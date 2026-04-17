import { generateJson } from "./llm";
import { config } from "./config";
import { ClaimExtractionSchema, type Claim } from "./schemas/claim";
import type { ResearchPlan } from "./schemas/plan";
import type { SourceIndex, SearchResult } from "./schemas/source";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { scoreSource, tierLabel, sortByTier } from "./sourcing";

const EVIDENCE_SYSTEM = `You are an evidence extraction specialist. Convert harvester-extracted LEARNINGS into formal CLAIMS linked to specific sources.

## A claim vs a learning

- A learning is just a fact ("KIVI achieves 2-bit quantization with near-zero perplexity loss").
- A claim is a learning POSITIONED AGAINST the hypothesis ("supports H1", "contradicts H1", or "neutral context"), tied to the specific source URL that contains it, with a confidence score.

## Output requirements

1. COVERAGE: Extract 15-25 claims per task — one claim per DISTINCT fact. Do NOT merge different methods/results into a single claim.
2. DIVERSITY: If learnings mention distinct methods (TurboQuant, KIVI, KVQuant, MiniKV, KV-Compress, CSKV, Kitty, AKVQ-VL, Coupled Quantization, PagedAttention, R-KV, Q4_K_M, AWQ, GPTQ, NVFP4, FP8, INT4, BF16), create a SEPARATE claim for EACH — list at the top of your mental model and check them off.
3. NEGATIVE CLAIMS REQUIRED: For each task, include AT LEAST 1 claim of type "contradicts" if ANY learning reports a failure, limitation, counter-example, or negative result. Research without contradictions is suspect.
4. NUMERIC PRIORITY: Every claim SHOULD contain a specific number, model name, or dataset name. If a learning has no specifics, rank its confidence <= 0.5 and consider skipping.
5. SOURCE ATTRIBUTION:
   - Each claim cites EXACTLY ONE source URL.
   - STRONGLY PREFER [primary] > [official] > [code] > [blog] > [community]. Catalog is sorted best-first.
   - Use exact_quote = the learning text VERBATIM (do not paraphrase).
   - title = the source's title from the catalog.

## Confidence calibration

- 0.9-1.0: Exact number from peer-reviewed paper on canonical benchmark for named model.
- 0.7-0.9: Specific claim with number OR named benchmark, from primary source.
- 0.5-0.7: Qualitative but specific (named method, named model, but no benchmark number).
- 0.3-0.5: Single-source blog claim, vague benchmark.
- <0.3: Filter out — do not extract.

## Anti-patterns

- DO NOT invent facts not present in learnings.
- DO NOT merge "INT4 quantization works for Llama AND Gemma" into one claim if source only says it for Llama.
- DO NOT extract claims without at least one from the method-pool when learnings contain them.
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
  // Strategy: find any source whose scraped content contains at least a substantial chunk of the learning.
  const normLearning = learning.toLowerCase().replace(/\s+/g, " ").trim();
  const keyPhrase = normLearning.slice(0, Math.min(60, normLearning.length));

  for (const src of sources) {
    const content = loadFullContent(src.url, contentDir);
    if (!content) continue;
    const normContent = content.toLowerCase().replace(/\s+/g, " ");
    if (normContent.includes(keyPhrase)) return src;
  }

  // Fallback: first source with matching title keywords
  const words = normLearning.split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
  for (const src of sources) {
    const title = (src.title ?? "").toLowerCase();
    const matches = words.filter((w) => title.includes(w)).length;
    if (matches >= 2) return src;
  }

  // Last resort: first source
  return sources[0] ?? null;
}

export async function extractEvidence(
  plan: ResearchPlan,
  projectDir: string
): Promise<Claim[]> {
  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  const sourceFiles = readdirSync(sourcesDir).filter(
    (f) => f.startsWith("T") && f.endsWith(".json")
  );

  const allClaims: Claim[] = [];
  let claimCounter = 0;

  for (const file of sourceFiles) {
    const sourceIndex: SourceIndex = JSON.parse(
      readFileSync(join(sourcesDir, file), "utf-8")
    );
    if (sourceIndex.results.length === 0) continue;

    const hypothesis = plan.hypotheses.find(
      (h) => h.id === sourceIndex.hypothesis_id
    );
    if (!hypothesis) continue;

    const learnings: string[] = (sourceIndex as any).learnings ?? [];
    if (learnings.length === 0) {
      console.log(`[evidence] ${sourceIndex.task_id}: skipped (no learnings)`);
      continue;
    }

    // Build compact source catalog (title + url + tier), sorted primary-first
    const sortedResults = sortByTier(sourceIndex.results, (r) => r.url);
    const sourceCatalog = sortedResults
      .map((r, i) => `[S${i + 1}] [${tierLabel(scoreSource(r.url))}] ${r.title}\n  ${r.url}`)
      .join("\n");

    const tierCounts: Record<string, number> = {};
    for (const r of sourceIndex.results) {
      const t = tierLabel(scoreSource(r.url));
      tierCounts[t] = (tierCounts[t] ?? 0) + 1;
    }

    const learningsBlock = learnings
      .map((l, i) => `L${i + 1}. ${l}`)
      .join("\n");

    const prompt = `Hypothesis ${hypothesis.id}: "${hypothesis.statement}"

