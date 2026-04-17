"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LogEvent {
  type: "line" | "exit" | "error";
  line?: string;
  code?: number | null;
  error?: string;
  ts: number;
}

function phaseFromLine(line: string): string | null {
  if (line.includes("[phase:plan]")) return "plan";
  if (line.includes("[phase:harvest]")) return "harvest";
  if (line.includes("[phase:evidence]")) return "evidence";
  if (line.includes("[phase:critic]")) return "critic";
  if (line.includes("[phase:synth]")) return "synth";
  return null;
}

const PHASES = ["plan", "harvest", "evidence", "critic", "synth"] as const;
const PHASE_LABELS: Record<string, string> = {
  plan: "Planning",
  harvest: "Harvesting",
  evidence: "Extracting evidence",
  critic: "Critiquing",
  synth: "Synthesizing",
};

export function NewResearchForm() {
  const [topic, setTopic] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "done" | "error">("idle");
  const logRef = useRef<HTMLDivElement>(null);

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
          es.close();
        }
        if (ev.type === "error") {
          setStatus("error");
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
    if (!topic.trim() || topic.length < 10) return;
    setStatus("starting");
    try {
      const resp = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setRunId(data.runId);
        setSlug(data.slug);
        setStatus("running");
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
            Start new research — enter a topic, engine runs plan → harvest → evidence → critic → report
          </div>
        </CardContent>
      </Card>
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
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted-foreground">
                Pipeline runs in a docker container. Typical time: 5–10 min.
              </div>
              <Button
                onClick={submit}
                disabled={!topic.trim() || topic.length < 10 || status === "starting"}
                size="sm"
              >
                {status === "starting" ? "Starting…" : "Start research"}
              </Button>
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
