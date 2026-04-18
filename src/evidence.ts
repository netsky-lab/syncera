import { generateJson } from "./llm";
import { config } from "./config";
import { FactExtractionSchema, type Fact } from "./schemas/fact";
import type { ResearchPlan } from "./schemas/plan";
import type { SourceIndex, SearchResult } from "./schemas/source";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { scoreSource, tierLabel, sortByTier } from "./sourcing";
import { z } from "zod";

// Extract a list of distinct named entities from learnings before fact
// extraction, then require the extractor to cover each.
async function extractMethodPool(learnings: string[]): Promise<string[]> {
  if (learnings.length === 0) return [];
  const prompt = `Below are factual learnings from a research subquestion. Identify ALL distinct methods, frameworks, models, benchmarks, and datasets mentioned by name. Do NOT include generic terms ("quantization", "inference") — only NAMED entities (e.g. "TurboQuant", "Llama-3", "WikiText-103", "vLLM", "NVFP4").

Return JSON: {"entities": ["Name1", "Name2", ...]}

Learnings:
${learnings.map((l, i) => `L${i + 1}. ${l.slice(0, 300)}`).join("\n")}`;

  try {
    const { object } = await generateJson({
      schema: z.object({ entities: z.array(z.string()) }),
      system:
        "You extract named technical entities from research notes. Only include proper-noun methods/models/benchmarks/datasets/frameworks. Be exhaustive — include rare and common alike.",
      prompt,
      temperature: 0,
      maxRetries: 1,
      endpoint: config.endpoints.evidence,
    });
    const dedup = new Map<string, string>();
    for (const e of object.entities) {
      const key = e.toLowerCase();
      if (!dedup.has(key) || dedup.get(key)!.length < e.length) dedup.set(key, e);
    }
    return Array.from(dedup.values()).filter((e) => e.length >= 2 && e.length <= 60);
  } catch (err: any) {
    console.warn(`[evidence] method-pool extraction failed: ${err.message?.slice(0, 80)}`);
    return [];
  }
}

const EVIDENCE_SYSTEM = `You are a fact extraction specialist. Convert harvester-collected LEARNINGS into structured FACTS that can be cited in a research report.

## A fact vs a learning

- A learning is a raw observation extracted from source prose ("KIVI achieves 2-bit quantization with near-zero perplexity loss on Llama-2-7B").
- A fact is that learning formalized with: the research subquestion it informs, the source URL that attests to it, a factuality classification (quantitative/qualitative/comparative/background), and a confidence score.

Crucially: facts are NOT tagged as supports/contradicts. This pipeline is QUESTION-FIRST — there is no pre-committed hypothesis to support or refute. Just report what the source says; the analyzer later surfaces tensions between facts.

## Output requirements

1. COVERAGE: Extract 15-25 facts per subquestion — one fact per DISTINCT piece of information. Do NOT merge different methods/results into a single fact.
2. DIVERSITY: If learnings mention distinct methods (TurboQuant, KIVI, KVQuant, MiniKV, KV-Compress, CSKV, Kitty, AKVQ-VL, Coupled Quantization, PagedAttention, R-KV, Q4_K_M, AWQ, GPTQ, NVFP4, FP8, INT4, BF16), create a SEPARATE fact for EACH.
3. NUMERIC PRIORITY: Every fact SHOULD contain a specific number, model name, benchmark name, or dataset name. If a learning has no specifics, rank its confidence <=0.5 and skip unless it's a named-entity anchor (background category).
4. SOURCE ATTRIBUTION:
   - Each fact cites EXACTLY ONE source URL from the catalog.
   - STRONGLY PREFER [primary] > [official] > [code] > [blog] > [community]. Catalog is sorted best-first.
   - exact_quote = the learning text VERBATIM (do not paraphrase).
   - title = the source's title from the catalog.

## Factuality categories

- quantitative: contains a specific number (percentages, ratios, latencies, bit-widths)
- qualitative: names a mechanism or capability without a number ("KIVI uses per-channel keys")
- comparative: direct comparison between two methods / models ("GPTQ 8-19% faster than AWQ on RTX 5090")
- background: framework / format / anchor mention without numbers (Q4_K_M, TensorRT-LLM, PagedAttention as context)

## Confidence calibration

- 0.9-1.0: Exact number from peer-reviewed paper on canonical benchmark for named model.
- 0.7-0.9: Specific claim with number OR named benchmark, from primary source.
- 0.5-0.7: Qualitative but specific (named method, named model, but no benchmark number).
- 0.3-0.5: Single-source blog claim, vague benchmark.
- <0.3: Filter out — do not extract.

## COMPARATIVE-METHOD COVERAGE (critical)

Research papers compare a hero method against 3-8 baselines in tables. Extract a DISTINCT fact for EACH non-hero method the paper reports a number for — even if that method is "background". Readers need the whole landscape.

Also extract BACKGROUND mentions even without numbers: if a paper names a framework (TensorRT-LLM, llama.cpp), format (Q4_K_M, Q4_0, GGUF), or well-known method (PagedAttention, FlashAttention) in its related-work or setup, include at least one fact naming that entity as factuality="background".

## Anti-patterns

- DO NOT invent facts not present in learnings.
- DO NOT merge "INT4 works for Llama AND Gemma" if source only says it for Llama.
- DO NOT extract without at least one fact per named entity when learnings contain them.
- DO NOT pad confidence scores (vague = low score).

Output JSON only matching the schema.`;

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (
    Math.abs(h).toString(36) +
    "-" +
    url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-")
  );
}

