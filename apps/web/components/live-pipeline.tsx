"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  };
  health?: {
    idleSeconds: number | null;
    stalled: boolean;
    warning: string | null;
  };
  quality?: {
    verdict: "pending" | "good" | "weak" | "retry";
    label: string;
    reasons: string[];
  };
  errors?: {
    llmTransient: number;
    failedUnits: number;
    unreadableQueries: number;
    searchTimeouts: number;
    last: string | null;
  };
};

// Map pipeline backend phase → 6 visible stages from design.
// Backend: scout / plan / harvest / evidence / verify / analyze / synth / playbook / refine
const STAGE_INDEX: Record<string, number> = {
  scout: 0,
  plan: 1,
  harvest: 2,
  evidence: 2,
  relevance: 2,
  verify: 3,
  analyze: 4,
  synth: 5,
  playbook: 5,
  refine: 5,
};

const STAGES: Array<{
  num: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    num: "01",
    name: "Scout",
    desc: "Scan the domain, calibrate the field",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    num: "02",
    name: "Plan",
    desc: "Decompose into literature-driven questions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    num: "03",
    name: "Harvest",
    desc: "Pull primary sources & extract facts",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    num: "04",
    name: "Verify",
    desc: "Three-layer check: URL, quote, adversarial",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    num: "05",
    name: "Analyze",
    desc: "Weight evidence, resolve conflicts",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    num: "06",
    name: "Synth",
    desc: "Assemble citable report",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

function cleanLine(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/^\[[^\]]+\]\s*/, "").slice(0, 64);
}

function compact(n: number | null | undefined): string {
  const value = Number(n ?? 0);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function progressText(run: Run): string {
  const p = run.progress;
  if (run.health?.stalled && run.health.idleSeconds != null) {
    return `no logs for ${Math.floor(run.health.idleSeconds / 60)}m · check run`;
  }
  if (!p) return "";
  const bits = [
    run.quality?.label ? run.quality.label.toLowerCase() : "",
    p.questions ? `${p.questions}q/${p.subquestions}sq` : "",
    p.sources ? `${p.sources} sources` : "",
    p.facts ? `${p.facts} facts` : "",
    p.verified ? `${p.verified} verified` : "",
    p.debt ? `${p.debt} debt` : "",
    p.contradictions ? `${p.contradictions} contradictions` : "",
    p.sourceQuality ? `q${p.sourceQuality}%` : "",
    run.errors?.llmTransient ? `${run.errors.llmTransient} transient` : "",
    run.errors?.unreadableQueries ? `${run.errors.unreadableQueries} unreadable` : "",
    p.tokens ? `${compact(p.tokens)} tok` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function CancelRunInline({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  async function handle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Stop this run? The pipeline container is killed; no report will be generated.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(`Cancel failed: ${d.error ?? r.status}`);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={handle}
      disabled={busy}
      className="ml-auto font-mono text-[10.5px] px-2 py-0.5 rounded border border-accent-red/40 bg-accent-red/5 text-accent-red hover:bg-accent-red/15 hover:border-accent-red/70 transition uppercase tracking-wider disabled:opacity-50"
      title="Kill the pipeline container"
    >
      {busy ? "stopping…" : "stop"}
    </button>
  );
}

export function LivePipeline() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      fetch("/api/runs")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (stopped) return;
          setRuns(d?.runs ?? []);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    };
    load();
    const t = setInterval(load, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  if (!loaded) return null;

  const active = runs.find((r) => r.status === "running");
  const currentIdx = active?.phase != null ? (STAGE_INDEX[active.phase] ?? -1) : -1;

  // No active run — render an idle version of the same pipeline card
  // so the dashboard shape doesn't jump when a run starts.
  const label = active ? "live pipeline" : "pipeline overview";

  const elapsed = active
    ? Math.max(0, Math.floor((Date.now() - active.startedAt) / 60_000))
    : 0;

  return (
    <section className="rl-pipeline">
      <div className="rl-pipeline-head">
        <div className="label">{label}</div>
        <div className="meta">
          {active ? (
            <>
              <span className="tnum">
                elapsed <strong>{elapsed}m</strong>
              </span>
              <Link
                href={`/projects/${active.slug}`}
                className="truncate max-w-[50vw] md:max-w-[360px] hover:text-fg transition"
                title={active.topic}
              >
                topic:{" "}
                <strong className="text-fg">{active.topic.slice(0, 72)}{active.topic.length > 72 ? "…" : ""}</strong>
              </Link>
              <CancelRunInline runId={active.id} />
            </>
          ) : (
            <>
              <span>
                avg <strong>48 min</strong>
              </span>
              <span>
                p95 <strong>74 min</strong>
              </span>
              <span>
                verifier <strong>3-layer</strong>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="rl-pipeline-track">
        <div className="rl-pipeline-line" />
        {currentIdx >= 0 && (
          <div
            className="rl-pipeline-progress"
            style={{
              width: `calc((100% - 40px) * ${Math.min(currentIdx, STAGES.length - 1) / (STAGES.length - 1)})`,
            }}
          />
        )}
        {STAGES.map((st, i) => {
          const done = currentIdx >= 0 && i < currentIdx;
          const isActive = currentIdx === i;
          const cls = isActive ? "rl-stage active" : done ? "rl-stage done" : "rl-stage";
          return (
            <div key={st.num} className={cls}>
              <div className="rl-stage-node">{st.icon}</div>
              <div className="rl-stage-num">{st.num}</div>
              <div className="rl-stage-name">{st.name}</div>
              <div className="rl-stage-desc">{st.desc}</div>
              {isActive && (
                <div className="rl-stage-log">
                  {progressText(active!) || cleanLine(active?.lastLine) || "running…"}
                </div>
              )}
              {done && i === currentIdx - 1 && (
                <div className="rl-stage-log">done</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
