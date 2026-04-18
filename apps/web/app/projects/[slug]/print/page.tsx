import { getProject } from "@/lib/projects";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import "./print.css";

export const dynamic = "force-dynamic";

function statusTone(status: string) {
  switch (status) {
    case "well_supported":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "partially_supported":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "contradicted":
      return "text-red-700 bg-red-50 border-red-200";
    case "unsupported":
      return "text-zinc-700 bg-zinc-50 border-zinc-200";
    default:
      return "text-zinc-700 bg-zinc-50";
  }
}

function claimTone(type: string) {
  switch (type) {
    case "supports":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "contradicts":
      return "text-red-700 bg-red-50 border-red-200";
    default:
      return "text-zinc-700 bg-zinc-50 border-zinc-200";
  }
}

function verdictToneClass(verdict: string): string {
  switch (verdict) {
    case "verified":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "url_dead":
    case "quote_fabricated":
      return "text-red-700 bg-red-50 border-red-200";
    default:
      return "text-amber-700 bg-amber-50 border-amber-200";
  }
}

const VERDICT_DESCRIPTIONS: Record<string, string> = {
  verified: "Claim accurately follows from cited source",
  url_dead: "Cited URL is unreachable (404 / timeout / fabricated)",
  quote_fabricated: "Exact quote not found in the scraped source content",
  overreach: "Claim overstates what source actually says",
  out_of_context: "Quote stripped from context that changes meaning",
  cherry_picked: "Source discusses multiple views, claim uses only one",
  misread: "Model misunderstood the source material",
};

