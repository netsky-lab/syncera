// Domain-relevance gate. Runs between harvest and evidence. For each
// (subquestion, source) pair, asks the LLM whether the source is
// actually on-domain for the research question or just keyword-matched
// from a different field.
//
// Why: harvester query generation + SearXNG ranking will occasionally
// surface papers that share terminology but operate in a different field
// (cosmetic TiO2 research → physics paper on radiopure titanium for
// dark-matter detectors). The 3-layer fact verifier can't catch this
// because exact quotes literally exist in the source; it just misses
// that the source shouldn't have been attributed in the first place.
//
// Output: sources/<SQ>.json entries gain a `relevance: {domain_match,
// usefulness 0-3, notes, checked_at}` field. Evidence extractor filters
// to usefulness >= 1, ordered by usefulness desc.

import { generateJson } from "./llm";
import { config } from "./config";
import { RelevanceSchema, type Relevance, type SourceIndex } from "./schemas/source";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";

const RELEVANCE_SYSTEM = `You are a domain-relevance gate for a research pipeline.

Given a research TOPIC, its research QUESTIONS, and ONE source (title + URL + scraped body), decide:
  (1) whether the source is on-domain for the research, or just keyword-matched from a different field
  (2) what TYPE of source it is — the evidence pool should prefer peer-reviewed / preprint / clinical data over blogs and product-marketing pages

A source is ON-DOMAIN when it discusses the substances, mechanisms, methods, or applications that the research questions are about. A source is OFF-DOMAIN when it happens to share terminology but operates in a different field.

Examples of OFF-DOMAIN matches we want to reject:
- Topic about "titanium dioxide in sunscreen" → paper on radiopure titanium for LUX-ZEPLIN dark-matter detectors (both mention titanium, zero cosmetic/dermatology relevance).
- Topic about "sodium benzoate as cosmetic preservative" → paper on FT-IR spectroscopy of sodium benzoate crystals at 313-553 K (same molecule, orthogonal purpose).
- Topic about "KV-cache compression for LLMs" → paper on database cache hierarchies in filesystem design (both "cache", different fields).

Examples of ON-DOMAIN matches we want to keep:
- Topic about "sunscreen UV filter photostability" → paper measuring photodegradation of Ethylhexyl Methoxycinnamate in formulations (direct).
- Topic about "KV-cache compression" → paper on TurboQuant quantization of attention KV caches (direct).
- Topic about "skin barrier hydration" → paper on stratum corneum lipid organization and TEWL (direct).

Output rubric:
- domain_match: "on" | "partial" | "off"
- usefulness 0-3:
  3 = core evidence, directly answers a research question with numbers or mechanism
  2 = supports claims, provides relevant context around the mechanism or methodology
  1 = background only, names an entity or cites a useful definition but doesn't carry direct evidence
  0 = off-domain, irrelevant — SKIP
- source_type: one of:
    "peer_reviewed"     — journal article with peer review (Nature, Elsevier, Wiley, Springer, MDPI, etc.)
    "preprint"          — arxiv, biorxiv, openreview, SSRN, ChemRxiv
    "clinical"          — clinical trial record / registry / regulatory document (FDA/EMA, clinicaltrials.gov)
    "technical_report"  — institutional white paper, ISO/standards body, patent, technical bulletin
    "reference_work"    — handbook, textbook chapter, wiki with citations (Wikipedia is here)
    "blog"              — personal blog, Medium, company engineering blog, lifestyle / wellness content
    "marketing"         — product page, e-commerce listing, sales brochure, SEO content farm, advertorial
    "other"             — news article, interview, forum post, unknown
- notes: ONE sentence. If off-domain, say what field the source is in; if on-domain, say what evidence it carries.

Be ruthless about field-mismatches AND about source-type honesty. A cosmetics-shop blog post that paraphrases peer-reviewed work is still type "blog" / "marketing" — do not launder it into "peer_reviewed" just because it sounds informed. Peer-reviewed requires either an explicit journal/publisher or a DOI to a reputable venue.

Output JSON only matching the schema.`;

