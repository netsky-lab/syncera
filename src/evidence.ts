import { generateJson } from "./llm";
import { config } from "./config";
import { FactExtractionSchema, type Fact } from "./schemas/fact";
import type { ResearchPlan } from "./schemas/plan";
import type { SourceIndex, SearchResult } from "./schemas/source";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { scoreSource, tierLabel, sortByTier } from "./sourcing";
import {
  detectDomainProfile,
  entityExamples,
  evidenceGuidanceBlock,
  type DomainProfile,
} from "./domain-profile";
import {
  adjustedConfidenceForTrust,
  readSourceStatus,
  sourceTrustForUrl,
} from "./source-status";
import { z } from "zod";

// Extract a list of distinct named entities from learnings before fact
// extraction, then require the extractor to cover each.
async function extractMethodPool(
  learnings: string[],
  domainProfile: DomainProfile
): Promise<string[]> {
  if (learnings.length === 0) return [];
  const prompt = `Below are factual learnings from a research subquestion. Identify ALL distinct named entities that the final facts should preserve.

Domain profile: ${domainProfile.label}
Examples of valid named entities in this domain: ${entityExamples(domainProfile)}

Include methods, frameworks, models, benchmarks, datasets, standards, compounds, ingredients, materials, interventions, populations, guidelines, regulations, or hardware when they are named in the learnings.
Do NOT include generic field terms unless they are named standards or named measures.

Return JSON: {"entities": ["Name1", "Name2", ...]}

Learnings:
${learnings.map((l, i) => `L${i + 1}. ${l.slice(0, 300)}`).join("\n")}`;

  try {
    const { object } = await generateJson({
      schema: z.object({ entities: z.array(z.string()) }),
      system:
        "You extract named domain entities from research notes. Be exhaustive, but exclude generic terms that are not named entities.",
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

- A learning is a raw observation extracted from source prose ("Method A reports outcome X under setup Y").
- A fact is that learning formalized with: the research subquestion it informs, the source URL that attests to it, a factuality classification (quantitative/qualitative/comparative/background), and a confidence score.

Crucially: facts are NOT tagged as supports/contradicts. This pipeline is QUESTION-FIRST — there is no pre-committed hypothesis to support or refute. Just report what the source says; the analyzer later surfaces tensions between facts.

## Output requirements

1. COVERAGE: Across a full subquestion, target 15-25 facts — one fact per DISTINCT piece of information. If the caller provides a small learning batch, extract only the facts supported by that batch; do NOT pad to 15-25.
2. DIVERSITY: If learnings mention distinct named methods, compounds, ingredients, standards, datasets, models, benchmarks, populations, materials, or interventions, create a SEPARATE fact for EACH where the learnings support it.
3. NUMERIC PRIORITY: Every fact SHOULD contain a specific number, model name, benchmark name, or dataset name. If a learning has no specifics, rank its confidence <=0.5 and skip unless it's a named-entity anchor (background category).
4. SOURCE ATTRIBUTION:
   - Each fact cites EXACTLY ONE source URL from the catalog.
   - STRONGLY PREFER [primary] > [official] > [code] > [blog] > [community]. Catalog is sorted best-first.
   - exact_quote = the learning text VERBATIM (do not paraphrase).
   - title = the source's title from the catalog.

## Factuality categories

- quantitative: contains a specific number (percentages, ratios, latencies, bit-widths, sample sizes, concentrations, effect sizes)
- qualitative: names a mechanism, property, or capability without a number
- comparative: direct comparison between two methods, products, populations, materials, models, treatments, or conditions
- background: framework / format / standard / ingredient / dataset / anchor mention without numbers

## Confidence calibration

- 0.9-1.0: Exact number from peer-reviewed paper on canonical benchmark for named model.
- 0.7-0.9: Specific claim with number OR named benchmark, from primary source.
- 0.5-0.7: Qualitative but specific (named method, named model, but no benchmark number).
- 0.3-0.5: Single-source blog claim, vague benchmark.
- <0.3: Filter out — do not extract.

## COMPARATIVE-METHOD COVERAGE (critical)

Research papers and technical reports often compare a focal method/product/intervention against baselines, comparators, controls, or prior standards. Extract a DISTINCT fact for EACH comparator with a reported result — even if that comparator is "background". Readers need the whole landscape.

Also extract BACKGROUND mentions even without numbers when they anchor the research landscape: named standards, frameworks, ingredients, datasets, cell chemistries, guidelines, or canonical methods.

## Anti-patterns

- DO NOT invent facts not present in learnings.
- DO NOT merge "A works for X AND Y" if source only says it for X.
- DO NOT extract without at least one fact per named entity when learnings contain them.
- DO NOT pad confidence scores (vague = low score).

## ATTRIBUTION (critical — verifier will reject misattributed facts)

The source URL you pick for a fact MUST be a source that discusses that fact's primary named entity (method / model / benchmark / framework / ingredient / material / intervention / standard / population). A learning's mere presence in the subquestion batch does NOT imply every source in the catalog attests to it.

Rule of thumb: scan the CATALOG TITLES. A fact about entity X should cite a source whose title or scraped content clearly discusses entity X or the exact same line of work — NOT a broad survey that happens to be in the same batch. If no catalog source clearly covers the fact's named entity, DO NOT extract that fact — a mis-attributed fact costs more than a missing one.

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

// Extract the most specific named entity from a fact statement. Matches
// hyphenated model names ("Llama-3.1-8B"), CamelCase methods ("TurboQuant",
// "MiKV"), and acronyms ("AWQ", "NVFP4"). Returns the longest match — longer
// names are more specific and less likely to accidentally appear in unrelated
// sources.
export function extractPrimaryEntity(statement: string): string | null {
  // Prefer method names (CamelCase, hyphenated-with-KV-or-Quant stems) over
  // model names (Llama-X, Qwen-X) because a paper is ABOUT a method and
  // tested ON models. Attribution check is strongest on the method.
  const blocklist = new Set([
    "GPU", "CPU", "LLM", "KV", "API", "JSON", "HTTP", "URL", "MoE",
    "VRAM", "RAM", "CUDA", "HBM", "PCIE", "NVIDIA", "AMD",
  ]);
  const methodPats = [
    /\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b/g,      // CamelCase: TurboQuant, MiKV, VecInfer
    /\b[A-Z][A-Za-z0-9]*(?:KV|Quant|Cache|Attn|Attention)[A-Za-z0-9]*\b/g, // KV-method stems
    /\b[A-Z]{3,}[0-9]*\b/g,                    // ACRONYM: AWQ, GPTQ, NVFP4
  ];
  for (const pat of methodPats) {
    const matches = (statement.match(pat) ?? []).filter((c) => !blocklist.has(c));
    if (matches.length > 0) {
      matches.sort((a, b) => b.length - a.length);
      return matches[0] ?? null;
    }
  }
  // Fallback: hyphenated (Llama-3.1-8B, KV-Compress) — picks model when
  // nothing more specific is available. Allow dots inside so "Llama-3.1-8B"
  // matches as a single entity instead of truncating to "Llama-3".
  const hyphenated = (statement.match(/\b[A-Z][a-zA-Z0-9]+(?:[-.][A-Za-z0-9]+)+\b/g) ?? []).filter(
    (c) => !blocklist.has(c)
  );
  if (hyphenated.length > 0) {
    hyphenated.sort((a, b) => b.length - a.length);
    return hyphenated[0] ?? null;
  }
  return null;
}

export function contentContainsEntity(content: string, entity: string): boolean {
  const normEntity = entity.toLowerCase().replace(/[-\s]/g, "");
  const normContent = content.toLowerCase().replace(/[-\s]/g, "");
  return normContent.includes(normEntity);
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export async function extractEvidence(
  plan: ResearchPlan,
  projectDir: string
): Promise<Fact[]> {
  const domainProfile = detectDomainProfile(plan.topic, plan.constraints);
  const evidenceSystem = `${EVIDENCE_SYSTEM}\n\n${evidenceGuidanceBlock(domainProfile)}`;
  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  const sourceStatus = readSourceStatus(projectDir);
  // Subquestion cache files — the LLM picks the ID shape, so accept any
  // filename that looks like a research-unit: starts with Q or SQ (any
  // case), has digits + optional separators + digits, and ends in .json.
  // Known shapes so far: Q1.json, Q1.1.json, Q1-S1.json, SQ1.1.json.
  // Also accept legacy T<n>.json (hypothesis-first re-runs).
  const sourceFiles = readdirSync(sourcesDir).filter(
    (f) => /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)
  );

  // Run subquestions in parallel with bounded, provider-aware concurrency.
  const EVIDENCE_CONCURRENCY = config.concurrency.evidence;
  const allFacts: Fact[] = [];
  const unitResults: Array<{ subquestionId: string; facts: Fact[] }> = [];
  let attributionRepaired = 0;
  let attributionUnresolved = 0;

  async function processUnit(file: string): Promise<void> {
    const sourceIndex: SourceIndex = JSON.parse(
      readFileSync(join(sourcesDir, file), "utf-8")
    );
    if (sourceIndex.results.length === 0) return;

    const activeSources = sourceIndex.results.filter(
      (r) => sourceTrustForUrl(sourceStatus, r.url) !== "ignored"
    );
    const skippedBySourceTrust = sourceIndex.results.length - activeSources.length;
    if (activeSources.length === 0) {
      console.log(
        `[evidence] ${sourceIndex.subquestion_id}: skipped (${skippedBySourceTrust} sources ignored by source trust)`
      );
      return;
    }

    const learnings: string[] = (sourceIndex as any).learnings ?? [];
    if (learnings.length === 0) {
      console.log(`[evidence] ${sourceIndex.subquestion_id}: skipped (no learnings)`);
      return;
    }

    const methodPool = await Promise.race([
      extractMethodPool(learnings, domainProfile),
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

    // Relevance gate filter: keep only on/partial with usefulness >= 1.
    // If gate hasn't run (legacy projects), keep everything — verifier
    // is still the final safety net.
    const relevanceFiltered = activeSources.filter((r) => {
      if (!r.relevance) return true; // gate never ran — fall through
      return r.relevance.usefulness >= 1;
    });
    const skippedByRelevance =
      sourceIndex.results.length - relevanceFiltered.length;

    // Order: first by relevance usefulness (higher = better), then by
    // source tier (primary > blog > community). Extractor takes the best
    // first, bails on token budget.
    const orderedResults = [...relevanceFiltered].sort((a, b) => {
      const at = sourceTrustForUrl(sourceStatus, a.url);
      const bt = sourceTrustForUrl(sourceStatus, b.url);
      const trustScore = (t: string) =>
        t === "trusted" ? 0 : t === "unreviewed" ? 1 : 2;
      if (trustScore(at) !== trustScore(bt)) {
        return trustScore(at) - trustScore(bt);
      }
      const au = a.relevance?.usefulness ?? 1;
      const bu = b.relevance?.usefulness ?? 1;
      if (au !== bu) return bu - au;
      return scoreSource(a.url) - scoreSource(b.url);
    });

    const sortedResults = orderedResults;
    const maxCatalogSources = positiveIntEnv("EVIDENCE_CATALOG_SOURCES", 24);
    const catalogResults = sortedResults.slice(0, maxCatalogSources);
    const sourceCatalog = catalogResults
      .map(
        (r, i) => {
          const tier = tierLabel(scoreSource(r.url));
          const trust = sourceTrustForUrl(sourceStatus, r.url);
          const useful = r.relevance
            ? `, usefulness=${r.relevance.usefulness}`
            : "";
          const trustNote = trust !== "unreviewed" ? `, trust=${trust}` : "";
          return `[S${i + 1}] [${tier}${useful}${trustNote}] ${r.title}\n  ${r.url}`;
        }
      )
      .join("\n");

    const tierCounts: Record<string, number> = {};
    for (const r of sortedResults) {
      const t = tierLabel(scoreSource(r.url));
      tierCounts[t] = (tierCounts[t] ?? 0) + 1;
    }
    if (skippedByRelevance > 0) {
      console.log(
        `[evidence] ${sourceIndex.subquestion_id}: ${skippedByRelevance} sources skipped by relevance gate`
      );
    }
    if (skippedBySourceTrust > 0) {
      console.log(
        `[evidence] ${sourceIndex.subquestion_id}: ${skippedBySourceTrust} sources skipped by source trust`
      );
    }

    const learningBatchSize = positiveIntEnv("EVIDENCE_LEARNINGS_PER_BATCH", 5);
    const learningBatches = chunk(learnings, learningBatchSize);

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

    const unitFacts: Fact[] = [];
    for (let batchIndex = 0; batchIndex < learningBatches.length; batchIndex++) {
      const batchLearnings = learningBatches[batchIndex]!;
      const learningsBlock = batchLearnings
        .map((l, i) => `L${batchIndex * learningBatchSize + i + 1}. ${l}`)
        .join("\n");

      const prompt = `${questionContext}
${methodPoolBlock}
LEARNING BATCH ${batchIndex + 1}/${learningBatches.length} from full scraped content (${batchLearnings.length} of ${learnings.length}):
${learningsBlock}

SOURCES consulted (${sortedResults.length} active URLs, ${skippedBySourceTrust} ignored; showing top ${catalogResults.length}):
${sourceCatalog}

For each learning in this batch, produce 1-2 facts only if the source catalog can plausibly support them:
- statement: the learning text (may be lightly rephrased but keep all numbers/names)
- factuality: quantitative | qualitative | comparative | background
- confidence: 0.0-1.0
- question_id: ${sourceIndex.question_id}
- subquestion_id: ${sourceIndex.subquestion_id}
- references: array with {url, title, exact_quote=the learning text verbatim}; pick the most plausible source URL from the catalog

Output JSON only (fact IDs will be assigned after all subquestions finish).`;

      console.log(
        `[evidence] ${sourceIndex.subquestion_id}: batch ${batchIndex + 1}/${learningBatches.length}, ${batchLearnings.length} learnings, ${sourceIndex.results.length} sources (${Object.entries(tierCounts)
          .map(([t, n]) => `${t}:${n}`)
          .join(" ")}) → ${sourceIndex.question_id}`
      );

      try {
        const { object } = await generateJson({
          schema: FactExtractionSchema,
          system: evidenceSystem,
          prompt,
          temperature: 0.2,
          maxTokens: positiveIntEnv("EVIDENCE_MAX_TOKENS", 4096),
          endpoint: config.endpoints.evidence,
        });

        for (const fact of object.facts) {
          fact.question_id = sourceIndex.question_id;
          fact.subquestion_id = sourceIndex.subquestion_id;

          const validRefs = [];
          for (const ref of fact.references ?? []) {
            const matchingSrc = activeSources.find(
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
                activeSources,
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
              activeSources,
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

          // Attribution check — if the fact names a specific entity, require
          // that entity to appear in the cited source's scraped content. If
          // not, search other sources in this subquestion for a match; swap
          // URL if found, downgrade confidence otherwise. Cheaper than running
          // the L3 verifier on every fact.
          const entity = extractPrimaryEntity(fact.statement);
          if (entity && fact.references[0]) {
            const primary = fact.references[0];
            const primaryContent = loadFullContent(primary.url, contentDir);
            const primaryHasEntity =
              primaryContent && contentContainsEntity(primaryContent, entity);
            if (!primaryHasEntity) {
              const better = activeSources.find((s) => {
                if (s.url === primary.url) return false;
                const c = loadFullContent(s.url, contentDir);
                return c ? contentContainsEntity(c, entity) : false;
              });
              if (better) {
                fact.references[0] = {
                  url: better.url,
                  title: better.title,
                  exact_quote: fact.statement,
                };
                attributionRepaired++;
              } else {
                fact.confidence = Math.min(fact.confidence ?? 0.5, 0.3);
                attributionUnresolved++;
              }
            }
          }

          const trust = sourceTrustForUrl(sourceStatus, fact.references[0]?.url);
          fact.confidence = adjustedConfidenceForTrust(fact.confidence, trust);

          unitFacts.push(fact);
        }
        console.log(
          `[evidence]   ${sourceIndex.subquestion_id}: batch ${batchIndex + 1}/${learningBatches.length} +${object.facts.length} facts`
        );
      } catch (err: any) {
        console.warn(
          `[evidence]   ${sourceIndex.subquestion_id} batch ${batchIndex + 1}/${learningBatches.length} failed: ${err.message?.slice(0, 100)}`
        );
      }
    }

    unitResults.push({ subquestionId: sourceIndex.subquestion_id, facts: unitFacts });
    console.log(
      `[evidence]   ${sourceIndex.subquestion_id}: +${unitFacts.length} facts`
    );
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
  if (attributionRepaired > 0 || attributionUnresolved > 0) {
    console.log(
      `[evidence] Attribution check: repaired ${attributionRepaired}, unresolved ${attributionUnresolved} (confidence downgraded to 0.3)`
    );
  }
  console.log(`[evidence] Written: ${factsPath}`);

  return deduped;
}
