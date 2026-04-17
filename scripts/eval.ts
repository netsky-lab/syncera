#!/usr/bin/env bun
// Evaluation script — compares our pipeline output against ChatGPT baseline.
// Usage: bun run scripts/eval.ts <project-slug>

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECTS_DIR = join(import.meta.dir, "..", "projects");

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

const plan = readJson("plan.json");
const claims = readJson("claims.json") ?? [];
const verification = readJson("verification.json");
const critic = readJson("critic_report.json");
const report = readText("REPORT.md") ?? "";
const sourcesIdx = readJson("sources/index.json");

console.log(`\n=== Eval: ${slug} ===\n`);

// Metric 1: Sources
const totalSources = sourcesIdx?.total_sources ?? 0;
const byProvider = sourcesIdx?.by_provider ?? {};
const arxivCount = byProvider.arxiv ?? 0;
const s2Count = byProvider.semantic_scholar ?? 0;
const webCount = Object.entries(byProvider)
  .filter(([k]) => k.startsWith("searxng") || k === "searxng")
  .reduce((n, [, v]) => n + (v as number), 0);
const primaryCount = arxivCount + s2Count;
const primaryPct = totalSources > 0 ? (primaryCount / totalSources) * 100 : 0;

console.log("📊 SOURCES");
console.log(`   Total: ${totalSources}`);
console.log(`   By provider: ${JSON.stringify(byProvider)}`);
console.log(`   Primary (arxiv+s2): ${primaryCount} (${primaryPct.toFixed(1)}%)`);

// Metric 2: Claims & citations
console.log("\n🔗 CLAIMS");
console.log(`   Total claims: ${claims.length}`);
if (verification) {
  const v = verification.summary;
  console.log(`   Verified: ${v.verified}/${v.total} (${((v.verified / v.total) * 100).toFixed(1)}%)`);
  console.log(`   Rejected: ${v.rejected}`);
  console.log(`   By verdict:`);
  for (const [verdict, n] of Object.entries(v.by_verdict ?? {})) {
    console.log(`     ${verdict}: ${n}`);
  }
} else {
  console.log(`   (no verification.json — pipeline hasn't run Verifier phase)`);
}

// Metric 3: Key concepts coverage
const reportLower = report.toLowerCase();
const claimsText = claims.map((c: any) => c.statement ?? "").join(" ").toLowerCase();
const combined = reportLower + " " + claimsText;

console.log("\n🧠 KEY CONCEPTS (from ChatGPT baseline)");
const covered: string[] = [];
const missed: string[] = [];
for (const concept of KEY_CONCEPTS) {
  if (combined.includes(concept.toLowerCase())) covered.push(concept);
  else missed.push(concept);
}
console.log(`   Coverage: ${covered.length}/${KEY_CONCEPTS.length} (${((covered.length / KEY_CONCEPTS.length) * 100).toFixed(0)}%)`);
console.log(`   ✓ Covered: ${covered.join(", ")}`);
if (missed.length) console.log(`   ✗ Missed: ${missed.join(", ")}`);

// Metric 4: Contradictions
console.log("\n⚡ CONTRADICTIONS");
const contradictions = critic?.contradictions ?? [];
console.log(`   Count: ${contradictions.length}`);
for (const c of contradictions) {
  console.log(`   - ${c.claim_a} vs ${c.claim_b}: ${c.description?.slice(0, 100)}`);
}

// Metric 5: Confidence
console.log("\n💪 CONFIDENCE");
console.log(`   Overall: ${critic ? (critic.overall_confidence * 100).toFixed(0) : "?"}%`);
if (critic) {
  for (const a of critic.hypothesis_assessments ?? []) {
    console.log(`   ${a.hypothesis_id}: ${a.status} (${(a.confidence * 100).toFixed(0)}%)`);
  }
}

// Metric 6: Hallucination detection
console.log("\n🚨 HALLUCINATION CHECKS");
let urlsInClaims = 0;
let fakeUrls = 0;
const suspiciousUrls: string[] = [];
for (const c of claims) {
  for (const ref of c.references ?? []) {
    urlsInClaims++;
    // Simple heuristics
    if (
      ref.url?.includes("pre-digested") ||
      ref.url?.startsWith("https-") || // malformed
      !ref.url?.startsWith("http")
    ) {
      fakeUrls++;
      suspiciousUrls.push(`${c.id} → ${ref.url}`);
    }
  }
}
console.log(`   URLs in claims: ${urlsInClaims}`);
console.log(`   Obviously fake: ${fakeUrls}`);
if (suspiciousUrls.length) {
  console.log(`   Suspicious:`);
  for (const s of suspiciousUrls.slice(0, 5)) console.log(`     ${s}`);
}

// Final score against ChatGPT baseline
console.log("\n📊 vs ChatGPT BASELINE");
const baseline = {
  primaryPct: 85,
  urlValidity: 100,
  keyConceptCoverage: 15,
  contradictions: 3,
  actionableScore: 5, // 5-step deployment sequence
};
const ours = {
  primaryPct: primaryPct.toFixed(0),
  urlValidity: urlsInClaims > 0 ? (((urlsInClaims - fakeUrls) / urlsInClaims) * 100).toFixed(0) : "?",
  keyConceptCoverage: covered.length,
  contradictions: contradictions.length,
  actionableScore: report.toLowerCase().includes("deployment sequence") ? 5 : 2,
};

console.log(`                       ChatGPT    Ours`);
console.log(`   Primary source %:   ${baseline.primaryPct}%       ${ours.primaryPct}%`);
console.log(`   URL validity:       ${baseline.urlValidity}%      ${ours.urlValidity}%`);
console.log(`   Key concepts:       ${baseline.keyConceptCoverage}/18     ${ours.keyConceptCoverage}/18`);
console.log(`   Contradictions:     ${baseline.contradictions}          ${ours.contradictions}`);
console.log(`   Deployment steps:   ${baseline.actionableScore}          ${ours.actionableScore}`);