function publicSchema() {
  return z.object({
    domain_match: z.enum(["on", "partial", "off"]),
    usefulness: z.number().int().min(0).max(3),
    source_type: z.enum([
      "peer_reviewed",
      "preprint",
      "clinical",
      "technical_report",
      "reference_work",
      "blog",
      "marketing",
      "other",
    ]),
    notes: z.string(),
  });
}

// Silent URL-level denylist — runs before the LLM to avoid burning cycles
// on obvious commercial / marketing / blog domains. Any match → usefulness=0
// off-domain, no LLM call. The casual user never sees these sources.
const DENYLIST_PATTERNS: RegExp[] = [
  // E-commerce tells — strong signals that a URL is trying to sell
  /\/(shop|cart|checkout|product|collections?|store)\//i,
  /^https?:\/\/[^/]*(shopify|shop\.|store\.|\.shop$|\.store$)/i,
  /^https?:\/\/[^/]*(amazon|ebay|walmart|target|costco|alibaba)\.[a-z.]+\//i,
  // Consumer lifestyle / wellness blog platforms
  /^https?:\/\/[^/]*(medium\.com|substack\.com|wordpress\.com|blogspot\.)/i,
  /\/blogs?\/(mind-journal|wellness|lifestyle|tips|guide|beauty)/i,
  // SEO content farms & product-review affiliates we've repeatedly seen
  /^https?:\/\/[^/]*(healthline\.com|webmd\.com|self\.com|byrdie\.com|stylecraze\.com|makeupalley)/i,
  // Review aggregators / quora-style
  /^https?:\/\/[^/]*(quora\.com|reddit\.com\/r\/(?!science|askscience|academicbiology))/i,
];

function isDenylistedUrl(url: string): boolean {
  return DENYLIST_PATTERNS.some((re) => re.test(url));
}

export async function assessSource(opts: {
  topic: string;
  questionContext: string;
  title: string;
  url: string;
  content: string;
}): Promise<Relevance> {
  const { topic, questionContext, title, url, content } = opts;

  // URL-level denylist — skip the LLM for obvious e-commerce / marketing
  // blogs. Saves tokens and guarantees Olga never sees sunscreen-shop
  // "mind-journal" posts sneaking into peer-reviewed citations.
  if (isDenylistedUrl(url)) {
    return {
      domain_match: "off",
      usefulness: 0,
      source_type: "marketing",
      notes: `URL matches denylist (commercial / marketing / lifestyle blog)`,
      checked_at: Date.now(),
    };
  }

  // Trim to keep prompt under ~30k tokens even on long papers. The gate
  // doesn't need every paragraph; intro + mid-body is plenty to decide
  // field.
  const trimmed = content.slice(0, 20_000);
  const prompt = `TOPIC
${topic}

RESEARCH QUESTIONS (the source should inform at least one):
${questionContext}

SOURCE
  title: ${title}
  url: ${url}

Body (first 20k chars of scraped markdown):
"""
${trimmed}
"""

Assess: is this source on-domain for the research, or keyword-matched from a different field?

Output JSON with fields: domain_match (on|partial|off), usefulness (0-3), source_type (peer_reviewed|preprint|clinical|technical_report|reference_work|blog|marketing|other), notes (1 sentence).`;

  try {
    const { object } = await generateJson({
      schema: publicSchema(),
      system: RELEVANCE_SYSTEM,
      prompt,
      temperature: 0.1,
      maxRetries: 1,
      endpoint: config.endpoints.verifier,
    });
    // Post-filter: regardless of usefulness LLM assigns, blog / marketing
    // source_type is hard-blocked from the evidence pool. Research-grade
    // reports don't cite cosmetics-shop wellness posts even if the LLM
    // decided they happen to be "on-topic".
    const blocked =
      object.source_type === "blog" || object.source_type === "marketing";
    return {
      domain_match: blocked ? "off" : object.domain_match,
      usefulness: blocked ? 0 : object.usefulness,
      source_type: object.source_type,
      notes: blocked
        ? `Blocked (source_type=${object.source_type}): ${object.notes}`
        : object.notes,
      checked_at: Date.now(),
    };
  } catch (err: any) {
    // On LLM failure, fall back to "partial/usefulness=1" — let the source
    // through with low weight; verifier will do its job downstream.
    return {
      domain_match: "partial",
      usefulness: 1,
      source_type: "other",
      notes: `Relevance check failed: ${err?.message?.slice(0, 80) ?? "unknown"}. Accepted with low weight as fallback.`,
      checked_at: Date.now(),
    };
  }
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (
    Math.abs(h).toString(36) +
    "-" +
    url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-")
  );
}

