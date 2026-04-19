import { listProjects } from "@/lib/projects";
import { Card, CardContent } from "@/components/ui/card";
import { NewResearchForm } from "@/components/new-research";
import { ProjectsList } from "@/components/projects-list";
import { ActiveRuns } from "@/components/active-runs";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "emerald" | "sky" | "amber" | "violet";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-400"
      : accent === "sky"
        ? "text-sky-400"
        : accent === "amber"
          ? "text-amber-400"
          : accent === "violet"
            ? "text-violet-400"
            : "";
  return (
    <Card className="shadow-none border-border/60">
      <CardContent className="pt-5 pb-4">
        <div className={`text-2xl font-semibold tabular-nums ${accentClass}`}>
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1 font-medium">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const projects = listProjects();
  const totals = {
    projects: projects.length,
    topics: projects.reduce(
      (n, p) => n + Math.max(p.questions, p.hypotheses),
      0
    ),
    findings: projects.reduce((n, p) => n + Math.max(p.facts, p.claims), 0),
    reports: projects.filter((p) => p.hasReport).length,
    sources: projects.reduce((n, p) => n + p.sources, 0),
  };
  const questionFirst = projects.filter(
    (p) => p.schema === "question_first"
  ).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-10 space-y-8 md:space-y-10">
      {/* Hero */}
      <header className="space-y-3 border-b border-border/50 pb-6 md:pb-8">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 font-semibold">
            Research Lab
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            v0.2 · question-first
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight leading-tight">
          Hypothesis-free research, grounded in verified evidence.
        </h1>
        <p className="text-[13px] sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Turn a topic into a structured research report: planner decomposes
          it into literature-driven questions, harvester pulls primary sources
          across Arxiv / OpenAlex / SearXNG, facts are fact-checked against
          their cited URLs, analyzer synthesizes narrative answers. No
          fabricated thresholds, no hand-waved verdicts.
        </p>
      </header>

      {/* Stats — 2 cols on mobile, 4 on md+ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Projects" value={totals.projects} accent="sky" />
        <StatCard
          label="Questions & Hypotheses"
          value={totals.topics}
          accent="violet"
        />
        <StatCard
          label="Facts & Claims"
          value={totals.findings}
          accent="emerald"
        />
        <StatCard
          label="Sources collected"
          value={totals.sources}
          accent="amber"
        />
      </div>

      {/* Schema split note */}
      {questionFirst > 0 && questionFirst < projects.length && (
        <div className="text-xs text-muted-foreground">
          <span className="font-mono text-foreground/80">{questionFirst}</span>{" "}
          question-first · <span className="font-mono text-foreground/80">
            {projects.length - questionFirst}
          </span>{" "}
          legacy hypothesis-first
        </div>
      )}

      {/* Active / recent runs */}
      <ActiveRuns />

      {/* New research form */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Start a new investigation
          </h2>
          <span className="text-[11px] text-muted-foreground">
            typical run: 30-60 min
          </span>
        </div>
        <NewResearchForm />
      </section>

      {/* Projects list */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
          {projects.length > 0 && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {totals.reports} / {projects.length} have reports
            </span>
          )}
        </div>
        <ProjectsList projects={projects} />
      </section>
    </div>
  );
}