function loadFullContent(url: string, contentDir: string): string | null {
  const p = join(contentDir, `${hashUrl(url)}.md`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

// Find the source URL most likely to contain this learning — simple substring heuristic.
function findBestSourceForLearning(
  learning: string,
  sources: SearchResult[],
  contentDir: string
): SearchResult | null {
  const normLearning = learning.toLowerCase().replace(/\s+/g, " ").trim();
  const keyPhrase = normLearning.slice(0, Math.min(60, normLearning.length));

  for (const src of sources) {
    const content = loadFullContent(src.url, contentDir);
    if (!content) continue;
    const normContent = content.toLowerCase().replace(/\s+/g, " ");
    if (normContent.includes(keyPhrase)) return src;
  }

  const words = normLearning.split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
  for (const src of sources) {
    const title = (src.title ?? "").toLowerCase();
    const matches = words.filter((w) => title.includes(w)).length;
    if (matches >= 2) return src;
  }

  return sources[0] ?? null;
}

export async function extractEvidence(
  plan: ResearchPlan,
  projectDir: string
): Promise<Fact[]> {
  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  // Subquestion cache files follow pattern Q<n>-S<m>.json or Q<n>.<m>.json
  const sourceFiles = readdirSync(sourcesDir).filter(
    (f) => /^Q\d+([-.]S?\d+)?\.json$/.test(f)
  );

  // Run subquestions in parallel with bounded concurrency.
  // Qwen endpoint has 5 slots; verify runs after so evidence may use all 5.
  const EVIDENCE_CONCURRENCY = 3;
  const allFacts: Fact[] = [];
  const unitResults: Array<{ subquestionId: string; facts: Fact[] }> = [];

  async function processUnit(file: string): Promise<void> {
    const sourceIndex: SourceIndex = JSON.parse(
      readFileSync(join(sourcesDir, file), "utf-8")
    );
    if (sourceIndex.results.length === 0) return;

    const learnings: string[] = (sourceIndex as any).learnings ?? [];
    if (learnings.length === 0) {
      console.log(`[evidence] ${sourceIndex.subquestion_id}: skipped (no learnings)`);
      return;
    }

    const methodPool = await Promise.race([
      extractMethodPool(learnings),
      new Promise<string[]>((resolve) =>
        setTimeout(() => {
          console.warn(
            `[evidence] ${sourceIndex.subquestion_id}: method-pool timeout (60s) — skipping`
          );
          resolve([]);
        }, 60_000)
      ),
    ]);
    if (methodPool.length > 0) {
      console.log(
        `[evidence] ${sourceIndex.subquestion_id}: method-pool (${methodPool.length}): ${methodPool.slice(0, 8).join(", ")}${methodPool.length > 8 ? "..." : ""}`
      );
    }

    const sortedResults = sortByTier(sourceIndex.results, (r) => r.url);
    const sourceCatalog = sortedResults
      .map(
        (r, i) => `[S${i + 1}] [${tierLabel(scoreSource(r.url))}] ${r.title}\n  ${r.url}`
      )
      .join("\n");

    const tierCounts: Record<string, number> = {};
    for (const r of sourceIndex.results) {
      const t = tierLabel(scoreSource(r.url));
      tierCounts[t] = (tierCounts[t] ?? 0) + 1;
    }

    const learningsBlock = learnings
      .map((l, i) => `L${i + 1}. ${l}`)
      .join("\n");

    const methodPoolBlock =
      methodPool.length > 0
        ? `\nREQUIRED COVERAGE — every one of these named entities from the learnings MUST be cited by at least one fact if the learnings support it. Miss none:\n${methodPool
            .map((m) => `  - ${m}`)
            .join("\n")}\n`
        : "";

    const question = plan.questions.find((q) => q.id === sourceIndex.question_id);
    const subquestion = question?.subquestions.find(
      (s) => s.id === sourceIndex.subquestion_id
    );
    const questionContext = question
      ? `Research question ${question.id} [${question.category}]: ${question.question}\nSubquestion ${subquestion?.id ?? sourceIndex.subquestion_id} [${subquestion?.angle ?? ""}]: ${subquestion?.text ?? ""}`
      : `Subquestion ${sourceIndex.subquestion_id}`;

    const prompt = `${questionContext}
${methodPoolBlock}
LEARNINGS extracted by harvester from full scraped content (${learnings.length}):
${learningsBlock}

SOURCES consulted (${sourceIndex.results.length} URLs):
${sourceCatalog}

For each learning, produce a fact:
- statement: the learning text (may be lightly rephrased but keep all numbers/names)
- factuality: quantitative | qualitative | comparative | background
- confidence: 0.0-1.0
- question_id: ${sourceIndex.question_id}
- subquestion_id: ${sourceIndex.subquestion_id}
- references: array with {url, title, exact_quote=the learning text verbatim}; pick the most plausible source URL from the catalog

Output JSON only (fact IDs will be assigned after all subquestions finish).`;

    console.log(
      `[evidence] ${sourceIndex.subquestion_id}: ${learnings.length} learnings, ${sourceIndex.results.length} sources (${Object.entries(tierCounts)
        .map(([t, n]) => `${t}:${n}`)
        .join(" ")}) → ${sourceIndex.question_id}`
    );

    try {
      const { object } = await generateJson({
        schema: FactExtractionSchema,
        system: EVIDENCE_SYSTEM,
        prompt,
        temperature: 0.2,
        endpoint: config.endpoints.evidence,
      });

      const unitFacts: Fact[] = [];
      for (const fact of object.facts) {
        fact.question_id = sourceIndex.question_id;
        fact.subquestion_id = sourceIndex.subquestion_id;

        const validRefs = [];
        for (const ref of fact.references ?? []) {
          const matchingSrc = sourceIndex.results.find(
            (s) =>
              s.url === ref.url ||
              ref.url?.includes(s.url) ||
              s.url?.includes(ref.url)
          );
          if (matchingSrc) {
            validRefs.push({
              url: matchingSrc.url,
              title: matchingSrc.title,
              exact_quote: ref.exact_quote ?? fact.statement,
            });
          } else {
            const best = findBestSourceForLearning(
              fact.statement,
              sourceIndex.results,
              contentDir
            );
            if (best) {
              validRefs.push({
                url: best.url,
                title: best.title,
                exact_quote: fact.statement,
              });
            }
          }
        }
        if (validRefs.length === 0) {
          const best = findBestSourceForLearning(
            fact.statement,
            sourceIndex.results,
            contentDir
          );
          if (best) {
            validRefs.push({
              url: best.url,
              title: best.title,
              exact_quote: fact.statement,
            });
          }
        }
        fact.references = validRefs;

        unitFacts.push(fact);
      }

      unitResults.push({ subquestionId: sourceIndex.subquestion_id, facts: unitFacts });
      console.log(
        `[evidence]   ${sourceIndex.subquestion_id}: +${unitFacts.length} facts`
      );
    } catch (err: any) {
      console.warn(
        `[evidence]   ${sourceIndex.subquestion_id} failed: ${err.message?.slice(0, 100)}`
      );
    }
  }

  const queue = [...sourceFiles];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < EVIDENCE_CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) return;
          await processUnit(file);
        }
      })()
    );
  }
  await Promise.all(workers);

  // Assign sequential fact IDs in stable subquestion order (Q1.1, Q1.2, Q2.1, ...)
  unitResults.sort((a, b) => a.subquestionId.localeCompare(b.subquestionId, undefined, { numeric: true }));
  let counter = 0;
  for (const unit of unitResults) {
    for (const fact of unit.facts) {
      counter++;
      fact.id = `F${counter}`;
      allFacts.push(fact);
    }
  }

  // Dedup by statement similarity (first 120 chars)
  const seen = new Set<string>();
  const deduped = allFacts.filter((f) => {
    const key = f.statement.toLowerCase().trim().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const factsPath = join(projectDir, "facts.json");
  writeFileSync(factsPath, JSON.stringify(deduped, null, 2));
  console.log(
    `[evidence] Total: ${deduped.length} unique facts (${allFacts.length - deduped.length} duplicates)`
  );
  console.log(`[evidence] Written: ${factsPath}`);

  return deduped;
}
