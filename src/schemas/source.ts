import { z } from "zod";

export const RelevanceSchema = z.object({
  domain_match: z.enum(["on", "partial", "off"]),
  usefulness: z
    .number()
    .int()
    .min(0)
    .max(3)
    .describe(
      "0 = skip, 1 = background only, 2 = supports claims, 3 = core evidence"
    ),
  // Source-type classification lets the pipeline silently drop blog /
  // marketing / product-ad pages even when their wording matches the
  // topic. Optional for back-compat with older sources/*.json files.
  source_type: z
    .enum([
      "peer_reviewed",
      "preprint",
      "clinical",
      "technical_report",
      "reference_work",
      "blog",
      "marketing",
      "other",
    ])
    .optional(),
  notes: z
    .string()
    .describe(
      "1 sentence — why this source is relevant to the topic, or why off-domain"
    ),
  checked_at: z.number().int().describe("Unix ms when assessed"),
});
export type Relevance = z.infer<typeof RelevanceSchema>;

export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  provider: z.string(),
  query: z.string(),
  raw_content: z.string().optional(),
  relevance: RelevanceSchema.optional(),
});

export const SourceIndexSchema = z.object({
  question_id: z.string().describe("Research question this index belongs to"),
  subquestion_id: z.string().default("").describe("Subquestion within the question (optional)"),
  queries: z.array(z.string()),
  results: z.array(SearchResultSchema),
  collected_at: z.string(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SourceIndex = z.infer<typeof SourceIndexSchema>;

export const QueryGenSchema = z.object({
  queries: z.array(z.string()).describe("2-4 search queries"),
});
