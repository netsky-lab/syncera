import { generateJson, countTokens, inputTokenBudget } from "./llm";
import { searchAll, searchSearXNG } from "./search";
import { readUrls } from "./reader";
import { SerpQueriesSchema, LearningsSchema } from "./schemas/learning";
import { scoreSource } from "./sourcing";
import type { SearchResult, SourceIndex } from "./schemas/source";
import type { ResearchPlan, Task } from "./schemas/plan";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

interface HarvesterInput {
  plan: ResearchPlan;
  projectDir: string;
  breadth?: number;          // parallel queries per task
  depth?: number;            // recursive deepening levels
  pagesPerQuery?: number;    // SearXNG pagination
  urlsPerQuery?: number;     // how many URLs to scrape per query
  readConcurrency?: number;
  force?: boolean;           // re-collect even if per-task cache exists
}

interface DeepResearchResult {
  learnings: string[];
  visitedUrls: Set<string>;
  sources: SearchResult[];
}

const QUERY_GEN_SYSTEM = `You generate search queries for deep research. Your output determines what literature the pipeline reads — careless queries = mediocre evidence.

## Two channels with DIFFERENT phrasing styles

### 'academic' channel (for arxiv/openreview/aclanthology search)
Phrasing should match PAPER TITLES and ABSTRACTS. Structure:
- "<Method name>: <What it does> via <Technique>"  → "KIVI: Tuning-free asymmetric 2-bit quantization for KV cache"
- "<Observed phenomenon> in <Model/Architecture>" → "Attention-head redundancy in long-context LLMs"
- "<Technique> for <Problem> in <Domain>"          → "Channel shrinking for KV cache compression in transformers"

### 'web' channel (for SearXNG Google/DDG search)
Phrasing should match BLOG POSTS, DOCS, GITHUB READMEs. Structure:
- "How to <action> with <tool>"                    → "How to configure vLLM KV cache quantization with FP8"
- "<Tool> <version> <feature> benchmark"           → "vLLM 0.6 paged attention throughput RTX 5090"
- "<Method> vs <Method> <comparison axis>"         → "AWQ vs GPTQ accuracy perplexity wikitext"

## Strict rules

- Name specific methods (TurboQuant, KIVI, KVQuant, PagedAttention, AWQ, GPTQ, MiniKV, Coupled Quantization), models (Gemma-2/3/4, Llama-3, Qwen), benchmarks (WikiText-103, LongBench, NIAH, GSM8K, MMLU), hardware (RTX 5090, H100, B200), frameworks (vLLM, TensorRT-LLM, Triton).
- For 'academic' queries: NO imperatives ("how to", "implement"). Use noun phrases as in paper titles.
- For 'web' queries: DO use imperatives and vendor names when relevant.
- No duplicate angles. Each query must cover a distinct research sub-question.
- If you know a canonical paper/method by name, use that name in at least one 'academic' query — it dramatically improves arxiv retrieval.

## Anti-patterns

- "Benchmark Gemma" (too vague)
- "Quantization research" (no specificity)
- "Best KV cache method 2026" (listicle-style, bad for both channels)

Output JSON only, matching the schema.`;