Task: ${sourceIndex.task_id}

LEARNINGS extracted by harvester from full scraped content (${learnings.length}):
${learningsBlock}

SOURCES consulted (${sourceIndex.results.length} URLs):
${sourceCatalog}

For each learning, produce a claim:
- statement: the learning text (may be lightly rephrased but keep all numbers/names)
- type: supports | contradicts | neutral (relative to hypothesis)
- confidence: 0.0-1.0
- references: array with {url, title, exact_quote=the learning text verbatim}; pick the most plausible source URL from the catalog

Start claim IDs from C${claimCounter + 1}. Output JSON only.`;

    console.log(
      `[evidence] ${sourceIndex.task_id}: ${learnings.length} learnings, ${sourceIndex.results.length} sources (${Object.entries(tierCounts).map(([t, n]) => `${t}:${n}`).join(" ")}) → ${hypothesis.id}`
    );

    try {
      const { object } = await generateJson({
        schema: ClaimExtractionSchema,
        system: EVIDENCE_SYSTEM,
        prompt,
        temperature: 0.2,
        endpoint: config.endpoints.evidence,
      });

      // Post-process: ensure each claim's reference URL is in the actual sources catalog,
      // and attach the best matching source via our substring heuristic if LLM picked wrong.
      for (const claim of object.claims) {
        claimCounter++;
        claim.id = `C${claimCounter}`;
        claim.hypothesis_id = hypothesis.id;

        // Validate + fix references
        const validRefs = [];
        for (const ref of claim.references ?? []) {
          // If LLM's URL matches a known source, keep it
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
              exact_quote: ref.exact_quote ?? claim.statement,
            });
          } else {
            // LLM made up URL — pin to best-matching real source
            const best = findBestSourceForLearning(
              claim.statement,
              sourceIndex.results,
              contentDir
            );
            if (best) {
              validRefs.push({
                url: best.url,
                title: best.title,
                exact_quote: claim.statement,
              });
            }
          }
        }
        if (validRefs.length === 0) {
          // No refs at all — attach best-guess source
          const best = findBestSourceForLearning(
            claim.statement,
            sourceIndex.results,
            contentDir
          );
          if (best) {
            validRefs.push({
              url: best.url,
              title: best.title,
              exact_quote: claim.statement,
            });
          }
        }
        claim.references = validRefs;

        allClaims.push(claim);
      }

      console.log(
        `[evidence]   ${sourceIndex.task_id}: +${object.claims.length} claims`
      );
    } catch (err: any) {
      console.warn(
        `[evidence]   ${sourceIndex.task_id} failed: ${err.message?.slice(0, 100)}`
      );
    }
  }

  // Dedup by statement similarity (first 120 chars)
  const seen = new Set<string>();
  const deduped = allClaims.filter((c) => {
    const key = c.statement.toLowerCase().trim().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const claimsPath = join(projectDir, "claims.json");
  writeFileSync(claimsPath, JSON.stringify(deduped, null, 2));
  console.log(
    `[evidence] Total: ${deduped.length} unique claims (${allClaims.length - deduped.length} duplicates)`
  );
  console.log(`[evidence] Written: ${claimsPath}`);

  return deduped;
}
