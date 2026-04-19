"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Run = {
  id: string;
  topic: string;
  slug: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  exitCode: number | null;
  phase: string | null;
  lastLine: string | null;
};

const PHASE_ORDER = [
  "scout",
  "plan",
  "harvest",
  "evidence",
  "verify",
  "analyze",
  "synth",
  "refine",
];
const PHASE_LABEL: Record<string, string> = {
  scout: "Scouting",
  plan: "Planning",
  harvest: "Harvesting",
  evidence: "Extracting facts",
  verify: "Verifying",
  analyze: "Analyzing",
  synth: "Synthesizing",
  refine: "Refining",
};

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function PhaseTimeline({ current }: { current: string | null }) {
  const idx = current ? PHASE_ORDER.indexOf(current) : -1;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASE_ORDER.map((p, i) => {
        const reached = idx >= 0 && i <= idx;
        const active = idx === i;
        return (
          <span
            key={p}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${
              active
                ? "bg-primary/20 border-primary/60 text-primary"
                : reached
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "border-border/40 text-muted-foreground/50"
            }`}
          >
            {PHASE_LABEL[p]?.slice(0, 4) ?? p}
          </span>
        );
      })}
    </div>
  );
}

export function ActiveRuns() {
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
    const t = setInterval(load, 3000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const active = runs.filter((r) => r.status === "running");
  const recent = runs
    .filter((r) => r.status !== "running")
    .slice(0, 3); // show 3 most recent completed/failed

  if (!loaded || (active.length === 0 && recent.length === 0)) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {active.length > 0 ? "Active runs" : "Recent activity"}
        </h2>
        {active.length > 0 && (
          <span className="text-[11px] text-muted-foreground font-mono">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
            {active.length} running
          </span>
        )}
      </div>
      <div className="space-y-2">
        {[...active, ...recent].map((run) => {
          const statusBg =
            run.status === "running"
              ? "border-primary/30 bg-primary/5"
              : run.status === "completed"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5";
          const statusIcon =
            run.status === "running" ? "●" : run.status === "completed" ? "✓" : "✗";
          const statusColor =
            run.status === "running"
              ? "text-primary"
              : run.status === "completed"
                ? "text-emerald-400"
                : "text-red-400";
          return (
            <Card key={run.id} className={`${statusBg} py-0`}>
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span
                    className={`${statusColor} text-[14px] pt-0.5 shrink-0 ${
                      run.status === "running" ? "animate-pulse" : ""
                    }`}
                  >
                    {statusIcon}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Link
                      href={`/projects/${run.slug}`}
                      className="block text-[13px] font-medium line-clamp-2 hover:text-primary transition-colors"
                    >
                      {run.topic}
                    </Link>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                      <span>{timeAgo(run.startedAt)}</span>
                      {run.status === "running" && run.phase && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-primary/10 text-primary border-primary/30"
                        >
                          {PHASE_LABEL[run.phase] ?? run.phase}
                        </Badge>
                      )}
                      {run.status === "failed" && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-red-500/10 text-red-300 border-red-500/30"
                        >
                          exit {run.exitCode}
                        </Badge>
                      )}
                    </div>
                    {run.status === "running" && (
                      <PhaseTimeline current={run.phase} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
