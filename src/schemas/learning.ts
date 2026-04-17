import { z } from "zod";

export const SerpQueryItemSchema = z.object({
  query: z.string().describe("A concrete search query"),
  research_goal: z
    .string()
    .describe("What this query aims to discover"),
  channel: z
    .string()
    .describe("'web' for blogs/docs/github/news, 'academic' for arxiv/openreview paper titles and authors"),
});

export const SerpQueriesSchema = z.object({
  queries: z.array(SerpQueryItemSchema),
});

export const LearningsSchema = z.object({
  learnings: z
    .array(z.string())
    .describe("Concise, information-dense learnings from the sources. Each learning is one factual statement."),
  follow_up_questions: z
    .array(z.string())
    .describe("Questions to research deeper"),
});

export type SerpQueryItem = z.infer<typeof SerpQueryItemSchema>;
export type Learnings = z.infer<typeof LearningsSchema>;
