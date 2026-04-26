import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ResearchPlan } from "./schemas/plan";
import type { AnalysisReport, Fact } from "./schemas/fact";
import type { Verification } from "./schemas/verification";
import type { SourceIndex } from "./schemas/source";
import {
  adjustedConfidenceForTrust,
  readSourceStatus,
  sourceTrustForFact,
  sourceTrustForUrl,
} from "./source-status";

type ClaimState = "verified" | "contested" | "blocked" | "unverified";

interface SourceMeta {
  url: string;
  title: string;
  provider: string;
  question_id: string;
  subquestion_id: string;
  collected_at: string | null;
  usefulness: number | null;
  domain_match: string | null;
  source_type: string | null;
  relevance_checked_at: number | null;
}

export interface EpistemicGraph {
  schema_version: 1;
  generated_at: string;
  topic: string;
  summary: {
    claims_total: number;
    claims_verified: number;
    claims_blocked: number;
    claims_contested: number;
    claims_unverified: number;
    research_debt_items: number;
    contradictions: number;
  };
  contradiction_pass?: {
    checked_at: string;
    candidates: number;
    accepted: number;
  };
  claims: Array<{
    id: string;
    statement: string;
    question_id: string;
    subquestion_id: string;
    factuality: string | null;
    confidence: number | null;
    lifecycle_state: ClaimState;
    verdict: string;
    evidence: Array<{
      url: string;
      title: string;
      exact_quote: string;
      provider: string | null;
      source_type: string | null;
      usefulness: number | null;
      domain_match: string | null;
      source_trust: string;
    }>;
    counterevidence: Array<{
      kind: "verification_rejection" | "conflicting_fact";
      fact_id?: string;
      verdict?: string;
      severity?: string | null;
      notes: string;
      corrected_statement?: string | null;
    }>;
    freshness: {
      collected_at: string[];
      newest_collected_at: string | null;
      relevance_checked_at: number[];
      newest_relevance_checked_at: number | null;
    };
    dependencies: {
      question_coverage: string;
      is_key_fact: boolean;
      conflicting_facts: string[];
      source_hosts: string[];
      open_questions: string[];
    };
  }>;
  research_debt: Array<{
    id: string;
    question_id: string;
    kind: "unknown" | "next_check" | "weak_evidence";
    severity: "low" | "medium" | "high";
    item: string;
    next_check: string | null;
    depends_on_claims: string[];
  }>;
  contradictions: Array<{
    id: string;
    scope: "within_question" | "cross_question";
    question_id: string | null;
    involved_questions: string[];
    involved_facts: string[];
    verdict?: "contradiction" | "different_context";
    difference: string;
    resolution_axes: string[];
    next_check?: string;
    confidence?: number;
  }>;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))] as T[];
}

function maxIso(values: string[]): string | null {
  const valid = values
    .map((v) => ({ raw: v, ms: Date.parse(v) }))
    .filter((v) => Number.isFinite(v.ms));
  valid.sort((a, b) => b.ms - a.ms);
  return valid[0]?.raw ?? null;
}

function maxNumber(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return Math.max(...valid);
}

function debtSeverity(coverage: string): "low" | "medium" | "high" {
  if (coverage === "insufficient" || coverage === "gaps_critical") return "high";
  if (coverage === "partial") return "medium";
  return "low";
}

function sourceFiles(projectDir: string): SourceIndex[] {
  const dir = join(projectDir, "sources");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f))
    .sort()
    .map((f) => readJson<SourceIndex | null>(join(dir, f), null))
    .filter(Boolean) as SourceIndex[];
}

function sourceMetaByUrl(projectDir: string): Map<string, SourceMeta> {
  const byUrl = new Map<string, SourceMeta>();
  for (const index of sourceFiles(projectDir)) {
    for (const result of index.results ?? []) {
      if (!result.url || byUrl.has(result.url)) continue;
      byUrl.set(result.url, {
        url: result.url,
        title: result.title ?? result.url,
        provider: result.provider ?? "source",
        question_id: index.question_id ?? "",
        subquestion_id: index.subquestion_id ?? "",
        collected_at: index.collected_at ?? null,
        usefulness: result.relevance?.usefulness ?? null,
        domain_match: result.relevance?.domain_match ?? null,
        source_type: result.relevance?.source_type ?? null,
        relevance_checked_at: result.relevance?.checked_at ?? null,
      });
    }
  }
  return byUrl;
}

