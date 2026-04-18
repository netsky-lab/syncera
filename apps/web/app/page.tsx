import Link from "next/link";
import { listProjects } from "@/lib/projects";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewResearchForm } from "@/components/new-research";

export const dynamic = "force-dynamic";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7
      ? "bg-emerald-500"
      : value >= 0.4
      ? "bg-amber-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2 w-28">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground shrink-0">{pct}%</span>
    </div>
  );
}

export default function DashboardPage() {
  const projects = listProjects();
  // Aggregate across BOTH schemas — question-first uses questions+facts,
  // legacy hypothesis-first uses hypotheses+claims. Surface them both under
  // unified labels so totals row stays meaningful regardless of mix.
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

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Research projects are live folders — each hypothesis tracked with evidence and citations.
        </p>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-semibold tabular-nums">{totals.projects}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Projects
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-semibold tabular-nums">{totals.topics}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Questions / Hypotheses
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-semibold tabular-nums">{totals.findings}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Facts / Claims
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-semibold tabular-nums">{totals.sources}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">
              Sources collected
            </div>
          </CardContent>
        </Card>
      </div>

      {/* New research form */}
      <NewResearchForm />

      {/* Projects list */}
      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <div className="text-muted-foreground">No projects yet.</div>
            <code className="inline-block bg-muted px-3 py-1.5 rounded text-xs font-mono">
              bun run src/run.ts &quot;your research topic&quot;
            </code>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <Link key={p.slug} href={`/projects/${p.slug}`}>
              <Card className="group hover:border-primary/60 hover:shadow-md transition-all cursor-pointer py-0">
                <CardContent className="py-4 px-5">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <h2 className="text-sm font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {p.topic}
                      </h2>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {p.slug}
                      </div>
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-center min-w-[44px]">
                        <div className="text-sm font-semibold tabular-nums">
                          {p.schema === "question_first" ? p.questions : p.hypotheses}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {p.schema === "question_first" ? "q" : "hyp"}
                        </div>
                      </div>
                      <div className="text-center min-w-[44px]">
                        <div className="text-sm font-semibold tabular-nums">
                          {p.schema === "question_first" ? p.facts : p.claims}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {p.schema === "question_first" ? "facts" : "claims"}
                        </div>
                      </div>
                      <div className="text-center min-w-[52px]">
                        <div className="text-sm font-semibold tabular-nums">
                          {p.sources}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          sources
                        </div>
                      </div>
                      {p.schema === "hypothesis_first" && p.confidence > 0 ? (
                        <ConfidenceBar value={p.confidence} />
                      ) : p.schema === "hypothesis_first" ? (
                        <span className="text-xs text-muted-foreground italic w-28 text-right">
                          pending
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          {p.schema === "question_first" ? "question-first" : "empty"}
                        </Badge>
                      )}
                      {p.hasReport && (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20">
                          Report
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
