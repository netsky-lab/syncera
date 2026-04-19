"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

// Question-first reading-mode layout: single prose column + sticky TOC.
// Inspired by Perplexity Pro / ChatGPT Deep Research / arxiv HTML v2 —
// optimized for linear reading, with citations as interactive chips that
// scroll to the referenced fact and briefly highlight it.

type Project = {
  slug: string;
  schema: string;
  plan: any;
  facts: any[];
  analysisReport: any;
  report: string | null;
  sources: any;
  units: any[];
  verification: any;
};

function FactCitations({
  text,
  factMap,
}: {
  text: string;
  factMap?: Map<string, any>;
}) {
  // Split text into runs, wrap [F#] tokens with scroll-to-fact anchors.
  const parts = text.split(/(\[F\d+(?:,\s*F\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(F\d+(?:,\s*F\d+)*)\]$/);
        if (!match) return <span key={i}>{part}</span>;
        const ids = match[1]!.split(/,\s*/);
        return (
          <span key={i} className="inline-flex gap-0.5 align-baseline">
            {ids.map((id, j) => {
              const fact = factMap?.get(id);
              return (
                <a
                  key={j}
                  href={`#${id}`}
                  title={
                    fact
                      ? `${fact.statement.slice(0, 220)}${
                          fact.statement.length > 220 ? "…" : ""
                        }`
                      : id
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(id);
                    if (el) {
                      el.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                      el.classList.add(
                        "ring-2",
                        "ring-primary/60",
                        "ring-offset-2",
                        "ring-offset-background"
                      );
                      setTimeout(
                        () =>
                          el.classList.remove(
                            "ring-2",
                            "ring-primary/60",
                            "ring-offset-2",
                            "ring-offset-background"
                          ),
                        1600
                      );
                    }
                  }}
                  className="inline-flex items-center px-1.5 h-[1.5em] text-[11px] font-mono rounded border border-primary/30 text-primary/90 bg-primary/5 hover:bg-primary/15 hover:border-primary/60 transition-colors no-underline cursor-help"
                >
                  {id}
                </a>
              );
            })}
          </span>
        );
      })}
    </>
  );
}

// Scroll-spy: watch section elements and return the id of the topmost
// visible section. Used by TOC to highlight current reading position.
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.target.getBoundingClientRect().top -
              b.target.getBoundingClientRect().top
          );
        if (visible.length > 0) {
          setActive(visible[0]!.target.id);
        }
      },
      {
        rootMargin: "-80px 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids.join(",")]);
  return active;
}

function JumpToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Jump to top"
      className="fixed bottom-6 right-6 z-20 p-2.5 rounded-full border border-border/60 bg-background/90 backdrop-blur-sm shadow-lg hover:border-primary/60 hover:bg-primary/10 transition-all"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 15l7-7 7 7"
        />
      </svg>
    </button>
  );
}

