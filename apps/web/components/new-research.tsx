"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScopeChat } from "./scope-chat";

interface LogEvent {
  type: "line" | "exit" | "error";
  line?: string;
  code?: number | null;
  error?: string;
  ts: number;
}

function phaseFromLine(line: string): string | null {
  const m = line.match(/\[phase:(\w+)\]/);
  return m?.[1] ?? null;
}

// Question-first pipeline phases in emission order. Scout runs first on
// a brand-new topic; skipped on reruns with a cached digest.
const PHASES = [
  "scout",
  "plan",
  "harvest",
  "evidence",
  "verify",
  "analyze",
  "synth",
  "playbook",
] as const;
const PHASE_LABELS: Record<string, string> = {
  scout: "Scouting",
  plan: "Planning",
  harvest: "Harvesting",
  evidence: "Extracting facts",
  verify: "Verifying",
  analyze: "Analyzing",
  synth: "Synthesizing",
  playbook: "Compiling playbook",
  refine: "Refining",
};

// localStorage key carrying the last in-flight runId for this user so a
// page refresh doesn't wipe the live log view.
const LS_ACTIVE_RUN = "rl_active_run";

// Starter topics surfaced below the textarea. Chosen to cover different
// angles (comparative ML, applied chemistry, deployment trade-offs) so a
// fresh user sees the scope of what the tool handles.
const EXAMPLE_TOPICS: { label: string; topic: string }[] = [
  {
    label: "KV-cache compression",
    topic:
      "How to compress KV-cache to fit Qwen3.6-35B-A3B model into 4 GPU slots on RTX 5090 using TurboQuant or similar quantization methods",
  },
  {
    label: "Cosmetic formulation",
    topic:
      "How should a sunscreen cream formulation with titanium dioxide, ethylhexyl methoxycinnamate, and diethylamino hydroxybenzoyl hexyl benzoate perform on photostability and skin penetration?",
  },
  {
    label: "Battery longevity",
    topic:
      "What techniques extend lithium-ion battery cycle life in EV applications beyond 200,000 km, and how do solid-state cells compare on energy density and fast-charge tolerance?",
  },
  {
    label: "LLM fine-tuning",
    topic:
      "Compare LoRA, QLoRA, DoRA, and full fine-tuning on a 70B model for domain adaptation: VRAM footprint, task degradation, and inference latency impact",
  },
];

