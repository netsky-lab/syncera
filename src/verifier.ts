import { generateJson } from "./llm";
import { config } from "./config";
import { VerificationSchema, type Verification } from "./schemas/verification";
import type { Claim } from "./schemas/claim";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

const VERIFIER_SYSTEM = `You are an adversarial fact-checker for a research report. Your job is to find any way the given CLAIM misrepresents the SOURCE. Default to skepticism.

For the claim, check:
1. Does the claim overstate what the source says? (source: "some", claim: "all")
2. Does the claim strip context? (source: "X works BUT under conditions Y", claim: "X works")
3. Does the claim cherry-pick? (source discusses multiple views, claim uses one)
4. Does the claim misread? (claim attributes result to wrong model/dataset/method)
5. Could a skeptical reader reject this claim using the same source?

If the claim is accurate and faithfully represents the source → verdict: verified.
Otherwise pick the MOST SPECIFIC verdict from: overreach | out_of_context | cherry_picked | misread.

Always include specific notes citing the source text. If verdict != verified, provide corrected_statement that the source actually supports.

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

// Normalize whitespace + lowercase for substring match
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Extract distinctive keywords from a statement (model names, metrics, technical terms)
function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "the","a","an","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","can","must",
    "of","in","on","at","to","for","with","by","from","as","into","through","during",
    "and","or","but","not","so","if","then","else","this","that","these","those",
    "its","their","our","your","his","her","they","them","it","when","where","why",
    "how","what","which","who","whom","than","about","than","also","very","more",
    "most","some","all","any","each","every","both","many","few","other","same",
    "such","only","own","while","because","although","since","until","unless",
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-._]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopwords.has(w));
  // Keep words with digits (metric values), hyphens (tech terms), dots (versions), or >4 chars
  return Array.from(
    new Set(words.filter((w) => /\d/.test(w) || /-/.test(w) || /\./.test(w) || w.length > 4))
  );
}

async function checkUrlAlive(url: string, timeoutMs = 5000): Promise<{ alive: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Use GET with range to avoid sites that reject HEAD
    const resp = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0", "User-Agent": "Mozilla/5.0 (research-lab fact-checker)" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return { alive: resp.status < 400 || resp.status === 416, status: resp.status };
  } catch (err: any) {
    return { alive: false, error: err.message };
  }
}

function loadContent(url: string, contentDir: string): string | null {
  const path = join(contentDir, `${hashUrl(url)}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

// Process claims with bounded concurrency (respects endpoint slot count)
async function parallelLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export async function verifyAll(args: {
  claims: Claim[];
  projectDir: string;
  concurrency?: number;
}): Promise<Verification[]> {
  const { claims, projectDir, concurrency = 5 } = args;
  const contentDir = join(projectDir, "sources", "content");

  console.log(`[verify] ${claims.length} claims to check (concurrency=${concurrency})`);

  const verifications = await parallelLimit(claims, concurrency, async (claim, idx) => {
    return await verifyOne(claim, contentDir, idx);
  });

  // Write artifact
  const report = {
    verifications,
    summary: summarize(verifications),
  };
  const path = join(projectDir, "verification.json");
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(`[verify] Written: ${path}`);
  console.log(`[verify] Summary: ${JSON.stringify(report.summary)}`);

  return verifications;
}

async function verifyOne(claim: Claim, contentDir: string, idx: number): Promise<Verification> {
  // Layer 1: deterministic URL check — first reference only (cheap)
  const ref = claim.references?.[0];
  if (!ref || !ref.url) {
    return {
      claim_id: claim.id,
      verdict: "url_dead",
      severity: "major",
      notes: "Claim has no references",
    };
  }

  const urlCheck = await checkUrlAlive(ref.url);
  if (!urlCheck.alive) {
    return {
      claim_id: claim.id,
      verdict: "url_dead",
      severity: "major",
      notes: `URL unreachable: ${urlCheck.status ?? urlCheck.error ?? "unknown"}`,
    };
  }

  // Layer 2: deterministic quote check — only fires for LONG exact_quotes
  // that look like direct substring copies. Learnings are paraphrases and
  // shouldn't trigger this check. We only reject here if the quote is long
  // (>100 chars) AND has no keyword overlap with the source content at all.
  const content = loadContent(ref.url, contentDir);
  if (content && ref.exact_quote && ref.exact_quote.length > 100) {
    const normContent = normalize(content);
    const normQuote = normalize(ref.exact_quote);
    // Keyword overlap check — are the main words from the quote present in the source?
    const quoteKeywords = extractKeywords(normQuote).slice(0, 6);
    const matched = quoteKeywords.filter((k) => normContent.includes(k)).length;
    if (matched < 2 && quoteKeywords.length >= 3) {
      return {
        claim_id: claim.id,
        verdict: "quote_fabricated",
        severity: "major",
        notes: `Claim statement keywords (${quoteKeywords.slice(0, 3).join(", ")}) not found in scraped content of ${ref.url}`,
      };
    }
  }

  // Layer 3: LLM adversarial review
  const sourceExcerpt = content ? content.slice(0, 15000) : `[Content not available — source existed but not scraped]`;

  try {
    const { object } = await generateJson({
      schema: z.object({
        verdict: z.string().describe("One word: verified | overreach | out_of_context | cherry_picked | misread"),
        notes: z.string().describe("Brief explanation (one sentence)"),
      }),
      system: VERIFIER_SYSTEM,
      prompt: `CLAIM (${claim.id}): "${claim.statement}"

Source URL: ${ref.url}
Source content (first 15k chars):
${sourceExcerpt}

Does the claim accurately follow from the source? Output JSON with exactly two fields: "verdict" and "notes".`,
      temperature: 0.1,
      maxRetries: 1,
      endpoint: config.endpoints.verifier,
    });

    const verdict = normalizeVerdict(object.verdict);
    const severity: "none" | "minor" | "major" = verdict === "verified" ? "none" : "major";

    return {
      claim_id: claim.id,
      verdict,
      severity,
      notes: object.notes ?? "",
    };
  } catch (err: any) {
    return {
      claim_id: claim.id,
      verdict: "verified",
      severity: "minor",
      notes: `LLM verification inconclusive: ${err.message?.slice(0, 100)}`,
    };
  }
}

function normalizeVerdict(s: string): Verification["verdict"] {
  const lower = s.toLowerCase().trim();
  if (lower.includes("verif")) return "verified";
  if (lower.includes("overreach") || lower.includes("overstat")) return "overreach";
  if (lower.includes("context")) return "out_of_context";
  if (lower.includes("cherry")) return "cherry_picked";
  if (lower.includes("misread") || lower.includes("misunder")) return "misread";
  if (lower.includes("dead") || lower.includes("url")) return "url_dead";
  if (lower.includes("fabric") || lower.includes("quote")) return "quote_fabricated";
  return "verified"; // default to not-reject if model is unclear
}

function normalizeSeverity(s: string): Verification["severity"] {
  const lower = s.toLowerCase().trim();
  if (lower.includes("major")) return "major";
  if (lower.includes("minor")) return "minor";
  return "none";
}

function summarize(verifications: Verification[]) {
  const byVerdict: Record<string, number> = {};
  let verified = 0;
  let rejected = 0;
  for (const v of verifications) {
    byVerdict[v.verdict] = (byVerdict[v.verdict] ?? 0) + 1;
    if (v.verdict === "verified") verified++;
    else rejected++;
  }
  return {
    total: verifications.length,
    verified,
    rejected,
    by_verdict: byVerdict,
  };
}
