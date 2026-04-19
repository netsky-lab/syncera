// Iterative refinement pass. Given a completed run, look at the analyzer's
// per-question coverage. For each question flagged "insufficient" or
// "gaps_critical", generate targeted queries from its specific gaps list,
// harvest them, extract additional facts, re-verify, re-analyze, re-synth.
//
// Philosophy: a real researcher doesn't stop at "we didn't find it" — they
// look again with a narrower angle. This phase implements that second look.
//
// Invoked via --refine flag in run.ts. Skipped by default (adds ~20-40 min).

import { generateJson } from "./llm";
import { config } from "./config";
import { searchAll, searchSearXNG } from "./search";
import { readUrls } from "./reader";
import { scoreSource, sortByTier } from "./sourcing";
import type { Fact } from "./schemas/fact";
import type { SourceIndex, SearchResult } from "./schemas/source";
import type { ResearchPlan } from "./schemas/plan";
import type { AnalysisReport } from "./schemas/fact";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";

const REFINE_QUERY_SYSTEM = `You generate narrow targeted search queries that attempt to close a specific research GAP. Given one research question, its current answer, and the gap list, produce 2-3 queries designed to surface the missing information.

Rules:
- Queries must be NARROWER than the original subquestions — they're trying to close a concrete hole, not re-survey.
- Each query targets a single gap. Use the gap's named methods / hardware / benchmarks verbatim.
- Prefer paper-title phrasing for academic channel and blog/doc phrasing for web channel.
- Return EXACTLY 2-3 queries.

GOOD (narrow, gap-targeted):
  ✓ "TurboQuant CUDA kernel RTX 5090 implementation"
  ✓ "FP8 KV cache Ampere A100 fallback vLLM workaround"
  ✓ "KV Pareto 78% memory reduction Qwen MoE benchmark"

BAD (broad, re-surveying):
  ✗ "KV cache compression methods survey"
  ✗ "TurboQuant overview"

Output JSON: {"queries": [{"query": "...", "channel": "academic" | "web", "targets_gap": "..."}]}`;

export interface RefineResult {
  additionalFacts: number;
  questionsRefined: string[];
}

