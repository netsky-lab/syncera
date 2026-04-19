import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { EventEmitter } from "events";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

// Host-side path to bind-mount into pipeline containers. In dev this is the
// repo root (two levels up from apps/web). In production the web container
// runs pipelines via docker-out-of-docker on the host daemon; the bind-mount
// path must be a HOST path, not a container path, hence an explicit env var.
const REPO_ROOT =
  process.env.PIPELINE_HOST_REPO_ROOT ?? join(process.cwd(), "..", "..");

// Container-side path where the projects/ directory is mounted. This is
// what THIS (web) process writes run logs under. Usually /app/projects in
// production, ../../projects in dev.
const REPO_ROOT_CONTAINER_PATH = (() => {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
})();

// Compose network name pipeline containers attach to so they can reach
// searxng by service name. In dev that's searxng_default (from searxng repo);
// in production it's the deploy compose network (usually deploy_default).
const PIPELINE_NETWORK = process.env.PIPELINE_NETWORK ?? "searxng_default";

export interface RunEvent {
  type: "line" | "exit" | "error";
  line?: string;
  code?: number | null;
  error?: string;
  ts: number;
}

interface ActiveRun {
  id: string;
  topic: string;
  slug: string;
  proc: ChildProcess;
  emitter: EventEmitter;
  events: RunEvent[];
  status: "running" | "completed" | "failed";
  startedAt: number;
  exitCode: number | null;
}

const runs = new Map<string, ActiveRun>();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function startRun(topic: string, constraints?: string): { runId: string; slug: string } {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = slugify(topic);

  const args = [
    "run",
    "--rm",
    "--network",
    PIPELINE_NETWORK,
    "-v",
    `${REPO_ROOT}:/app`,
    "-w",
    "/app",
    "-e",
    `SEARXNG_URL=${process.env.SEARXNG_URL ?? "http://research-lab-searxng:8080"}`,
    "-e",
    `GEMMA_BASE_URL=${process.env.GEMMA_BASE_URL ?? ""}`,
    "-e",
    `GEMMA_MODEL=${process.env.GEMMA_MODEL ?? "qwen3.6-35b-a3b"}`,
    "-e",
    `GEMMA_API_KEY=${process.env.GEMMA_API_KEY ?? "dummy"}`,
    "--name",
    `rl-run-${runId}`,
    "oven/bun:1",
    "bun",
    "run",
    "src/run.ts",
    topic,
  ];
  if (constraints) args.push(constraints);

  // Use an absolute path + explicit PATH so the Next.js standalone runtime
  // (which may strip PATH) always finds docker in the production image.
  //
  // cwd must be a path that exists in the CURRENT container's filesystem;
  // REPO_ROOT is the HOST-side bind-mount path used for the spawned
  // pipeline container (-v arg), not the working directory of this process.
  const dockerBin = process.env.DOCKER_BIN ?? "/usr/bin/docker";
  const proc = spawn(dockerBin, args, {
    env: {
      ...process.env,
      PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
    },
  });
  const emitter = new EventEmitter();
  const events: RunEvent[] = [];

  const run: ActiveRun = {
    id: runId,
    topic,
    slug,
    proc,
    emitter,
    events,
    status: "running",
    startedAt: Date.now(),
    exitCode: null,
  };

  // Persist run metadata + events to disk so history survives restart.
  // Directory: projects/<slug>/runs/<runId>.{meta.json,jsonl}
  const runsDir = join(REPO_ROOT_CONTAINER_PATH, slug, "runs");
  try {
    mkdirSync(runsDir, { recursive: true });
  } catch {}
  const metaPath = join(runsDir, `${runId}.meta.json`);
  const jsonlPath = join(runsDir, `${runId}.jsonl`);
  const writeMeta = () => {
    try {
      writeFileSync(
        metaPath,
        JSON.stringify(
          {
            id: runId,
            topic,
            slug,
            status: run.status,
            startedAt: run.startedAt,
            endedAt: run.status !== "running" ? Date.now() : null,
            exitCode: run.exitCode,
          },
          null,
          2
        )
      );
    } catch {}
  };
  writeMeta();

  const pushLine = (line: string) => {
    if (!line.trim()) return;
    const ev: RunEvent = { type: "line", line, ts: Date.now() };
    events.push(ev);
    if (events.length > 2000) events.splice(0, events.length - 2000);
    emitter.emit("event", ev);
    try {
      require("fs").appendFileSync(jsonlPath, JSON.stringify(ev) + "\n");
    } catch {}
  };

  const handleChunk = (buf: Buffer) => {
    const text = buf.toString("utf-8");
    for (const line of text.split("\n")) pushLine(line);
  };

  proc.stdout?.on("data", handleChunk);
  proc.stderr?.on("data", handleChunk);

  proc.on("exit", (code) => {
    run.status = code === 0 ? "completed" : "failed";
    run.exitCode = code;
    const ev: RunEvent = { type: "exit", code, ts: Date.now() };
    events.push(ev);
    emitter.emit("event", ev);
    try {
      require("fs").appendFileSync(jsonlPath, JSON.stringify(ev) + "\n");
    } catch {}
    writeMeta();
  });

  proc.on("error", (err) => {
    run.status = "failed";
    const ev: RunEvent = { type: "error", error: err.message, ts: Date.now() };
    events.push(ev);
    emitter.emit("event", ev);
  });

  runs.set(runId, run);
  return { runId, slug };
}

