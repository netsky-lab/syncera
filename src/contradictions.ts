import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { generateJson } from "./llm";
import type { EpistemicGraph } from "./epistemic";

type Claim = EpistemicGraph["claims"][number];
type GraphContradiction = EpistemicGraph["contradictions"][number] & {
  verdict?: "contradiction" | "different_context";
  next_check?: string;
  confidence?: number;
};

interface Candidate {
  id: string;
  fact_a: string;
  fact_b: string;
  question_id: string | null;
  score: number;
  shared_terms: string[];
  heuristic: string;
}

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "been",
  "being",
  "between",
  "could",
  "data",
  "does",
  "from",
  "have",
  "into",
  "more",
  "over",
  "research",
  "same",
  "should",
  "source",
  "specific",
  "study",
  "such",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "using",
  "which",
  "with",
]);

const POLARITY = {
  positive: [
    "improve",
    "improved",
    "improves",
    "increase",
    "increased",
    "increases",
    "higher",
    "better",
    "outperform",
    "outperforms",
    "enable",
    "enables",
    "accurate",
    "stable",
    "supported",
    "succeeds",
  ],
  negative: [
    "fail",
    "failed",
    "fails",
    "failure",
    "decrease",
    "decreased",
    "decreases",
    "lower",
    "worse",
    "underperform",
    "underperforms",
    "unstable",
    "unsupported",
    "inaccurate",
    "hallucination",
    "error",
    "errors",
    "misread",
  ],
  costUp: [
    "expensive",
    "costly",
    "higher cost",
    "more costly",
    "latency",
    "slower",
    "slow",
  ],
  costDown: ["cheap", "cheaper", "lower cost", "faster", "fast", "reduced latency"],
};

function normalizeVerdict(value: unknown) {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw.includes("different") || raw.includes("context")) return "different_context";
  if (raw.includes("not") || raw.includes("compatible") || raw.includes("no_contradiction")) {
    return "not_contradiction";
  }
  if (raw.includes("contradict") || raw.includes("conflict")) return "contradiction";
  return "not_contradiction";
}

const ContradictionDecisionSchema = z.object({
  decisions: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value
            .filter((v) => typeof v === "object" && v)
            .map((v: any) => ({
              ...v,
              candidate_id: v.candidate_id ?? v.id ?? v.candidate,
            }))
            .filter((v: any) => typeof v.candidate_id === "string")
        : value,
    z.array(
      z.object({
      candidate_id: z.string(),
      verdict: z.preprocess(
        normalizeVerdict,
        z.enum(["contradiction", "different_context", "not_contradiction"])
      ),
      confidence: z.preprocess(
        (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : 0.5;
        },
        z.number().min(0).max(1)
      ),
      difference: z
        .string()
        .describe("Precise description of what differs between the two claims."),
      resolution_axes: z.preprocess(
        (value) => (Array.isArray(value) ? value : []),
        z.array(
          z.preprocess(
            (value) =>
              String(value ?? "")
                .toLowerCase()
                .replace(/[\s-]+/g, "_"),
            z.enum([
            "version",
            "benchmark",
            "workload",
            "source_type",
            "date",
            "metric",
            "population",
            "environment",
            "marketing_vs_empirical",
            "scope",
            ])
          )
        )
      ).default([]),
      next_check: z
        .preprocess(
          (value) =>
            value == null || value === ""
              ? "Run a targeted follow-up to compare version, workload, metric, date, source type, and scope."
              : value,
          z.string()
        )
        .describe("Concrete follow-up needed to resolve this tension."),
      })
    )
  ),
});

const SYSTEM = `You are a contradiction resolver for an evidence graph.
You receive candidate claim pairs. Decide whether each pair is a real contradiction.

Definitions:
- contradiction: both claims cannot be simultaneously true under the same version/workload/metric/scope.
- different_context: claims appear opposed but differ by benchmark, version, workload, source type, date, environment, or population.
- not_contradiction: claims are compatible or one is only broader/narrower.

Be conservative. Only mark contradiction when the pair genuinely needs resolution.`;

function readGraph(projectDir: string): EpistemicGraph {
  const path = join(projectDir, "epistemic_graph.json");
  if (!existsSync(path)) {
    throw new Error("epistemic_graph.json is missing; run phase:epistemic first");
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z][a-z0-9+.-]{3,}/g)
        ?.filter((t) => !STOPWORDS.has(t)) ?? []
    ),
  ];
}

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
}

function polarity(text: string): Set<string> {
  const p = new Set<string>();
  for (const [kind, words] of Object.entries(POLARITY)) {
    if (hasAny(text, words)) p.add(kind);
  }
  return p;
}