export function buildEpistemicGraph(args: {
  plan: ResearchPlan;
  projectDir: string;
}): EpistemicGraph {
  const { plan, projectDir } = args;
  const facts = readJson<Fact[]>(join(projectDir, "facts.json"), []);
  const verificationReport = readJson<{ verifications?: Verification[] }>(
    join(projectDir, "verification.json"),
    {}
  );
  const analysis = readJson<AnalysisReport>(
    join(projectDir, "analysis_report.json"),
    { answers: [], cross_question_tensions: [], overall_summary: "" }
  );
  const sourcesIndex = readJson<any>(join(projectDir, "sources", "index.json"), null);
  const sourceMeta = sourceMetaByUrl(projectDir);
  const sourceStatus = readSourceStatus(projectDir);
  const verByFact = new Map(
    (verificationReport.verifications ?? []).map((v: Verification) => [v.fact_id, v])
  );
  const answerByQuestion = new Map(
    (analysis.answers ?? []).map((a) => [a.question_id, a])
  );

  const conflictsByFact = new Map<string, Array<{ factId: string; nature: string }>>();
  for (const answer of analysis.answers ?? []) {
    for (const conflict of answer.conflicting_facts ?? []) {
      if (conflict.fact_a && conflict.fact_b) {
        const a = conflictsByFact.get(conflict.fact_a) ?? [];
        a.push({ factId: conflict.fact_b, nature: conflict.nature });
        conflictsByFact.set(conflict.fact_a, a);
        const b = conflictsByFact.get(conflict.fact_b) ?? [];
        b.push({ factId: conflict.fact_a, nature: conflict.nature });
        conflictsByFact.set(conflict.fact_b, b);
      }
    }
  }

  const claims = facts.map((fact) => {
    const verification = verByFact.get(fact.id);
    const answer = answerByQuestion.get(fact.question_id);
    const verdict = verification?.verdict ?? "unverified";
    const conflicts = conflictsByFact.get(fact.id) ?? [];
    const lifecycleState: ClaimState =
      verdict === "verified"
        ? conflicts.length
          ? "contested"
          : "verified"
        : verdict === "unverified"
          ? "unverified"
          : "blocked";

    const evidence = (fact.references ?? []).map((ref) => {
      const meta = sourceMeta.get(ref.url);
      const trust = sourceTrustForUrl(sourceStatus, ref.url);
      return {
        url: ref.url,
        title: ref.title || meta?.title || "",
        exact_quote: ref.exact_quote ?? "",
        provider: meta?.provider ?? null,
        source_type: meta?.source_type ?? null,
        usefulness: meta?.usefulness ?? null,
        domain_match: meta?.domain_match ?? null,
        source_trust: trust,
      };
    });
    const sourceTrust = sourceTrustForFact(sourceStatus, fact);
    const collectedAt = uniq(
      evidence
        .map((ref) => sourceMeta.get(ref.url)?.collected_at)
        .filter(Boolean) as string[]
    );
    const relevanceCheckedAt = uniq(
      evidence
        .map((ref) => sourceMeta.get(ref.url)?.relevance_checked_at)
        .filter((v): v is number => typeof v === "number")
    );
    const openQuestions = uniq([
      ...((answer?.gaps ?? []) as string[]),
      ...((answer?.follow_ups ?? []) as string[]),
    ]);
    return {
      id: fact.id,
      statement: fact.statement,
      question_id: fact.question_id,
      subquestion_id: fact.subquestion_id,
      factuality: fact.factuality ?? null,
      confidence:
        typeof fact.confidence === "number"
          ? adjustedConfidenceForTrust(fact.confidence, sourceTrust)
          : null,
      lifecycle_state: lifecycleState,
      verdict,
      evidence,
      counterevidence: [
        ...(verification && verification.verdict !== "verified"
          ? [
              {
                kind: "verification_rejection" as const,
                verdict: verification.verdict,
                severity: verification.severity ?? null,
                notes: verification.notes ?? "",
                corrected_statement: verification.corrected_statement ?? null,
              },
            ]
          : []),
        ...conflicts.map((conflict) => ({
          kind: "conflicting_fact" as const,
          fact_id: conflict.factId,
          notes: conflict.nature,
        })),
      ],
      freshness: {
        collected_at: collectedAt,
        newest_collected_at: maxIso(collectedAt),
        relevance_checked_at: relevanceCheckedAt,
        newest_relevance_checked_at: maxNumber(relevanceCheckedAt),
      },
      dependencies: {
        question_coverage: answer?.coverage ?? "pending",
        is_key_fact: (answer?.key_facts ?? []).includes(fact.id),
        conflicting_facts: conflicts.map((c) => c.factId),
        source_hosts: uniq(evidence.map((ref) => hostOf(ref.url))),
        open_questions: openQuestions,
      },
    };
  });

  const claimsByQuestion = new Map<string, string[]>();
  for (const claim of claims) {
    const arr = claimsByQuestion.get(claim.question_id) ?? [];
    arr.push(claim.id);
    claimsByQuestion.set(claim.question_id, arr);
  }

  const researchDebt: EpistemicGraph["research_debt"] = [];
  for (const answer of analysis.answers ?? []) {
    const severity = debtSeverity(answer.coverage);
    for (const gap of answer.gaps ?? []) {
      researchDebt.push({
        id: `D${researchDebt.length + 1}`,
        question_id: answer.question_id,
        kind: "unknown",
        severity,
        item: gap,
        next_check: answer.follow_ups?.[0] ?? null,
        depends_on_claims: claimsByQuestion.get(answer.question_id) ?? [],
      });
    }
    for (const followUp of answer.follow_ups ?? []) {
      researchDebt.push({
        id: `D${researchDebt.length + 1}`,
        question_id: answer.question_id,
        kind: "next_check",
        severity: severity === "high" ? "medium" : severity,
        item: followUp,
        next_check: followUp,
        depends_on_claims: claimsByQuestion.get(answer.question_id) ?? [],
      });
    }
  }
  for (const sq of sourcesIndex?.by_subquestion ?? []) {
    if ((sq.sources ?? 0) > 0) continue;
    researchDebt.push({
      id: `D${researchDebt.length + 1}`,
      question_id: sq.question_id ?? "",
      kind: "weak_evidence",
      severity: "high",
      item: `No accepted sources for ${sq.subquestion_id ?? "subquestion"}.`,
      next_check: `Run targeted source search for ${sq.subquestion_id ?? sq.question_id}.`,
      depends_on_claims: claimsByQuestion.get(sq.question_id ?? "") ?? [],
    });
  }
  const questionableSources = Object.entries(sourceStatus).filter(
    ([, record]) => record.status === "questionable"
  );
  for (const [url, record] of questionableSources) {
    const dependentClaims = claims
      .filter((claim) => claim.evidence.some((e) => e.url === url))
      .map((claim) => claim.id);
    if (dependentClaims.length === 0) continue;
    const questionId =
      claims.find((claim) => dependentClaims.includes(claim.id))?.question_id ?? "";
    researchDebt.push({
      id: `D${researchDebt.length + 1}`,
      question_id: questionId,
      kind: "weak_evidence",
      severity: "medium",
      item: `Source marked questionable supports ${dependentClaims.length} claim${dependentClaims.length === 1 ? "" : "s"}: ${hostOf(url)}.${record.note ? ` Note: ${record.note}` : ""}`,
      next_check: `Find replacement primary or independently verified evidence for ${hostOf(url)}.`,
      depends_on_claims: dependentClaims,
    });
  }

  const contradictions: EpistemicGraph["contradictions"] = [];
  for (const answer of analysis.answers ?? []) {
    for (const conflict of answer.conflicting_facts ?? []) {
      contradictions.push({
        id: `C${contradictions.length + 1}`,
        scope: "within_question",
        question_id: answer.question_id,
        involved_questions: [answer.question_id],
        involved_facts: [conflict.fact_a, conflict.fact_b].filter(Boolean),
        verdict: "contradiction",
        difference: conflict.nature,
        resolution_axes: [
          "source/version mismatch",
          "benchmark/workload mismatch",
          "marketing claim vs empirical evidence",
        ],
      });
    }
  }
  for (const tension of analysis.cross_question_tensions ?? []) {
    contradictions.push({
      id: `C${contradictions.length + 1}`,
      scope: "cross_question",
      question_id: null,
      involved_questions: tension.involved_questions ?? [],
      involved_facts: tension.involved_facts ?? [],
      verdict: "contradiction",
      difference: tension.description,
      resolution_axes: [
        "different objectives",
        "different workloads",
        "tradeoff hidden by aggregate metrics",
      ],
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    topic: plan.topic,
    summary: {
      claims_total: claims.length,
      claims_verified: claims.filter((c) => c.lifecycle_state === "verified").length,
      claims_blocked: claims.filter((c) => c.lifecycle_state === "blocked").length,
      claims_contested: claims.filter((c) => c.lifecycle_state === "contested").length,
      claims_unverified: claims.filter((c) => c.lifecycle_state === "unverified").length,
      research_debt_items: researchDebt.length,
      contradictions: contradictions.length,
    },
    claims,
    research_debt: researchDebt,
    contradictions,
  };
}

export function writeEpistemicGraph(args: {
  plan: ResearchPlan;
  projectDir: string;
}): EpistemicGraph {
  const graph = buildEpistemicGraph(args);
  writeFileSync(
    join(args.projectDir, "epistemic_graph.json"),
    JSON.stringify(graph, null, 2)
  );
  return graph;
}
