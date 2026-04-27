import { z } from "zod";

const CitationArray = z
  .array(z.string())
  .default([])
  .describe("Fact IDs cited by this item, e.g. F1, F7. Use only verified facts.");

export const PlaybookRuleSchema = z.object({
  id: z.string().describe("Stable ID, e.g. R1"),
  title: z.string().describe("Short imperative title"),
  rule: z.string().describe("Operational rule a practitioner can apply"),
  rationale: z
    .string()
    .describe("Why this rule follows from the evidence; cite fact IDs inline"),
  citations: CitationArray,
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Confidence based on directness and density of verified evidence"),
});

export const PlaybookChecklistSchema = z.object({
  id: z.string().describe("Stable ID, e.g. C1"),
  title: z.string(),
  items: z.array(
    z.object({
      text: z.string().describe("Checklist item written as an action"),
      citations: CitationArray,
    })
  ),
});

export const PlaybookDecisionTreeSchema = z.object({
  id: z.string().describe("Stable ID, e.g. DT1"),
  title: z.string(),
  entry_question: z.string().describe("First decision question"),
  branches: z.array(
    z.object({
      condition: z.string().describe("If/when condition"),
      action: z.string().describe("Recommended action under this condition"),
      citations: CitationArray,
    })
  ),
});

export const PlaybookEvalSchema = z.object({
  id: z.string().describe("Stable ID, e.g. E1"),
  name: z.string(),
  purpose: z.string(),
  procedure: z.string().describe("Concrete way to run the evaluation"),
  pass_criteria: z.string().describe("Observable success criterion"),
  citations: CitationArray,
});

export const PlaybookFailureModeSchema = z.object({
  id: z.string().describe("Stable ID, e.g. FM1"),
  failure_mode: z.string(),
  signals: z.array(z.string()).describe("Observable symptoms"),
  likely_causes: z.array(z.string()),
  interventions: z.array(z.string()).describe("Actions to try"),
  citations: CitationArray,
});

export const PlaybookTemplateSchema = z.object({
  id: z.string().describe("Stable ID, e.g. T1"),
  name: z.string(),
  use_case: z.string(),
  body: z.string().describe("Reusable prompt, protocol, table, or procedure template"),
  citations: CitationArray,
});

export const PlaybookSchema = z.object({
  schema_version: z.literal(1).default(1),
  topic: z.string(),
  operating_principles: z.array(PlaybookRuleSchema).default([]),
  checklists: z.array(PlaybookChecklistSchema).default([]),
  decision_trees: z.array(PlaybookDecisionTreeSchema).default([]),
  evals: z.array(PlaybookEvalSchema).default([]),
  failure_modes: z.array(PlaybookFailureModeSchema).default([]),
  templates: z.array(PlaybookTemplateSchema).default([]),
  research_debt: z
    .array(
      z.object({
        item: z.string(),
        next_check: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        depends_on_claims: z.array(z.string()).default([]),
      })
    )
    .default([])
    .describe("Operational gaps that must be closed before relying on the playbook"),
});

export type Playbook = z.infer<typeof PlaybookSchema>;