export async function refine(
  plan: ResearchPlan,
  projectDir: string
): Promise<RefineResult> {
  const analysisPath = join(projectDir, "analysis_report.json");
  if (!existsSync(analysisPath)) {
    console.log("[refine] no analysis_report.json — nothing to refine");
    return { additionalFacts: 0, questionsRefined: [] };
  }
  const analysis: AnalysisReport = JSON.parse(
    readFileSync(analysisPath, "utf-8")
  );

  const weak = analysis.answers.filter(
    (a) => a.coverage === "insufficient" || a.coverage === "gaps_critical"
  );
  if (weak.length === 0) {
    console.log("[refine] all questions have sufficient coverage — skipping");
    return { additionalFacts: 0, questionsRefined: [] };
  }
  console.log(
    `[refine] ${weak.length} weak questions to refine: ${weak.map((a) => a.question_id).join(", ")}`
  );

  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  const globalVisited = new Set<string>();
  // Seed globalVisited from existing source files
  for (const f of readdirSync(sourcesDir).filter((f) =>
    /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)
  )) {
    try {
      const idx: SourceIndex = JSON.parse(
        readFileSync(join(sourcesDir, f), "utf-8")
      );
      for (const r of idx.results) {
        globalVisited.add(normalizeUrl(r.url));
      }
    } catch {}
  }

  const questionsRefined: string[] = [];
  let additionalFacts = 0;

  // For each weak question, generate queries targeting its gaps, harvest,
  // and APPEND new sources to the first matching subquestion file.
  for (const ans of weak) {
    const q = plan.questions.find((x) => x.id === ans.question_id);
    if (!q || q.subquestions.length === 0) continue;

    const subq = q.subquestions[0]!; // dump new sources into the first subquestion
    const subqPath = join(sourcesDir, `${subq.id}.json`);
    if (!existsSync(subqPath)) {
      console.warn(`[refine] ${ans.question_id}: no source file for ${subq.id}`);
      continue;
    }
    const existingIdx: SourceIndex = JSON.parse(
      readFileSync(subqPath, "utf-8")
    );

    // Generate targeted queries
    let queries: { query: string; channel: string; targets_gap: string }[] = [];
    try {
      const { object } = await generateJson({
        schema: z.object({
          queries: z.array(
            z.object({
              query: z.string(),
              channel: z.string(),
              targets_gap: z.string(),
            })
          ),
        }),
        system: REFINE_QUERY_SYSTEM,
        prompt: `Research question ${q.id} [${q.category}]: ${q.question}

Current answer (coverage: ${ans.coverage}):
${ans.answer}

Gaps to close:
${(ans.gaps ?? []).map((g, i) => `${i + 1}. ${g}`).join("\n")}

Generate 2-3 narrow queries targeting these gaps.`,
        maxRetries: 1,
        endpoint: config.endpoints.harvester,
      });
      queries = object.queries.slice(0, 3);
    } catch (err: any) {
      console.warn(
        `[refine] ${ans.question_id}: query gen failed: ${err.message?.slice(0, 80)}`
      );
      continue;
    }

    if (queries.length === 0) continue;
    console.log(
      `[refine] ${ans.question_id}: ${queries.length} targeted queries: ${queries.map((q) => q.query.slice(0, 50)).join(" · ")}`
    );

    // Harvest — shallow, primary-only
    const newSources: SearchResult[] = [];
    const newContents: string[] = [];
    for (const { query, channel } of queries) {
      let results: SearchResult[] = [];
      if (channel === "academic") {
        const academic = await searchAll(query, 12).catch(() => []);
        results = academic.filter(
          (r: any) =>
            r.provider === "arxiv" ||
            r.provider === "openalex" ||
            r.provider === "semantic_scholar"
        );
      } else {
        const web = await searchSearXNG(query, { pageno: 1, maxResults: 8 }).catch(
          () => []
        );
        const academic = await searchAll(query, 8).catch(() => []);
        results = [
          ...web,
          ...academic.filter(
            (r: any) => r.provider === "arxiv" || r.provider === "openalex"
          ),
        ];
      }
      const tiered = sortByTier(results, (r: any) => r.url);
      const topUrls: SearchResult[] = [];
      for (const r of tiered) {
        const k = normalizeUrl(r.url);
        if (!k || globalVisited.has(k)) continue;
        globalVisited.add(k);
        topUrls.push(r);
        if (topUrls.length >= 4) break;
      }
      if (topUrls.length === 0) continue;
      const reads = await readUrls(
        topUrls.map((r) => r.url),
        4,
        25000
      );
      for (let i = 0; i < topUrls.length; i++) {
        const r = reads[i];
        if (!r?.success || r.content.length < 200) continue;
        const src = topUrls[i]!;
        src.raw_content = r.content.slice(0, 8000);
        newSources.push(src);
        newContents.push(r.content.slice(0, 12000));
        // Persist content
        const hash = hashUrl(src.url);
        writeFileSync(
          join(contentDir, `${hash}.md`),
          `# ${src.title}\n\nURL: ${src.url}\n\n---\n\n${r.content}`
        );
      }
    }
    if (newSources.length === 0) {
      console.log(`[refine] ${ans.question_id}: no new sources found`);
      continue;
    }

    // Append to existing subquestion index
    existingIdx.results.push(...newSources);
    existingIdx.queries = Array.from(
      new Set([...existingIdx.queries, ...queries.map((q) => q.query)])
    );

    // Extract learnings on just the new sources, append
    try {
      const { extractLearnings } = await import("./harvester");
      const extracted = await extractLearnings({
        query: queries.map((q) => q.query).join(" / "),
        researchGoal: `${q.question} — refinement pass targeting: ${(ans.gaps ?? []).join("; ")}`,
        contents: newContents,
        numLearnings: 8,
        numFollowUps: 0,
      });
      const prior: string[] = (existingIdx as any).learnings ?? [];
      (existingIdx as any).learnings = [...prior, ...extracted.learnings];
      console.log(
        `[refine] ${ans.question_id}: +${newSources.length} sources, +${extracted.learnings.length} learnings`
      );
      additionalFacts += extracted.learnings.length;
    } catch (err: any) {
      console.warn(
        `[refine] ${ans.question_id}: learnings extraction failed: ${err.message?.slice(0, 80)}`
      );
    }

    writeFileSync(subqPath, JSON.stringify(existingIdx, null, 2));
    questionsRefined.push(ans.question_id);
  }

  // Update aggregate sources/index.json
  const allFiles = readdirSync(sourcesDir).filter((f) =>
    /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)
  );
  let totalSources = 0;
  let totalLearnings = 0;
  const byProvider: Record<string, number> = {};
  for (const f of allFiles) {
    try {
      const idx: SourceIndex = JSON.parse(
        readFileSync(join(sourcesDir, f), "utf-8")
      );
      totalSources += idx.results.length;
      totalLearnings += ((idx as any).learnings?.length ?? 0) as number;
      for (const r of idx.results) {
        const p = r.provider.split(":")[0] ?? "unknown";
        byProvider[p] = (byProvider[p] ?? 0) + 1;
      }
    } catch {}
  }
  writeFileSync(
    join(sourcesDir, "index.json"),
    JSON.stringify(
      {
        total_sources: totalSources,
        total_learnings: totalLearnings,
        by_provider: byProvider,
        collected_at: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return { additionalFacts, questionsRefined };
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  let s = url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");
  const arxivMatch = s.match(
    /^(?:export\.)?arxiv\.org\/(?:abs|html|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?(?:\/.*)?$/
  );
  if (arxivMatch) return `arxiv:${arxivMatch[1]}`;
  return s;
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (
    Math.abs(h).toString(36) +
    "-" +
    url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-")
  );
}