const LEARNINGS_SYSTEM = `You extract factual learnings from scraped source content. Each learning is a SELF-CONTAINED sentence with the full context needed to cite it later.

## Required structure for EACH learning

Template (pick whichever fits the source fact):
  "<Method/Tool> achieves <Metric> of <Value> on <Benchmark/Dataset> for <Model/Setup>"
  "<Method> reduces <Resource> by <Value> compared to <Baseline>"
  "<Observation> holds for <Model/Setup> but fails for <Counter-example>"
  "<Authors/Paper> report <Finding> with <Dataset> in <Year>"

Examples of GOOD learnings:
  ✓ "KVQuant achieves <0.1 perplexity degradation on WikiText-2 with 3-bit KV quantization for LLaMA-7B"
  ✓ "INT4 KV-cache reduces peak VRAM by 75% vs FP16 on 32k context for Gemma-2-27B"
  ✓ "2-bit quantization degrades accuracy on reasoning benchmarks (GSM8K -3.1pp) for Qwen3 per Kitty paper"
  ✓ "vLLM --kv-cache-dtype=fp8 flag halves KV memory consumption without attention speedup"

Examples of BAD learnings (REJECT, skip):
  ✗ "Quantization significantly reduces memory"        — no number, no model, no source
  ✗ "KV cache is important for inference performance"   — tautology, no fact
  ✗ "Researchers have explored various methods"         — meta-statement, no claim
  ✗ "FP8 is better than FP16"                           — missing metric/benchmark

## Rules

- Every learning MUST include at least ONE of: numeric metric, model name, benchmark name, or paper/author.
- Prefer specific numbers over ranges.  "4.7x reduction" > "significant reduction".
- Do NOT use the words: "significant", "substantial", "effective", "impressive", "important" (unless quoting).
- Do NOT invent facts. If source doesn't say it, don't write it.
- NEGATIVE findings matter: if a source reports a failure or limitation ("FP8 lacks fused ops", "2-bit fails for reasoning"), extract it — these are high-value contradictions later.
- Preserve exact method/metric names as written in source ("NVFP4", not "4-bit FP"; "LongBench", not "long bench").

## Follow-up questions

Generate 3 follow-up questions that dig DEEPER, not broader:
  ✓ "What is the perplexity delta for 3-bit TurboQuant on Llama-3 vs Gemma-4?"  — specific, deepens
  ✗ "What are other quantization methods?"                                        — broader, shallow

Output JSON only.`;

