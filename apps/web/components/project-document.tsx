"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SectionTweak } from "@/components/section-tweak";
import { Markdown } from "@/components/markdown";

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

// Extract plausible INCI / ingredient list items from a topic string.
// Triggers only if the topic looks like an ingredient list (3+ comma- or
// slash-separated items where each is multi-word & has capital letters).
// Returns names sorted longest-first so regex replacement doesn't
// partial-match a shorter name inside a longer one ("Zea mays starch"
// before "Zea mays").
function extractIngredients(topic: string | undefined | null): string[] {
  if (!topic) return [];
  const candidates = topic
    .split(/[,\n]|\s\/\s|\//)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 80)
    .map((s) => s.replace(/^\W+|\W+$/g, ""))
    .filter((s) => /[A-Z]/.test(s))
    .filter((s) => !/[?!:;]/.test(s))
    .filter((s) => s.split(/\s+/).length <= 6);
  // Keep only if we have at least 4 plausible INCI items — otherwise the
  // topic is probably a regular sentence, not an ingredient list.
  if (candidates.length < 4) return [];
  const uniq = Array.from(new Set(candidates));
  uniq.sort((a, b) => b.length - a.length);
  return uniq;
}

// Wrap occurrences of `ingredients` in `text` with **bold** markdown-ish
// spans. Returns an array of React nodes. Preserves content between hits.
function boldIngredients(text: string, ingredients: string[]): React.ReactNode[] {
  if (ingredients.length === 0) return [text];
  // Build a single regex matching any ingredient (longest first — set
  // above). Escape regex specials in each name.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${ingredients.map(esc).join("|")})`, "gi");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong
        key={`ing-${key++}`}
        className="text-fg font-semibold"
      >
        {m[0]}
      </strong>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function FactCitations({
  text,
  factMap,
  ingredients,
}: {
  text: string;
  factMap?: Map<string, any>;
  ingredients?: string[];
}) {
  const ings = ingredients ?? [];
  // Split text into runs, wrap [F#] tokens with scroll-to-fact anchors.
  const parts = text.split(/(\[F\d+(?:,\s*F\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(F\d+(?:,\s*F\d+)*)\]$/);
        if (!match) {
          if (ings.length === 0) return <span key={i}>{part}</span>;
          return <span key={i}>{boldIngredients(part, ings)}</span>;
        }
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
      cls: "bg-accent-sage/15 text-accent-sage border-accent-sage/30",
    },
    partial: {
      label: "Partial",
      cls: "bg-accent-amber/15 text-accent-amber border-accent-amber/30",
    },
    gaps_critical: {
      label: "Gaps",
      cls: "bg-accent-rust/15 text-accent-rust border-accent-rust/30",
    },
    insufficient: {
      label: "Insufficient",
      cls: "bg-accent-red/15 text-accent-red border-accent-red/30",
    },
  };
  const m = map[coverage] ?? { label: coverage, cls: "bg-ink-700 text-fg-muted" };
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
    quantitative: "bg-accent-sage/10 text-accent-sage border-accent-sage/20",
    qualitative: "bg-accent-amber/10 text-accent-amber border-accent-amber/20",
    comparative: "bg-accent-primary/10 text-accent-primary border-accent-primary/20",
    background: "bg-ink-700 text-fg-muted border-fg/[0.08]",
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
  ingredients,
}: {
  q: any;
  answer: any;
  facts: any[];
  verMap: Map<string, any>;
  factMap: Map<string, any>;
  ingredients: string[];
}) {
  const [showAllFacts, setShowAllFacts] = useState(false);
  const questionFacts = facts.filter((f) => f.question_id === q.id);
  const shown = showAllFacts ? questionFacts : questionFacts.slice(0, 6);

  return (
    <section
      id={q.id}
      className="scroll-mt-8 mt-10 first:mt-0 pt-8 first:pt-0 border-t border-ink-600 first:border-0"
    >
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="font-mono text-[11px] text-fg-muted">{q.id}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent-primary">
          {q.category}
        </span>
        {answer && <CoverageBadge coverage={answer.coverage} />}
      </div>
      <h2 className="text-[20px] md:text-[24px] font-medium tracking-[-0.018em] leading-[1.25] text-fg mb-5 max-w-[720px]">
        {q.question}
      </h2>

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
        <div className="rl-summary-card mb-5">
          <p className="whitespace-pre-wrap">
            <FactCitations text={answer.answer} factMap={factMap} ingredients={ingredients} />
          </p>
        </div>
      )}

      {answer?.conflicting_facts?.length > 0 && (
        <div
          className="rl-summary-card mb-4 space-y-2"
          style={{
            borderColor: "rgba(255, 122, 122, 0.24)",
            background:
              "linear-gradient(180deg, rgba(255,122,122,0.05) 0%, var(--ink-800) 60%)",
          }}
        >
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-red mb-2">
            Conflicting findings · {answer.conflicting_facts.length}
          </div>
          {answer.conflicting_facts.map((cf: any, i: number) => (
            <div key={i} className="text-[13.5px] leading-[1.55] text-fg">
              <FactCitations text={`[${cf.fact_a}] vs [${cf.fact_b}] — ${cf.nature}`} factMap={factMap} ingredients={ingredients} />
            </div>
          ))}
        </div>
      )}

      {(answer?.gaps?.length > 0 || answer?.follow_ups?.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
          {answer?.gaps?.length > 0 && (
            <div className="rl-kf">
              <div className="lbl">Gaps</div>
              <ul className="text-[13px] leading-[1.45] text-fg space-y-1 mt-1">
                {answer.gaps.map((g: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-fg-faint mt-0.5 shrink-0">·</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer?.follow_ups?.length > 0 && (
            <div className="rl-kf">
              <div className="lbl">Follow-ups</div>
              <ul className="text-[13px] leading-[1.45] text-fg space-y-1 mt-1">
                {answer.follow_ups.map((f: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-accent-primary mt-0.5 shrink-0">→</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {questionFacts.length > 0 && (
        <div className="space-y-2">
          <div className="rl-tl-section-head">
            <h3>Evidence</h3>
            <span className="n">{questionFacts.length} facts</span>
            <div className="line" />
            {questionFacts.length > 6 && (
              <button
                onClick={() => setShowAllFacts((s) => !s)}
                className="font-mono text-[11px] text-accent-primary hover:brightness-110"
              >
                {showAllFacts ? "top 6" : `all ${questionFacts.length}`}
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
                  className={`rl-claim-card ${rejected ? "opacity-60" : ""}`}
                  style={rejected ? { borderStyle: "dashed" } : undefined}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-mono text-[10.5px] text-fg-faint">
                      {f.id}
                    </span>
                    <FactualityBadge f={f.factuality} />
                    <span className="font-mono text-[10.5px] text-fg-muted tabular-nums">
                      {(f.confidence * 100).toFixed(0)}%
                    </span>
                    {rejected && (
                      <span className="rl-claim-verdict fail ml-auto">
                        ✗ {ver?.verdict ?? "rejected"}
                      </span>
                    )}
                    {!rejected && ver?.verdict === "verified" && (
                      <span className="rl-claim-verdict ok ml-auto">
                        ✓ verified
                      </span>
                    )}
                  </div>
                  <div
                    className={`text-[13.5px] leading-[1.55] text-fg ${
                      rejected ? "line-through decoration-fg-muted/60" : ""
                    }`}
                  >
                    {f.statement}
                  </div>
                  {f.references?.[0] && (
                    <a
                      href={f.references[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-[11.5px] font-mono text-accent-primary hover:brightness-110 underline decoration-dotted break-all"
                    >
                      {f.references[0].title || f.references[0].url}
                    </a>
                  )}
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
  slug,
  canEdit = false,
  branches,
}: {
  project: Project;
  slug?: string;
  canEdit?: boolean;
  branches?: {
    children: any[];
    parent: any | null;
    siblings: any[];
  };
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
  // Detect INCI-style ingredient lists in the topic and auto-bold each
  // component everywhere it appears in the prose. Casual users (skincare
  // formulators) asked for this — scanning a long analysis for "where
  // did it say what about Niacinamide" is otherwise brutal.
  const ingredients = useMemo(
    () => extractIngredients(project.plan?.topic),
    [project.plan?.topic]
  );

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
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-10 items-start">
      <article className="min-w-0 max-w-[780px]">
        {intro && (
          <section className="mb-2">
            <div className="rl-tl-section-head">
              <h3>Introduction</h3>
              <div className="line" />
            </div>
            {slug ? (
              <SectionTweak
                slug={slug}
                section="introduction"
                sectionLabel="Introduction"
                canEdit={canEdit}
                originalContent={intro}
              >
                <div className="rl-summary-card">
                  <p>{intro}</p>
                </div>
              </SectionTweak>
            ) : (
              <div className="rl-summary-card">
                <p>{intro}</p>
              </div>
            )}
          </section>
        )}

        {analysisReport?.overall_summary && (
          <section id="summary" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>Summary</h3>
              <span className="n">auto-generated</span>
              <div className="line" />
            </div>
            {slug ? (
              <SectionTweak
                slug={slug}
                section="summary"
                sectionLabel="Summary"
                canEdit={canEdit}
                originalContent={analysisReport.overall_summary}
              >
                <div className="rl-summary-card">
                  <p>
                    <FactCitations
                      text={analysisReport.overall_summary}
                      factMap={factMap}
                    />
                  </p>
                </div>
              </SectionTweak>
            ) : (
              <div className="rl-summary-card">
                <p>
                  <FactCitations
                    text={analysisReport.overall_summary}
                    factMap={factMap}
                  />
                </p>
              </div>
            )}
          </section>
        )}

        {tensions.length > 0 && (
          <section id="tensions" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>Cross-question tensions</h3>
              <span className="n">{tensions.length}</span>
              <div className="line" />
            </div>
            <div className="space-y-2">
              {tensions.map((t: any, i: number) => (
                <div
                  key={i}
                  className="p-3 rounded-md border border-accent-amber/20 bg-accent-amber/5 text-[13px] leading-relaxed"
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
                    <FactCitations text={t.description} factMap={factMap} ingredients={ingredients} />
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
            ingredients={ingredients}
          />
        ))}

        {comparisonTable && (
          <section id="comparison" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>Method comparison</h3>
              <div className="line" />
            </div>
            {slug ? (
              <SectionTweak
                slug={slug}
                section="comparison"
                sectionLabel="Method comparison"
                canEdit={canEdit}
                originalContent={comparisonTable}
              >
                <div
                  className="overflow-x-auto prose-reader text-[13px] leading-relaxed [&_table]:w-full [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border [&_th]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-border/60 [&_table]:border-collapse"
                  dangerouslySetInnerHTML={{
                    __html: markdownTableToHtml(comparisonTable),
                  }}
                />
              </SectionTweak>
            ) : (
              <div
                className="overflow-x-auto prose-reader text-[13px] leading-relaxed [&_table]:w-full [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border [&_th]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-border/60 [&_table]:border-collapse"
                dangerouslySetInnerHTML={{
                  __html: markdownTableToHtml(comparisonTable),
                }}
              />
            )}
          </section>
        )}

        {deployment && (
          <section id="deployment" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>Deployment sequence</h3>
              <div className="line" />
            </div>
            {slug ? (
              <SectionTweak
                slug={slug}
                section="deployment"
                sectionLabel="Deployment sequence"
                canEdit={canEdit}
                originalContent={deployment}
              >
                <DeploymentList deployment={deployment} factMap={factMap} ingredients={ingredients} />
              </SectionTweak>
            ) : (
              <DeploymentList deployment={deployment} factMap={factMap} ingredients={ingredients} />
            )}
          </section>
        )}

        {recommendation && (
          <section id="recommendation" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>Recommendation</h3>
              <div className="line" />
            </div>
            {slug ? (
              <SectionTweak
                slug={slug}
                section="recommendation"
                sectionLabel="Recommendation"
                canEdit={canEdit}
                originalContent={recommendation}
              >
                <div
                  className="rl-summary-card"
                  style={{
                    borderColor: "rgba(232, 165, 132, 0.28)",
                    background:
                      "linear-gradient(180deg, rgba(232,165,132,0.05) 0%, var(--ink-800) 60%)",
                  }}
                >
                  <p>
                    <FactCitations text={recommendation} factMap={factMap} ingredients={ingredients} />
                  </p>
                </div>
              </SectionTweak>
            ) : (
              <div
                className="rl-summary-card"
                style={{
                  borderColor: "rgba(232, 165, 132, 0.28)",
                  background:
                    "linear-gradient(180deg, rgba(232,165,132,0.05) 0%, var(--ink-800) 60%)",
                }}
              >
                <p>
                  <FactCitations text={recommendation} factMap={factMap} ingredients={ingredients} />
                </p>
              </div>
            )}
          </section>
        )}

        {referenceUrls.length > 0 && (
          <section id="references" className="scroll-mt-8">
            <div className="rl-tl-section-head">
              <h3>References</h3>
              <span className="n">{referenceUrls.length}</span>
              <div className="line" />
            </div>
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

      {/* Rail — TOC + verification breakdown. Ported from
          the report prototype rail. Hidden on <lg; JumpToTop
          covers mobile navigation. */}
      <aside className="hidden lg:flex flex-col gap-4 sticky top-6 self-start">
        <div className="border border-ink-600 rounded-xl bg-ink-800 p-4 px-4">
          <h4 className="font-mono text-[11px] text-fg-muted tracking-[0.1em] uppercase mb-3">
            On this page
          </h4>
          <nav className="space-y-0.5 text-[12px] -mx-1">
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
                            ? "bg-accent-sage"
                            : a.coverage === "partial"
                              ? "bg-accent-amber"
                              : a.coverage === "gaps_critical"
                                ? "bg-accent-rust"
                                : "bg-accent-red"
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
        </div>

        <BreakdownCard project={project} />
        {branches && (branches.children.length > 0 || branches.siblings.length > 0 || branches.parent) && (
          <BranchesCard branches={branches} currentSlug={slug} />
        )}
      </aside>
      <JumpToTop />
    </div>
  );
}

function DeploymentList({
  deployment,
  factMap,
  ingredients,
}: {
  deployment: string;
  factMap: Map<string, any>;
  ingredients?: string[];
}) {
  const steps = deployment
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && /^\d+\./.test(l))
    .map((step) => step.replace(/^\d+\.\s*/, ""));
  return (
    <ol className="space-y-2.5 text-[14px] leading-relaxed list-none">
      {steps.map((text, i) => (
        <li
          key={i}
          className="flex items-start gap-3 p-3 rounded-md border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors"
        >
          <span className="font-mono text-[11px] text-muted-foreground shrink-0 pt-0.5 tabular-nums w-6">
            {i + 1}.
          </span>
          <div className="flex-1">
            <FactCitations text={text} factMap={factMap} ingredients={ingredients} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function BranchesCard({
  branches,
  currentSlug,
}: {
  branches: { children: any[]; parent: any | null; siblings: any[] };
  currentSlug?: string;
}) {
  const { children, parent, siblings } = branches;
  // Siblings excludes current slug by default; collapse parent's kids
  // minus self so the user sees "you are here, and these are your peers".
  const otherSiblings = siblings.filter((s) => s.slug !== currentSlug);
  return (
    <div className="border border-ink-600 rounded-xl bg-ink-800 p-4 text-[12px]">
      <h4 className="font-mono text-[11px] text-fg-muted tracking-[0.1em] uppercase mb-3">
        Branches
      </h4>
      {parent && (
        <>
          <div className="font-mono text-[10px] text-fg-faint uppercase tracking-wider mb-1.5">
            source
          </div>
          <BranchRow p={parent} subtle />
        </>
      )}
      {children.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-fg-faint uppercase tracking-wider mt-3 mb-1.5">
            extends of this · {children.length}
          </div>
          <div className="space-y-1.5">
            {children.map((p) => (
              <BranchRow key={p.slug} p={p} />
            ))}
          </div>
        </>
      )}
      {otherSiblings.length > 0 && (
        <>
          <div className="font-mono text-[10px] text-fg-faint uppercase tracking-wider mt-3 mb-1.5">
            other extends of the source · {otherSiblings.length}
          </div>
          <div className="space-y-1.5">
            {otherSiblings.map((p) => (
              <BranchRow key={p.slug} p={p} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BranchRow({
  p,
  subtle = false,
}: {
  p: any;
  subtle?: boolean;
}) {
  const title = p.topic.split("\n")[0] || p.slug;
  return (
    <Link
      href={`/projects/${p.slug}`}
      className={`block px-2.5 py-1.5 rounded-md border border-ink-600 hover:border-ink-500 hover:bg-ink-700 transition ${
        subtle ? "opacity-80" : ""
      }`}
    >
      <div className="text-[12px] text-fg truncate">
        {title.slice(0, 48)}
        {title.length > 48 ? "…" : ""}
      </div>
      <div className="font-mono text-[10.5px] text-fg-muted mt-0.5 flex gap-2">
        <span>{p.facts} F</span>
        <span>·</span>
        <span>{p.sources} S</span>
        {p.hasReport && (
          <span className="text-accent-sage ml-auto">✓ report</span>
        )}
      </div>
    </Link>
  );
}

function BreakdownCard({ project }: { project: Project }) {
  const v = project.verification?.summary;
  const verMap = new Map<string, any>();
  if (project.verification?.verifications) {
    for (const ve of project.verification.verifications)
      verMap.set(ve.claim_id ?? ve.fact_id, ve);
  }
  const verified = v?.verified ?? 0;
  const total = v?.total ?? project.facts.length;
  const rejected = total - verified;

  // Count verdict types among rejected
  let overreach = 0;
  let urlDead = 0;
  for (const ve of project.verification?.verifications ?? []) {
    if (ve.verdict === "verified") continue;
    if (ve.verdict === "url_dead" || ve.verdict === "quote_fabricated") urlDead++;
    else overreach++;
  }

  const providers = (project.sources?.by_provider ?? {}) as Record<
    string,
    number
  >;
  const totalSources = project.sources?.total_sources ?? 0;

  return (
    <div className="border border-ink-600 rounded-xl bg-ink-800 p-4 px-4 text-[12px]">
      <h4 className="font-mono text-[11px] text-fg-muted tracking-[0.1em] uppercase mb-3">
        Breakdown
      </h4>
      <RailStat k="facts" v={String(total)} />
      {total > 0 && (
        <>
          <RailStat
            k="verified"
            v={String(verified)}
            vClass="text-accent-sage"
          />
          {rejected > 0 && (
            <RailStat
              k="rejected"
              v={String(rejected)}
              vClass="text-fg-muted"
            />
          )}
          {urlDead > 0 && (
            <RailStat k="url / quote" v={String(urlDead)} vClass="text-accent-red" />
          )}
          {overreach > 0 && (
            <RailStat
              k="adversarial"
              v={String(overreach)}
              vClass="text-accent-amber"
            />
          )}
        </>
      )}
      {totalSources > 0 && (
        <div className="pt-3 mt-3 border-t border-ink-600">
          <RailStat k="sources" v={String(totalSources)} />
          {Object.entries(providers)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, count]) => (
              <RailStat key={name} k={name} v={String(count)} />
            ))}
        </div>
      )}
    </div>
  );
}

function RailStat({
  k,
  v,
  vClass,
}: {
  k: string;
  v: string;
  vClass?: string;
}) {
  return (
    <div className="flex justify-between py-1">
      <span className="font-mono text-[11px] text-fg-muted">{k}</span>
      <span className={`font-mono text-[11.5px] ${vClass ?? "text-fg"}`}>
        {v}
      </span>
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
      className={`block px-3 py-1.5 border-l transition ${
        isActive
          ? "border-accent-primary text-fg"
          : "border-ink-600 text-fg-muted hover:text-fg hover:border-ink-500"
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