function opposing(a: Set<string>, b: Set<string>): string | null {
  if (a.has("positive") && b.has("negative")) return "positive_vs_negative";
  if (a.has("negative") && b.has("positive")) return "negative_vs_positive";
  if (a.has("costUp") && b.has("costDown")) return "cost_up_vs_down";
  if (a.has("costDown") && b.has("costUp")) return "cost_down_vs_up";
  return null;
}

function evidenceText(claim: Claim): string {
  return claim.evidence
    .slice(0, 2)
    .map((e) => `${e.title}: ${e.exact_quote}`)
    .join("\n");
}

function candidateScope(a: Claim, b: Claim): number {
  if (a.subquestion_id && a.subquestion_id === b.subquestion_id) return 4;
  if (a.question_id && a.question_id === b.question_id) return 3;
  const hostOverlap = a.dependencies.source_hosts.some((h) =>
    b.dependencies.source_hosts.includes(h)
  );
  return hostOverlap ? 1 : 0;
}

export function findContradictionCandidates(
  graph: EpistemicGraph,
  limit = 32
): Candidate[] {
  const claims = graph.claims.filter((c) =>
    ["verified", "contested"].includes(c.lifecycle_state)
  );
  const claimTerms = new Map(claims.map((c) => [c.id, terms(c.statement)]));
  const claimPolarity = new Map(claims.map((c) => [c.id, polarity(c.statement)]));
  const candidates: Candidate[] = [];

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]!;
      const b = claims[j]!;
      const scope = candidateScope(a, b);
      if (scope <= 0) continue;
      const at = claimTerms.get(a.id) ?? [];
      const bt = claimTerms.get(b.id) ?? [];
      const shared = at.filter((t) => bt.includes(t));
      if (shared.length < 2) continue;
      const op = opposing(
        claimPolarity.get(a.id) ?? new Set(),
        claimPolarity.get(b.id) ?? new Set()
      );
      const comparative =
        a.factuality === "comparative" || b.factuality === "comparative";
      const quantitative =
        a.factuality === "quantitative" && b.factuality === "quantitative";
      const score =
        scope * 2 +
        Math.min(shared.length, 5) +
        (op ? 5 : 0) +
        (comparative ? 2 : 0) +
        (quantitative ? 1 : 0);
      if (!op && !comparative && !quantitative) continue;
      candidates.push({
        id: `K${candidates.length + 1}`,
        fact_a: a.id,
        fact_b: b.id,
        question_id: a.question_id === b.question_id ? a.question_id : null,
        score,
        shared_terms: shared.slice(0, 8),
        heuristic: op ?? (comparative ? "comparative_overlap" : "quantitative_overlap"),
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, i) => ({ ...candidate, id: `K${i + 1}` }));
}

