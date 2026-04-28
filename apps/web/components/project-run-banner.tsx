"use client";

// Banner shown at the top of /projects/<slug> when a pipeline run is
// actively writing to this project (e.g. user just kicked off Extend and
// was redirected here). Polls /api/runs every 3s, filters to this slug,
// shows phase + elapsed + Stop + last line. Hides itself when the run
// completes or no run is active.

import { useEffect, useState } from "react";

type Run = {
  id: string;
  topic: string;
  slug: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  phase: string | null;
  lastLine: string | null;
  progress?: {
    questions: number;
    subquestions: number;
    sources: number;
    learnings: number;
    facts: number;
    verified: number;
    rejected: number;
    debt: number;
    contradictions: number;
    llmCalls: number;
    tokens: number;
    sourceQuality?: number;
    acceptedSources?: number;
    rejectedSources?: number;
  };
  health?: {
    idleSeconds: number | null;
    stalled: boolean;
    warning: string | null;
  };
};

const PHASE_LABEL: Record<string, string> = {
  scout: "Scouting",
  plan: "Planning",
  harvest: "Harvesting",
  relevance: "Gating relevance",
  evidence: "Extracting facts",
  verify: "Verifying",
  analyze: "Analyzing",
  synth: "Synthesizing",
  playbook: "Compiling playbook",
  refine: "Refining",
  "refine-playbook": "Compiling playbook",
};

function elapsedMin(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function cleanLine(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120);
}

function compact(n: number | null | undefined): string {
  const value = Number(n ?? 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function ProjectRunBanner({ slug }: { slug: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      fetch("/api/runs")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (stopped || !d) return;
          const match = (d.runs ?? []).find(
            (r: Run) => r.slug === slug && r.status === "running"
          );
          setRun(match ?? null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [slug]);

  async function cancel() {
    if (!run || busy) return;
    if (!confirm("Stop this run? The pipeline container is killed; the partial report is kept as-is.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/runs/${run.id}/cancel`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Cancel failed: ${d.error ?? r.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!run) return null;

  return (
    <div className="mb-6 rounded-xl border border-accent-primary/30 bg-accent-primary/[0.04] px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-accent-primary tracking-[0.08em] uppercase">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-primary" />
          </span>
          Pipeline running
        </span>
        <span className="text-[13px] text-fg">
          {run.phase ? PHASE_LABEL[run.phase] ?? run.phase : "starting…"}
        </span>
        <span className="font-mono text-[11px] text-fg-muted tnum">
          · {elapsedMin(run.startedAt)}
        </span>
        <button
          onClick={cancel}
          disabled={busy}
          className="ml-auto font-mono text-[10.5px] px-2 py-0.5 rounded border border-accent-red/40 bg-accent-red/5 text-accent-red hover:bg-accent-red/15 transition uppercase tracking-wider disabled:opacity-50"
        >
          {busy ? "stopping…" : "stop"}
        </button>
      </div>
      {run.lastLine && (
        <div className="mt-1.5 font-mono text-[11px] text-fg-muted truncate">
          {cleanLine(run.lastLine)}
        </div>
      )}
      {run.progress && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4 lg:grid-cols-8">
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.questions || 0}q / {run.progress.subquestions || 0}sq
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.sources || 0} sources
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.learnings || 0} learnings
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.facts || 0} facts
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.verified || 0}/{run.progress.verified + run.progress.rejected || 0} verified
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {run.progress.debt || 0} debt
          </span>
          <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
            {compact(run.progress.tokens)} tok
          </span>
          {!!run.progress.sourceQuality && (
            <span className="rounded bg-ink-900 px-2 py-1 text-fg-muted">
              q{run.progress.sourceQuality}%
            </span>
          )}
        </div>
      )}
      {run.health?.warning && (
        <div
          className={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
            run.health.stalled
              ? "border-accent-amber/30 bg-accent-amber/[0.06] text-accent-amber"
              : "border-fg/[0.06] bg-ink-900 text-fg-muted"
          }`}
        >
          {run.health.warning}
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-fg-muted">
        Artifacts update as phases finish; refresh after completion for the final report.
      </div>
    </div>
  );
}
