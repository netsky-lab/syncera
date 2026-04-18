import { z } from "zod";

// ---- Question-first research plan ----
//
// The plan describes WHAT the research will answer, not WHAT it expects to find.
// Unlike the older hypothesis-first schema, numeric thresholds are NOT fabricated
// up front — they emerge from evidence during synthesis.
//
// Structure: topic → N research questions → M subquestions per question.
// Subquestions drive harvester query generation.

export const SubquestionSchema = z.object({
  id: z.string().describe("Unique ID within the question, e.g. Q1.1, Q1.2"),
  text: z.string().describe("A concrete sub-question that can be answered by 3-6 literature queries"),
  angle: z
    .enum(["benchmark", "methodology", "comparison", "case_study", "feasibility", "trade_off"])
    .describe("The search angle — informs query phrasing"),
});

export const ResearchQuestionSchema = z.object({
  id: z.string().describe("Unique ID, e.g. Q1, Q2"),
  question: z.string().describe("A concrete research question the final report must answer. No embedded numeric thresholds."),
  category: z
    .enum(["factual", "comparative", "trade_off", "feasibility", "deployment", "mechanism"])
    .describe("What kind of question this is — drives narrative tone of the answer"),
  subquestions: z
    .array(SubquestionSchema)
    .min(1)
    .describe("2-4 subquestions that decompose the question into searchable angles"),
});

export const ResearchPlanSchema = z.object({
  topic: z.string().describe("Research topic as received from the user"),
  constraints: z.string().optional().describe("Hardware / scope / timeline constraints lifted from the topic"),
  questions: z
    .array(ResearchQuestionSchema)
    .min(2)
    .describe(
      "3-12 research questions. Count should match the topic's scope — a narrow topic gets fewer, a broad survey gets more. Do NOT force a target count."
    ),
  scope_notes: z
    .string()
    .optional()
    .describe("What the report will NOT cover (e.g. 'training from scratch is out of scope; this is inference-only')"),
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;
export type Subquestion = z.infer<typeof SubquestionSchema>;