function batch<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function candidateBlock(graph: EpistemicGraph, candidates: Candidate[]): string {
  const byId = new Map(graph.claims.map((c) => [c.id, c]));
  return candidates
    .map((candidate) => {
      const a = byId.get(candidate.fact_a)!;
      const b = byId.get(candidate.fact_b)!;
      return [
        `Candidate ${candidate.id}`,
        `Heuristic: ${candidate.heuristic}; shared terms: ${candidate.shared_terms.join(", ")}`,
        `A ${a.id} (${a.question_id}/${a.subquestion_id}, ${a.factuality}, ${a.confidence}): ${a.statement}`,
        `A evidence:\n${evidenceText(a) || "(none)"}`,
        `B ${b.id} (${b.question_id}/${b.subquestion_id}, ${b.factuality}, ${b.confidence}): ${b.statement}`,
        `B evidence:\n${evidenceText(b) || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function existingContradictionKeys(graph: EpistemicGraph): Set<string> {
  return new Set(
    graph.contradictions.map((c) => c.involved_facts.slice().sort().join(":"))
  );
}

function addContradictionToClaims(graph: EpistemicGraph, contradiction: GraphContradiction) {
  for (const factId of contradiction.involved_facts) {
    const claim = graph.claims.find((c) => c.id === factId);
    if (!claim) continue;
    claim.lifecycle_state = "contested";
    for (const other of contradiction.involved_facts.filter((id) => id !== factId)) {
      if (!claim.dependencies.conflicting_facts.includes(other)) {
        claim.dependencies.conflicting_facts.push(other);
      }
      if (
        !claim.counterevidence.some(
          (c) => c.kind === "conflicting_fact" && c.fact_id === other
        )
      ) {
        claim.counterevidence.push({
          kind: "conflicting_fact",
          fact_id: other,
          notes: contradiction.difference,
        });
      }
    }
    if (
      contradiction.next_check &&
      !claim.dependencies.open_questions.includes(contradiction.next_check)
    ) {
      claim.dependencies.open_questions.push(contradiction.next_check);
    }
  }
}

function refreshSummary(graph: EpistemicGraph) {
  graph.summary.claims_verified = graph.claims.filter(
    (c) => c.lifecycle_state === "verified"
  ).length;
  graph.summary.claims_blocked = graph.claims.filter(
    (c) => c.lifecycle_state === "blocked"
  ).length;
  graph.summary.claims_contested = graph.claims.filter(
    (c) => c.lifecycle_state === "contested"
  ).length;
  graph.summary.claims_unverified = graph.claims.filter(
    (c) => c.lifecycle_state === "unverified"
  ).length;
  graph.summary.contradictions = graph.contradictions.length;
}

export async function resolveContradictions(args: {
  projectDir: string;
  force?: boolean;
  maxCandidates?: number;
}): Promise<{ candidates: number; contradictions: number; graph: EpistemicGraph }> {
  const graph = readGraph(args.projectDir);
  if (graph.contradiction_pass && !args.force) {
    return {
      candidates: graph.contradiction_pass.candidates,
      contradictions: graph.contradictions.length,
      graph,
    };
  }

  const candidates = findContradictionCandidates(graph, args.maxCandidates ?? 32);
  const byCandidate = new Map(candidates.map((c) => [c.id, c]));
  const existing = existingContradictionKeys(graph);
  const additions: GraphContradiction[] = [];

  for (const group of batch(candidates, 6)) {
    if (!group.length) continue;
    const { object } = await generateJson({
      schema: ContradictionDecisionSchema,
      system: SYSTEM,
      prompt: `Topic: ${graph.topic}\n\nReview these candidate claim pairs and classify each one.\n\n${candidateBlock(graph, group)}`,
      temperature: 0.1,
      maxRetries: 1,
    });
    for (const decision of object.decisions) {
      if (decision.verdict === "not_contradiction") continue;
      if (decision.confidence < 0.5) continue;
      const candidate = byCandidate.get(decision.candidate_id);
      if (!candidate) continue;
      const involved = [candidate.fact_a, candidate.fact_b].sort();
      const key = involved.join(":");
      if (existing.has(key)) continue;
      existing.add(key);
      additions.push({
        id: `C${graph.contradictions.length + additions.length + 1}`,
        scope: candidate.question_id ? "within_question" : "cross_question",
        question_id: candidate.question_id,
        verdict: decision.verdict,
        involved_questions: [
          ...new Set(
            involved
              .map((id) => graph.claims.find((c) => c.id === id)?.question_id)
              .filter(Boolean) as string[]
          ),
        ],
        involved_facts: involved,
        difference: decision.difference,
        resolution_axes: decision.resolution_axes,
        next_check: decision.next_check,
        confidence: decision.confidence,
      });
    }
  }

  if (additions.length === 0) {
    for (const candidate of candidates.filter((c) => c.heuristic.includes("_vs_")).slice(0, 3)) {
      const involved = [candidate.fact_a, candidate.fact_b].sort();
      const key = involved.join(":");
      if (existing.has(key)) continue;
      existing.add(key);
      additions.push({
        id: `C${graph.contradictions.length + additions.length + 1}`,
        scope: candidate.question_id ? "within_question" : "cross_question",
        question_id: candidate.question_id,
        verdict: "different_context",
        involved_questions: [
          ...new Set(
            involved
              .map((id) => graph.claims.find((c) => c.id === id)?.question_id)
              .filter(Boolean) as string[]
          ),
        ],
        involved_facts: involved,
        difference: `Candidate tension (${candidate.heuristic}) over shared terms: ${candidate.shared_terms.join(", ")}.`,
        resolution_axes: ["workload", "scope", "source_type"],
        next_check:
          "Run a targeted follow-up to determine whether these claims differ by workload, scope, source type, or implementation condition.",
        confidence: 0.45,
      });
    }
  }

  for (const contradiction of additions) {
    graph.contradictions.push(contradiction);
    if (contradiction.verdict === "contradiction") {
      addContradictionToClaims(graph, contradiction);
    } else if (contradiction.next_check) {
      for (const factId of contradiction.involved_facts) {
        const claim = graph.claims.find((c) => c.id === factId);
        if (
          claim &&
          !claim.dependencies.open_questions.includes(contradiction.next_check)
        ) {
          claim.dependencies.open_questions.push(contradiction.next_check);
        }
      }
    }
  }
  graph.contradiction_pass = {
    checked_at: new Date().toISOString(),
    candidates: candidates.length,
    accepted: additions.length,
  };
  refreshSummary(graph);
  writeFileSync(
    join(args.projectDir, "epistemic_graph.json"),
    JSON.stringify(graph, null, 2)
  );
  return {
    candidates: candidates.length,
    contradictions: graph.contradictions.length,
    graph,
  };
}
