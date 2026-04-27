import { generateJson, countTokens, inputTokenBudget } from "./llm";
import { config } from "./config";
import { searchAll, searchSearXNG } from "./search";
import { readUrls } from "./reader";
import { SerpQueriesSchema, LearningsSchema } from "./schemas/learning";
import { scoreSource } from "./sourcing";
import {
  academicSiteFilter,
  detectDomainProfile,
  domainPromptBlock,
  learningGuidanceBlock,
  type DomainProfile,
} from "./domain-profile";
import type { SearchResult, SourceIndex } from "./schemas/source";
import type { ResearchPlan, ResearchQuestion, Subquestion } from "./schemas/plan";
import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";

interface HarvesterInput {
  plan: ResearchPlan;
  projectDir: string;
  breadth?: number;          // queries per subquestion depth level
  depth?: number;            // recursive deepening levels
  pagesPerQuery?: number;    // SearXNG pagination
  urlsPerQuery?: number;     // readable URLs to try to collect per query
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

### 'academic' channel
Phrasing should match paper titles, abstracts, standards, trials, patents, or technical reports in the target field. Structure:
- "<Named entity>: <what it does/measures> via <technique>"
- "<Observed phenomenon> in <population/system/material/model>"
- "<Technique/intervention> for <problem> in <domain>"

### 'web' channel (for SearXNG Google/DDG search)
Phrasing should match official docs, regulatory pages, technical notes, product documentation, or high-quality field-specific web sources. Structure:
- "How to <action> with <tool/method/standard>"
- "<Entity/source> <version/year> <feature/outcome> benchmark"
- "<Method A> vs <Method B> <comparison axis>"

## Strict rules

- Name specific methods, materials, compounds, standards, datasets, populations, model names, benchmarks, tools, or hardware from the topic and domain context.
- For 'academic' queries: NO imperatives ("how to", "implement"). Use noun phrases as in paper titles.
- For 'web' queries: DO use imperatives and vendor names when relevant.
- No duplicate angles. Each query must cover a distinct research sub-question.
- If you know a canonical paper, method, standard, guideline, ingredient, molecule, dataset, or framework by name, use that name in at least one query.
- Stay anchored to the current goal. Do not introduce a named entity from prior learnings unless it directly answers the current goal.
- For product-under-evaluation topics, treat the named product as the design target. Search for competitor docs, public methods, evaluation frameworks, trust literature, and pricing/collaboration patterns; do not search as if the target product already has public benchmark reports, customer deployments, or internal implementation docs unless the topic explicitly says so.

## Anti-patterns

- "Benchmark the topic" (too vague)
- "Research about this field" (no specificity)
- "Best method 2026" (listicle-style, usually bad for evidence)

Output JSON only, matching the schema.`;

const LEARNINGS_SYSTEM = `You extract factual learnings from scraped source content. Each learning is a SELF-CONTAINED sentence with the full context needed to cite it later.

## Required structure for EACH learning

Template (pick whichever fits the source fact):
  "SOURCE <index> <url> | <Method/Tool> achieves <Metric> of <Value> on <Benchmark/Dataset> for <Model/Setup>"
  "SOURCE <index> <url> | <Method> reduces <Resource> by <Value> compared to <Baseline>"
  "SOURCE <index> <url> | <Observation> holds for <Model/Setup> but fails for <Counter-example>"
  "SOURCE <index> <url> | <Authors/Paper> report <Finding> with <Dataset> in <Year>"

Examples of GOOD learnings:
  ✓ "SOURCE 1 https://example.org/paper | Smith et al. report a 21% reduction in outcome X for population Y after 12 weeks"
  ✓ "SOURCE 2 https://example.org/report | Method A reduces resource B by 4.7x compared to baseline C on benchmark D"
  ✓ "SOURCE 3 https://example.org/study | Compound X degrades by 38% after 2 MED UVA exposure in emulsion Y"
  ✓ "SOURCE 4 https://example.org/docs | Official framework Z added feature Q in version 1.2 but documents limitation R"

Examples of BAD learnings (REJECT, skip):
  ✗ "The method is significant"                         — no number, entity, or measured outcome
  ✗ "This topic is important"                           — tautology, no fact
  ✗ "Researchers have explored various methods"         — meta-statement, no claim
  ✗ "A is better than B"                                — missing metric/benchmark/context

## Rules

- Every learning MUST include at least ONE of: numeric metric, model name, benchmark name, or paper/author.
- For non-ML domains, a named ingredient, assay, skin model, cell chemistry, standard, guideline, population, or formulation vehicle counts as a named entity even when there is no benchmark.
- Prefer specific numbers over ranges.  "4.7x reduction" > "significant reduction".
- Do NOT use the words: "significant", "substantial", "effective", "impressive", "important" (unless quoting).
- Do NOT invent facts. If source doesn't say it, don't write it.
- If a source is off-topic for the Query and Goal, extract no learnings from it.
- NEGATIVE findings matter: if a source reports a failure, adverse result, limitation, null result, or boundary condition, extract it — these are high-value contradictions later.
- Preserve exact method/metric/entity names as written in source.

## COMPARATIVE-METHOD COVERAGE (critical for research breadth)

Research papers and technical reports often compare a focal method/product/intervention against several baselines, comparators, or controls. Extract a DISTINCT learning for EACH comparator with a reported result — even if that comparator is "background". Readers need the whole landscape.

BAD (collapses a table into one vague learning):
  ✗ "Method A outperforms several baselines" — names dropped, no numbers

Also extract BACKGROUND mentions even without numbers when they anchor the research landscape: named standards, frameworks, ingredients, datasets, cell chemistries, guidelines, or canonical methods.

## Follow-up questions

Generate 3 follow-up questions that dig DEEPER, not broader:
  ✓ "What is the measured delta for named method A on benchmark/population/setup B vs C?"  — specific, deepens
  ✗ "What are other methods?"                                                           — broader, shallow

Follow-ups must preserve the Query/Goal domain. Do not pivot to unrelated products, papers, systems, industries, or acronyms just because they appeared in a scraped page. For product-under-evaluation topics, follow-ups should ask what evidence, UX, method, metric, competitor pattern, or trust mechanism should inform the target product; they should not imply the target product already has public proof.

Output JSON only.`;

export async function harvest(input: HarvesterInput): Promise<SourceIndex[]> {
  const {
    plan,
    projectDir,
    breadth = positiveIntEnv("HARVEST_BREADTH", 8),
    depth = positiveIntEnv("HARVEST_DEPTH", 2),
    pagesPerQuery = positiveIntEnv("HARVEST_PAGES_PER_QUERY", 3),
    urlsPerQuery = positiveIntEnv("HARVEST_URLS_PER_QUERY", 10),
    readConcurrency = positiveIntEnv("HARVEST_READ_CONCURRENCY", 6),
  } = input;

  // Budget caps — a broad topic (like an INCI ingredient list) can grind
  // the deep-recursion loop for 2+ hours. These cap wall-time and total
  // source volume so a run can't hang the pipeline slot indefinitely.
  // Env overrides: MAX_HARVEST_MINUTES, MAX_HARVEST_SOURCES.
  // Default source cap is intentionally high enough for a deep-research run;
  // smaller demos can lower MAX_HARVEST_SOURCES or HARVEST_* knobs.
  const maxHarvestMinutes = positiveIntEnv("MAX_HARVEST_MINUTES", 90);
  const maxHarvestSources = positiveIntEnv("MAX_HARVEST_SOURCES", 400);
  const harvestDeadlineMs = Date.now() + maxHarvestMinutes * 60 * 1000;

  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(projectDir, "sources", "content");
  if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
  if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });

  // Parallelism cap is provider-aware: qwen/self-hosted stays conservative,
  // Gemini can fan out more because it is an external API.
  const HARVEST_CONCURRENCY = config.concurrency.harvest;

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
  const expectedUnitIds = new Set(allUnits.map((u) => u.subquestion.id));
  const maxSourcesPerUnit = Math.max(
    urlsPerQuery,
    Math.ceil(maxHarvestSources / Math.max(1, allUnits.length))
  );
  if (input.force) {
    rmSync(contentDir, { recursive: true, force: true });
    mkdirSync(contentDir, { recursive: true });
    for (const file of readdirSync(sourcesDir)) {
      if (file === "index.json" || /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(file)) {
        rmSync(join(sourcesDir, file), { force: true });
      }
    }
  } else {
    for (const file of readdirSync(sourcesDir)) {
      if (!/^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(file)) continue;
      const id = file.replace(/\.json$/i, "");
      if (!expectedUnitIds.has(id)) rmSync(join(sourcesDir, file), { force: true });
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
    `[harvester] ${allIndices.length} cached, ${pendingUnits.length} to collect (concurrency=${HARVEST_CONCURRENCY}, source cap≈${maxSourcesPerUnit}/unit)`
  );

  async function processUnit(unit: HarvestUnit): Promise<void> {
    const cachePath = join(sourcesDir, `${unit.subquestion.id}.json`);
    const header = `${unit.subquestion.id} [${unit.subquestion.angle}]`;
    console.log(`\n[harvester] ─── ${header} (question ${unit.question.id}) ───`);
    console.log(`[harvester] Subquestion: ${unit.subquestion.text.slice(0, 120)}`);

    // The harvester-facing "goal" is the subquestion text plus its parent
    // question — the LLM-query generator uses both to produce targeted queries.
    const goal = `Research question: ${unit.question.question}\nSubquestion (${unit.subquestion.angle}): ${unit.subquestion.text}`;

    // Budget check before spinning up another subquestion loop.
    if (Date.now() > harvestDeadlineMs) {
      console.warn(
        `[harvester] skipping ${header} — harvest time budget exhausted (${maxHarvestMinutes} min)`
      );
      return null;
    }

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
      // plan.constraints carries the brief's domain_hints/constraints
      // from the pre-research scope chat. Pinning queries to this domain
      // prevents off-field matches (titanium-physics on a cosmetics run).
      domainContext: plan.constraints,
      budget: {
        deadlineMs: harvestDeadlineMs,
        maxSources: maxSourcesPerUnit,
        sourcesSoFar: 0,
      },
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

interface HarvestBudget {
  deadlineMs: number;
  maxSources: number;
  sourcesSoFar: number;
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
  budget?: HarvestBudget;
  domainContext?: string;
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
    budget,
  } = opts;
  const domainProfile = detectDomainProfile(topic, opts.domainContext);

  const budgetExceeded = (): boolean => {
    if (!budget) return false;
    return (
      Date.now() > budget.deadlineMs || budget.sourcesSoFar >= budget.maxSources
    );
  };

  if (budgetExceeded()) {
    console.warn(
      `[deep] budget exhausted before depth=${depth} — returning with current learnings`
    );
    return { sources: [], learnings: parentLearnings };
  }

  // 1. Generate breadth search queries
  const queries = await generateQueries({
    topic,
    taskGoal,
    priorLearnings: parentLearnings,
    numQueries: breadth,
    domainContext: opts.domainContext,
    domainProfile,
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
      const academicSites = academicSiteFilter(domainProfile);
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
    const tiered = rankSearchResults(unique, {
      query,
      taskGoal,
      domainProfile,
    });
    const dropped = unique.length - tiered.length;
    if (dropped > 0) {
      console.log(
        `[deep]   "${query.slice(0, 60)}" — prefiltered ${dropped}/${unique.length} weak/off-domain candidates`
      );
    }

    if (tiered.length === 0) {
      console.log(`[deep]   "${query.slice(0, 60)}" — 0 new URLs`);
      continue;
    }

    // 3. Scrape full content via Jina Reader. Do not stop at the first
    // urlsPerQuery candidates: many search results are PDFs, bot-blocked,
    // duplicate mirrors, or pages Jina cannot read. Keep pulling from the
    // ranked candidate list until we have enough readable sources.
    const contentfulSources: SearchResult[] = [];
    const fullContents: string[] = [];
    let attempted = 0;
    let cursor = 0;
    while (
      cursor < tiered.length &&
      contentfulSources.length < urlsPerQuery &&
      !budgetExceeded()
    ) {
      const remaining = urlsPerQuery - contentfulSources.length;
      const fetchBatchSize = Math.max(readConcurrency, remaining);
      const batch: SearchResult[] = [];

      while (cursor < tiered.length && batch.length < fetchBatchSize) {
        const src = tiered[cursor++]!;
        const key = normalizeUrl(src.url);
        if (!key || globalVisited.has(key)) continue;
        globalVisited.add(key);
        batch.push(src);
      }
      if (batch.length === 0) break;

      attempted += batch.length;
      console.log(
        `[deep]   "${query.slice(0, 60)}" — fetching ${batch.length} URLs (${contentfulSources.length}/${urlsPerQuery} readable so far)`
      );
      const reads = await readUrls(
        batch.map((r) => r.url),
        readConcurrency,
        30000
      );

      for (let i = 0; i < batch.length; i++) {
        if (contentfulSources.length >= urlsPerQuery || budgetExceeded()) break;
        const src = batch[i]!;
        const read = reads[i]!;
        if (read?.success && read.content.length > 200) {
          src.raw_content = read.content.slice(0, 8000);
          contentfulSources.push(src);
          // Truncate per-source content to keep LLM prefill time manageable
          // (primary papers can be 30-80kB; at 10 sources/query that's often
          // hundreds of kB per call).
          fullContents.push(read.content.slice(0, positiveIntEnv("HARVEST_CONTENT_CHARS", 8000)));

          const hash = hashUrl(src.url);
          writeFileSync(
            join(contentDir, `${hash}.md`),
            `# ${src.title}\n\nURL: ${src.url}\n\n---\n\n${read.content}`
          );
        }
      }
    }

    allSources.push(...contentfulSources);
    if (budget) budget.sourcesSoFar += contentfulSources.length;
    console.log(
      `[deep]   "${query.slice(0, 60)}" — ${contentfulSources.length}/${attempted} readable`
    );

    if (contentfulSources.length === 0) continue;
    if (budgetExceeded()) {
      console.warn(
        `[deep] budget exhausted after query "${query.slice(0, 40)}" — stopping this depth level`
      );
      break;
    }

    // 4. Extract learnings from full content
    try {
      const extracted = await extractLearnings({
        query,
        researchGoal: research_goal,
        contents: fullContents,
        sources: contentfulSources,
        numLearnings: positiveIntEnv("HARVEST_LEARNINGS_PER_QUERY", 8),
        numFollowUps: positiveIntEnv("HARVEST_FOLLOWUPS_PER_QUERY", 4),
        domainProfile,
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
        snowballContents.push(read.content.slice(0, positiveIntEnv("HARVEST_CONTENT_CHARS", 8000)));
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
            sources: snowballSources,
            numLearnings: 8,
            numFollowUps: 0,
            domainProfile,
          });
          allLearnings.push(...extracted.learnings);
          console.log(`[snowball]   +${extracted.learnings.length} learnings from snowball`);
        } catch (err: any) {
          console.warn(`[snowball]   learnings failed: ${err.message?.slice(0, 80)}`);
        }
      }
    }
  }

  // 5. Recurse deeper if depth > 0 and budget allows
  if (depth > 1 && followUpQuestions.length > 0 && !budgetExceeded()) {
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
  domainContext?: string;
  domainProfile?: DomainProfile;
}): Promise<{ query: string; research_goal: string; channel?: string }[]> {
  const {
    topic,
    taskGoal,
    priorLearnings,
    numQueries,
    domainContext,
    domainProfile = detectDomainProfile(topic, domainContext),
  } = args;

  // Keep prior learnings compact — 10 latest, each truncated to 200 chars
  const priorTrimmed = priorLearnings
    .slice(-10)
    .map((l) => l.slice(0, 200))
    .join("\n- ");

  const priorSection = priorTrimmed
    ? `\n\nPrior learnings (go DEEPER, do not repeat):\n- ${priorTrimmed}`
    : "";

  // Domain context comes from the pre-research scope chat (via
  // plan.constraints). It carries "Domain: cosmetic skincare" kind of
  // hints that tell the query generator which journals/phrasing to
  // prefer. Without this, a topic with "titanium" in an INCI list
  // ends up retrieving physics dark-matter detector papers.
  const domainSection = domainContext
    ? `\n\nDOMAIN CONTEXT (pin queries to this field — do NOT drift):\n${domainContext.slice(0, 1000)}`
    : "";
  const profileSection = `\n\n${domainPromptBlock(domainProfile)}`;

  const webCount = Math.ceil(numQueries * 0.6);
  const academicCount = numQueries - webCount;
  const prompt = `Research topic: ${topic}\nCurrent goal: ${taskGoal.slice(0, 500)}${domainSection}${profileSection}${priorSection}\n\nIf this is a product evaluation/deploy-readiness task, do not assume the named target product has public benchmark scores, customer deployments, or implementation docs. Generate queries that find external evidence the product should learn from.\n\nGenerate EXACTLY ${numQueries} diverse queries: ${webCount} with channel="web" and ${academicCount} with channel="academic". Return ONLY JSON.`;

  const { object } = await generateJson({
    schema: SerpQueriesSchema,
    system: QUERY_GEN_SYSTEM,
    prompt: prompt.slice(0, 9000),
    temperature: 0.4,
    endpoint: config.endpoints.harvester,
  });

  return object.queries.slice(0, numQueries);
}

