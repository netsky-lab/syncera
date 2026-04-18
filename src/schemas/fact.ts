import { z } from "zod";

// ---- Question-first fact & analysis schemas ----
//
// A Fact is a concrete, source-attributed piece of evidence extracted during
// research. Unlike the old Claim, a Fact is NOT tagged with a supports /
// contradicts classification — that classification required a pre-committed
// hypothesis, which this architecture intentionally avoids. Instead, a Fact
// just reports what the source said; tensions between facts surface during
// analysis as "conflicting findings".

export const ReferenceSchema = z.object({
  url: z.string(),
  title: z.string().default("").describe("Source title"),
  exact_quote: z.string().default("").describe("Exact quote from the source"),
});

export const FactSchema = z.object({
  id: z.string().default("").describe("Unique fact ID, e.g. F1, F2 (renumbered post-extraction)"),
  question_id: z.string().default("").describe("Research question this fact informs (Q1, Q2, ...)"),
  subquestion_id: z.string().default("").describe("Subquestion within the question (Q1.1, Q1.2, ...) if known"),
  statement: z.string().describe("The factual statement, 1-2 sentences. Must contain a number, method name, benchmark, or dataset."),
  factuality: z
    .enum(["quantitative", "qualitative", "comparative", "background"])
    .default("qualitative")
    .describe("What kind of fact: quantitative (has number), qualitative (mechanism/capability), comparative (X vs Y), background (context)"),
  confidence: z.number().describe("0.0 to 1.0 — how confident we are this fact is accurately stated"),
  references: z.array(ReferenceSchema),
});

export const FactExtractionSchema = z.object({
  facts: z.array(FactSchema),
});

// ---- Analyzer output ----
//
// For each research question, the analyzer produces a narrative answer grounded
// in facts. Unlike the old critic which rendered verdicts against thresholds,
// the analyzer synthesizes what the literature says.

export const QuestionAnswerSchema = z.object({
  question_id: z.string(),
  answer: z.string().describe("3-6 sentence narrative answer grounded in cited facts [F#]. No thresholds."),
  key_facts: z.array(z.string()).describe("Fact IDs that most directly answer the question"),
  conflicting_facts: z
    .array(
      z.object({
        fact_a: z.string(),
        fact_b: z.string(),
        nature: z.string().describe("What the two facts disagree about — same metric / mechanism / compatibility / scaling"),
      })
    )
    .default([])
    .describe("Pairs of facts that disagree within this question's scope"),
  coverage: z
    .enum(["complete", "partial", "gaps_critical", "insufficient"])
    .describe("How well the collected evidence answers this question"),
  gaps: z.array(z.string()).describe("Specific unmeasured or unreported things within this question's scope"),
  follow_ups: z
    .array(z.string())
    .default([])
    .describe("Concrete follow-up investigations worth running (experiments, targeted searches)"),
});

export const AnalysisReportSchema = z.object({
  answers: z.array(QuestionAnswerSchema),
  cross_question_tensions: z
    .array(
      z.object({
        description: z.string(),
        involved_questions: z.array(z.string()),
        involved_facts: z.array(z.string()),
      })
    )
    .default([])
    .describe("Tensions that span multiple questions — e.g. a method wins on Q1 but loses on Q3"),
  overall_summary: z
    .string()
    .describe("2-4 sentence top-level summary of what the research found, without fabricated thresholds or verdicts"),
});

export type Reference = z.infer<typeof ReferenceSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
