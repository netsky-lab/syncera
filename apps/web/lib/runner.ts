import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { EventEmitter } from "events";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "fs";

// Host-side path to bind-mount into pipeline containers. In dev this is the
// repo root (two levels up from apps/web). In production the web container
// runs pipelines via docker-out-of-docker on the host daemon; the bind-mount
// path must be a HOST path, not a container path, hence an explicit env var.
// Resolved per-call — a static process.cwd() at module init trips Next 16's
// NFT warning ("whole project traced unintentionally") and also fails tests
// that would want to override the env.
function repoRoot(): string {
  // turbopackIgnore hints: these runtime paths mustn't trip NFT into tracing
  // the whole monorepo into the standalone bundle.
  return (
    process.env.PIPELINE_HOST_REPO_ROOT ??
    join(process.cwd(),"..", "..")
  );
}

// Container-side path where the projects/ directory is mounted. This is
// what THIS (web) process writes run logs under. Usually /app/projects in
// production, ../../projects in dev.
function repoRootContainerPath(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(),"projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(),"..", "..", "projects");
}

// Compose network name pipeline containers attach to so they can reach
// searxng by service name. In dev that's searxng_default (from searxng repo);
// in production it's the deploy compose network (usually deploy_default).
function pipelineNetwork(): string {
  return process.env.PIPELINE_NETWORK ?? "searxng_default";
}

function pipelineSearxngUrl(): string {
  if (process.env.PIPELINE_SEARXNG_URL) return process.env.PIPELINE_SEARXNG_URL;
  if (process.env.SEARXNG_URL) return process.env.SEARXNG_URL;
  return pipelineNetwork() === "searxng_default"
    ? "http://searxng-core:8080"
    : "http://research-lab-searxng:8080";
}

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
  ownerUid: string | null; // who kicked this off — addressee for webhook
  // Latest [phase:X] tag seen in stdout. Sticky across `[deep]`/`[extract]`
  // noise — harvester emits `[phase:harvest]` once then spams harvest-internal
  // log lines, so a fixed look-back window over recent events would miss the
  // phase tag and show null. We capture it on the fly instead.
  lastPhase: string | null;
  lastLine: string | null;
}

const runs = new Map<string, ActiveRun>();

function hasAttachedDockerRunClient(runId: string): boolean {
  try {
    const dockerBin = process.env.DOCKER_BIN ?? "/usr/bin/docker";
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const ps = spawnSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf-8",
    });
    if (ps.status !== 0) return false;
    return ps.stdout
      .split("\n")
      .some(
        (line) =>
          line.includes(`${dockerBin} run`) &&
          line.includes(`rl-run-${runId}`)
      );
  } catch {
    return false;
  }
}