export async function harvest(input: HarvesterInput): Promise<SourceIndex[]> {
  const {
    plan,
    projectDir,
    breadth = 10,
    depth = 2,
    pagesPerQuery = 3,
    urlsPerQuery = 6,
    readConcurrency = 4,
  } = input;

  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(projectDir, "sources", "content");
  if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
  if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });

  const allIndices: SourceIndex[] = [];
  const globalVisited = new Set<string>();

  for (const task of plan.tasks) {
    const taskPath = join(sourcesDir, `${task.id}.json`);

    // Per-task cache: skip if already collected in this run cycle
    if (existsSync(taskPath) && !input.force) {
      const cached = JSON.parse(
        (await Bun.file(taskPath).text?.() ?? require("fs").readFileSync(taskPath, "utf-8"))
      ) as SourceIndex;
      // Only trust cache if it has the new-format learnings field (from deep-research harvester)
      const hasLearnings = Array.isArray((cached as any).learnings);
      if (hasLearnings && cached.results.length > 0) {
        console.log(
          `[harvester] ─── Task ${task.id} cached (${cached.results.length} sources, ${(cached as any).learnings?.length ?? 0} learnings) ───`
        );
        for (const r of cached.results) {
          const key = normalizeUrl(r.url);
          if (key) globalVisited.add(key);
        }
        allIndices.push(cached);
        continue;
      }
    }

    console.log(`\n[harvester] ─── Task ${task.id} (${task.hypothesis_id}) ───`);
    console.log(`[harvester] Goal: ${task.goal.slice(0, 100)}`);

    const result = await deepResearch({
      topic: plan.topic,
      taskGoal: task.goal,
      breadth,
      depth,
      pagesPerQuery,
      urlsPerQuery,
      readConcurrency,
      learnings: [],
      globalVisited,
      contentDir,
    });

    const index: SourceIndex = {
      task_id: task.id,
      hypothesis_id: task.hypothesis_id,
      queries: Array.from(new Set(result.sources.map((s) => s.query))),
      results: result.sources,
      collected_at: new Date().toISOString(),
    };
    (index as any).learnings = result.learnings;

    allIndices.push(index);
    writeFileSync(taskPath, JSON.stringify(index, null, 2));
    console.log(
      `[harvester] Task ${task.id} done: ${result.sources.length} sources, ${result.learnings.length} learnings`
    );
  }

  // Summary index
  const totalSources = allIndices.reduce((n, i) => n + i.results.length, 0);
  const totalLearnings = allIndices.reduce(
    (n, i) => n + ((i as any).learnings?.length ?? 0),
    0
  );

  const providerCounts: Record<string, number> = {};
  for (const idx of allIndices) {
    for (const r of idx.results) {
      const p = r.provider.split(":")[0] ?? "unknown";
      providerCounts[p] = (providerCounts[p] ?? 0) + 1;
    }
  }

  writeFileSync(
    join(sourcesDir, "index.json"),
    JSON.stringify(
      {
        total_sources: totalSources,
        total_learnings: totalLearnings,
        by_provider: providerCounts,
        by_task: allIndices.map((i) => ({
          task_id: i.task_id,
          sources: i.results.length,
          learnings: (i as any).learnings?.length ?? 0,
        })),
        collected_at: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(
    `\n[harvester] TOTAL: ${totalSources} sources, ${totalLearnings} learnings`
  );

  return allIndices;
}

// Recursive deep-research loop (dzhng-style)
async function deepResearch(opts: {
  topic: string;
  taskGoal: string;
  breadth: number;
  depth: number;
  pagesPerQuery: number;
  urlsPerQuery: number;
  readConcurrency: number;
  learnings: string[];
  globalVisited: Set<string>;
  contentDir: string;
}): Promise<DeepResearchResult> {
  const {
    topic,
    taskGoal,
    breadth,
    depth,
    pagesPerQuery,
    urlsPerQuery,
    readConcurrency,
    learnings: parentLearnings,
    globalVisited,
    contentDir,
  } = opts;

  // 1. Generate breadth search queries
  const queries = await generateQueries({
    topic,
    taskGoal,
    priorLearnings: parentLearnings,
    numQueries: breadth,
  });

  const webCount = queries.filter((q) => (q.channel ?? "web") === "web").length;
  const academicCount = queries.filter((q) => q.channel === "academic").length;
  console.log(
    `[deep] depth=${depth} breadth=${breadth} — ${queries.length} queries (web: ${webCount}, academic: ${academicCount})`
  );
  queries.forEach((q, i) =>
    console.log(`[deep]   ${i + 1}. [${q.channel ?? "web"}] ${q.query}`)
  );

  const allLearnings: string[] = [...parentLearnings];
  const allSources: SearchResult[] = [];
  const followUpQuestions: string[] = [];

  // 2. For each query: search + scrape + extract learnings
  for (const { query, research_goal, channel } of queries) {
    const ch = channel ?? "web";
    const paged: SearchResult[] = [];

    if (ch === "academic") {
      // Academic channel: primary-only providers + site-filtered SearXNG.
      const academic = await searchAll(query).catch(() => [] as SearchResult[]);
      for (const r of academic) {
        // Keep all primary-source providers (not general web)
        if (
          r.provider === "arxiv" ||
          r.provider === "openalex" ||
          r.provider === "semantic_scholar"
        ) {
          paged.push(r);
        }
      }
      // Site-filtered SearXNG — gives us Google ranking but only over
      // arxiv/openreview/aclanthology/neurips/pmlr, avoiding blog noise.
      const academicSites =
        "site:arxiv.org OR site:openreview.net OR site:aclanthology.org OR site:papers.nips.cc OR site:proceedings.mlr.press OR site:dl.acm.org";
      const filtered = await searchSearXNG(`${query} ${academicSites}`, {
        pageno: 1,
        maxResults: 15,
      });
      paged.push(...filtered);
    } else {
      // Web channel: SearXNG paginated + optional arxiv supplement
      for (let pageno = 1; pageno <= pagesPerQuery; pageno++) {
        const page = await searchSearXNG(query, { pageno });
        paged.push(...page);
      }
      const academic = await searchAll(query).catch(() => [] as SearchResult[]);
      for (const r of academic) {
        if (r.provider === "arxiv" || r.provider === "semantic_scholar") {
          paged.push(r);
        }
      }
    }

    // Dedupe first, then tier-sort so primary sources win early slots.
    // SearXNG ranks by its own relevance but interleaves a lot of SEO-blog
    // content; arxiv/s2 results are added at the end, so they rarely get
    // picked under urlsPerQuery=6. Sorting by tier fixes this.
    const seenInBatch = new Set<string>();
    const unique: SearchResult[] = [];
    for (const r of paged) {
      const key = normalizeUrl(r.url);
      if (!key || seenInBatch.has(key) || globalVisited.has(key)) continue;
      seenInBatch.add(key);
      unique.push(r);
    }
    // Stable sort by tier — preserves original order within same tier
    const tiered = unique
      .map((r, i) => ({ r, tier: scoreSource(r.url), i }))
      .sort((a, b) => a.tier - b.tier || a.i - b.i)
      .map((x) => x.r);

    const topUrls: SearchResult[] = [];
    for (const r of tiered) {
      const key = normalizeUrl(r.url);
      if (!key) continue;
      globalVisited.add(key);
      topUrls.push(r);
      if (topUrls.length >= urlsPerQuery) break;
    }

    if (topUrls.length === 0) {
      console.log(`[deep]   "${query.slice(0, 60)}" — 0 new URLs`);
      continue;
    }

    // 3. Scrape full content via Jina Reader
    console.log(`[deep]   "${query.slice(0, 60)}" — fetching ${topUrls.length} URLs`);
    const reads = await readUrls(
      topUrls.map((r) => r.url),
      readConcurrency,
      30000
    );

    // Attach content to sources, persist content to disk
    const contentfulSources: SearchResult[] = [];
    const fullContents: string[] = [];
    for (let i = 0; i < topUrls.length; i++) {
      const src = topUrls[i]!;
      const read = reads[i]!;
      if (read?.success && read.content.length > 200) {
        src.raw_content = read.content.slice(0, 8000);
        contentfulSources.push(src);
        // Truncate per-source content to keep LLM prefill time manageable
        // (primary papers can be 30-80kB; at 6 sources/query that's 300-500kB
        // per call which times out Cloudflare proxy at ~100s prefill).
        fullContents.push(read.content.slice(0, 15000));

        const hash = hashUrl(src.url);
        writeFileSync(
          join(contentDir, `${hash}.md`),
          `# ${src.title}\n\nURL: ${src.url}\n\n---\n\n${read.content}`
        );
      }
    }

    allSources.push(...contentfulSources);
    console.log(
      `[deep]   "${query.slice(0, 60)}" — ${contentfulSources.length}/${topUrls.length} readable`
    );

    if (contentfulSources.length === 0) continue;

    // 4. Extract learnings from full content
    try {
      const extracted = await extractLearnings({
        query,
        researchGoal: research_goal,
        contents: fullContents,
        numLearnings: 5,
        numFollowUps: 3,
      });
      allLearnings.push(...extracted.learnings);
      followUpQuestions.push(...extracted.follow_up_questions);
      console.log(
        `[deep]   "${query.slice(0, 60)}" — +${extracted.learnings.length} learnings, +${extracted.follow_up_questions.length} follow-ups`
      );
    } catch (err: any) {
      console.warn(`[deep]   Learnings failed for "${query.slice(0, 40)}": ${err.message?.slice(0, 80)}`);
    }
  }

  // 5. Recurse deeper if depth > 0
  if (depth > 1 && followUpQuestions.length > 0) {
    const newBreadth = Math.max(1, Math.ceil(breadth / 2));
    const newDepth = depth - 1;

    const deeperGoal = followUpQuestions.slice(0, 3).join("\n- ");
    console.log(`[deep] RECURSING — depth=${newDepth} breadth=${newBreadth}`);
    const deeper = await deepResearch({
      ...opts,
      taskGoal: `Follow-up research directions:\n- ${deeperGoal}`,
      breadth: newBreadth,
      depth: newDepth,
      learnings: allLearnings,
    });

    return {
      learnings: deeper.learnings,
      visitedUrls: globalVisited,
      sources: [...allSources, ...deeper.sources],
    };
  }

  return {
    learnings: dedupStrings(allLearnings),
    visitedUrls: globalVisited,
    sources: allSources,
  };
}

// --- LLM helpers ---

async function generateQueries(args: {
  topic: string;
  taskGoal: string;
  priorLearnings: string[];
  numQueries: number;
}): Promise<{ query: string; research_goal: string; channel?: string }[]> {
  const { topic, taskGoal, priorLearnings, numQueries } = args;

  // Keep prior learnings compact — 10 latest, each truncated to 200 chars
  const priorTrimmed = priorLearnings
    .slice(-10)
    .map((l) => l.slice(0, 200))
    .join("\n- ");

  const priorSection = priorTrimmed
    ? `\n\nPrior learnings (go DEEPER, do not repeat):\n- ${priorTrimmed}`
    : "";

  const webCount = Math.ceil(numQueries * 0.6);
  const academicCount = numQueries - webCount;
  const prompt = `Research topic: ${topic}\nCurrent goal: ${taskGoal.slice(0, 500)}${priorSection}\n\nGenerate EXACTLY ${numQueries} diverse queries: ${webCount} with channel="web" and ${academicCount} with channel="academic". Return ONLY JSON.`;

  const { object } = await generateJson({
    schema: SerpQueriesSchema,
    system: QUERY_GEN_SYSTEM,
    prompt: prompt.slice(0, 6000),
    temperature: 0.4,
  });

  return object.queries.slice(0, numQueries);
}

async function extractLearnings(args: {
  query: string;
  researchGoal: string;
  contents: string[];
  numLearnings: number;
  numFollowUps: number;
}) {
  const { query, researchGoal, contents, numLearnings, numFollowUps } = args;

  const promptPrefix = `Query: ${query}\nGoal: ${researchGoal}\n\nExtract at most ${numLearnings} concise learnings with specific numbers/names/metrics. Also generate at most ${numFollowUps} follow-up questions to deepen research.\n\nSources:\n`;

  // Build batches that fit within token budget
  const budget = await inputTokenBudget();
  const systemTokens = await countTokens(LEARNINGS_SYSTEM);
  const prefixTokens = await countTokens(promptPrefix);
  const overhead = systemTokens + prefixTokens + 500; // buffer for schema hint
  const batchBudget = budget - overhead;

  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < contents.length; i++) {
    const wrapped = `<content index="${i + 1}">\n${contents[i]}\n</content>\n\n`;
    const tokens = await countTokens(wrapped);
    if (tokens > batchBudget) {
      // Single source too large — truncate it
      const ratio = batchBudget / tokens;
      const safe = wrapped.slice(0, Math.floor(wrapped.length * ratio * 0.9));
      if (currentBatch.length) batches.push(currentBatch);
      batches.push([safe]);
      currentBatch = [];
      currentTokens = 0;
    } else if (currentTokens + tokens > batchBudget) {
      batches.push(currentBatch);
      currentBatch = [wrapped];
      currentTokens = tokens;
    } else {
      currentBatch.push(wrapped);
      currentTokens += tokens;
    }
  }
  if (currentBatch.length) batches.push(currentBatch);

  console.log(
    `[extract]   ${contents.length} sources → ${batches.length} batch${batches.length > 1 ? "es" : ""} (budget ${batchBudget} tokens)`
  );

  // Run each batch and merge
  const allLearnings: string[] = [];
  const allFollowUps: string[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batchBlock = batches[b]!.join("");
    const { object } = await generateJson({
      schema: LearningsSchema,
      system: LEARNINGS_SYSTEM,
      prompt: `${promptPrefix}${batchBlock}`,
      temperature: 0.2,
    });
    allLearnings.push(...object.learnings);
    allFollowUps.push(...object.follow_up_questions);
    if (batches.length > 1) {
      console.log(
        `[extract]   batch ${b + 1}/${batches.length}: +${object.learnings.length} learnings`
      );
    }
  }

  // Dedup across batches by rough similarity (first 80 chars)
  const seen = new Set<string>();
  const dedupedLearnings = allLearnings.filter((l) => {
    const k = l.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const seenQ = new Set<string>();
  const dedupedFollowUps = allFollowUps.filter((q) => {
    const k = q.toLowerCase().slice(0, 80);
    if (seenQ.has(k)) return false;
    seenQ.add(k);
    return true;
  });

  return {
    learnings: dedupedLearnings.slice(0, numLearnings * Math.max(1, batches.length)),
    follow_up_questions: dedupedFollowUps.slice(0, numFollowUps),
  };
}

// --- utils ---

function normalizeUrl(url: string): string {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36) + "-" + url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-");
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const k = s.toLowerCase().trim().slice(0, 100);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
