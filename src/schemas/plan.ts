import { z } from "zod";

// ---- Question-first research plan ----
//
// The plan describes WHAT the research will answer, not WHAT it expects to find.
// Unlike the older hypothesis-first schema, numeric thresholds are NOT fabricated
// up front — they emerge from evidence during synthesis.
//
// Structure: topic → N research questions → M subquestions per question.
// Subquestions drive harvester query generation.

const allowedAngles = [
  "benchmark",
  "methodology",
  "comparison",
  "case_study",
  "feasibility",
  "trade_off",
] as const;

const allowedCategories = [
  "factual",
  "comparative",
  "trade_off",
  "feasibility",
  "deployment",
  "mechanism",
] as const;

function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function inferAngle(value: unknown): (typeof allowedAngles)[number] {
  const v = normalizeLabel(value);
  if (allowedAngles.includes(v as any)) return v as (typeof allowedAngles)[number];
  if (/bench|metric|eval|measure|number|quant/.test(v)) return "benchmark";
  if (/method|mechan|how|citation|trust|source|ux|workflow/.test(v)) return "methodology";
  if (/compar|compet|versus|vs|alternative|landscape/.test(v)) return "comparison";
  if (/case|user|review|adoption|practitioner|customer|team|collab/.test(v)) return "case_study";
  if (/deploy|integrat|barrier|risk|feasib|workflow|enterprise/.test(v)) return "feasibility";
  if (/trade|cost|price|pricing|business|limit|constraint/.test(v)) return "trade_off";
  return "feasibility";
}

function inferCategory(value: unknown): (typeof allowedCategories)[number] {
  const v = normalizeLabel(value);
  if (allowedCategories.includes(v as any)) return v as (typeof allowedCategories)[number];
  if (/compar|compet|versus|vs|landscape/.test(v)) return "comparative";
  if (/trade|cost|price|pricing|business|limit|constraint/.test(v)) return "trade_off";
  if (/deploy|integrat|workflow|api|collab|enterprise/.test(v)) return "deployment";
  if (/mechan|method|how|architecture|trust|citation|source/.test(v)) return "mechanism";
  if (/feasib|risk|barrier|adoption|viab/.test(v)) return "feasibility";
  return "factual";
}

export const SubquestionSchema = z.preprocess((raw) => {
  if (typeof raw === "string") {
    return { id: "", text: raw, angle: inferAngle(raw) };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      ...obj,
      text: obj.text ?? obj.question ?? obj.query ?? "",
      angle: inferAngle(obj.angle ?? obj.category ?? obj.type ?? obj.text),
    };
  }
  return raw;
}, z.object({
  id: z.string().describe("Unique ID within the question, e.g. Q1.1, Q1.2"),
  text: z.string().describe("A concrete sub-question that can be answered by 4-10 literature queries"),
  angle: z
    .enum(allowedAngles)
    .describe("The search angle — informs query phrasing"),
}));

export const ResearchQuestionSchema = z.preprocess((raw) => {
  if (typeof raw === "string") {
    return {
      id: "",
      question: raw,
      category: inferCategory(raw),
      subquestions: [
        { id: "", text: raw, angle: inferAngle(raw) },
        { id: "", text: `What evidence answers: ${raw}`, angle: "benchmark" },
      ],
    };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const question = obj.question ?? obj.text ?? obj.title ?? "";
    return {
      ...obj,
      question,
      category: inferCategory(obj.category ?? obj.type ?? question),
      subquestions: Array.isArray(obj.subquestions)
        ? obj.subquestions
        : Array.isArray(obj.questions)
          ? obj.questions
          : [],
    };
  }
  return raw;
}, z.object({
  id: z.string().describe("Unique ID, e.g. Q1, Q2"),
  question: z.string().describe("A concrete research question the final report must answer. No embedded numeric thresholds."),
  category: z
    .enum(allowedCategories)
    .describe("What kind of question this is — drives narrative tone of the answer"),
  subquestions: z
    .array(SubquestionSchema)
    .min(2)
    .max(5)
    .describe("2-5 subquestions that decompose the question into searchable angles"),
}));

export const ResearchPlanSchema = z.object({
  topic: z.string().describe("Research topic as received from the user"),
  constraints: z.string().optional().describe("Hardware / scope / timeline constraints lifted from the topic"),
  questions: z
    .array(ResearchQuestionSchema)
    .min(1)
    .max(15)
    .describe(
      "5-15 research questions. Count should match the topic's scope — narrow topics still get at least 5, broad surveys may use the full 15."
    ),
  scope_notes: z
    .string()
    .optional()
    .describe("What the report will NOT cover (e.g. 'training from scratch is out of scope; this is inference-only')"),
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;
export type Subquestion = z.infer<typeof SubquestionSchema>;
