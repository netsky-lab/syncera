// Scouting-first pass. Given the raw topic, run a lightweight harvest (3-4
// broad survey queries, shallow scrape, no recursion) and extract a structured
// digest of what the literature actually discusses. The planner downstream
// receives this digest and grounds its research questions in real numbers /
// named methods instead of Qwen's prior beliefs.
//
// This addresses the academic-rigor concern that a hypothesis-first (or even
// question-first) planner without prior calibration can invent thresholds or
// ask questions that have no answer in published literature. Scouting-first
// plans have better answerability.

import { generateToolJson } from "./llm";
import { config } from "./config";
import { searchAll, searchSearXNG } from "./search";
import { readUrls } from "./reader";
import { scoreSource, sortByTier } from "./sourcing";
import { z } from "zod";

export const ScoutDigestSchema = z.object({
  methods_in_literature: z
    .array(z.string())
    .describe(
      "5-15 distinct named methods / frameworks / techniques that appear in the scouted sources. Proper nouns only."
    ),
  typical_numbers: z
    .array(z.string())
    .describe(
      "5-10 representative numeric claims from the sources: '<metric>: <range> observed in <method>'. Do NOT invent numbers."
    ),
  open_questions: z
    .array(z.string())
    .describe(
      "3-6 questions the literature appears to still be debating (conflicting reports, unmeasured corners, methodology disagreements)."
    ),
  consensus_points: z
    .array(z.string())
    .describe(
      "2-5 points the literature agrees on — established baselines that don't need re-asking."
    ),
  key_benchmarks: z
    .array(z.string())
    .describe(
      "3-8 benchmarks / datasets / evaluation protocols the field uses to measure this topic."
    ),
  hardware_constraints: z
    .array(z.string())
    .default([])
    .describe(
      "Named hardware / VRAM / context constraints that recur across sources (e.g. 'A100 80GB', 'RTX 5090 32GB', 'SM120'). Empty if topic isn't hardware-constrained."
    ),
});

export type ScoutDigest = z.infer<typeof ScoutDigestSchema>;

const ScoutQueriesSchema = z.object({
  queries: z
    .array(z.string())
    .min(5)
    .max(8)
    .describe("5-8 broad survey search queries for initial literature scouting."),
});

const SCOUT_QUERIES_SYSTEM = `You generate 5-8 broad survey queries for an initial literature scouting pass. These must be generic enough to return a CROSS-SECTION of relevant papers — not narrow questions with embedded assumptions.

GOOD (survey-style):
  ✓ "survey of KV cache compression methods for large language models"
  ✓ "benchmark comparison inference-time quantization techniques 2024 2025"
  ✓ "related work: memory-efficient transformer inference"

BAD (narrow-style — these are for the main harvest, not scouting):
  ✗ "TurboQuant perplexity on Llama-3 WikiText-103"
  ✗ "vLLM --kv-cache-dtype=fp8 configuration guide"

Rules:
- Mix academic-style ("survey of X", "comparison of Y") and review-style ("state of the art in Z", "benchmark of W").
- Include at least one query that would return RECENT survey papers (include "2024" or "2025" or "recent").
- Keep the topic's domain words verbatim. Don't abstract "Gemma 4 on RTX 5090" to "LLM on GPU".

Return the queries through the function call arguments.`;

const SCOUT_DIGEST_SYSTEM = `You distill a literature-scouting batch into a structured digest. Given 4-8 scraped sources from broad survey queries, extract the structured fields described in the schema. Be extractive, not generative — if something isn't in the sources, don't make it up.

Rules:
- methods_in_literature: proper-noun methods ONLY (TurboQuant, KIVI, AWQ, GPTQ, PagedAttention, etc.). No generic terms ("quantization", "compression").
- typical_numbers: preserve exact values from sources. "4.98x compression on GSM8K (ZipCache)" not "substantial compression".
- open_questions: where do sources disagree or acknowledge unknowns? State each as a concrete question.
- consensus_points: what does every source take for granted as baseline truth?
- hardware_constraints: only include constraints that appear verbatim in sources.

Return the digest through the function call arguments.`;

export async function scout(topic: string): Promise<ScoutDigest | null> {
  if (process.env.SCOUT_DISABLED === "1") {
    console.log("[scout] SCOUT_DISABLED=1 — skipping scouting pass");
    return null;
  }

  console.log("[scout] Generating survey queries…");
  let queries: string[] = [];
  try {
    const { object } = await generateToolJson({
      schema: ScoutQueriesSchema,
      system: SCOUT_QUERIES_SYSTEM,
      prompt: `Topic: ${topic}\n\nGenerate 5-8 broad survey queries.`,
      maxRetries: 1,
      toolName: "create_scout_queries",
      toolDescription:
        "Create broad survey search queries for initial research calibration.",
      endpoint: config.endpoints.planner,
    });
    queries = object.queries.slice(0, 8);
  } catch (err: any) {
    console.warn(`[scout] query gen failed: ${err.message?.slice(0, 80)}`);
    return null;
  }

  if (queries.length === 0) return null;
  console.log(`[scout] ${queries.length} survey queries: ${queries.map((q) => q.slice(0, 50)).join(" · ")}`);

  // Shallow harvest: one page per query, tier-sort, top 3 URLs each.
  const allContents: string[] = [];
  let totalFetched = 0;
  for (const query of queries) {
    const paged = await searchAll(query, 15).catch(() => [] as any[]);
    const tiered = sortByTier(paged, (r: any) => r.url);
    const top = tiered.slice(0, 3);
    if (top.length === 0) continue;
    const reads = await readUrls(
      top.map((r: any) => r.url),
      3,
      15000
    );
    for (const read of reads) {
      if (read?.success && read.content.length > 200) {
        allContents.push(read.content.slice(0, 12000));
        totalFetched++;
      }
    }
  }
  console.log(`[scout] scraped ${totalFetched} sources across ${queries.length} queries`);

  if (allContents.length === 0) return null;

  // Distill into digest
  try {
    const block = allContents
      .slice(0, 8)
      .map((c, i) => `<source index="${i + 1}">\n${c}\n</source>\n\n`)
      .join("");
    let object: ScoutDigest;
    try {
      const res = await generateToolJson({
        schema: ScoutDigestSchema,
        system: SCOUT_DIGEST_SYSTEM,
        prompt: `Topic: ${topic}\n\nSources from broad survey queries:\n\n${block}\n\nReturn the structured digest.`,
        maxRetries: 1,
        toolName: "create_scout_digest",
        toolDescription:
          "Distill scouted source excerpts into a structured research calibration digest.",
        endpoint: config.endpoints.planner,
      });
      object = res.object;
    } catch (err: any) {
      console.warn(`[scout] function-call digest failed: ${err.message?.slice(0, 100)}`);
      return null;
    }
    console.log(
      `[scout] digest: ${object.methods_in_literature.length} methods, ${object.typical_numbers.length} numbers, ${object.open_questions.length} open questions`
    );
    return object;
  } catch (err: any) {
    console.warn(`[scout] digest failed: ${err.message?.slice(0, 80)}`);
    return null;
  }
}
