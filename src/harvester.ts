import { generateJson, countTokens, inputTokenBudget } from "./llm";
import { config } from "./config";
import { searchAll, searchSearXNG } from "./search";
import { readUrls } from "./reader";
import { SerpQueriesSchema, LearningsSchema } from "./schemas/learning";
import { scoreSource } from "./sourcing";
import type { SearchResult, SourceIndex } from "./schemas/source";
import type { ResearchPlan, ResearchQuestion, Subquestion } from "./schemas/plan";
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

## COMPARATIVE-METHOD COVERAGE (critical for research breadth)

Research papers typically compare a hero method against 3-8 baselines in tables. Extract a DISTINCT learning for EACH non-hero method the paper reports a number for — even if that method is "background". Readers need the whole landscape.

GOOD (one per baseline):
  ✓ "TurboQuant achieves 6x KV reduction on Gemma [paper X]"
  ✓ "Kitty reports 3.1pp GSM8K drop at 2-bit on Qwen3 [paper X Table 2]"
  ✓ "MiniKV achieves 80%+ compression on Llama-3 [paper X Table 2]"
  ✓ "Coupled Quantization enables 1-bit KV cache at <1% perplexity loss [paper X Table 2]"

BAD (collapses the table into one hero-method learning):
  ✗ "TurboQuant outperforms baselines KIVI, Kitty, MiniKV" — names dropped, no numbers

Also extract BACKGROUND mentions even without numbers: if a paper names a framework (TensorRT-LLM, llama.cpp), format (Q4_K_M, Q4_0, GGUF), or well-known method (PagedAttention, FlashAttention) in its related-work or setup, include at least one learning naming that entity. These are research-landscape anchors.

## Follow-up questions

Generate 3 follow-up questions that dig DEEPER, not broader:
  ✓ "What is the perplexity delta for 3-bit TurboQuant on Llama-3 vs Gemma-4?"  — specific, deepens
  ✗ "What are other quantization methods?"                                        — broader, shallow

