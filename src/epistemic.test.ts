import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildEpistemicGraph } from "./epistemic";
import type { ResearchPlan } from "./schemas/plan";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("buildEpistemicGraph", () => {
  test("links claims to evidence, verification, debt, and contradictions", () => {
    const dir = mkdtempSync(join(tmpdir(), "syncera-epistemic-"));
    try {
      mkdirSync(join(dir, "sources"), { recursive: true });
      const plan = {
        topic: "agent reliability",
        questions: [
          {
            id: "Q1",
            question: "What fails?",
            category: "mechanism",
            subquestions: [{ id: "Q1.1", text: "Syntax failures", angle: "benchmark" }],
          },
        ],
      } as ResearchPlan;
      writeJson(join(dir, "facts.json"), [
        {
          id: "F1",
          question_id: "Q1",
          subquestion_id: "Q1.1",
          statement: "Model A fails syntax-heavy tasks.",
          factuality: "qualitative",
          confidence: 0.8,
          references: [
            { url: "https://example.com/a", title: "A", exact_quote: "fails syntax" },
          ],
        },
        {
          id: "F2",
          question_id: "Q1",
          subquestion_id: "Q1.1",
          statement: "Model A succeeds on the same class of tasks.",
          factuality: "qualitative",
          confidence: 0.7,
          references: [
            { url: "https://example.com/b", title: "B", exact_quote: "succeeds" },
          ],
        },
      ]);
      writeJson(join(dir, "verification.json"), {
        verifications: [
          { fact_id: "F1", verdict: "verified", severity: "none", notes: "ok" },
          { fact_id: "F2", verdict: "overreach", severity: "major", notes: "too broad" },
        ],
      });
      writeJson(join(dir, "analysis_report.json"), {
        answers: [
          {
            question_id: "Q1",
            answer: "mixed",
            key_facts: ["F1"],
            conflicting_facts: [
              { fact_a: "F1", fact_b: "F2", nature: "same workload, opposite result" },
            ],
            coverage: "partial",
            gaps: ["No reproducible issue"],
            follow_ups: ["Run a minimal repo benchmark"],
          },
        ],
        cross_question_tensions: [],
        overall_summary: "mixed",
      });
      writeJson(join(dir, "sources", "Q1.1.json"), {
        question_id: "Q1",
        subquestion_id: "Q1.1",
        queries: ["q"],
        collected_at: "2026-04-26T10:00:00.000Z",
        results: [
          {
            title: "A",
            url: "https://example.com/a",
            snippet: "",
            provider: "searxng",
            query: "q",
            relevance: {
              domain_match: "on",
              usefulness: 3,
              source_type: "technical_report",
              notes: "core",
              checked_at: 1777197600000,
            },
          },
        ],
      });
      writeJson(join(dir, "sources", "index.json"), {
        by_subquestion: [
          { question_id: "Q1", subquestion_id: "Q1.2", sources: 0, learnings: 0 },
        ],
      });

      const graph = buildEpistemicGraph({ plan, projectDir: dir });
      expect(graph.summary.claims_total).toBe(2);
      expect(graph.summary.claims_contested).toBe(1);
      expect(graph.summary.claims_blocked).toBe(1);
      expect(graph.claims[0]!.evidence[0]!.provider).toBe("searxng");
      expect(graph.claims[0]!.dependencies.open_questions).toContain(
        "Run a minimal repo benchmark"
      );
      expect(graph.claims[1]!.counterevidence[0]!.verdict).toBe("overreach");
      expect(graph.research_debt.map((d) => d.kind)).toContain("weak_evidence");
      expect(graph.contradictions[0]!.involved_facts).toEqual(["F1", "F2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