export default async function PrintPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const {
    plan,
    claims,
    criticReport,
    facts,
    analysisReport,
    report,
    sources,
    units: taskSources,
    verification,
    schema,
  } = project;
  const isQuestionFirst = schema === "question_first";
  const hypotheses = (plan.hypotheses as any[]) ?? [];
  const tasks = (plan.tasks as any[]) ?? [];
  const questions = (plan.questions as any[]) ?? [];
  const totalSources = sources?.total_sources ?? 0;
  const totalLearnings = sources?.total_learnings ?? 0;
  const byProvider: Record<string, number> = sources?.by_provider ?? {};
  const assessments = criticReport?.hypothesis_assessments ?? [];
  const contradictions = criticReport?.contradictions ?? [];
  const verMap = new Map<string, any>();
  if (verification?.verifications) {
    for (const v of verification.verifications)
      verMap.set(v.claim_id ?? v.fact_id, v);
  }

  return (
    <div className="print-doc">
      {/* Cover */}
      <section className="cover">
        <div className="cover-brand">Research Lab</div>
        <h1 className="cover-title">{plan.topic}</h1>
        <div className="cover-meta">
          <div>
            <div className="cover-meta-label">Generated</div>
            <div>{new Date().toISOString().slice(0, 10)}</div>
          </div>
          {isQuestionFirst ? (
            <>
              <div>
                <div className="cover-meta-label">Questions</div>
                <div>{questions.length}</div>
              </div>
              <div>
                <div className="cover-meta-label">Facts extracted</div>
                <div>{facts.length}</div>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="cover-meta-label">Overall confidence</div>
                <div className="cover-confidence">
                  {criticReport
                    ? `${Math.round(criticReport.overall_confidence * 100)}%`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="cover-meta-label">Hypotheses</div>
                <div>{hypotheses.length}</div>
              </div>
              <div>
                <div className="cover-meta-label">Claims extracted</div>
                <div>{claims.length}</div>
              </div>
            </>
          )}
          <div>
            <div className="cover-meta-label">Sources</div>
            <div>{totalSources}</div>
          </div>
          <div>
            <div className="cover-meta-label">Learnings</div>
            <div>{totalLearnings}</div>
          </div>
        </div>
        {isQuestionFirst && analysisReport?.overall_summary ? (
          <div className="cover-summary">
            <div className="section-eyebrow">Summary</div>
            <p>{analysisReport.overall_summary}</p>
          </div>
        ) : (
          !isQuestionFirst &&
          criticReport?.summary && (
            <div className="cover-summary">
              <div className="section-eyebrow">Executive summary</div>
              <p>{criticReport.summary}</p>
            </div>
          )
        )}
      </section>

      {/* 1. Synthesized Report — first, it's the main output */}
      {report && (
        <section className="page-break report-section">
          <h2>1. Report</h2>
          <div className="markdown-body-print">
            <Markdown content={report} />
          </div>
        </section>
      )}

      {/* 2. Analysis (question-first) — per-question answers + tensions */}
      {isQuestionFirst && analysisReport && (
        <section className="page-break">
          <h2>2. Analysis</h2>
          <p className="section-intro">
            Per-question narrative answers synthesized from verified facts.
            Coverage classified as complete / partial / gaps_critical /
            insufficient based on whether evidence directly addresses the
            question or only speaks to adjacent configurations.
          </p>
          {analysisReport.answers?.map((a: any) => {
            const q = questions.find((x: any) => x.id === a.question_id);
            return (
              <div key={a.question_id} className="assessment-block">
                <div className="assessment-head">
                  <span className="hypothesis-id">{a.question_id}</span>
                  <span className={`assessment-status ${statusTone(a.coverage)}`}>
                    {a.coverage?.replace(/_/g, " ")}
                  </span>
                  {q?.category && (
                    <span className="claim-conf">{q.category}</span>
                  )}
                </div>
                {q && <div className="assessment-hypothesis">{q.question}</div>}
                {a.answer && (
                  <div style={{ marginTop: "0.5rem", fontSize: "10pt", lineHeight: 1.55 }}>
                    {a.answer}
                  </div>
                )}
                <div className="assessment-details">
                  {a.key_facts?.length > 0 && (
                    <div>
                      <strong>Key facts:</strong>{" "}
                      <span className="mono">{a.key_facts.join(", ")}</span>
                    </div>
                  )}
                  {a.conflicting_facts?.length > 0 && (
                    <div>
                      <strong className="text-red-700">Conflicts:</strong>{" "}
                      {a.conflicting_facts.map((cf: any, i: number) => (
                        <span key={i} className="mono">
                          {cf.fact_a} vs {cf.fact_b}
                          {i < a.conflicting_facts.length - 1 ? "; " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {a.gaps?.length > 0 && (
                    <div>
                      <strong className="text-amber-700">Gaps:</strong>{" "}
                      {a.gaps.join("; ")}
                    </div>
                  )}
                  {a.follow_ups?.length > 0 && (
                    <div>
                      <strong>Follow-ups:</strong> {a.follow_ups.join("; ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {analysisReport.cross_question_tensions?.length > 0 && (
            <>
              <div className="sub-eyebrow" style={{ marginTop: "1.2rem" }}>
                Cross-question tensions
              </div>
              {analysisReport.cross_question_tensions.map((t: any, i: number) => (
                <div key={i} className="contradiction">
                  <span className="mono">
                    {(t.involved_questions ?? []).join(", ")}
                  </span>
                  {t.involved_facts?.length > 0 && (
                    <>
                      {" — facts "}
                      <span className="mono">
                        {t.involved_facts.join(", ")}
                      </span>
                    </>
                  )}
                  <div className="contradiction-desc">{t.description}</div>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {/* 2. Critic Assessment (hypothesis-first) */}
      {!isQuestionFirst && criticReport && (
        <section className="page-break">
          <h2>2. Critic Assessment</h2>
          <p className="section-intro">
            Per-hypothesis evaluation with gaps and cross-claim contradictions.
          </p>
          <div className="critic-overall">
            <div className="critic-conf">
              {Math.round(criticReport.overall_confidence * 100)}%
            </div>
            <div className="critic-summary-text">{criticReport.summary}</div>
          </div>

          {assessments.map((a: any) => {
            const h = hypotheses.find((h: any) => h.id === a.hypothesis_id);
            return (
              <div key={a.hypothesis_id} className="assessment-block">
                <div className="assessment-head">
                  <span className="hypothesis-id">{a.hypothesis_id}</span>
                  <span className={`assessment-status ${statusTone(a.status)}`}>
                    {a.status.replace(/_/g, " ")}
                  </span>
                  <span className="claim-conf">
                    conf {(a.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                {h && <div className="assessment-hypothesis">{h.statement}</div>}
                <div className="assessment-details">
                  {a.supporting_claims?.length > 0 && (
                    <div>
                      <strong className="text-emerald-700">Supports:</strong>{" "}
                      <span className="mono">
                        {a.supporting_claims.join(", ")}
                      </span>
                    </div>
                  )}
                  {a.contradicting_claims?.length > 0 && (
                    <div>
                      <strong className="text-red-700">Contradicts:</strong>{" "}
                      <span className="mono">
                        {a.contradicting_claims.join(", ")}
                      </span>
                    </div>
                  )}
                  {a.gaps?.length > 0 && (
                    <div>
                      <strong className="text-amber-700">Gaps:</strong>{" "}
                      {a.gaps.join("; ")}
                    </div>
                  )}
                  {a.recommendation && (
                    <div>
                      <strong>Next:</strong> {a.recommendation}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {contradictions.length > 0 && (
            <>
              <div className="sub-eyebrow" style={{ marginTop: "1.2rem" }}>
                Contradictions found
              </div>
              {contradictions.map((c: any, i: number) => (
                <div key={i} className="contradiction">
                  <span className="mono">{c.claim_a}</span>
                  {" vs "}
                  <span className="mono">{c.claim_b}</span>
                  <div className="contradiction-desc">{c.description}</div>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {/* Fact-Check summary (between Critic and Claims) */}
      {verification?.summary && (
        <section className="page-break">
          <h2>2.5. Fact-Check Summary</h2>
          <p className="section-intro">
            Every claim was verified against its cited source. URL-dead and
            quote-fabricated verdicts are deterministic; semantic verdicts are
            LLM adversarial review.
          </p>
          <div className="critic-overall">
            <div className="critic-conf">
              {Math.round(
                (verification.summary.verified / Math.max(1, verification.summary.total)) * 100
              )}%
            </div>
            <div className="critic-summary-text">
              <strong>
                {verification.summary.verified} / {verification.summary.total} claims verified
              </strong>
              {verification.summary.rejected > 0 && (
                <>
                  {". "}
                  {verification.summary.rejected} rejected by verifier.
                </>
              )}
            </div>
          </div>
          {verification.summary.by_verdict && (
            <table className="tasks-table">
              <thead>
                <tr>
                  <th>Verdict</th>
                  <th>Count</th>
                  <th>What it means</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(verification.summary.by_verdict)
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([v, n]) => (
                    <tr key={v}>
                      <td className="mono">{v.replace(/_/g, " ")}</td>
                      <td className="mono">{n as number}</td>
                      <td>{VERDICT_DESCRIPTIONS[v] ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {verification.verifications?.some((v: any) => v.verdict !== "verified") && (
            <>
              <div className="sub-eyebrow" style={{ marginTop: "1.2rem" }}>
                Rejected claims (not cited in final report)
              </div>
              {verification.verifications
                .filter((v: any) => v.verdict !== "verified")
                .map((v: any, i: number) => (
                  <div key={i} className="contradiction">
                    <div className="flex" style={{ display: "flex", gap: "0.4rem", alignItems: "baseline" }}>
                      <span className="mono">{v.claim_id}</span>
                      <span className={`assessment-status ${verdictToneClass(v.verdict)}`}>
                        {v.verdict.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="contradiction-desc">{v.notes}</div>
                    {v.corrected_statement && (
                      <div className="contradiction-desc" style={{ marginTop: "0.3rem" }}>
                        <strong>Correction:</strong> {v.corrected_statement}
                      </div>
                    )}
                  </div>
                ))}
            </>
          )}
        </section>
      )}

      {/* 3. Facts (question-first) / Claims (hypothesis-first) */}
      {isQuestionFirst ? (
        <section className="page-break">
          <h2>3. Facts &amp; Evidence</h2>
          <p className="section-intro">
            {facts.length} facts extracted from scraped source content, each
            tagged by subquestion and linked to a source URL with an exact
            quote.
          </p>
          {facts.map((f: any) => {
            const ver = verMap.get(f.id);
            const isRejected = ver && ver.verdict !== "verified";
            return (
              <div
                key={f.id}
                className="claim-block"
                style={isRejected ? { opacity: 0.55 } : {}}
              >
                <div className="claim-header">
                  <span className="claim-id">{f.id}</span>
                  {ver && (
                    <span
                      className={`claim-type ${verdictToneClass(ver.verdict)}`}
                    >
                      {ver.verdict === "verified" ? "✓" : "⚠"}{" "}
                      {ver.verdict.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="claim-type text-zinc-700 bg-zinc-50 border-zinc-200">
                    {f.factuality}
                  </span>
                  <span className="claim-conf">
                    conf {(f.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="claim-hyp">
                    {f.question_id}
                    {f.subquestion_id ? `/${f.subquestion_id}` : ""}
                  </span>
                </div>
                <div
                  className="claim-statement"
                  style={
                    isRejected
                      ? {
                          textDecoration: "line-through",
                          textDecorationColor: "#999",
                        }
                      : {}
                  }
                >
                  {f.statement}
                </div>
                {f.references?.length > 0 && (
                  <ul className="claim-refs">
                    {f.references.map((r: any, i: number) => (
                      <li key={i}>
                        <a href={r.url}>{r.title || r.url}</a>
                        {r.exact_quote && (
                          <div className="claim-quote">
                            &ldquo;{r.exact_quote.slice(0, 300)}&rdquo;
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="page-break">
          <h2>3. Claims &amp; Evidence</h2>
          <p className="section-intro">
            {claims.length} claims extracted from full scraped source content,
            each linked to an exact quote in the source.
          </p>
          {claims.map((c: any) => {
            const ver = verMap.get(c.id);
            const isRejected = ver && ver.verdict !== "verified";
            return (
              <div
                key={c.id}
                className="claim-block"
                style={isRejected ? { opacity: 0.55 } : {}}
              >
                <div className="claim-header">
                  <span className="claim-id">{c.id}</span>
                  {ver && (
                    <span
                      className={`claim-type ${verdictToneClass(ver.verdict)}`}
                    >
                      {ver.verdict === "verified" ? "✓" : "⚠"}{" "}
                      {ver.verdict.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className={`claim-type ${claimTone(c.type)}`}>
                    {c.type}
                  </span>
                  <span className="claim-conf">
                    conf {(c.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="claim-hyp">{c.hypothesis_id}</span>
                </div>
                <div
                  className="claim-statement"
                  style={
                    isRejected
                      ? {
                          textDecoration: "line-through",
                          textDecorationColor: "#999",
                        }
                      : {}
                  }
                >
                  {c.statement}
                </div>
                {c.references?.length > 0 && (
                  <ul className="claim-refs">
                    {c.references.map((r: any, i: number) => (
                      <li key={i}>
                        <a href={r.url}>{r.title || r.url}</a>
                        {r.exact_quote && (
                          <div className="claim-quote">
                            &ldquo;{r.exact_quote.slice(0, 300)}&rdquo;
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 4. Research Plan — context for what was asked */}
      {isQuestionFirst ? (
        <section className="page-break">
          <h2>4. Research Plan</h2>
          <p className="section-intro">
            {questions.length} research questions with{" "}
            {questions.reduce(
              (n: number, q: any) => n + (q.subquestions?.length ?? 0),
              0
            )}{" "}
            subquestions that drove harvester query generation. No numeric
            thresholds were fabricated during planning.
          </p>
          {questions.map((q: any) => (
            <div key={q.id} className="hypothesis-block">
              <div className="hypothesis-header">
                <span className="hypothesis-id">{q.id}</span>
                <span className="hypothesis-statement">{q.question}</span>
              </div>
              <div className="criteria-row">
                <span className="criterion">
                  <strong>category</strong>: {q.category}
                </span>
              </div>
              {q.subquestions?.length > 0 && (
                <ul
                  style={{
                    marginTop: "0.3rem",
                    paddingLeft: "1.2rem",
                    fontSize: "9.5pt",
                  }}
                >
                  {q.subquestions.map((sq: any) => (
                    <li key={sq.id}>
                      <span className="mono">{sq.id}</span> [{sq.angle}] —{" "}
                      {sq.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {plan.scope_notes && (
            <div className="validation-infra">
              <strong>Scope notes:</strong> {plan.scope_notes}
            </div>
          )}
        </section>
      ) : (
        <section className="page-break">
          <h2>4. Research Plan</h2>
          <p className="section-intro">
            Hypotheses, acceptance criteria, and tasks generated from the topic.
          </p>
          <div className="sub-eyebrow">Hypotheses</div>
          {hypotheses.map((h: any) => (
            <div key={h.id} className="hypothesis-block">
              <div className="hypothesis-header">
                <span className="hypothesis-id">{h.id}</span>
                <span className="hypothesis-statement">{h.statement}</span>
              </div>
              <div className="criteria-row">
                {h.acceptance_criteria?.map((c: any, i: number) => (
                  <span key={i} className="criterion">
                    <strong>{c.name}</strong>: {c.threshold}
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div className="sub-eyebrow" style={{ marginTop: "1.2rem" }}>
            Tasks
          </div>
          <table className="tasks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hyp</th>
                <th>Type</th>
                <th>Goal</th>
                <th>Depends on</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t: any) => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td className="mono">{t.hypothesis_id}</td>
                  <td className="mono">{t.type}</td>
                  <td>{t.goal}</td>
                  <td className="mono">
                    {t.depends_on?.length ? t.depends_on.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="budget-row">
            <span>
              <strong>Max steps:</strong> {plan.budget?.max_steps ?? "—"}
            </span>
            <span>
              <strong>Max sources:</strong> {plan.budget?.max_sources ?? "—"}
            </span>
            <span>
              <strong>Validation:</strong>{" "}
              {plan.validation_needed ? "required" : "optional"}
            </span>
          </div>
          {plan.validation_infra && (
            <div className="validation-infra">
              <strong>Validation infra:</strong> {plan.validation_infra}
            </div>
          )}
        </section>
      )}

      {/* 5. Sources — full list grouped by task */}
      <section className="page-break">
        <h2>5. Sources</h2>
        <p className="section-intro">
          {totalSources} unique URLs collected across{" "}
          {isQuestionFirst
            ? `${questions.reduce(
                (n: number, q: any) => n + (q.subquestions?.length ?? 0),
                0
              )} subquestions`
            : `${tasks.length} tasks`}{" "}
          via{" "}
          {Object.entries(byProvider)
            .map(([p, c]) => `${p} (${c})`)
            .join(", ")}
          . Each source was scraped via Jina Reader to full markdown content.
        </p>

        {taskSources.map((t: any) => {
          const unitId = t.task_id ?? t.subquestion_id ?? "";
          const parentId = t.hypothesis_id ?? t.question_id ?? "";
          // For hypothesis-first: find task goal. For question-first: find subquestion text.
          let unitLabel = "";
          if (isQuestionFirst) {
            const q = questions.find((qq: any) => qq.id === t.question_id);
            const sq = q?.subquestions?.find(
              (s: any) => s.id === t.subquestion_id
            );
            unitLabel = sq?.text ?? "";
          } else {
            unitLabel = tasks.find((tk: any) => tk.id === t.task_id)?.goal ?? "";
          }
          return (
            <div key={unitId || parentId} className="source-group">
              <div className="source-group-head">
                <span className="hypothesis-id">{unitId}</span>
                <span className="mono">{parentId}</span>
                {unitLabel && (
                  <span className="source-group-goal">{unitLabel}</span>
                )}
                <span className="source-count">
                  {t.results.length} sources
                </span>
              </div>

              {t.queries?.length > 0 && (
                <div className="source-queries">
                  <span className="sub-eyebrow" style={{ marginRight: 6 }}>
                    queries
                  </span>
                  {t.queries.slice(0, 6).map((q: string, i: number) => (
                    <span key={i} className="source-query">
                      {q}
                    </span>
                  ))}
                  {t.queries.length > 6 && (
                    <span className="source-query-more">
                      + {t.queries.length - 6} more
                    </span>
                  )}
                </div>
              )}

              <ol className="source-list">
                {t.results.map((r: any, i: number) => (
                  <li key={i}>
                    <div className="source-title">
                      <a href={r.url}>{r.title || r.url}</a>
                    </div>
                    <div className="source-meta">
                      <span className="mono source-provider">
                        {(r.provider ?? "").split(":").pop() ?? r.provider}
                      </span>
                      <span className="source-url">{r.url}</span>
                    </div>
                    {r.snippet && (
                      <div className="source-snippet">
                        {r.snippet.slice(0, 240)}
                        {r.snippet.length > 240 ? "…" : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </section>

      <footer className="print-footer">
        <span>
          Generated by Research Lab · {new Date().toISOString().slice(0, 10)}
        </span>
      </footer>
    </div>
  );
}
