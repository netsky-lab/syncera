import { z } from "zod";

export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  provider: z.string(),
  query: z.string(),
  raw_content: z.string().optional(),
});

export const SourceIndexSchema = z.object({
  task_id: z.string(),
  hypothesis_id: z.string(),
  queries: z.array(z.string()),
  results: z.array(SearchResultSchema),
  collected_at: z.string(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SourceIndex = z.infer<typeof SourceIndexSchema>;

export const QueryGenSchema = z.object({
  queries: z.array(z.string()).describe("2-4 search queries"),
});
