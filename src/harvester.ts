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

const QUERY_GEN_SYSTEM = `You generate search queries for deep research.

Generate a DIVERSE mix across two channels:
- 'web' queries: practical, blog-/docs-/GitHub-style phrasing (tutorials, benchmarks, deployment).
- 'academic' queries: paper-oriented phrasing with method/author/venue language (arxiv-style titles, e.g. "KV cache quantization Llama perplexity evaluation").

Rules:
- Each query targets a different angle — no overlap.
- Queries must be specific: real technical terms, model names, tool names, method names, dataset names.
- For 'academic' channel, prefer phrasing that would match paper titles/abstracts.
- For 'web' channel, prefer phrasing that would match blog posts, GitHub READMEs, official docs.
- No vague queries.
- Output JSON only matching the provided schema.`;

const LEARNINGS_SYSTEM = `You extract concise, information-dense learnings from web search results.
- Each learning is one factual statement with specific numbers, names, dates, metrics when available.
- Do not invent facts. Only extract what the sources actually say.
- Include exact metrics (e.g. "70% VRAM reduction", "perplexity delta 0.8"), model names, benchmark scores.
- Generate follow-up questions that would deepen the research, not repeat what's already known.
- Output JSON only.`;

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
      // Academic channel: arxiv + semantic scholar, skip SearXNG web
      const academic = await searchAll(query).catch(() => [] as SearchResult[]);
      for (const r of academic) {
        if (r.provider === "arxiv" || r.provider === "semantic_scholar") {
          paged.push(r);
        }
      }
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
