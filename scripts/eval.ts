#!/usr/bin/env bun
// Evaluation script — measures a finished project against the ChatGPT Deep
// Research baseline. Speaks both schemas:
//   * question-first: facts.json + verification.json + analysis_report.json
//   * legacy:         claims.json + verification.json + critic_report.json
//
// Usage: bun run scripts/eval.ts <project-slug>

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECTS_DIR = join(import.meta.dir, "..", "projects");

// KV-cache compression baseline — ChatGPT Deep Research output on the same
// topic named 18 key methods / benchmarks / frameworks. This is the coverage
// target for our pipeline on that topic. Adapt for other topics.
const KEY_CONCEPTS = [
  "TurboQuant",
  "KIVI",
  "KVQuant",
  "MiniKV",
  "Kitty",
  "Coupled Quantization",
  "PagedAttention",
  "FP8",
  "INT8",
  "AWQ",
  "GPTQ",
  "Tensor Parallelism",
  "Gemma 3",
  "Gemma 4",
  "vLLM",
  "TensorRT-LLM",
  "WikiText",
  "Q4_K_M",
];

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun run scripts/eval.ts <project-slug>");
  process.exit(1);
}

const projectDir = join(PROJECTS_DIR, slug);

function readJson(name: string): any {
  const p = join(projectDir, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}
function readText(name: string): string | null {
  const p = join(projectDir, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

// Schema detection — prefer question-first artifacts when present.
const facts = readJson("facts.json");
const claims = readJson("claims.json");
const analysis = readJson("analysis_report.json");
const critic = readJson("critic_report.json");
const verification = readJson("verification.json");
const report = readText("REPORT.md") ?? "";
const sourcesIdx = readJson("sources/index.json");

const isQuestionFirst = Array.isArray(facts);
type Finding = { id: string; statement: string; references: { url: string }[] };
const findings: Finding[] = isQuestionFirst
  ? (facts ?? [])
  : (claims ?? []);

console.log(`\n=== Eval: ${slug} ===`);
console.log(`Schema: ${isQuestionFirst ? "question-first" : "legacy hypothesis-first"}\n`);

// ───── 1. Sources ──────────────────────────────────────────────────────────
const totalSources = sourcesIdx?.total_sources ?? 0;
const byProvider: Record<string, number> = sourcesIdx?.by_provider ?? {};
const arxivCount = byProvider.arxiv ?? 0;
const s2Count = byProvider.semantic_scholar ?? 0;
const openalexCount = byProvider.openalex ?? 0;
const primaryCount = arxivCount + s2Count + openalexCount;
const primaryPct = totalSources > 0 ? (primaryCount / totalSources) * 100 : 0;

console.log("📊 SOURCES");
console.log(`   Total: ${totalSources}`);
console.log(`   By provider: ${JSON.stringify(byProvider)}`);
console.log(`   Primary (arxiv+s2+openalex): ${primaryCount} (${primaryPct.toFixed(1)}%)`);

// ───── 2. Findings & verification ──────────────────────────────────────────
console.log(`\n🔗 ${isQuestionFirst ? "FACTS" : "CLAIMS"}`);
console.log(`   Total: ${findings.length}`);
if (verification) {
  const v = verification.summary ?? {};
  const verified = v.verified ?? 0;
  const total = v.total ?? 0;
  const pct = total > 0 ? ((verified / total) * 100).toFixed(1) : "0";
  console.log(`   Verified: ${verified}/${total} (${pct}%)`);
  console.log(`   Rejected: ${v.rejected ?? 0}`);
  console.log(`   By verdict:`);
  for (const [verdict, n] of Object.entries(v.by_verdict ?? {})) {
    console.log(`     ${verdict}: ${n}`);
  }
} else {
  console.log(`   (no verification.json — verify phase hasn't run)`);
}

// ───── 3. Key-concept coverage ─────────────────────────────────────────────
const findingsText = findings.map((f) => f.statement ?? "").join(" ").toLowerCase();
const combined = report.toLowerCase() + " " + findingsText;

console.log("\n🧠 KEY CONCEPTS (from ChatGPT Deep Research baseline)");
const covered: string[] = [];
const missed: string[] = [];
for (const concept of KEY_CONCEPTS) {
  if (combined.includes(concept.toLowerCase())) covered.push(concept);
  else missed.push(concept);
}
const coveragePct = ((covered.length / KEY_CONCEPTS.length) * 100).toFixed(0);
console.log(`   Coverage: ${covered.length}/${KEY_CONCEPTS.length} (${coveragePct}%)`);
console.log(`   ✓ Covered: ${covered.join(", ") || "—"}`);
if (missed.length) console.log(`   ✗ Missed:  ${missed.join(", ")}`);

// ───── 4. Contradictions / tensions ────────────────────────────────────────
console.log("\n⚡ TENSIONS");
const tensions: { a: string; b: string; desc: string }[] = [];
if (isQuestionFirst) {
  for (const t of analysis?.cross_question_tensions ?? []) {
    tensions.push({
      a: (t.involved_questions ?? []).join(","),
      b: (t.involved_facts ?? []).join(","),
      desc: t.description ?? "",
    });
  }
  for (const a of analysis?.answers ?? []) {
    for (const cf of a.conflicting_facts ?? []) {
      tensions.push({ a: cf.fact_a, b: cf.fact_b, desc: cf.nature ?? "" });
    }
  }
} else {
  for (const c of critic?.contradictions ?? []) {
    tensions.push({ a: c.claim_a, b: c.claim_b, desc: c.description ?? "" });
  }
}
console.log(`   Count: ${tensions.length}`);
for (const t of tensions.slice(0, 5)) {
  console.log(`   - ${t.a} vs ${t.b}: ${t.desc.slice(0, 100)}`);
}

// ───── 5. Coverage / confidence ────────────────────────────────────────────
console.log("\n💪 COVERAGE / CONFIDENCE");
if (isQuestionFirst) {
  const tally: Record<string, number> = {};
  for (const a of analysis?.answers ?? []) {
    tally[a.coverage] = (tally[a.coverage] ?? 0) + 1;
  }
  const n = (analysis?.answers ?? []).length;
  console.log(`   Per-question coverage (n=${n}):`);
  for (const [coverage, count] of Object.entries(tally)) {
    console.log(`     ${coverage}: ${count}`);
  }
} else {
  console.log(`   Overall: ${critic ? (critic.overall_confidence * 100).toFixed(0) : "?"}%`);
  for (const a of critic?.hypothesis_assessments ?? []) {
    console.log(`   ${a.hypothesis_id}: ${a.status} (${(a.confidence * 100).toFixed(0)}%)`);
  }
}

// ───── 6. Hallucination heuristics ─────────────────────────────────────────
console.log("\n🚨 HALLUCINATION CHECKS");
let urlsCount = 0;
let fakeUrls = 0;
const suspicious: string[] = [];
for (const f of findings) {
  for (const ref of f.references ?? []) {
    urlsCount++;
    if (
      !ref.url?.startsWith("http") ||
      ref.url?.includes("pre-digested") ||
      ref.url?.startsWith("https-")
    ) {
      fakeUrls++;
      suspicious.push(`${f.id} → ${ref.url}`);
    }
  }
}
console.log(`   URLs in ${isQuestionFirst ? "facts" : "claims"}: ${urlsCount}`);
console.log(`   Obviously malformed: ${fakeUrls}`);
for (const s of suspicious.slice(0, 5)) console.log(`     ${s}`);

// ───── 7. vs baseline summary ──────────────────────────────────────────────
console.log("\n📊 vs ChatGPT Deep Research BASELINE");
const baseline = {
  primaryPct: 85,
  urlValidity: 100,
  keyConceptCoverage: 15,
  tensions: 3,
};
const urlValidity =
  urlsCount > 0 ? (((urlsCount - fakeUrls) / urlsCount) * 100).toFixed(0) : "?";
const verifiedPct =
  verification?.summary?.total > 0
    ? ((verification.summary.verified / verification.summary.total) * 100).toFixed(0)
    : "?";

console.log(`                       ChatGPT    Ours`);
console.log(`   Primary source %:   ${baseline.primaryPct}%       ${primaryPct.toFixed(0)}%`);
console.log(`   URL validity:       ${baseline.urlValidity}%      ${urlValidity}%`);
console.log(`   Verified facts %:   —          ${verifiedPct}%`);
console.log(`   Key concepts:       ${baseline.keyConceptCoverage}/18     ${covered.length}/18`);
console.log(`   Tensions surfaced:  ${baseline.tensions}          ${tensions.length}`);
