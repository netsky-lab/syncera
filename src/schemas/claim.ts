import { z } from "zod";

export const ReferenceSchema = z.object({
  url: z.string(),
  title: z.string().default("").describe("Source title (optional)"),
  exact_quote: z.string().default("").describe("Exact quote from the source (optional)"),
});

export const ClaimSchema = z.object({
  // id is optional in LLM output — we renumber all claims after extraction.
  id: z.string().default("").describe("Unique claim ID, e.g. C1, C2 (optional, will be renumbered)"),
  hypothesis_id: z.string().default("").describe("Which hypothesis this claim supports or contradicts (optional, set from context)"),
  statement: z.string().describe("The claim in 1-2 sentences"),
  type: z.string().describe("supports | contradicts | neutral"),
  confidence: z.number().describe("0.0 to 1.0"),
  references: z.array(ReferenceSchema),
});

export const ClaimExtractionSchema = z.object({
  claims: z.array(ClaimSchema),
});

export const CriticReportSchema = z.object({
  hypothesis_assessments: z.array(
    z.object({
      hypothesis_id: z.string(),
      status: z.string().describe("well_supported | partially_supported | unsupported | contradicted"),
      confidence: z.number().describe("0.0 to 1.0"),
      supporting_claims: z.array(z.string()).describe("Claim IDs"),
      contradicting_claims: z.array(z.string()).describe("Claim IDs"),
      gaps: z.array(z.string()).describe("What evidence is missing"),
      recommendation: z.string().describe("Next steps for this hypothesis"),
    })
  ),
  contradictions: z.array(
    z.object({
      claim_a: z.string(),
      claim_b: z.string(),
      description: z.string(),
    })
  ),
  overall_confidence: z.number(),
  summary: z.string(),
});

export type Reference = z.infer<typeof ReferenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type CriticReport = z.infer<typeof CriticReportSchema>;
