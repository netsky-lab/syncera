import { getProject } from "@/lib/projects";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Markdown } from "@/components/markdown";
import { SourcesList } from "@/components/sources-list";

export const dynamic = "force-dynamic";

function statusTone(status: string) {
  switch (status) {
    case "well_supported":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "partially_supported":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "contradicted":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "unsupported":
      return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function claimTone(type: string) {
  switch (type) {
    case "supports":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "contradicts":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  }
}

function verdictTone(verdict: string) {
  switch (verdict) {
    case "verified":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "url_dead":
    case "quote_fabricated":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "overreach":
    case "out_of_context":
    case "cherry_picked":
    case "misread":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  }
}

function verdictIcon(verdict: string): string {
  switch (verdict) {
    case "verified":
      return "✓";
    case "url_dead":
    case "quote_fabricated":
      return "✗";
    default:
      return "⚠";
  }
}

function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const r = 20;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = value >= 0.7 ? "#22c55e" : value >= 0.4 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg width="56" height="56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} stroke="currentColor" strokeWidth="4" fill="none" className="text-muted" />
        <circle
          cx="28"
          cy="28"
          r={r}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        {pct}%
      </div>
    </div>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const { plan, claims, criticReport, facts, analysisReport, report, sources, units: taskSources, verification, schema } = project;
  const verMap = new Map<string, any>();
  if (verification?.verifications) {
    for (const v of verification.verifications) verMap.set(v.claim_id ?? v.fact_id, v);
  }

  const hypotheses = (plan.hypotheses as any[]) ?? [];
  const tasks = (plan.tasks as any[]) ?? [];
  const questions = (plan.questions as any[]) ?? [];
  const totalSources = sources?.total_sources ?? 0;
  const totalLearnings = sources?.total_learnings ?? 0;
  const byProvider: Record<string, number> = sources?.by_provider ?? {};
  const isQuestionFirst = schema === "question_first";

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">Projects</Link>
        <span>/</span>
        <span className="text-foreground font-mono">{slug.slice(0, 50)}{slug.length > 50 ? "…" : ""}</span>
      </nav>

      {/* Header */}
      <header className="flex items-start gap-5">
        <div className="flex-1 min-w-0 space-y-2">
          <h1 className="text-2xl font-bold tracking-tight leading-tight">{plan.topic}</h1>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline" className="text-[10px]">
              {isQuestionFirst ? "question-first" : "hypothesis-first"}
            </Badge>
            {plan.validation_needed && (
              <Badge variant="outline" className="text-[10px]">empirical validation needed</Badge>
            )}
            {isQuestionFirst ? (
              <Badge variant="outline" className="text-[10px]">{questions.length} questions</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">{hypotheses.length} hypotheses</Badge>
            )}
            {isQuestionFirst ? (
              <Badge variant="outline" className="text-[10px]">{facts.length} facts</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">{claims.length} claims</Badge>
            )}
            <Badge variant="outline" className="text-[10px]">{totalSources} sources</Badge>
            {totalLearnings > 0 && (
              <Badge variant="outline" className="text-[10px]">{totalLearnings} learnings</Badge>
            )}
            {verification?.summary && (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                {verification.summary.verified}/{verification.summary.total} verified
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={`/api/projects/${slug}/pdf`}
            className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent transition-colors inline-flex items-center gap-1.5"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export PDF
          </a>
          {criticReport && <ConfidenceRing value={criticReport.overall_confidence} />}
        </div>
      </header>

      {criticReport?.summary && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 px-5 text-sm leading-relaxed">
            <div className="text-[10px] uppercase tracking-widest text-primary mb-2 font-semibold">
              Critic summary
            </div>
            {criticReport.summary}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="report" className="w-full">
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="hypotheses">Hypotheses</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="critic">Critic</TabsTrigger>
        </TabsList>

        {/* Report */}
        <TabsContent value="report" className="mt-5">
          {report ? (
            <Card>
              <CardContent className="py-6 px-7">
                <Markdown content={report} />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                No report generated yet. Run the synth phase.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Hypotheses */}
        <TabsContent value="hypotheses" className="mt-5 space-y-3">
          {hypotheses.map((h: any) => {
            const assessment = criticReport?.hypothesis_assessments?.find(
              (a: any) => a.hypothesis_id === h.id
            );
            return (
              <Card key={h.id}>
                <CardContent className="py-4 px-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">{h.id}</span>
                        {assessment && (
                          <Badge variant="outline" className={`text-[10px] ${statusTone(assessment.status)}`}>
                            {assessment.status.replace(/_/g, " ")}
                          </Badge>
                        )}
                        {assessment && (
                          <span className="text-xs text-muted-foreground font-mono ml-auto">
                            conf {(assessment.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-medium leading-snug">{h.statement}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {h.acceptance_criteria.map((c: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-mono">
                        {c.name}: {c.threshold}
                      </Badge>
                    ))}
                  </div>
                  {assessment && (
                    <div className="text-xs space-y-1.5 pt-2 border-t border-border/50">
                      {assessment.supporting_claims?.length > 0 && (
                        <div className="text-muted-foreground">
                          <span className="text-emerald-400 font-medium">Supports:</span>{" "}
                          <span className="font-mono">{assessment.supporting_claims.join(", ")}</span>
                        </div>
                      )}
                      {assessment.contradicting_claims?.length > 0 && (
                        <div className="text-muted-foreground">
                          <span className="text-red-400 font-medium">Contradicts:</span>{" "}
                          <span className="font-mono">{assessment.contradicting_claims.join(", ")}</span>
                        </div>
                      )}
                      {assessment.gaps?.length > 0 && (
                        <div className="text-muted-foreground">
                          <span className="text-amber-400 font-medium">Gaps:</span>{" "}
                          {assessment.gaps.join("; ")}
                        </div>
                      )}
                      {assessment.recommendation && (
                        <div className="text-muted-foreground pt-1">
                          <span className="text-primary font-medium">Next:</span>{" "}
                          {assessment.recommendation}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Claims */}
        <TabsContent value="claims" className="mt-5 space-y-2">
          {claims.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                No claims extracted.
              </CardContent>
            </Card>
          ) : (
            claims.map((c: any) => {
              const ver = verMap.get(c.id);
              const isRejected = ver && ver.verdict !== "verified";
              return (
              <Card key={c.id} className={isRejected ? "opacity-60 border-dashed" : ""}>
                <CardContent className="py-3 px-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs font-semibold text-muted-foreground shrink-0 mt-0.5">
                      {c.id}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[13px] leading-relaxed ${isRejected ? "line-through decoration-zinc-500/60" : ""}`}>
                        {c.statement}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {ver && (
                        <Badge variant="outline" className={`text-[10px] ${verdictTone(ver.verdict)}`}>
                          {verdictIcon(ver.verdict)} {ver.verdict.replace(/_/g, " ")}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-[10px] ${claimTone(c.type)}`}>
                        {c.type}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {c.hypothesis_id}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono tabular-nums">
                        {(c.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                  {ver && ver.verdict !== "verified" && (
                    <div className="pl-9 text-xs text-amber-300/80 italic">
                      <span className="text-muted-foreground font-mono not-italic">verifier:</span>{" "}
                      {ver.notes}
                      {ver.corrected_statement && (
                        <div className="mt-1 not-italic text-zinc-300">
                          <span className="text-muted-foreground font-mono">corrected:</span> {ver.corrected_statement}
                        </div>
                      )}
                    </div>
                  )}
                  {c.references?.length > 0 && (
                    <div className="pl-9 space-y-1.5">
                      {c.references.map((r: any, i: number) => (
                        <div key={i} className="text-xs text-muted-foreground space-y-0.5">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary/80 hover:text-primary underline decoration-dotted"
                          >
                            {r.title || r.url}
                          </a>
                          {r.exact_quote && (
                            <div className="italic text-muted-foreground/80 border-l-2 border-border pl-2">
                              "{r.exact_quote.slice(0, 200)}
                              {r.exact_quote.length > 200 ? "…" : ""}"
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
            })
          )}
        </TabsContent>

        {/* Sources */}
        <TabsContent value="sources" className="mt-5">
          {taskSources.length > 0 ? (
            <SourcesList slug={slug} tasks={taskSources} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No sources collected yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Plan */}
        <TabsContent value="plan" className="mt-5 space-y-4">
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Tasks · {tasks.length}
              </div>
              <div className="space-y-2">
                {tasks.map((t: any) => (
                  <div key={t.id} className="flex items-start gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
                    <span className="font-mono text-muted-foreground shrink-0 w-6">{t.id}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">{t.type}</Badge>
                    <Badge variant="secondary" className="text-[10px] shrink-0 font-mono">{t.hypothesis_id}</Badge>
                    <div className="flex-1">{t.goal}</div>
                    {t.depends_on?.length > 0 && (
                      <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                        ← {t.depends_on.join(",")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 px-5 space-y-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Budget & validation
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm pt-1">
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Max steps
                  </div>
                  <div className="font-semibold tabular-nums">{plan.budget?.max_steps ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Max sources
                  </div>
                  <div className="font-semibold tabular-nums">{plan.budget?.max_sources ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Validation
                  </div>
                  <div className="font-semibold">{plan.validation_needed ? "needed" : "optional"}</div>
                </div>
              </div>
              {plan.validation_infra && (
                <div className="pt-2 mt-2 border-t border-border/50">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Validation infra
                  </div>
                  <div className="text-xs mt-1 text-muted-foreground">{plan.validation_infra}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Critic */}
        <TabsContent value="critic" className="mt-5 space-y-3">
          {criticReport ? (
            <>
              <Card>
                <CardContent className="py-4 px-5 space-y-3">
                  <div className="flex items-center gap-4">
                    <ConfidenceRing value={criticReport.overall_confidence} />
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                        Overall confidence
                      </div>
                      <div className="text-sm leading-relaxed text-foreground">
                        {criticReport.summary}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {criticReport.contradictions?.length > 0 && (
                <Card>
                  <CardContent className="py-4 px-5 space-y-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Contradictions · {criticReport.contradictions.length}
                    </div>
                    {criticReport.contradictions.map((c: any, i: number) => (
                      <div key={i} className="text-xs p-3 rounded-md bg-red-500/5 border border-red-500/20">
                        <div className="flex gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] font-mono">{c.claim_a}</Badge>
                          <span className="text-muted-foreground">vs</span>
                          <Badge variant="outline" className="text-[10px] font-mono">{c.claim_b}</Badge>
                        </div>
                        <div className="text-muted-foreground">{c.description}</div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                No critic report yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
