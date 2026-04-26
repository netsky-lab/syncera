import { describe, expect, test } from "bun:test";
import { findContradictionCandidates } from "./contradictions";
import type { EpistemicGraph } from "./epistemic";

function claim(
  id: string,
  statement: string,
  factuality: string | null = "qualitative"
): EpistemicGraph["claims"][number] {
  return {
    id,
    statement,
    question_id: "Q1",
    subquestion_id: "Q1.1",
    factuality,
    confidence: 0.8,
    lifecycle_state: "verified",
    verdict: "verified",
    evidence: [],
    counterevidence: [],
    freshness: {
      collected_at: [],
      newest_collected_at: null,
      relevance_checked_at: [],
      newest_relevance_checked_at: null,
    },
    dependencies: {
      question_coverage: "partial",
      is_key_fact: false,
      conflicting_facts: [],
      source_hosts: [],
      open_questions: [],
    },
  };
}

describe("findContradictionCandidates", () => {
  test("finds opposite polarity claims in the same subquestion", () => {
    const graph: EpistemicGraph = {
      schema_version: 1,
      generated_at: "2026-04-26T00:00:00Z",
      topic: "models",
      summary: {
        claims_total: 2,
        claims_verified: 2,
        claims_blocked: 0,
        claims_contested: 0,
        claims_unverified: 0,
        research_debt_items: 0,
        contradictions: 0,
      },
      claims: [
        claim("F1", "Qwen model improves syntax-heavy coding benchmark accuracy."),
        claim("F2", "Qwen model fails syntax-heavy coding benchmark tasks with errors."),
      ],
      research_debt: [],
      contradictions: [],
    };

    const candidates = findContradictionCandidates(graph);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.fact_a).toBe("F1");
    expect(candidates[0]!.fact_b).toBe("F2");
    expect(candidates[0]!.heuristic).toBe("positive_vs_negative");
  });

  test("ignores compatible claims without polarity or comparative signal", () => {
    const graph: EpistemicGraph = {
      schema_version: 1,
      generated_at: "2026-04-26T00:00:00Z",
      topic: "models",
      summary: {
        claims_total: 2,
        claims_verified: 2,
        claims_blocked: 0,
        claims_contested: 0,
        claims_unverified: 0,
        research_debt_items: 0,
        contradictions: 0,
      },
      claims: [
        claim("F1", "Qwen model uses grouped-query attention in deployment."),
        claim("F2", "Qwen model uses tokenizer configuration during deployment."),
      ],
      research_debt: [],
      contradictions: [],
    };

    expect(findContradictionCandidates(graph)).toEqual([]);
  });
});