export async function extractLearnings(args: {
  query: string;
  researchGoal: string;
  contents: string[];
  sources?: SearchResult[];
  numLearnings: number;
  numFollowUps: number;
  domainProfile?: DomainProfile;
}) {
  const {
    query,
    researchGoal,
    contents,
    sources,
    numLearnings,
    numFollowUps,
    domainProfile = detectDomainProfile(`${query}\n${researchGoal}`),
  } = args;

  const promptPrefix = `Query: ${query}\nGoal: ${researchGoal}\n\nExtract at most ${numLearnings} concise learnings with specific numbers/names/metrics. Also generate at most ${numFollowUps} follow-up questions to deepen research.\n\nCRITICAL SOURCE LINKING:\n- Each learning MUST start with: SOURCE <index> <url> | <finding>\n- Use the exact source index and URL from the wrapper below.\n- Do not omit the SOURCE prefix; downstream attribution depends on it.\n\nSources:\n`;

  // Build batches that fit within token budget
  const budget = await inputTokenBudget();
  const learningsSystem = `${LEARNINGS_SYSTEM}\n\n${learningGuidanceBlock(domainProfile)}`;
  const systemTokens = await countTokens(learningsSystem);
  const prefixTokens = await countTokens(promptPrefix);
  const overhead = systemTokens + prefixTokens + 500; // buffer for schema hint
  const batchBudget = budget - overhead;

  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < contents.length; i++) {
    const src = sources?.[i];
    const attrs = src
      ? ` index="${i + 1}" url="${src.url}" title="${(src.title ?? "").replace(/"/g, "'")}"`
      : ` index="${i + 1}"`;
    const wrapped = `<content${attrs}>\n${contents[i]}\n</content>\n\n`;
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
    let { object } = await generateJson({
      schema: LearningsSchema,
      system: learningsSystem,
      prompt: `${promptPrefix}${batchBlock}`,
      temperature: 0.2,
      endpoint: config.endpoints.harvester,
    });
    if (object.learnings.length === 0 && contents.length > 0) {
      console.log(
        `[extract]   batch ${b + 1}/${batches.length}: 0 learnings — retrying relaxed extraction`
      );
      const relaxedSystem = `${learningsSystem}

## Empty-output fallback

The previous extraction pass found no learnings. Re-read the same sources more permissively.
- Return 2-5 candidate learnings if any source is even partially relevant to the Query and Goal.
- For R&D, acceptable learnings include named assay methods, application dose standards, skin models, formulation vehicles, penetration mechanisms, limitations, and boundary conditions, even without a numeric result.
- Keep the SOURCE <index> <url> | prefix.
- Do not invent values. If no number is present, preserve the named entity and condition exactly.`;
      const relaxed = await generateJson({
        schema: LearningsSchema,
        system: relaxedSystem,
        prompt: `${promptPrefix}${batchBlock}

Return candidate learnings now. Prefer imperfect but source-grounded findings over an empty list.`,
        temperature: 0,
        maxRetries: 1,
        endpoint: config.endpoints.harvester,
      });
      object = relaxed.object;
    }
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

function rankSearchResults(
  results: SearchResult[],
  opts: { query: string; taskGoal: string; domainProfile: DomainProfile }
): SearchResult[] {
  const { query, taskGoal, domainProfile } = opts;
  const queryTerms = termSet(`${query}\n${taskGoal}`);
  const domainTerms = domainRelevanceTerms(domainProfile);
  const scored = results.map((r, i) => {
    const text = `${r.title}\n${r.snippet}\n${r.url}`.toLowerCase();
    const queryHits = countHits(text, queryTerms);
    const domainHits = countHits(text, domainTerms);
    const tier = scoreSource(r.url);
    const hostPenalty = weakHostPenalty(r.url, domainProfile);
    const providerBoost =
      r.provider === "openalex" || r.provider === "semantic_scholar" ? -8 : 0;
    return {
      r,
      i,
      tier,
      queryHits,
      domainHits,
      score:
        tier * 30 +
        hostPenalty -
        queryHits * 3 -
        domainHits * 6 +
        providerBoost,
    };
  });

  const hasDomainMatches = scored.some((x) => x.domainHits > 0);
  const filtered = scored.filter((x) => {
    if (weakHostPenalty(x.r.url, domainProfile) >= 80) return false;
    if (domainProfile.id === "generic") return true;
    if (!hasDomainMatches) return true;
    // In specialized domains, a source with zero field-language in title,
    // snippet, and URL is usually a keyword collision. Keep only top-tier
    // academic sources when they at least match the query text.
    if (x.domainHits === 0 && x.tier > 0) return false;
    if (x.domainHits === 0 && x.queryHits < 2) return false;
    return true;
  });

  const poolLimit = positiveIntEnv("HARVEST_CANDIDATE_POOL", 50);
  return filtered
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, poolLimit)
    .map((x) => x.r);
}