// Re-attach to orphaned pipeline containers on web-container startup. If
// the web process was rebuilt (docker compose up -d) while pipelines
// were mid-run, they kept going but our stdout-pipe into events.jsonl
// ended. Here we find each meta.json with status=running, check whether
// its sibling container is still alive, and — if so — spawn a
// `docker logs --follow` subprocess that re-streams into the same
// events.jsonl. If the container is dead, mark meta as failed so the UI
// stops reporting it as running.
let reattached = false;
function reattachOrphans() {
  if (reattached) return;
  reattached = true;
  try {
    const root = repoRootContainerPath();
    if (!existsSync(root)) return;
    for (const slugDir of readdirSync(root, { withFileTypes: true })) {
      if (!slugDir.isDirectory()) continue;
      const runsDir = join(root, slugDir.name, "runs");
      if (!existsSync(runsDir)) continue;
      for (const f of readdirSync(runsDir)) {
        if (!f.endsWith(".meta.json")) continue;
        let meta: any;
        try {
          meta = JSON.parse(readFileSync(join(runsDir, f), "utf-8"));
        } catch {
          continue;
        }
        if (meta.status !== "running") continue;
        if (runs.has(meta.id) || hasAttachedDockerRunClient(meta.id)) continue;

        // Ask docker whether the container is still alive.
        const dockerBin = process.env.DOCKER_BIN ?? "/usr/bin/docker";
        const { spawnSync } = require("child_process") as typeof import("child_process");
        const inspect = spawnSync(
          dockerBin,
          ["inspect", "-f", "{{.State.Status}}", `rl-run-${meta.id}`],
          {
            env: {
              ...process.env,
              PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
            },
            encoding: "utf-8",
          }
        );
        const containerState = inspect.stdout?.trim() ?? "";
        const alive =
          inspect.status === 0 &&
          (containerState === "running" || containerState === "restarting");

        if (!alive) {
          // Container died while web was down. Mark meta as failed so
          // listRuns stops showing it as running and the UI doesn't
          // render an endless "scout…" pill.
          try {
            meta.status = "failed";
            meta.endedAt = Date.now();
            meta.exitCode = null;
            meta.orphaned = true;
            writeFileSync(join(runsDir, f), JSON.stringify(meta, null, 2));
          } catch {}
          continue;
        }

        console.log(
          `[runner] re-attaching to orphan pipeline rl-run-${meta.id} (${slugDir.name})`
        );

        const jsonlPath = join(runsDir, `${meta.id}.jsonl`);
        const emitter = new EventEmitter();
        const events: RunEvent[] = [];
        // Prime events from disk so in-memory replay for SSE clients
        // includes the pre-restart history.
        if (existsSync(jsonlPath)) {
          try {
            const tail = readFileSync(jsonlPath, "utf-8");
            for (const line of tail.split("\n")) {
              if (!line.trim()) continue;
              try {
                const ev = JSON.parse(line);
                if (ev.type && ev.ts) events.push(ev);
              } catch {}
            }
            if (events.length > 2000) events.splice(0, events.length - 2000);
          } catch {}
        }

        // Reconstruct phase + lastLine from events for the phase pill.
        let lastPhase: string | null = null;
        let lastLine: string | null = null;
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (ev?.type === "line" && typeof ev.line === "string") {
            if (!lastLine) lastLine = ev.line;
            const pm = ev.line.match(/\[phase:(\w+)\]/);
            if (pm) {
              lastPhase = pm[1] ?? null;
              break;
            }
          }
        }

        const logsProc = spawn(
          dockerBin,
          ["logs", "--follow", "--tail", "0", `rl-run-${meta.id}`],
          {
            env: {
              ...process.env,
              PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
            },
          }
        );

        const run: ActiveRun = {
          id: meta.id,
          topic: meta.topic ?? slugDir.name,
          slug: meta.slug ?? slugDir.name,
          proc: logsProc,
          emitter,
          events,
          status: "running",
          startedAt: meta.startedAt ?? Date.now(),
          exitCode: null,
          ownerUid: null, // best-effort; project.owner is the authority
          lastPhase,
          lastLine,
        };

        const pushLine = (line: string) => {
          if (!line.trim()) return;
          const ev: RunEvent = { type: "line", line, ts: Date.now() };
          events.push(ev);
          if (events.length > 2000) events.splice(0, events.length - 2000);
          emitter.emit("event", ev);
          try {
            appendFileSync(jsonlPath, JSON.stringify(ev) + "\n");
          } catch {}
          const pm = line.match(/\[phase:(\w+)\]/);
          if (pm) run.lastPhase = pm[1] ?? run.lastPhase;
          run.lastLine = line;
        };

        let buf = "";
        const onChunk = (chunk: Buffer) => {
          buf += chunk.toString("utf-8");
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            pushLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        };
        logsProc.stdout?.on("data", onChunk);
        logsProc.stderr?.on("data", onChunk);

        logsProc.on("exit", (code) => {
          if (buf) pushLine(buf);
          // Query the sibling container's real exit code — docker logs
          // exiting doesn't tell us whether the pipeline succeeded.
          let containerState = "";
          try {
            const stateInspect = spawnSync(
              dockerBin,
              ["inspect", "-f", "{{.State.Status}}", `rl-run-${meta.id}`],
              {
                env: {
                  ...process.env,
                  PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
                },
                encoding: "utf-8",
              }
            );
            containerState = stateInspect.stdout?.trim() ?? "";
            if (containerState === "running" || containerState === "restarting") {
              return;
            }
            const inspect2 = spawnSync(
              dockerBin,
              ["inspect", "-f", "{{.State.ExitCode}}", `rl-run-${meta.id}`],
              {
                env: {
                  ...process.env,
                  PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
                },
                encoding: "utf-8",
              }
            );
            const realCode = parseInt(inspect2.stdout?.trim() ?? "", 10);
            run.status = realCode === 0 ? "completed" : "failed";
            run.exitCode = Number.isFinite(realCode) ? realCode : null;
          } catch {
            run.status = "failed";
          }
          const exitEv: RunEvent = {
            type: "exit",
            code: run.exitCode,
            ts: Date.now(),
          };
          events.push(exitEv);
          emitter.emit("event", exitEv);
          try {
            appendFileSync(jsonlPath, JSON.stringify(exitEv) + "\n");
          } catch {}
          try {
            meta.status = run.status;
            meta.endedAt = Date.now();
            meta.exitCode = run.exitCode;
            writeFileSync(join(runsDir, f), JSON.stringify(meta, null, 2));
          } catch {}
        });

        runs.set(meta.id, run);
      }
    }
  } catch (err: any) {
    console.warn(`[runner] reattachOrphans failed: ${err?.message ?? err}`);
  }
}