function CoverageBadge({ coverage }: { coverage: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    complete: {
      label: "Complete",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    },
    partial: {
      label: "Partial",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    },
    gaps_critical: {
      label: "Gaps",
      cls: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    },
    insufficient: {
      label: "Insufficient",
      cls: "bg-red-500/15 text-red-300 border-red-500/30",
    },
  };
  const m = map[coverage] ?? { label: coverage, cls: "bg-muted text-muted-foreground" };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide border ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function FactualityBadge({ f }: { f: string }) {
  const map: Record<string, string> = {
    quantitative: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    qualitative: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    comparative: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    background: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-mono border ${map[f] ?? "bg-muted"}`}
    >
      {f}
    </span>
  );
}

function QuestionSection({
  q,
  answer,
  facts,
  verMap,
  factMap,
}: {
  q: any;
  answer: any;
  facts: any[];
  verMap: Map<string, any>;
  factMap: Map<string, any>;
}) {
  const [showAllFacts, setShowAllFacts] = useState(false);
  const questionFacts = facts.filter((f) => f.question_id === q.id);
  const shown = showAllFacts ? questionFacts : questionFacts.slice(0, 6);

  return (
    <section id={q.id} className="scroll-mt-8 py-10 border-t border-border/50 first:border-0 first:pt-0">
      <div className="flex items-start gap-3 mb-3">
        <span className="font-mono text-[11px] text-muted-foreground pt-1.5">{q.id}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              {q.category}
            </span>
            {answer && <CoverageBadge coverage={answer.coverage} />}
          </div>
          <h2 className="text-xl font-semibold tracking-tight leading-snug text-foreground">
            {q.question}
          </h2>
        </div>
      </div>

      {q.subquestions?.length > 0 && (
        <details className="mb-4 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors select-none inline-block">
            {q.subquestions.length} sub-questions
          </summary>
          <ul className="mt-2 pl-4 space-y-1 text-muted-foreground">
            {q.subquestions.map((sq: any) => (
              <li key={sq.id} className="flex items-start gap-2">
                <span className="font-mono text-[10px] pt-0.5">{sq.id}</span>
                <span className="text-[10px] uppercase tracking-wide px-1 py-0 rounded bg-muted/50">
                  {sq.angle}
                </span>
                <span className="flex-1">{sq.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {answer?.answer && (
        <div className="prose-reader mb-6">
          <p className="text-[15px] leading-[1.75] text-foreground/90 whitespace-pre-wrap">
            <FactCitations text={answer.answer} factMap={factMap} />
          </p>
        </div>
      )}

      {answer?.conflicting_facts?.length > 0 && (
        <div className="mb-4 p-3 rounded-md border border-red-500/20 bg-red-500/5 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-red-300 font-semibold">
            Conflicting findings ({answer.conflicting_facts.length})
          </div>
          {answer.conflicting_facts.map((cf: any, i: number) => (
            <div key={i} className="text-[13px] leading-relaxed">
              <FactCitations text={`[${cf.fact_a}] vs [${cf.fact_b}] — ${cf.nature}`} factMap={factMap} />
            </div>
          ))}
        </div>
      )}

      {(answer?.gaps?.length > 0 || answer?.follow_ups?.length > 0) && (
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {answer?.gaps?.length > 0 && (
            <div className="p-3 rounded-md border border-border/60 bg-muted/20 space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Gaps
              </div>
              <ul className="text-[13px] leading-relaxed text-foreground/80 space-y-1">
                {answer.gaps.map((g: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-0.5 shrink-0">·</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer?.follow_ups?.length > 0 && (
            <div className="p-3 rounded-md border border-border/60 bg-muted/20 space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Follow-ups
              </div>
              <ul className="text-[13px] leading-relaxed text-foreground/80 space-y-1">
                {answer.follow_ups.map((f: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-0.5 shrink-0">→</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {questionFacts.length > 0 && (
        <div className="border-t border-border/50 pt-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Evidence · {questionFacts.length} facts
            </h3>
            {questionFacts.length > 6 && (
              <button
                onClick={() => setShowAllFacts((s) => !s)}
                className="text-[11px] text-primary hover:underline"
              >
                {showAllFacts ? "Show top 6" : `Show all ${questionFacts.length}`}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {shown.map((f: any) => {
              const ver = verMap.get(f.id);
              const rejected = ver && ver.verdict !== "verified";
              return (
                <div
                  key={f.id}
                  id={f.id}
                  className={`flex items-start gap-3 py-2 px-3 rounded-md border transition-all ${
                    rejected
                      ? "opacity-60 border-dashed border-border/50"
                      : "border-border/50 hover:border-border hover:bg-muted/20"
                  }`}
                >
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0 pt-0.5 w-10">
                    {f.id}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className={`text-[13px] leading-relaxed ${rejected ? "line-through decoration-zinc-500/60" : ""}`}>
                      {f.statement}
                    </div>
                    {f.references?.[0] && (
                      <a
                        href={f.references[0].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block text-[11px] text-primary/80 hover:text-primary underline decoration-dotted truncate max-w-full"
                      >
                        {f.references[0].title || f.references[0].url}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                    <FactualityBadge f={f.factuality} />
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function ProjectDocument({
  project,
}: {
  project: Project;
}) {
  const { plan, facts, analysisReport, report } = project;
  const verMap = new Map<string, any>();
  if (project.verification?.verifications) {
    for (const v of project.verification.verifications)
      verMap.set(v.claim_id ?? v.fact_id, v);
  }

  const questions = plan.questions as any[];
  const answers = analysisReport?.answers ?? [];
  const answerFor = (qid: string) =>
    answers.find((a: any) => a.question_id === qid);

  // Extract non-question sections from REPORT.md by regex:
  // Introduction, Summary, Method Comparison, Deployment Sequence,
  // Recommendation, Methodology, References.
  function extractSection(name: string): string {
    if (!report) return "";
    const re = new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "m");
    const m = report.match(re);
    return m?.[1]?.trim() ?? "";
  }

  const intro = extractSection("Introduction");
  const comparisonTable = extractSection("Method Comparison");
  const deployment = extractSection("Deployment Sequence");
  const recommendation = extractSection("Recommendation");
  const tensions = analysisReport?.cross_question_tensions ?? [];

  // References built from cited facts only
  const citedIds = new Set<string>();
  const gather = (s: string) => {
    for (const m of s.matchAll(/\[(F\d+)\]/g)) citedIds.add(m[1]!);
  };
  if (analysisReport?.overall_summary) gather(analysisReport.overall_summary);
  for (const a of answers) {
    if (a.answer) gather(a.answer);
    for (const cf of a.conflicting_facts ?? []) {
      citedIds.add(cf.fact_a);
      citedIds.add(cf.fact_b);
    }
  }
  for (const t of tensions) {
    for (const f of t.involved_facts ?? []) citedIds.add(f);
  }
  const referenceUrls: { id: string; title: string; url: string }[] = [];
  const seenUrls = new Set<string>();
  for (const f of facts) {
    if (!citedIds.has(f.id)) continue;
    const r = f.references?.[0];
    if (!r?.url || seenUrls.has(r.url)) continue;
    seenUrls.add(r.url);
    referenceUrls.push({ id: f.id, title: r.title || r.url, url: r.url });
  }

  // Facts lookup by id for hover-preview tooltips on citation chips.
  const factMap = useMemo(
    () => new Map<string, any>(facts.map((f) => [f.id, f])),
    [facts]
  );

  // TOC section ids for scroll-spy
  const tocIds: string[] = [
    ...(analysisReport?.overall_summary ? ["summary"] : []),
    ...(tensions.length > 0 ? ["tensions"] : []),
    ...questions.map((q: any) => q.id),
    ...(comparisonTable ? ["comparison"] : []),
    ...(deployment ? ["deployment"] : []),
    ...(recommendation ? ["recommendation"] : []),
    ...(referenceUrls.length > 0 ? ["references"] : []),
  ];
  const activeSection = useActiveSection(tocIds);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 grid lg:grid-cols-[1fr_15rem] gap-12">
      <article className="max-w-[70ch] min-w-0">
        {intro && (
          <section className="py-6 border-b border-border/50 mb-2">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Introduction
            </h2>
            <p className="text-[15px] leading-[1.75] text-foreground/90">{intro}</p>
          </section>
        )}

        {analysisReport?.overall_summary && (
          <section id="summary" className="scroll-mt-8 py-6 border-b border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Summary
            </h2>
            <p className="text-[15px] leading-[1.75] text-foreground/90">
              <FactCitations text={analysisReport.overall_summary} factMap={factMap} />
            </p>
          </section>
        )}

        {tensions.length > 0 && (
          <section id="tensions" className="scroll-mt-8 py-6 border-b border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Cross-question tensions
            </h2>
            <div className="space-y-2">
              {tensions.map((t: any, i: number) => (
                <div
                  key={i}
                  className="p-3 rounded-md border border-amber-500/20 bg-amber-500/5 text-[13px] leading-relaxed"
                >
                  <div className="flex flex-wrap gap-1.5 mb-1.5 text-[10px]">
                    {(t.involved_questions ?? []).map((qid: string) => (
                      <a
                        key={qid}
                        href={`#${qid}`}
                        onClick={(e) => {
                          e.preventDefault();
                          document.getElementById(qid)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="font-mono px-1.5 rounded border border-primary/30 text-primary/90 bg-primary/5 hover:bg-primary/15"
                      >
                        {qid}
                      </a>
                    ))}
                  </div>
                  <div>
                    <FactCitations text={t.description} factMap={factMap} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {questions.map((q) => (
          <QuestionSection
            key={q.id}
            q={q}
            answer={answerFor(q.id)}
            facts={facts}
            verMap={verMap}
            factMap={factMap}
          />
        ))}

        {comparisonTable && (
          <section id="comparison" className="scroll-mt-8 py-10 border-t border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Method comparison
            </h2>
            <div
              className="overflow-x-auto prose-reader text-[13px] leading-relaxed [&_table]:w-full [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border [&_th]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-border/60 [&_table]:border-collapse"
              dangerouslySetInnerHTML={{ __html: markdownTableToHtml(comparisonTable) }}
            />
          </section>
        )}

        {deployment && (
          <section id="deployment" className="scroll-mt-8 py-10 border-t border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Deployment sequence
            </h2>
            <ol className="space-y-2.5 text-[14px] leading-relaxed list-none counter-reset-[step]">
              {deployment
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l && /^\d+\./.test(l))
                .map((step, i) => {
                  const text = step.replace(/^\d+\.\s*/, "");
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-md border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0 pt-0.5 tabular-nums w-6">
                        {i + 1}.
                      </span>
                      <div className="flex-1">
                        <FactCitations text={text} factMap={factMap} />
                      </div>
                    </li>
                  );
                })}
            </ol>
          </section>
        )}

        {recommendation && (
          <section id="recommendation" className="scroll-mt-8 py-10 border-t border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              Recommendation
            </h2>
            <div className="p-4 rounded-md border border-primary/30 bg-primary/5">
              <p className="text-[15px] leading-[1.75] text-foreground/90">
                <FactCitations text={recommendation} factMap={factMap} />
              </p>
            </div>
          </section>
        )}

        {referenceUrls.length > 0 && (
          <section id="references" className="scroll-mt-8 py-10 border-t border-border/50">
            <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
              References · {referenceUrls.length}
            </h2>
            <ol className="space-y-1.5 text-[12px] list-none">
              {referenceUrls.map((r) => (
                <li key={r.url} className="flex items-start gap-3">
                  <span className="font-mono text-muted-foreground shrink-0 w-10">
                    {r.id}
                  </span>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/80 hover:text-primary underline decoration-dotted break-all"
                  >
                    {r.title}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>

      {/* TOC sidebar */}
      <aside className="hidden lg:block">
        <nav className="sticky top-20 space-y-0.5 text-[12px]">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3 pl-2">
            On this page
          </div>
          {analysisReport?.overall_summary && (
            <TocItem id="summary" activeId={activeSection} label="Summary" />
          )}
          {tensions.length > 0 && (
            <TocItem
              id="tensions"
              activeId={activeSection}
              label={`Tensions (${tensions.length})`}
            />
          )}
          {questions.map((q) => {
            const a = answerFor(q.id);
            return (
              <TocItem
                key={q.id}
                id={q.id}
                activeId={activeSection}
                label={
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px]">{q.id}</span>
                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                      {q.category}
                    </span>
                    {a && (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ml-auto ${
                          a.coverage === "complete"
                            ? "bg-emerald-400"
                            : a.coverage === "partial"
                              ? "bg-amber-400"
                              : a.coverage === "gaps_critical"
                                ? "bg-orange-400"
                                : "bg-red-400"
                        }`}
                      />
                    )}
                  </span>
                }
              />
            );
          })}
          {comparisonTable && (
            <TocItem
              id="comparison"
              activeId={activeSection}
              label="Method comparison"
            />
          )}
          {deployment && (
            <TocItem
              id="deployment"
              activeId={activeSection}
              label="Deployment"
            />
          )}
          {recommendation && (
            <TocItem
              id="recommendation"
              activeId={activeSection}
              label="Recommendation"
            />
          )}
          {referenceUrls.length > 0 && (
            <TocItem
              id="references"
              activeId={activeSection}
              label={`References (${referenceUrls.length})`}
            />
          )}
        </nav>
      </aside>
      <JumpToTop />
    </div>
  );
}

function TocItem({
  id,
  activeId,
  label,
}: {
  id: string;
  activeId: string | null;
  label: ReactNode;
}) {
  const isActive = activeId === id;
  return (
    <a
      href={`#${id}`}
      className={`block px-2 py-1.5 rounded transition-all border-l-2 ${
        isActive
          ? "border-primary bg-primary/5 text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      }`}
    >
      {label}
    </a>
  );
}

// Minimal markdown pipe-table → HTML. Enough for our comparison table.
function markdownTableToHtml(md: string): string {
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (lines.length < 2) return `<pre>${md}</pre>`;
  const parseRow = (l: string) =>
    l
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
  const header = parseRow(lines[0]!);
  const body = lines.slice(2).map(parseRow);
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\[(F\d+)\]/g, '<a href="#$1" class="fact-ref">[$1]</a>');
  return (
    "<table><thead><tr>" +
    header.map((h) => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead><tbody>" +
    body
      .map(
        (r) =>
          `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`
      )
      .join("") +
    "</tbody></table>"
  );
}
