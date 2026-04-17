import { generateJson } from "./llm";
import { ClaimExtractionSchema, type Claim } from "./schemas/claim";
import type { ResearchPlan } from "./schemas/plan";
import type { SourceIndex, SearchResult } from "./schemas/source";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { scoreSource, tierLabel, sortByTier } from "./sourcing";

const EVIDENCE_SYSTEM = `You are an evidence extraction specialist. You receive HARVESTER-EXTRACTED LEARNINGS (already distilled factual statements from full scraped source content) plus the list of source URLs/titles they came from.

Your job: convert these learnings into formal claims linked to specific sources.

Rules:
- Extract a COMPREHENSIVE set of claims — aim for 15-25 claims per task. Err toward MORE claims, not fewer.
- PRIORITIZE DIVERSITY: if multiple learnings mention distinct methods, frameworks, models, or benchmarks (e.g. KIVI, KVQuant, MiniKV, PagedAttention, GPTQ, AWQ, TurboQuant, TensorRT-LLM, vLLM, WikiText, GSM8K, LongBench), create a SEPARATE claim for each — do NOT merge them.
- Include claims even about methods with only 1-2 supporting learnings. Rare-but-specific claims are valuable evidence.
- Each claim must cite a specific source URL (from the list).
- STRONGLY PREFER sources tagged [primary] or [official] over [blog] or [community]. The catalog is sorted best-first.
- Use exact_quote = the learning text verbatim.
- Mark each claim as "supports", "contradicts", or "neutral" relative to the hypothesis.
- Set confidence 0.0-1.0 based on specificity.
- Do NOT invent claims. Only use what's in the learnings list.
- Output JSON only matching the schema.`;

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
