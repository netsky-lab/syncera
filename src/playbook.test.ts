import { describe, expect, test } from "bun:test";
import { renderPlaybookMarkdown } from "./playbook";
import type { Playbook } from "./schemas/playbook";

describe("renderPlaybookMarkdown", () => {
  test("renders operational sections with fact citations", () => {
    const playbook: Playbook = {
      schema_version: 1,
      topic: "Test topic",
      operating_principles: [
        {
          id: "R1",
          title: "Use verified evidence",
          rule: "Only operationalize verified claims.",
          rationale: "The run verified the claim [F1].",
          citations: ["F1"],
          confidence: "high",
        },
      ],
      checklists: [
        {
          id: "C1",
          title: "Launch checklist",
          items: [{ text: "Check the measured baseline.", citations: ["F2"] }],
        },
      ],
      decision_trees: [],
      evals: [],
      failure_modes: [],
      templates: [],
      research_debt: [
        {
          item: "No production benchmark.",
          next_check: "Run the benchmark.",
          severity: "high",
          depends_on_claims: ["F1"],
        },
      ],
    };

    const md = renderPlaybookMarkdown(playbook);
    expect(md).toContain("# Operational Playbook: Test topic");
    expect(md).toContain("## Operating Principles");
    expect(md).toContain("Only operationalize verified claims. [F1]");
    expect(md).toContain("- Check the measured baseline. [F2]");
    expect(md).toContain("Next check: Run the benchmark. [F1]");
  });
});