function loadContent(url: string, contentDir: string): string | null {
  const p = join(contentDir, `${hashUrl(url)}.md`);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
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

export async function runRelevancePhase(
  plan: ResearchPlan,
  projectDir: string,
  opts: { concurrency?: number; force?: boolean } = {}
): Promise<{
  totalChecked: number;
  accepted: number;
  rejected: number;
  weakSubquestions: string[];
}> {
  const { concurrency = 5, force = false } = opts;
  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  const expectedUnitIds = new Set(
    plan.questions.flatMap((q) => q.subquestions.map((s) => s.id))
  );

  const sourceFiles = readdirSync(sourcesDir).filter((f) => {
    if (!/^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)) return false;
    return expectedUnitIds.has(f.replace(/\.json$/i, ""));
  });

  let totalChecked = 0;
  let accepted = 0;
  let rejected = 0;
  const weakSubquestions: string[] = [];

  for (const file of sourceFiles) {
    const path = join(sourcesDir, file);
    const index: SourceIndex = JSON.parse(readFileSync(path, "utf-8"));

    // Build question context: the specific subquestion + its parent question.
    const question = plan.questions.find((q) => q.id === index.question_id);
    const subquestion = question?.subquestions.find(
      (s) => s.id === index.subquestion_id
    );
    const questionContext = question
      ? `${question.id} [${question.category}]: ${question.question}\n  ${subquestion?.id ?? index.subquestion_id} [${subquestion?.angle ?? "?"}]: ${subquestion?.text ?? ""}`
      : `Subquestion ${index.subquestion_id}`;

    // Assess each source that doesn't yet have a relevance verdict, or all if force.
    const targets = index.results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => force || !r.relevance);

    if (targets.length === 0) {
      console.log(`[relevance] ${index.subquestion_id}: cached, skipping`);
      // Still tally from cache for reporting
      for (const r of index.results) {
        totalChecked++;
        if ((r.relevance?.usefulness ?? 1) >= 1) accepted++;
        else rejected++;
      }
      continue;
    }

    console.log(
      `[relevance] ${index.subquestion_id}: assessing ${targets.length}/${index.results.length} sources`
    );

    const verdicts = await parallelLimit(targets, concurrency, async ({ r }) => {
      const content = loadContent(r.url, contentDir);
      if (!content) {
        return {
          domain_match: "off" as const,
          usefulness: 0,
          notes: "Scraped content missing — cannot assess relevance.",
          checked_at: Date.now(),
        } satisfies Relevance;
      }
      return await assessSource({
        topic: plan.topic,
        questionContext,
        title: r.title,
        url: r.url,
        content,
      });
    });

    // Merge verdicts back into the index
    for (let k = 0; k < targets.length; k++) {
      const t = targets[k]!;
      index.results[t.i]!.relevance = verdicts[k]!;
    }

    // Update totals for this subquestion
    let sqAccepted = 0;
    let sqRejected = 0;
    for (const r of index.results) {
      totalChecked++;
      if ((r.relevance?.usefulness ?? 0) >= 1) {
        accepted++;
        sqAccepted++;
      } else {
        rejected++;
        sqRejected++;
      }
    }

    if (sqAccepted === 0 && index.results.length > 0) {
      weakSubquestions.push(index.subquestion_id);
    }

    writeFileSync(path, JSON.stringify(index, null, 2));
    console.log(
      `[relevance]   ${index.subquestion_id}: ${sqAccepted} on-domain, ${sqRejected} off-domain`
    );
  }

  console.log(
    `[relevance] Total: ${accepted}/${totalChecked} on-domain (${rejected} filtered)`
  );
  if (weakSubquestions.length > 0) {
    console.log(
      `[relevance] Weak subquestions (0 on-domain sources): ${weakSubquestions.join(", ")}`
    );
  }

  return { totalChecked, accepted, rejected, weakSubquestions };
}