export function getRun(runId: string): ActiveRun | undefined {
  return runs.get(runId);
}

export function listRuns(): {
  id: string;
  topic: string;
  slug: string;
  status: string;
  startedAt: number;
  exitCode: number | null;
  phase: string | null;
  lastLine: string | null;
}[] {
  // In-memory runs (current process lifetime)
  const memRuns = Array.from(runs.values())
    .map((r) => {
      // Peek the most recent "phase:" line so consumers see current phase.
      let phase: string | null = null;
      let lastLine: string | null = null;
      for (let i = r.events.length - 1; i >= 0 && i >= r.events.length - 60; i--) {
        const ev = r.events[i];
        if (ev?.line) {
          if (!lastLine) lastLine = ev.line.slice(0, 160);
          const m = ev.line.match(/\[phase:(\w+)\]/);
          if (m && !phase) {
            phase = m[1]!;
            break;
          }
        }
      }
      return {
        id: r.id,
        topic: r.topic,
        slug: r.slug,
        status: r.status,
        startedAt: r.startedAt,
        exitCode: r.exitCode,
        phase,
        lastLine,
      };
    });

  // Disk-persisted runs — scan projects/*/runs/*.meta.json
  const diskRuns: (typeof memRuns) = [];
  try {
    for (const slugDir of readdirSync(REPO_ROOT_CONTAINER_PATH, {
      withFileTypes: true,
    })) {
      if (!slugDir.isDirectory()) continue;
      const runsDir = join(REPO_ROOT_CONTAINER_PATH, slugDir.name, "runs");
      if (!existsSync(runsDir)) continue;
      for (const f of readdirSync(runsDir)) {
        if (!f.endsWith(".meta.json")) continue;
        try {
          const m = JSON.parse(readFileSync(join(runsDir, f), "utf-8"));
          const status: "running" | "completed" | "failed" =
            m.status === "running" || m.status === "failed" ? m.status : "completed";
          diskRuns.push({
            id: m.id,
            topic: m.topic ?? slugDir.name,
            slug: m.slug ?? slugDir.name,
            status,
            startedAt: m.startedAt ?? 0,
            exitCode: m.exitCode ?? null,
            phase: null,
            lastLine: null,
          });
        } catch {}
      }
    }
  } catch {}

  // Dedupe by runId, preferring in-memory (has phase/lastLine)
  const byId = new Map<string, (typeof memRuns)[number]>();
  for (const r of diskRuns) byId.set(r.id, r);
  for (const r of memRuns) byId.set(r.id, r);
  return Array.from(byId.values()).sort((a, b) => b.startedAt - a.startedAt);
}
