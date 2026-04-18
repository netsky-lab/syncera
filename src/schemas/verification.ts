import { z } from "zod";

export const VerdictSchema = z.enum([
  "verified",          // fact accurately follows from source
  "url_dead",          // URL unreachable (deterministic)
  "quote_fabricated",  // exact_quote not found in scraped content (deterministic)
  "overreach",         // fact overstates what source says
  "out_of_context",    // quote stripped from context that changes meaning
  "cherry_picked",     // source discusses multiple views, fact uses one
  "misread",           // model misunderstood the source
]);

export const SeveritySchema = z.enum(["none", "minor", "major"]);

export const VerificationSchema = z.object({
  fact_id: z.string(),
  verdict: VerdictSchema,
  severity: SeveritySchema,
  notes: z.string().describe("Why this verdict — cite specific parts of the source"),
  corrected_statement: z
    .string()
    .nullish()
    .describe("If fact is an overreach or misread, a statement the source actually supports"),
});

export const VerificationReportSchema = z.object({
  verifications: z.array(VerificationSchema),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