export function NewResearchForm() {
  const [topic, setTopic] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [sourcesMode, setSourcesMode] = useState(false);
  const [settingsMode, setSettingsMode] = useState(false);
  const [userSourcesText, setUserSourcesText] = useState("");
  const [depth, setDepth] = useState<"balanced" | "deep" | "max">("deep");
  const [targetSources, setTargetSources] = useState(250);
  const [minQuestions, setMinQuestions] = useState(8);
  const [parallelism, setParallelism] = useState(16);
  const [provider, setProvider] = useState("qwen");
  const [preferredSourceTypes, setPreferredSourceTypes] = useState(
    "primary papers, official docs, benchmarks"
  );
  const [runId, setRunId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "done" | "error">("idle");
  const logRef = useRef<HTMLDivElement>(null);

  // Resume-on-mount: if a run was in-flight on previous page load, reconnect.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_ACTIVE_RUN);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        runId: string;
        slug: string;
        topic: string;
      };
      // Only resume if the run still exists server-side.
      fetch(`/api/runs`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const found = (d?.runs ?? []).find(
            (r: any) => r.id === saved.runId
          );
          if (!found) {
            localStorage.removeItem(LS_ACTIVE_RUN);
            return;
          }
          setTopic(saved.topic);
          setSlug(saved.slug);
          setRunId(saved.runId);
          setStatus(found.status === "running" ? "running" : found.status === "completed" ? "done" : "error");
        })
        .catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/runs/stream?id=${runId}`);
    es.onmessage = (msg) => {
      try {
        const ev: LogEvent = JSON.parse(msg.data);
        setEvents((prev) => [...prev, ev]);

        if (ev.type === "line" && ev.line) {
          const phase = phaseFromLine(ev.line);
          if (phase) setCurrentPhase(phase);
        }
        if (ev.type === "exit") {
          setStatus(ev.code === 0 ? "done" : "error");
          try {
            localStorage.removeItem(LS_ACTIVE_RUN);
          } catch {}
          es.close();
        }
        if (ev.type === "error") {
          setStatus("error");
          try {
            localStorage.removeItem(LS_ACTIVE_RUN);
          } catch {}
          es.close();
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  async function submit() {
    if (!topic.trim() || topic.length < 4) return;
    setStatus("starting");
    const userSources = userSourcesText
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u));
    try {
      const resp = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          deep_settings: {
            depth,
            target_sources: targetSources,
            min_questions: minQuestions,
            parallelism,
            provider,
            preferred_source_types: preferredSourceTypes
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          },
          ...(userSources.length > 0 ? { user_sources: userSources } : {}),
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setRunId(data.runId);
        setSlug(data.slug);
        setStatus("running");
        try {
          localStorage.setItem(
            LS_ACTIVE_RUN,
            JSON.stringify({ runId: data.runId, slug: data.slug, topic })
          );
        } catch {}
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  function reset() {
    setRunId(null);
    setSlug(null);
    setEvents([]);
    setCurrentPhase(null);
    setStatus("idle");
    setTopic("");
    try {
      localStorage.removeItem(LS_ACTIVE_RUN);
    } catch {}
  }

  if (!expanded && status === "idle") {
    return (
      <Card
        className="border-dashed cursor-pointer hover:border-primary/60 transition-colors"
        onClick={() => setExpanded(true)}
      >
        <CardContent className="py-5 px-5 flex items-center gap-3 text-sm">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-primary font-semibold">
            +
          </div>
          <div className="text-muted-foreground">
            Start new research — enter a topic, engine runs scout → plan → harvest → evidence → verify → analyze → synth
          </div>
        </CardContent>
      </Card>
    );
  }

  // Chat mode takes over the card when the user clicks "Discuss scope".
  // On successful run start, callback flips us back to the normal
  // running-status view (shared with direct-start path).
  if (chatMode && status === "idle") {
    return (
      <ScopeChat
        initialTopic={topic}
        onCancel={() => setChatMode(false)}
        onRunStarted={(newRunId, newSlug) => {
          setRunId(newRunId);
          setSlug(newSlug);
          setStatus("running");
          setChatMode(false);
          try {
            localStorage.setItem(
              LS_ACTIVE_RUN,
              JSON.stringify({ runId: newRunId, slug: newSlug, topic })
            );
          } catch {}
        }}
      />
    );
  }

  return (
    <Card className={status === "idle" ? "" : "border-primary/40"}>
      <CardContent className="py-5 px-5 space-y-4">
        {(status === "idle" || status === "starting") && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">New research</div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                cancel
              </button>
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. How to compress KV-cache to fit Gemma model into 4 GPU slots on RTX 5090"
              className="w-full min-h-[80px] px-3 py-2 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={status === "starting"}
              autoFocus
            />
            {sourcesMode && (
              <div className="space-y-1">
                <div className="text-[11px] text-fg-muted">
                  Paste URLs (one per line) — pipeline skips search+harvest
                  and uses only these sources for evidence.
                </div>
                <textarea
                  value={userSourcesText}
                  onChange={(e) => setUserSourcesText(e.target.value)}
                  placeholder="https://arxiv.org/abs/2310.12345&#10;https://www.biorxiv.org/..."
                  rows={4}
                  disabled={status === "starting"}
                  className="w-full px-3 py-2 text-[12.5px] font-mono rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 resize-y"
                />
                <div className="text-[11px] text-fg-muted">
                  {
                    userSourcesText
                      .split(/\s+/)
                      .filter((u) => /^https?:\/\//.test(u.trim())).length
                  }{" "}
                  valid URLs · max 100
                </div>
              </div>
            )}
            {settingsMode && (
              <div className="grid gap-3 rounded-md border border-fg/[0.08] bg-ink-900 p-3 md:grid-cols-2">
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Depth</span>
                  <select
                    value={depth}
                    onChange={(e) => setDepth(e.target.value as typeof depth)}
                    disabled={status === "starting"}
                    className="h-8 w-full rounded border border-ink-500 bg-ink-800 px-2 text-[12px] text-fg"
                  >
                    <option value="balanced">Balanced</option>
                    <option value="deep">Deep</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Provider</span>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    disabled={status === "starting"}
                    className="h-8 w-full rounded border border-ink-500 bg-ink-800 px-2 text-[12px] text-fg"
                  >
                    <option value="qwen">Qwen</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Min questions: {minQuestions}</span>
                  <input
                    type="range"
                    min={5}
                    max={20}
                    value={minQuestions}
                    onChange={(e) => setMinQuestions(Number(e.target.value))}
                    disabled={status === "starting"}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Target sources: {targetSources}</span>
                  <input
                    type="range"
                    min={50}
                    max={500}
                    step={25}
                    value={targetSources}
                    onChange={(e) => setTargetSources(Number(e.target.value))}
                    disabled={status === "starting"}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Parallelism: {parallelism}</span>
                  <input
                    type="range"
                    min={4}
                    max={64}
                    step={4}
                    value={parallelism}
                    onChange={(e) => setParallelism(Number(e.target.value))}
                    disabled={status === "starting"}
                    className="w-full"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-fg-muted">
                  <span>Preferred source types</span>
                  <input
                    value={preferredSourceTypes}
                    onChange={(e) => setPreferredSourceTypes(e.target.value)}
                    disabled={status === "starting"}
                    className="h-8 w-full rounded border border-ink-500 bg-ink-800 px-2 text-[12px] text-fg"
                  />
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Try:</span>
              {EXAMPLE_TOPICS.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setTopic(ex.topic)}
                  className="px-2 py-0.5 rounded border border-border/60 hover:border-primary/50 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                  title={ex.topic}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5 text-[11px] text-fg-muted">
                <div>Deep mode target: up to 400 sources · typical time: 30-90 min.</div>
                <div>Qwen profile: 16 slots / 64k context · Gemini search can still supplement harvest.</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setSettingsMode((s) => !s)}
                  disabled={status === "starting"}
                  className={`h-9 px-3 rounded-md border text-[12px] font-medium transition disabled:opacity-50 inline-flex items-center gap-1.5 ${
                    settingsMode
                      ? "bg-accent-primary/10 border-accent-primary/40 text-accent-primary"
                      : "bg-ink-800 border-fg/[0.08] hover:bg-ink-700"
                  }`}
                  title="Configure research depth, sources and provider"
                >
                  Settings
                </button>
                <button
                  onClick={() => setSourcesMode((s) => !s)}
                  disabled={status === "starting"}
                  className={`h-9 px-3 rounded-md border text-[12px] font-medium transition disabled:opacity-50 inline-flex items-center gap-1.5 ${
                    sourcesMode
                      ? "bg-accent-primary/10 border-accent-primary/40 text-accent-primary"
                      : "bg-ink-800 border-fg/[0.08] hover:bg-ink-700"
                  }`}
                  title="Bring your own source URLs instead of web search"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M3 2h6l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8 2v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                  </svg>
                  Bring sources
                </button>
                <button
                  onClick={() => setChatMode(true)}
                  disabled={!topic.trim() || topic.length < 4 || status === "starting"}
                  className="h-9 px-3 rounded-md bg-ink-800 border border-fg/[0.08] hover:bg-ink-700 text-[12px] font-medium transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                  title="Quick chat to pin down domain and scope before starting"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M2 4.5A1.5 1.5 0 0 1 3.5 3h7A1.5 1.5 0 0 1 12 4.5v4A1.5 1.5 0 0 1 10.5 10H7l-2.5 2.5V10H3.5A1.5 1.5 0 0 1 2 8.5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Discuss scope
                </button>
                <button
                  onClick={submit}
                  disabled={!topic.trim() || topic.length < 4 || status === "starting"}
                  className="h-9 px-4 rounded-md bg-accent-primary text-ink-900 text-[13px] font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === "starting" ? "Starting…" : "Run now"}
                </button>
              </div>
            </div>
          </>
        )}

        {status === "running" || status === "done" || status === "error" ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">Topic</div>
                <div className="text-sm font-medium truncate">{topic}</div>
              </div>
              <Badge
                variant="outline"
                className={
                  status === "done"
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : status === "error"
                    ? "bg-red-500/15 text-red-300 border-red-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                }
              >
                {status === "done" ? "done" : status === "error" ? "failed" : "running"}
              </Badge>
            </div>

            {/* Phase progress */}
            <div className="flex items-center gap-1.5">
              {PHASES.map((p) => {
                const i = PHASES.indexOf(p);
                const cur = currentPhase ? PHASES.indexOf(currentPhase as typeof PHASES[number]) : -1;
                const state =
                  cur === -1
                    ? "pending"
                    : i < cur
                    ? "done"
                    : i === cur
                    ? status === "done"
                      ? "done"
                      : "active"
                    : "pending";
                return (
                  <div key={p} className="flex-1">
                    <div
                      className={
                        "h-1 rounded-full " +
                        (state === "done"
                          ? "bg-emerald-500"
                          : state === "active"
                          ? "bg-amber-500 animate-pulse"
                          : "bg-muted")
                      }
                    />
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground text-center mt-1">
                      {PHASE_LABELS[p]}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Log stream */}
            <div
              ref={logRef}
              className="max-h-64 overflow-y-auto bg-zinc-950 rounded-md border text-[11px] font-mono leading-5 px-3 py-2"
            >
              {events.length === 0 && (
                <div className="text-muted-foreground italic">Waiting for output…</div>
              )}
              {events.map((ev, i) => {
                if (ev.type === "line") {
                  return (
                    <div key={i} className="whitespace-pre-wrap break-words text-zinc-300">
                      {ev.line}
                    </div>
                  );
                }
                if (ev.type === "exit") {
                  return (
                    <div key={i} className={ev.code === 0 ? "text-emerald-400" : "text-red-400"}>
                      [exit code {ev.code}]
                    </div>
                  );
                }
                return (
                  <div key={i} className="text-red-400">
                    [error] {ev.error}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              {slug && status === "done" ? (
                <a
                  href={`/projects/${slug}`}
                  className="text-sm text-primary underline underline-offset-2"
                >
                  Open project →
                </a>
              ) : (
                <span />
              )}
              <Button variant="outline" size="sm" onClick={reset}>
                Clear
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