Output JSON only.`;

export async function harvest(input: HarvesterInput): Promise<SourceIndex[]> {
  const {
    plan,
    projectDir,
    breadth = 6,
    depth = 1,
    pagesPerQuery = 2,
    urlsPerQuery = 6,
    readConcurrency = 4,
  } = input;

  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(projectDir, "sources", "content");
  if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
  if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });

  // Parallelism cap for harvest: 3 simultaneous subquestions. Each runs
  // deepResearch (search API + Jina fetches + LEARNINGS LLM call per query).
  // Endpoint has 5 slots; 3 concurrent keeps slack for other pipeline phases.
  const HARVEST_CONCURRENCY = 3;

  // Flatten plan into (question, subquestion) units. Each unit gets one
  // SourceIndex. Per-subquestion cache file: sources/{subquestion.id}.json.
  interface HarvestUnit {
    question: ResearchQuestion;
    subquestion: Subquestion;
  }
  const allUnits: HarvestUnit[] = [];
  for (const q of plan.questions) {
    for (const sq of q.subquestions) {
      allUnits.push({ question: q, subquestion: sq });
    }
  }

  const allIndices: SourceIndex[] = [];
  const globalVisited = new Set<string>();
  const pendingUnits: HarvestUnit[] = [];

  // First pass: load any per-subquestion caches synchronously so
  // globalVisited is seeded before parallel units start.
  for (const unit of allUnits) {
    const cachePath = join(sourcesDir, `${unit.subquestion.id}.json`);
    if (existsSync(cachePath) && !input.force) {
      const cached = JSON.parse(
        require("fs").readFileSync(cachePath, "utf-8")
      ) as SourceIndex;
      const hasLearnings = Array.isArray((cached as any).learnings);
      if (hasLearnings && cached.results.length > 0) {
        console.log(
          `[harvester] ─── ${unit.subquestion.id} cached (${cached.results.length} sources, ${(cached as any).learnings?.length ?? 0} learnings) ───`
        );
        for (const r of cached.results) {
          const key = normalizeUrl(r.url);
          if (key) globalVisited.add(key);
        }
        allIndices.push(cached);
        continue;
      }
    }
    pendingUnits.push(unit);
  }

  console.log(
    `[harvester] ${allIndices.length} cached, ${pendingUnits.length} to collect (concurrency=${HARVEST_CONCURRENCY})`
  );

  async function processUnit(unit: HarvestUnit): Promise<void> {
    const cachePath = join(sourcesDir, `${unit.subquestion.id}.json`);
    const header = `${unit.subquestion.id} [${unit.subquestion.angle}]`;
    console.log(`\n[harvester] ─── ${header} (question ${unit.question.id}) ───`);
    console.log(`[harvester] Subquestion: ${unit.subquestion.text.slice(0, 120)}`);

    // The harvester-facing "goal" is the subquestion text plus its parent
    // question — the LLM-query generator uses both to produce targeted queries.
    const goal = `Research question: ${unit.question.question}\nSubquestion (${unit.subquestion.angle}): ${unit.subquestion.text}`;

    const result = await deepResearch({
      topic: plan.topic,
      taskGoal: goal,
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
      question_id: unit.question.id,
      subquestion_id: unit.subquestion.id,
      queries: Array.from(new Set(result.sources.map((s) => s.query))),
      results: result.sources,
      collected_at: new Date().toISOString(),
    };
    (index as any).learnings = result.learnings;

    allIndices.push(index);
    writeFileSync(cachePath, JSON.stringify(index, null, 2));
    console.log(
      `[harvester] ${header} done: ${result.sources.length} sources, ${result.learnings.length} learnings`
    );
  }

  const unitQueue = [...pendingUnits];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < HARVEST_CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (unitQueue.length > 0) {
          const unit = unitQueue.shift();
          if (!unit) return;
          try {
            await processUnit(unit);
          } catch (err: any) {
            console.warn(
              `[harvester] ${unit.subquestion.id} failed: ${err.message?.slice(0, 100)}`
            );
          }
        }
      })()
    );
  }
  await Promise.all(workers);

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
        by_subquestion: allIndices.map((i) => ({
          question_id: i.question_id,
          subquestion_id: i.subquestion_id,
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
        if (
          r.provider === "arxiv" ||
          r.provider === "semantic_scholar" ||
          r.provider === "openalex"
        ) {
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

  // 4.5 — Citation snowball: scan collected content for cited arxiv paper
  // IDs (references section, "et al." citations, inline [N] markers). Add
  // new papers as additional sources and run extractLearnings on them.
  // Disabled by setting SNOWBALL_MAX_PAPERS=0.
  const snowballMax = Number(process.env.SNOWBALL_MAX_PAPERS ?? 8);
  if (snowballMax > 0 && allSources.length > 0) {
    const seen = new Set(allSources.map((s) => normalizeUrl(s.url)));
    // Collect arxiv IDs cited anywhere in the first 25 kB of each primary-tier
    // source's scraped content. Keep the top N that aren't already visited.
    const cited = new Map<string, number>(); // arxivId -> count (popularity)
    for (const src of allSources.slice(0, 15)) {
      if (scoreSource(src.url) > 1) continue; // primary tier only
      const content = src.raw_content ?? "";
      const scope = content.slice(0, 25000);
      const arxivIds = scope.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/g) ?? [];
      for (const id of arxivIds) {
        const canonical = id.replace(/v\d+$/, "");
        const key = `arxiv:${canonical}`;
        if (seen.has(key) || globalVisited.has(key)) continue;
        cited.set(canonical, (cited.get(canonical) ?? 0) + 1);
      }
    }
    const newIds = Array.from(cited.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, snowballMax)
      .map(([id]) => id);
    if (newIds.length > 0) {
      console.log(`[snowball] ${newIds.length} new arxiv papers cited by primary sources`);
      const snowballUrls = newIds.map((id) => `https://arxiv.org/html/${id}v1`);
      const reads = await readUrls(snowballUrls, readConcurrency, 30000);
      const snowballSources: SearchResult[] = [];
      const snowballContents: string[] = [];
      for (let i = 0; i < newIds.length; i++) {
        const read = reads[i];
        if (!read?.success || read.content.length < 200) continue;
        const src: SearchResult = {
          title: `arXiv:${newIds[i]}`,
          url: snowballUrls[i]!,
          snippet: read.content.slice(0, 300),
          provider: "arxiv:snowball",
          query: "[citation snowball]",
          raw_content: read.content.slice(0, 8000),
        };
        globalVisited.add(`arxiv:${newIds[i]}`);
        snowballSources.push(src);
        snowballContents.push(read.content.slice(0, 15000));
        // Persist content to disk like the main loop does
        const hash = hashUrl(src.url);
        writeFileSync(
          join(contentDir, `${hash}.md`),
          `# ${src.title}\n\nURL: ${src.url}\n\n---\n\n${read.content}`
        );
      }
      allSources.push(...snowballSources);
      console.log(
        `[snowball]   fetched ${snowballSources.length}/${newIds.length} snowballed papers`
      );
      if (snowballContents.length > 0) {
        try {
          const extracted = await extractLearnings({
            query: "citations snowballed from primary sources",
            researchGoal: opts.taskGoal,
            contents: snowballContents,
            numLearnings: 8,
            numFollowUps: 0,
          });
          allLearnings.push(...extracted.learnings);
          console.log(`[snowball]   +${extracted.learnings.length} learnings from snowball`);
        } catch (err: any) {
          console.warn(`[snowball]   learnings failed: ${err.message?.slice(0, 80)}`);
        }
      }
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
    endpoint: config.endpoints.harvester,
  });

  return object.queries.slice(0, numQueries);
}

export async function extractLearnings(args: {
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
      endpoint: config.endpoints.harvester,
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
  let s = url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[#?].*$/, "")
    .replace(/\/+$/, "");

  // Arxiv paper ID canonicalization: abs/X, html/X, html/Xv2, pdf/X,
  // pdf/X.pdf all point to the same paper. Canonical key = "arxiv:<id>"
  // without version suffix. Also normalizes export.arxiv.org -> arxiv.org.
  const arxivMatch = s.match(
    /^(?:export\.)?arxiv\.org\/(?:abs|html|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?(?:\/.*)?$/
  );
  if (arxivMatch) return `arxiv:${arxivMatch[1]}`;

  // OpenReview dedup: forum?id=X, pdf?id=X, pdf/X — all same paper.
  // NOTE: query stripping above already removed ?id=... so only pathnames remain.
  const orMatch = s.match(/^openreview\.net\/(?:forum|pdf|attachment)\/([a-z0-9_-]+)/i);
  if (orMatch) return `openreview:${orMatch[1].toLowerCase()}`;

  // Semantic Scholar paper IDs.
  const s2Match = s.match(/^(?:www\.)?semanticscholar\.org\/paper\/[^\/]*\/?([a-f0-9]{8,})/);
  if (s2Match) return `s2:${s2Match[1]}`;

  // OpenAlex work IDs.
  const oaMatch = s.match(/^(?:api\.)?openalex\.org\/works\/(w\d+)/i);
  if (oaMatch) return `openalex:${oaMatch[1].toLowerCase()}`;

  return s;
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