function ensureOrphansReattached() {
  // Importing this module during `next build` or unit tests must not spawn
  // `docker logs --follow` sidecars. Runtime API calls perform the attach.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "test") return;
  reattachOrphans();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// Extract the phase name from a pipeline log line emitted by src/run.ts.
// Lines look like "[phase:harvest] Collecting sources...". The active-runs
// UI uses this to drive the timeline; a regex miss means the wrong pill
// lights up.
export function phaseFromLine(line: string): string | null {
  const m = line.match(/\[phase:(\w+)\]/);
  return m?.[1] ?? null;
}

export function startRun(
  topic: string,
  constraints?: string,
  ownerUid: string | null = null,
  opts?: {
    forceSlug?: string;
    extraArgs?: string[];
    userSources?: string[];
    env?: Record<string, string>;
  }
): { runId: string; slug: string } {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // If the caller pins a slug (Extend flow pre-copies source artifacts
  // into <sourceSlug>-<ext>-<tail>), honor it instead of slugifying the
  // topic. The pipeline reads FORCE_SLUG on its side via env.
  let slug = opts?.forceSlug || slugify(topic);

  // Collision guard + pre-claim ownership BEFORE spawning the pipeline
  // container. The pipeline runs as root inside its container and creates
  // the project dir first-to-win; if the web (app=1001) process tries to
  // write `.owner` after that, permission denied. So: we mkdir the
  // project dir here as app, write `.owner` first, then let the root-owned
  // pipeline drop its artifacts inside the dir we already own.
  if (ownerUid) {
    try {
      const { getOwner, setOwner } =
        require("@/lib/projects") as typeof import("./projects");
      const existingOwner = getOwner(slug);
      if (existingOwner && existingOwner !== ownerUid && !opts?.forceSlug) {
        const suffix = ownerUid.replace(/^u_/, "").slice(0, 6);
        slug = `${slug}-${suffix}`;
      }
      const projectDir = join(repoRootContainerPath(), slug);
      mkdirSync(projectDir, { recursive: true });
      if (!getOwner(slug)) setOwner(slug, ownerUid);
      // Stage user-curated URL list so the pipeline picks it up via
      // USER_SOURCES_FILE env. Pipeline reads the file on startup,
      // skips scout+harvest, ingests URLs via Jina Reader.
      if (opts?.userSources && opts.userSources.length > 0) {
        writeFileSync(
          join(projectDir, "user_sources.json"),
          JSON.stringify(
            { urls: opts.userSources, submitted_at: Date.now() },
            null,
            2
          )
        );
      }
    } catch (err: any) {
      console.warn(`[runner] ownership pre-claim failed: ${err?.message}`);
    }
  }

  const args = [
    "run",
    "--rm",
    "--network",
    pipelineNetwork(),
    "-v",
    `${repoRoot()}:/app`,
    "-w",
    "/app",
    "-e",
    `SEARXNG_URL=${pipelineSearxngUrl()}`,
    "-e",
    `LLM_PROVIDER=${process.env.LLM_PROVIDER ?? ""}`,
    "-e",
    `LLM_STREAM=${process.env.LLM_STREAM ?? ""}`,
    "-e",
    `LLM_REQUEST_TIMEOUT_MS=${process.env.LLM_REQUEST_TIMEOUT_MS ?? ""}`,
    "-e",
    `LLM_REASONING_EFFORT=${process.env.LLM_REASONING_EFFORT ?? ""}`,
    "-e",
    `LLM_INPUT_USD_PER_1M=${process.env.LLM_INPUT_USD_PER_1M ?? ""}`,
    "-e",
    `LLM_OUTPUT_USD_PER_1M=${process.env.LLM_OUTPUT_USD_PER_1M ?? ""}`,
    "-e",
    `QWEN_BASE_URL=${process.env.QWEN_BASE_URL ?? ""}`,
    "-e",
    `QWEN_MODEL=${process.env.QWEN_MODEL ?? ""}`,
    "-e",
    `QWEN_API_KEY=${process.env.QWEN_API_KEY ?? ""}`,
    "-e",
    `QWEN_FALLBACK_URLS=${process.env.QWEN_FALLBACK_URLS ?? ""}`,
    "-e",
    `GEMINI_OPENAI_BASE_URL=${process.env.GEMINI_OPENAI_BASE_URL ?? ""}`,
    "-e",
    `GEMINI_NATIVE_BASE_URL=${process.env.GEMINI_NATIVE_BASE_URL ?? ""}`,
    "-e",
    `GEMINI_MODEL=${process.env.GEMINI_MODEL ?? ""}`,
    "-e",
    `GEMINI_API_KEY=${process.env.GEMINI_API_KEY ?? ""}`,
    "-e",
    `GEMINI_REASONING_EFFORT=${process.env.GEMINI_REASONING_EFFORT ?? ""}`,
    "-e",
    `GEMINI_SEARCH_GROUNDING=${process.env.GEMINI_SEARCH_GROUNDING ?? ""}`,
    "-e",
    `GEMINI_SEARCH_MODEL=${process.env.GEMINI_SEARCH_MODEL ?? ""}`,
    "-e",
    `GEMINI_SEARCH_MAX_RESULTS=${process.env.GEMINI_SEARCH_MAX_RESULTS ?? ""}`,
    "-e",
    `GEMINI_SEARCH_TIMEOUT_MS=${process.env.GEMINI_SEARCH_TIMEOUT_MS ?? ""}`,
    "-e",
    `CONCURRENCY_HARVEST=${process.env.CONCURRENCY_HARVEST ?? ""}`,
    "-e",
    `CONCURRENCY_EVIDENCE=${process.env.CONCURRENCY_EVIDENCE ?? ""}`,
    "-e",
    `CONCURRENCY_ANALYZER=${process.env.CONCURRENCY_ANALYZER ?? ""}`,
    "-e",
    `CONCURRENCY_RELEVANCE=${process.env.CONCURRENCY_RELEVANCE ?? ""}`,
    "-e",
    `CONCURRENCY_VERIFIER=${process.env.CONCURRENCY_VERIFIER ?? ""}`,
    "-e",
    `HARVEST_BREADTH=${process.env.HARVEST_BREADTH ?? ""}`,
    "-e",
    `HARVEST_DEPTH=${process.env.HARVEST_DEPTH ?? ""}`,
    "-e",
    `HARVEST_PAGES_PER_QUERY=${process.env.HARVEST_PAGES_PER_QUERY ?? ""}`,
    "-e",
    `HARVEST_URLS_PER_QUERY=${process.env.HARVEST_URLS_PER_QUERY ?? ""}`,
    "-e",
    `HARVEST_READ_CONCURRENCY=${process.env.HARVEST_READ_CONCURRENCY ?? ""}`,
    "-e",
    `MAX_HARVEST_MINUTES=${process.env.MAX_HARVEST_MINUTES ?? ""}`,
    "-e",
    `MAX_HARVEST_SOURCES=${process.env.MAX_HARVEST_SOURCES ?? ""}`,
    "-e",
    `SNOWBALL_MAX_PAPERS=${process.env.SNOWBALL_MAX_PAPERS ?? ""}`,
    "-e",
    `GEMMA_BASE_URL=${process.env.GEMMA_BASE_URL ?? ""}`,
    "-e",
    `GEMMA_MODEL=${process.env.GEMMA_MODEL ?? "qwen3.6-35b-a3b"}`,
    "-e",
    `GEMMA_API_KEY=${process.env.GEMMA_API_KEY ?? "dummy"}`,
    ...(ownerUid ? ["-e", `OWNER_UID=${ownerUid}`] : []),
    ...(opts?.forceSlug ? ["-e", `FORCE_SLUG=${opts.forceSlug}`] : []),
    ...(opts?.userSources && opts.userSources.length > 0
      ? ["-e", `USER_SOURCES_FILE=/app/projects/${slug}/user_sources.json`]
      : []),
    ...(opts?.env
      ? Object.entries(opts.env).flatMap(([key, value]) => [
          "-e",
          `${key}=${value}`,
        ])
      : []),
    "--name",
    `rl-run-${runId}`,
    "oven/bun:1",
    "bun",
    "run",
    "src/run.ts",
    topic,
  ];
  if (constraints) args.push(constraints);
  if (opts?.extraArgs && opts.extraArgs.length > 0) {
    args.push(...opts.extraArgs);
  }

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
    ownerUid,
    lastPhase: null,
    lastLine: null,
  };

  // Persist run metadata + events to disk so history survives restart.
  // Directory: projects/<slug>/runs/<runId>.{meta.json,jsonl}
  // (The project dir + .owner were already created above before spawn.)
  const runsDir = join(repoRootContainerPath(), slug, "runs");
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
    // Track latest phase tag + last readable line so listRuns can surface
    // accurate progress without scanning events on every poll.
    const pm = line.match(/\[phase:(\w+)\]/);
    if (pm) run.lastPhase = pm[1]!;
    run.lastLine = line.slice(0, 160);
    try {
      appendFileSync(jsonlPath, JSON.stringify(ev) + "\n");
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
      appendFileSync(jsonlPath, JSON.stringify(ev) + "\n");
    } catch {}
    writeMeta();

    // Fire-and-forget webhook to the run owner's configured target. Keep
    // the runner itself synchronous — deliver() has its own timeout +
    // retries and never throws.
    if (ownerUid) {
      const { getWebhookTarget } = require("@/lib/users") as typeof import("./users");
      const { fireWebhook } = require("@/lib/webhook") as typeof import("./webhook");
      const target = getWebhookTarget(ownerUid);
      if (target) {
        void fireWebhook(target, {
          event: run.status === "completed" ? "run.completed" : "run.failed",
          runId,
          slug,
          topic,
          status: run.status as "completed" | "failed",
          exitCode: run.exitCode,
          startedAt: run.startedAt,
          finishedAt: Date.now(),
        });
      }
    }
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

/**
 * Request cancellation of a running pipeline. Sends SIGKILL to the spawned
 * `docker run` process, then issues `docker kill rl-run-<id>` to reach the
 * actual pipeline container (SIGKILL to the docker client doesn't
 * propagate). Idempotent — already-finished runs return `ok: false`.
 */
export async function cancelRun(runId: string): Promise<{ ok: boolean; reason?: string }> {
  ensureOrphansReattached();
  const run = runs.get(runId);
  const dockerKill = () => {
    try {
      const dockerBin = process.env.DOCKER_BIN ?? "/usr/bin/docker";
      const { spawnSync } = require("child_process") as typeof import("child_process");
      const res = spawnSync(dockerBin, ["kill", `rl-run-${runId}`], {
        env: {
          ...process.env,
          PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}`,
        },
        encoding: "utf-8",
      });
      return {
        killed: res.status === 0,
        status: res.status,
        stderr: res.stderr?.trim() ?? "",
      };
    } catch (err: any) {
      return { killed: false, status: -1, stderr: String(err?.message ?? err) };
    }
  };

  if (run) {
    if (run.status !== "running") {
      return { ok: false, reason: `Run status is ${run.status}` };
    }
    try { run.proc.kill("SIGKILL"); } catch {}
    const r = dockerKill();
    if (!r.killed) console.warn(`[runner] docker kill rl-run-${runId} soft-fail: ${r.stderr}`);
    run.status = "failed";
    run.exitCode = null;
    const ev: RunEvent = {
      type: "error",
      error: "Cancelled by user",
      ts: Date.now(),
    };
    run.events.push(ev);
    run.emitter.emit("event", ev);
    return { ok: true };
  }

  // Fallback: web container restarted after pipeline spawn, so the
  // ActiveRun object is gone but the sibling container is still alive.
  // Find the meta.json on disk, docker-kill the container, and write a
  // cancelled meta so /api/runs stops reporting it as running.
  const disk = findDiskRun(runId);
  if (!disk) return { ok: false, reason: "Run not found" };
  const r = dockerKill();
  try {
    const metaPath = join(disk.runsDir, `${runId}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    meta.status = "failed";
    meta.endedAt = Date.now();
    meta.exitCode = null;
    meta.cancelled = true;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    const jsonlPath = join(disk.runsDir, `${runId}.jsonl`);
    appendFileSync(
      jsonlPath,
      JSON.stringify({
        type: "error",
        error: "Cancelled by user (post-restart)",
        ts: Date.now(),
      }) + "\n"
    );
  } catch (err: any) {
    console.warn(`[runner] disk-cancel meta update failed: ${err?.message ?? err}`);
  }
  if (!r.killed) {
    return {
      ok: true,
      reason: `Container kill soft-fail (may have already exited): ${r.stderr}`,
    };
  }
  return { ok: true };
}

// Locate {runsDir, slug, ownerUid} for a runId by scanning project dirs.
// Used after web restart to authz + cancel runs whose in-memory state
// was lost.
function findDiskRun(
  runId: string
): { runsDir: string; slug: string; ownerUid: string | null } | null {
  try {
    for (const d of readdirSync(repoRootContainerPath(), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const runsDir = join(repoRootContainerPath(), d.name, "runs");
      const metaPath = join(runsDir, `${runId}.meta.json`);
      if (existsSync(metaPath)) {
        let ownerUid: string | null = null;
        try {
          const owner = readFileSync(
            join(repoRootContainerPath(), d.name, ".owner"),
            "utf-8"
          ).trim();
          if (owner) ownerUid = owner;
        } catch {}
        return { runsDir, slug: d.name, ownerUid };
      }
    }
  } catch {}
  return null;
}

export function getRun(runId: string): ActiveRun | undefined {
  ensureOrphansReattached();
  return runs.get(runId);
}

// Lighter lookup used by the cancel route — returns status + owner for
// both in-memory and disk-only runs (the latter appear after a web
// container restart while the pipeline sibling is still running).
export function getRunMeta(
  runId: string
): { status: string; ownerUid: string | null; slug: string } | undefined {
  ensureOrphansReattached();
  const mem = runs.get(runId);
  if (mem) {
    return { status: mem.status, ownerUid: mem.ownerUid, slug: mem.slug };
  }
  const disk = findDiskRun(runId);
  if (!disk) return undefined;
  try {
    const metaPath = join(disk.runsDir, `${runId}.meta.json`);
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    return {
      status: meta.status ?? "unknown",
      ownerUid: disk.ownerUid,
      slug: disk.slug,
    };
  } catch {
    return undefined;
  }
}

export function listRuns(viewerUid: string | null = null, viewerIsAdmin = false): {
  id: string;
  topic: string;
  slug: string;
  status: string;
  startedAt: number;
  exitCode: number | null;
  phase: string | null;
  lastLine: string | null;
  owner_uid: string | null;
}[] {
  ensureOrphansReattached();
  // Visibility: you see runs you own + runs on projects you can view.
  // Admin sees everything (god viewer). Non-auth sees nothing.
  const { canView } = require("@/lib/projects") as typeof import("./projects");
  const canSeeRun = (ownerUid: string | null, slug: string): boolean => {
    if (viewerIsAdmin) return true;
    if (ownerUid && ownerUid === viewerUid) return true;
    return canView(slug, viewerUid);
  };

  // In-memory runs (current process lifetime). `lastPhase` + `lastLine`
  // are captured by pushLine on every stdout chunk — no event scan here.
  const memRuns = Array.from(runs.values())
    .filter((r) => canSeeRun(r.ownerUid, r.slug))
    .map((r) => {
      return {
        id: r.id,
        topic: r.topic,
        slug: r.slug,
        status: r.status,
        startedAt: r.startedAt,
        exitCode: r.exitCode,
        phase: r.lastPhase,
        lastLine: r.lastLine,
        owner_uid: r.ownerUid,
      };
    });

  // Disk-persisted runs — scan projects/*/runs/*.meta.json
  const diskRuns: (typeof memRuns) = [];
  try {
    for (const slugDir of readdirSync(repoRootContainerPath(), {
      withFileTypes: true,
    })) {
      if (!slugDir.isDirectory()) continue;
      const runsDir = join(repoRootContainerPath(), slugDir.name, "runs");
      if (!existsSync(runsDir)) continue;
      // Gate by project visibility — runs belong to the project.
      if (!canSeeRun(null, slugDir.name)) continue;
      for (const f of readdirSync(runsDir)) {
        if (!f.endsWith(".meta.json")) continue;
        try {
          const m = JSON.parse(readFileSync(join(runsDir, f), "utf-8"));
          const status: "running" | "completed" | "failed" =
            m.status === "running" || m.status === "failed" ? m.status : "completed";
          // Reconstruct phase + lastLine from events.jsonl so the live
          // pipeline widget stays lit after a web-container restart.
          // Without this, meta.json.status="running" with phase=null
          // makes the UI show no active stage even though the pipeline
          // container is still working.
          let phase: string | null = null;
          let lastLine: string | null = null;
          if (status === "running") {
            const jsonlPath = join(runsDir, `${m.id}.jsonl`);
            if (existsSync(jsonlPath)) {
              try {
                // Tail the file — 32KB is plenty for last-phase recovery.
                const buf = readFileSync(jsonlPath, "utf-8");
                const tail = buf.slice(Math.max(0, buf.length - 32_000));
                const lines = tail.split("\n").filter(Boolean);
                for (let i = lines.length - 1; i >= 0; i--) {
                  try {
                    const ev = JSON.parse(lines[i]!);
                    if (ev.type === "line" && typeof ev.line === "string") {
                      if (!lastLine) lastLine = ev.line;
                      const pm = ev.line.match(/\[phase:(\w+)\]/);
                      if (pm) {
                        phase = pm[1] ?? null;
                        break;
                      }
                    }
                  } catch {}
                }
              } catch {}
            }
          }
          diskRuns.push({
            id: m.id,
            topic: m.topic ?? slugDir.name,
            slug: m.slug ?? slugDir.name,
            status,
            startedAt: m.startedAt ?? 0,
            exitCode: m.exitCode ?? null,
            phase,
            lastLine,
            owner_uid: null,
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
