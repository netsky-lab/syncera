import { generateJson } from "./llm";
import { config } from "./config";
import { VerificationSchema, type Verification } from "./schemas/verification";
import type { Fact } from "./schemas/fact";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

const VERIFIER_SYSTEM = `You are an adversarial fact-checker for a research report. Your job is to find any way the given FACT misrepresents the SOURCE. Default to skepticism.

For the fact, check:
1. Does it overstate what the source says? (source: "some", fact: "all")
2. Does it strip context? (source: "X works BUT under conditions Y", fact: "X works")
3. Does it cherry-pick? (source discusses multiple views, fact uses one)
4. Does it misread? (fact attributes result to wrong model/dataset/method)
5. Could a skeptical reader reject it using the same source?

If the fact is accurate and faithfully represents the source → verdict: verified.
Otherwise pick the MOST SPECIFIC verdict from: overreach | out_of_context | cherry_picked | misread.

Always include specific notes citing the source text. If verdict != verified, provide corrected_statement that the source actually supports.

Output JSON only matching the schema.`;

export function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (
    Math.abs(h).toString(36) +
    "-" +
    url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-")
  );
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractKeywords(text: string): string[] {
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
  return Array.from(
    new Set(words.filter((w) => /\d/.test(w) || /-/.test(w) || /\./.test(w) || w.length > 4))
  );
}

// Real-browser UA — some publishers (Elsevier, Sage, T&F) 403 anything that
// looks like a bot, which previously caused our verifier to nuke valid facts
// as `url_dead`. Modern Chrome UA slips past most of them.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// "Transient" statuses mean the URL infra is alive but doesn't want to
// serve us right now (rate limit, auth wall, bot block, internal error).
// Treating those as `url_dead` is a false-positive — the reader can still
// resolve the citation in their own browser session.
const TRANSIENT_STATUSES = new Set([401, 402, 403, 405, 406, 408, 409, 418, 429, 500, 501, 502, 503, 504]);

async function checkUrlAlive(url: string, timeoutMs = 12000): Promise<{ alive: boolean; status?: number; error?: string }> {
  // Try HEAD first (zero body transfer, polite). If the server doesn't
  // support it (405/501) or range-specific endpoints confuse it, fall
  // back to a tiny GET. This handles direct-PDF links (Springer, Wiley,
  // tandfonline) that return 200 on GET but 405 on HEAD.
  const attempt = async (method: "HEAD" | "GET") => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      return { status: resp.status };
    } catch (err: any) {
      clearTimeout(timer);
      return { error: err?.message ?? String(err) };
    }
  };

  const head = await attempt("HEAD");
  if (head.status !== undefined) {
    if (head.status < 400) return { alive: true, status: head.status };
    if (head.status === 416) return { alive: true, status: head.status };
    // Transient / bot-block — try GET before giving up.
    if (TRANSIENT_STATUSES.has(head.status) || head.status === 404) {
      const get = await attempt("GET");
      if (get.status !== undefined && get.status < 400) {
        return { alive: true, status: get.status };
      }
      // 403/429/5xx after both HEAD+GET: treat as "can't verify from
      // here" — not definitively dead. Downstream still gets to see the
      // scraped content and run the quote+LLM check.
      if (get.status !== undefined && TRANSIENT_STATUSES.has(get.status)) {
        return { alive: true, status: get.status, error: "transient-bypass" };
      }
      return { alive: false, status: get.status ?? head.status, error: get.error };
    }
    return { alive: false, status: head.status };
  }
  // HEAD network error — try GET.
  const get = await attempt("GET");
  if (get.status !== undefined) {
    if (get.status < 400 || get.status === 416) {
      return { alive: true, status: get.status };
    }
    if (TRANSIENT_STATUSES.has(get.status)) {
      return { alive: true, status: get.status, error: "transient-bypass" };
    }
    return { alive: false, status: get.status };
  }
  return { alive: false, error: get.error ?? head.error };
}

function loadContent(url: string, contentDir: string): string | null {
  const path = join(contentDir, `${hashUrl(url)}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

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
  facts: Fact[];
  projectDir: string;
  concurrency?: number;
}): Promise<Verification[]> {
  const { facts, projectDir, concurrency = 5 } = args;
  const contentDir = join(projectDir, "sources", "content");

  console.log(`[verify] ${facts.length} facts to check (concurrency=${concurrency})`);

  const verifications = await parallelLimit(facts, concurrency, async (fact, idx) => {
    return await verifyOne(fact, contentDir, idx);
  });

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

async function verifyOne(fact: Fact, contentDir: string, idx: number): Promise<Verification> {
  const ref = fact.references?.[0];
  if (!ref || !ref.url) {
    return {
      fact_id: fact.id,
      verdict: "url_dead",
      severity: "major",
      notes: "Fact has no references",
    };
  }

  const urlCheck = await checkUrlAlive(ref.url);
  if (!urlCheck.alive) {
    return {
      fact_id: fact.id,
      verdict: "url_dead",
      severity: "major",
      notes: `URL unreachable: ${urlCheck.status ?? urlCheck.error ?? "unknown"}`,
    };
  }

  const content = loadContent(ref.url, contentDir);
  if (content && ref.exact_quote && ref.exact_quote.length > 100) {
    const normContent = normalize(content);
    const normQuote = normalize(ref.exact_quote);
    const quoteKeywords = extractKeywords(normQuote).slice(0, 6);
    const matched = quoteKeywords.filter((k) => normContent.includes(k)).length;
    if (matched < 2 && quoteKeywords.length >= 3) {
      return {
        fact_id: fact.id,
        verdict: "quote_fabricated",
        severity: "major",
        notes: `Fact statement keywords (${quoteKeywords.slice(0, 3).join(", ")}) not found in scraped content of ${ref.url}`,
      };
    }
  }

  const sourceExcerpt = content ? content.slice(0, 15000) : `[Content not available — source existed but not scraped]`;

  try {
    const { object } = await generateJson({
      schema: z.object({
        verdict: z.string().describe("One word: verified | overreach | out_of_context | cherry_picked | misread"),
        notes: z.string().describe("Brief explanation (one sentence)"),
      }),
      system: VERIFIER_SYSTEM,
      prompt: `FACT (${fact.id}): "${fact.statement}"

Source URL: ${ref.url}
Source content (first 15k chars):
${sourceExcerpt}

Does the fact accurately follow from the source? Output JSON with exactly two fields: "verdict" and "notes".`,
      temperature: 0.1,
      maxRetries: 1,
      endpoint: config.endpoints.verifier,
    });

    const verdict = normalizeVerdict(object.verdict);
    const severity: "none" | "minor" | "major" = verdict === "verified" ? "none" : "major";

    return {
      fact_id: fact.id,
      verdict,
      severity,
      notes: object.notes ?? "",
    };
  } catch (err: any) {
    return {
      fact_id: fact.id,
      verdict: "verified",
      severity: "minor",
      notes: `LLM verification inconclusive: ${err.message?.slice(0, 100)}`,
    };
  }
}

export function normalizeVerdict(s: string): Verification["verdict"] {
  const lower = s.toLowerCase().trim();
  if (lower.includes("verif")) return "verified";
  if (lower.includes("overreach") || lower.includes("overstat")) return "overreach";
  if (lower.includes("context")) return "out_of_context";
  if (lower.includes("cherry")) return "cherry_picked";
  if (lower.includes("misread") || lower.includes("misunder")) return "misread";
  if (lower.includes("dead") || lower.includes("url")) return "url_dead";
  if (lower.includes("fabric") || lower.includes("quote")) return "quote_fabricated";
  return "verified";
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
