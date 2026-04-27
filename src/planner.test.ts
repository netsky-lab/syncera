import { describe, expect, test } from "bun:test";
import { normalizePlan } from "./planner";
import type { ResearchPlan } from "./schemas/plan";

function question(i: number) {
  return {
    id: "",
    question: `Question ${i}`,
    category: "factual" as const,
    subquestions: [
      { id: "", text: `Evidence for question ${i}`, angle: "benchmark" as const },
      { id: "", text: `Limits for question ${i}`, angle: "trade_off" as const },
    ],
  };
}

describe("normalizePlan", () => {
  test("caps narrow cosmetics R&D plans at 5 top-level questions", () => {
    const plan: ResearchPlan = {
      topic:
        "Relationship between applied layer thickness and active ingredient concentration in cosmetic creams and skin penetration.",
      questions: Array.from({ length: 8 }, (_, i) => question(i + 1)),
    };

    const normalized = normalizePlan(plan, plan.topic);
    expect(normalized.questions).toHaveLength(5);
    expect(normalized.questions.map((q) => q.id)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
    ]);
  });

  test("keeps broad product research plans expandable", () => {
    const plan: ResearchPlan = {
      topic:
        "Product research for Syncera: compare features, pricing, collaboration, and trust mechanisms across AI deep research tools.",
      questions: Array.from({ length: 8 }, (_, i) => question(i + 1)),
    };

    const normalized = normalizePlan(plan, plan.topic);
    expect(normalized.questions).toHaveLength(8);
  });
});
