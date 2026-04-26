import { getProject } from "@/lib/projects";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const project = getProject(slug, viewerUidFromRequest(request));
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const questions = project.plan?.questions ?? [];
  const answers = project.analysisReport?.answers ?? [];
  const verification = project.verification;
  const facts = project.facts ?? [];
  const sourceRows = (project.units ?? []).flatMap((unit: any) =>
    (unit.results ?? []).map((source: any) => ({
      question_id: unit.question_id,
      subquestion_id: unit.subquestion_id,
      title: source.title ?? source.url,
      url: source.url,
      provider: source.provider ?? "source",
      relevance: source.relevance ?? null,
    }))
  );

  const verMap = new Map<string, any>(
    (verification?.verifications ?? []).map((v: any) => [
      v.fact_id ?? v.claim_id,
      v,
    ])
  );
  const answerByQuestion = new Map(
    answers.map((a: any) => [a.question_id, a])
  );

  const questionAudit = questions.map((q: any) => {
    const qFacts = facts.filter((f: any) => f.question_id === q.id);
    const qSources = sourceRows.filter((s: any) => s.question_id === q.id);
    const verifiedFacts = qFacts.filter((f: any) => {
      const verdict = verMap.get(f.id)?.verdict;
      return !verdict || verdict === "verified";
    });
    const answer = answers.find((a: any) => a.question_id === q.id);
    return {
      id: q.id,
      question: q.question,
      category: q.category,
      subquestions: q.subquestions ?? [],
      coverage: answer?.coverage ?? "pending",
      facts_total: qFacts.length,
      facts_verified: verifiedFacts.length,
      sources_total: qSources.length,
      gaps: answer?.gaps ?? [],
      follow_ups: answer?.follow_ups ?? [],
      key_facts: answer?.key_facts ?? [],
    };
  });

  const claimLifecycle = facts.map((fact: any) => {
    const verification = verMap.get(fact.id);
    const answer = answerByQuestion.get(fact.question_id) as any;
    const verdict = verification?.verdict ?? "unverified";
    const sourceUrls = (fact.references ?? [])
      .map((ref: any) => ref.url)
      .filter(Boolean);
    const conflicting = (answer?.conflicting_facts ?? []).filter(
      (c: any) => c.fact_a === fact.id || c.fact_b === fact.id
    );
    return {
      id: fact.id,
      statement: fact.statement,
      question_id: fact.question_id,
      subquestion_id: fact.subquestion_id,
      confidence: fact.confidence ?? null,
      factuality: fact.factuality ?? null,
      lifecycle_state:
        verdict === "verified"
          ? conflicting.length
            ? "contested"
            : "verified"
          : verdict === "unverified"
            ? "unverified"
            : "blocked",
      verdict,
      evidence_count: sourceUrls.length,
      evidence_urls: sourceUrls,
      counterevidence:
        verdict !== "verified"
          ? {
              verdict,
              severity: verification?.severity ?? null,
              notes: verification?.notes ?? "",
              corrected_statement: verification?.corrected_statement ?? null,
            }
          : null,
      dependencies: {
        question_coverage: answer?.coverage ?? "pending",
        is_key_fact: (answer?.key_facts ?? []).includes(fact.id),
        conflicting_facts: conflicting,
        open_questions: [...(answer?.gaps ?? []), ...(answer?.follow_ups ?? [])],
      },
    };
  });

  const researchDebt = questionAudit.flatMap((q: any) => [
    ...q.gaps.map((gap: string) => ({
      question_id: q.id,
      kind: "unknown",
      severity:
        q.coverage === "insufficient" || q.coverage === "gaps_critical"
          ? "high"
          : "medium",
      item: gap,
      next_check: q.follow_ups[0] ?? null,
    })),
    ...q.follow_ups.map((followUp: string) => ({
      question_id: q.id,
      kind: "next_check",
      severity: q.coverage === "complete" ? "low" : "medium",
      item: followUp,
      next_check: followUp,
    })),
  ]);

  const contradictionResolver = [
    ...answers.flatMap((answer: any) =>
      (answer.conflicting_facts ?? []).map((conflict: any) => ({
        scope: "within_question",
        question_id: answer.question_id,
        involved_facts: [conflict.fact_a, conflict.fact_b].filter(Boolean),
        difference: conflict.nature,
        likely_resolution_axes: [
          "source/version mismatch",
          "benchmark/workload mismatch",
          "marketing claim vs empirical evidence",
        ],
      }))
    ),
    ...(project.analysisReport?.cross_question_tensions ?? []).map((t: any) => ({
      scope: "cross_question",
      question_id: null,
      involved_questions: t.involved_questions ?? [],
      involved_facts: t.involved_facts ?? [],
      difference: t.description,
      likely_resolution_axes: [
        "different objectives",
        "different workloads",
        "tradeoff hidden by aggregate metrics",
      ],
    })),
  ];
  const epistemicEngine = project.epistemicGraph
    ? {
        claim_lifecycle: project.epistemicGraph.claims ?? [],
        research_debt: (project.epistemicGraph.research_debt ?? []).map((d: any) => ({
          ...d,
          status: project.debtStatus?.[d.id]?.status ?? "open",
          status_record: project.debtStatus?.[d.id] ?? null,
        })),
        contradiction_resolver: project.epistemicGraph.contradictions ?? [],
        summary: project.epistemicGraph.summary ?? null,
      }
    : {
        claim_lifecycle: claimLifecycle,
        research_debt: researchDebt.map((d: any) => ({
          ...d,
          status: project.debtStatus?.[d.id]?.status ?? "open",
          status_record: project.debtStatus?.[d.id] ?? null,
        })),
        contradiction_resolver: contradictionResolver,
        summary: null,
      };

  const providerCounts: Record<string, number> = {};
  const sourceTypeCounts: Record<string, number> = {};
  for (const source of sourceRows) {
    providerCounts[source.provider] = (providerCounts[source.provider] ?? 0) + 1;
    const type = source.relevance?.source_type ?? "unknown";
    sourceTypeCounts[type] = (sourceTypeCounts[type] ?? 0) + 1;
  }

  const totalFacts = verification?.summary?.total ?? facts.length;
  const verifiedFacts = verification?.summary?.verified ?? facts.length;
  const audit = {
    slug,
    generated_at: new Date().toISOString(),
    schema: project.schema,
    topic: project.plan?.topic ?? slug,
    cognitive_contract: {
      question_first: true,
      source_bounded: true,
      quote_bound_facts: true,
      verified_only_synthesis: true,
      explicit_gaps: true,
      resumable_phases: true,
    },
    metrics: {
      questions: questions.length,
      sources: project.sources?.total_sources ?? sourceRows.length,
      source_rows: sourceRows.length,
      learnings: project.sources?.total_learnings ?? 0,
      facts_total: totalFacts,
      facts_verified: verifiedFacts,
      facts_rejected: Math.max(0, totalFacts - verifiedFacts),
      verification_rate:
        totalFacts > 0 ? Number((verifiedFacts / totalFacts).toFixed(4)) : null,
      weak_questions: questionAudit.filter(
        (q: any) => q.coverage === "insufficient" || q.coverage === "gaps_critical"
      ).length,
    },
    source_mix: {
      by_provider: providerCounts,
      by_type: sourceTypeCounts,
    },
    source_status: project.sourceStatus ?? {},
    epistemic_engine: epistemicEngine,
    usage: project.usageSummary,
    questions: questionAudit,
    verification_summary: verification?.summary ?? null,
    cross_question_tensions:
      project.analysisReport?.cross_question_tensions ?? [],
  };

  const url = new URL(request.url);
  const headers: HeadersInit = {};
  if (url.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${slug}-audit.json"`;
  }
  return Response.json(audit, { headers });
}
