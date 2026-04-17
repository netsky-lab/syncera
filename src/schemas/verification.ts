import { z } from "zod";

export const VerdictSchema = z.enum([
  "verified",          // claim accurately follows from source
  "url_dead",          // URL unreachable (deterministic)
  "quote_fabricated",  // exact_quote not found in scraped content (deterministic)
  "overreach",         // claim overstates what source says
  "out_of_context",    // quote stripped from context that changes meaning
  "cherry_picked",     // source discusses multiple views, claim uses one
  "misread",           // model misunderstood the source
]);

export const SeveritySchema = z.enum(["none", "minor", "major"]);

export const VerificationSchema = z.object({
  claim_id: z.string(),
  verdict: VerdictSchema,
  severity: SeveritySchema,
  notes: z.string().describe("Why this verdict — cite specific parts of the source"),
  corrected_statement: z
    .string()
    .nullish()
    .describe("If claim is an overreach or misread, a statement the source actually supports"),
});

export const VerificationReportSchema = z.object({
  verifications: z.array(VerificationSchema),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