function termSet(text: string): string[] {
  const stop = new Set([
    "about", "after", "against", "also", "and", "are", "based", "between",
    "does", "effect", "effects", "from", "have", "into", "method", "using",
    "what", "when", "where", "which", "with", "without", "versus", "study",
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !stop.has(t))
    )
  ).slice(0, 40);
}

function countHits(text: string, terms: string[]): number {
  let n = 0;
  for (const term of terms) {
    if (text.includes(term)) n++;
  }
  return n;
}

function domainRelevanceTerms(profile: DomainProfile): string[] {
  if (profile.id === "chemistry_cosmetics") {
    return [
      "active", "absorption", "ascorbic", "caffeine", "confocal", "corneum",
      "cosmetic", "cream", "dermal", "diffusion", "epidermis", "formulation",
      "franz", "hplc", "ingredient", "penetration", "percutaneous", "permeation",
      "raman", "retinoic", "retinol", "skin", "stratum", "sunscreen", "tape",
      "topical", "vehicle", "vitamin",
    ];
  }
  if (profile.id === "llm_infra") {
    return [
      "attention", "benchmark", "cache", "context", "gpu", "inference", "kv",
      "latency", "llm", "model", "quantization", "throughput", "token", "vllm",
      "vram",
    ];
  }
  if (profile.id === "battery_materials") {
    return [
      "aging", "anode", "battery", "calendar", "capacity", "cathode", "cell",
      "cycle", "electrolyte", "impedance", "lithium", "retention", "sei",
      "soc",
    ];
  }
  if (profile.id === "biomedical_clinical") {
    return [
      "clinical", "cohort", "dose", "endpoint", "guideline", "intervention",
      "patient", "population", "safety", "trial", "treatment",
    ];
  }
  return [];
}

function weakHostPenalty(url: string, profile: DomainProfile): number {
  const u = url.toLowerCase();
  if (/amazon|ebay|walmart|shopify|\/shop\/|\/product\/|\/collections?\//.test(u)) {
    return 100;
  }
  if (profile.id === "chemistry_cosmetics") {
    if (/healthline|webmd|byrdie|stylecraze|makeupalley|skincare|beauty|allure/.test(u)) {
      return 80;
    }
  }
  if (/quora|pinterest|facebook|instagram|tiktok/.test(u)) return 80;
  return 0;
}

// --- utils ---

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  if (Number.isFinite(value) && value > 0) return Math.floor(value);
  return fallback;
}

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
