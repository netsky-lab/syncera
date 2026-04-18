// Hybrid synthesizer: deterministic assembly + two small LLM calls.
//   - Exec summary (1 paragraph)
//   - Deployment sequence (bullets with citations)
// All other sections built from critic_report + claims data directly.

import { generateJson, generateText } from "./llm";
import { config } from "./config";
import type { Claim, CriticReport } from "./schemas/claim";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

export async function synthesize(
  plan: ResearchPlan,
  projectDir: string
): Promise<string> {
  const allClaims: Claim[] = JSON.parse(
    readFileSync(join(projectDir, "claims.json"), "utf-8")
  );
  const criticReport: CriticReport = JSON.parse(
    readFileSync(join(projectDir, "critic_report.json"), "utf-8")
  );

  // Filter to verified claims
  const verificationPath = join(projectDir, "verification.json");
  let verified: Claim[] = allClaims;
  let rejectedIds = new Set<string>();
  if (existsSync(verificationPath)) {
    const verData = JSON.parse(readFileSync(verificationPath, "utf-8"));
    const verMap = new Map<string, Verification>();
    for (const v of verData.verifications ?? []) verMap.set(v.claim_id, v);
    verified = [];
    for (const c of allClaims) {
      const v = verMap.get(c.id);
      if (!v || v.verdict === "verified") verified.push(c);
      else rejectedIds.add(c.id);
    }
  }

  console.log(
    `[synth] ${verified.length} verified / ${rejectedIds.size} rejected`
  );

  // --- Call 1: Executive summary (1 paragraph, fast) ---
  const claimsSummary = verified
    .slice(0, 40)
    .map(
      (c) =>
        `${c.id} [${c.type}] (${c.hypothesis_id}) conf=${c.confidence}: ${c.statement.slice(0, 200)}`
    )
    .join("\n");

  const assessmentsList = criticReport.hypothesis_assessments
    .map(
      (a) =>
        `${a.hypothesis_id}: ${a.status} (${(a.confidence * 100).toFixed(0)}%)`
    )
    .join("; ");

  let execSummary = "";
  try {
    const { object } = await generateJson({
      schema: z.object({ summary: z.string() }),
      system: `You write the Executive Summary for a fact-checked research report.

STRICT 3-SENTENCE STRUCTURE (exactly 3 sentences, not more, not fewer):
  Sentence 1 (headline): Biggest finding backed by a specific NUMBER and at least ONE claim ID.
    Example: "INT4 KV-cache compression via TurboQuant achieves up to 6x memory reduction on H100 [C1] while reporting <0.1 perplexity delta on Llama-3 benchmarks [C12]."
  Sentence 2 (tension): Main contradiction or the most important counter-evidence, with claim IDs.
    Example: "However, Kitty [C57] and Not All Bits Are Equal [C23] report 2-bit quantization degrades reasoning benchmarks by 3.1pp on GSM8K, directly contradicting the zero-loss claims for sub-3-bit regimes."
  Sentence 3 (uncertainty): The SPECIFIC remaining unknown — a metric + setup that was not measured.
    Example: "The critical unmeasured combination is WikiText-103 perplexity delta for INT4 TurboQuant on Gemma-2-27B at 32k+ context on 4x RTX 5090."

Rules:
- Every factual claim MUST cite [C<n>].
- Use exact numbers from claims (do NOT round them for prose).
- Never use: significantly, substantially, effective, impressive, important, promising.
- Never use: "more research is needed" (replaced by the specific-unknown sentence 3).

Output JSON: {"summary": "<three sentences>"}`,
      prompt: `Topic: ${plan.topic}\n\nAssessments: ${assessmentsList}\nOverall confidence: ${(criticReport.overall_confidence * 100).toFixed(0)}%\nCritic summary: ${criticReport.summary}\n\nSample verified claims:\n${claimsSummary}\n\nReturn JSON: {"summary": "..."}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    execSummary = object.summary;
  } catch (err: any) {
    execSummary = criticReport.summary ?? "";
    console.warn(`[synth] exec-summary fallback: ${err.message?.slice(0, 80)}`);
  }

  // --- Call 2: Deployment sequence (3-5 bullets) ---
  let deploymentBullets: string[] = [];
  try {
    const { object } = await generateJson({
      schema: z.object({
        steps: z.array(z.string()).describe("3-5 operational steps for an engineer today, ordered by risk (production-ready first). Cite claim IDs [C#]."),
      }),
      system: `You generate a deployment sequence — numbered steps an engineer can execute TODAY in their own environment.

Each step MUST include:
  - A concrete ACTIONABLE PRIMITIVE: a CLI flag, config value, API call, library invocation, or git clone URL.
    GOOD:  "Set --kv-cache-dtype=fp8 in vLLM launch args"
    GOOD:  "Pull ggml-org/llama.cpp PR #21526 to enable TurboQuant KV quantization"
    BAD:   "Implement FP8 quantization"
    BAD:   "Deploy TurboQuant"
  - Named tool/flag/parameter from the claims (not a generic verb).
  - Expected outcome with a SPECIFIC number from the cited claim.
  - Citation [C<n>] for the supporting claim.

Step format (each string):
  "<N>. <Action with exact tool+flag>: <Expected measurable outcome> [C<n>]."

ORDERING rule (strict):
  Step 1 = most production-ready, zero custom code (vendor-documented).
  Step N = most experimental, requires custom kernels / unmerged PRs.

GOOD example:
  1. Enable FP8 KV cache in vLLM via --kv-cache-dtype=fp8: halves KV memory vs BF16 baseline [C33].
  2. Apply INT4 weight quantization with AWQ via \`llmcompressor\` CLI: reduces total model weights by 75% [C33].
  3. Replace attention kernel with Marlin fused INT4 from GitHub (vllm-project/llm-compressor@main): +10.9x decoding throughput at batch ≥16 [C25].
  4. Prototype NVFP4 KV-cache on Blackwell via vllm-project/vllm#38171 (feature branch): targets ~2x FP8 throughput, quality regressions possible [C19].

BAD example:
  1. Use quantization (too vague).
  2. Apply TurboQuant (no flag, no measure).

Rules:
- Generate 4-6 steps, ordered from lowest to highest risk.
- Never use: significantly, substantially, important, effective, promising.
- Never skip the citation.

FLAG AUTHENTICITY (critical):
- A CLI flag/API/config value belongs in a step ONLY IF the verbatim token (e.g. --kv-cache-dtype, KV_CACHE_BITS=4, --quantization awq) appears inside the cited claim's statement. Do NOT invent plausible-looking flags that the claim does not contain.
- If the cited claim describes a method/capability but NAMES NO flag, write the step without inventing one. Example: "Apply KVQuant 3-bit quantization following the KVQuant paper (no upstream vLLM flag as of source; use the reference implementation at github.com/SqueezeAILab/KVQuant) [C17]."
- Prefer claims whose statement contains "--", "=", github.com/, or a config key — those are the claims carrying real primitives. For methods without a documented flag, the step should reference the library / repo / paper, not fabricate a flag.
- FORBIDDEN: invented flags like "--kv-cache-bits=3.5", "--kv-cache-quantization=kivi", "--kv-cache-dtype=kvquant". None of these exist in vLLM; saying so damages credibility more than a slightly less specific step.

Output JSON: {"steps": ["1. ...", "2. ..."]}`,
      prompt: `Topic: ${plan.topic}\n\nVerified claims:\n${claimsSummary}\n\nReturn JSON: {"steps": ["1. ...", "2. ..."]}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    deploymentBullets = object.steps.slice(0, 6);
  } catch (err: any) {
    deploymentBullets = ["[deployment sequence LLM call failed; see critic recommendations]"];
    console.warn(`[synth] deployment fallback: ${err.message?.slice(0, 80)}`);
  }

  // --- Deterministic assembly of the rest ---
  const lines: string[] = [];
  lines.push(`# Research Report: ${plan.topic}`, "");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push(`*Overall confidence: ${(criticReport.overall_confidence * 100).toFixed(0)}%*`);
  lines.push(`*Evidence: ${verified.length} verified claims${rejectedIds.size ? `, ${rejectedIds.size} rejected` : ""}*`, "");

  // --- Call 5: Introduction paragraph (problem framing) ---
  let introduction = "";
  try {
    const { object } = await generateJson({
      schema: z.object({ introduction: z.string() }),
      system: `You write the Introduction for a fact-checked research report — one paragraph (4-6 sentences) of plain-English problem framing.

Structure:
  1. State the practical problem as a reader would encounter it.
  2. Explain WHY it matters (what breaks / what costs / what's at stake).
  3. Name the main approach families the report will survey (from hypotheses).
  4. Set the bar: what does "answer" mean for this topic (concrete metrics).

Rules:
- Plain prose, no bullets, no citations (citations are reserved for the hypothesis sections).
- Do not summarize findings — that's the Executive Summary's job.
- Write for a senior engineer or researcher, not a general audience.
- Never use: significantly, substantially, effective, impressive, important, promising.

HARDWARE ARITHMETIC (if topic contains GPU/VRAM/context constraints):
- Make the resource budget explicit in one sentence. Use standard hardware knowledge to compute totals.
  Example for "4x RTX 5090": "Four RTX 5090 cards provide 128 GB VRAM total (32 GB each)..."
  Example for "Gemma 2 27B at int4": "...with Gemma-class weights at int4 occupying roughly 14 GB, leaving the KV-cache to absorb the remaining budget."
- Use known reference values (RTX 5090 = 32GB VRAM, H100 = 80GB, A100 = 40 or 80GB). If you're unsure of a spec, omit the arithmetic rather than guess.

Output JSON: {"introduction": "<paragraph>"}`,
      prompt: `Topic: ${plan.topic}\n\nHypotheses the report will test:\n${plan.hypotheses.map((h) => `${h.id}: ${h.statement}`).join("\n")}\n\nReturn JSON: {"introduction": "..."}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    introduction = object.introduction;
  } catch (err: any) {
    console.warn(`[synth] introduction fallback: ${err.message?.slice(0, 80)}`);
  }

  if (introduction) {
    lines.push("## Introduction", "", introduction, "");
  }
  lines.push("## Executive Summary", "", execSummary, "");

  // --- Call 3: Per-hypothesis narrative analysis (one paragraph each) ---
  // Runs all hypotheses in parallel — each call is independent; endpoint
  // concurrency (5 slots) handles 4 simultaneously with room to spare.
  const analysisMap = new Map<string, string>();
  const verifiedById = new Map(verified.map((c) => [c.id, c]));
  await Promise.all(plan.hypotheses.map(async (h) => {
    const a = criticReport.hypothesis_assessments.find(
      (x: any) => x.hypothesis_id === h.id
    );
    // Build evidence pool from critic's explicit picks + hypothesis_id-matched
    // + keyword-matched from the full verified set. This works even after
    // --replan made claim.hypothesis_id stale relative to current plan.
    const pool = new Map<string, Claim>();
    for (const id of a?.supporting_claims ?? []) {
      const c = verifiedById.get(id);
      if (c) pool.set(c.id, c);
    }
    for (const id of a?.contradicting_claims ?? []) {
      const c = verifiedById.get(id);
      if (c) pool.set(c.id, c);
    }
    for (const c of verified.filter((c) => c.hypothesis_id === h.id)) {
      pool.set(c.id, c);
    }
    // Keyword-match to pull in thematically-relevant claims from other hypotheses
    const hypothesisText = (
      h.statement + " " + h.acceptance_criteria.map((k) => k.name).join(" ")
    ).toLowerCase();
    const kwTokens = hypothesisText
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const kwSet = new Set(kwTokens);
    const scored = verified
      .filter((c) => !pool.has(c.id))
      .map((c) => {
        const t = c.statement.toLowerCase();
        let score = 0;
        for (const k of kwSet) if (t.includes(k)) score++;
        return { c, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    for (const { c } of scored) pool.set(c.id, c);

    const relevant = Array.from(pool.values());
    const evidencePreview = relevant
      .slice(0, 25)
      .map((c) => `[${c.id}] (${c.type}, conf ${c.confidence}) ${c.statement}`)
      .join("\n");
    try {
      const { object } = await generateJson({
        schema: z.object({ analysis: z.string() }),
        system: `You write a 5-8 sentence analytical paragraph synthesizing evidence for ONE research hypothesis. This sits between the bullet-point assessment and the evidence list — it tells the reader the STORY the evidence paints.

Required structure (as prose, not bullets):
  1. The KEY FINDING: what the preponderance of evidence actually shows, with 2-3 [C#] citations and specific numbers.
  2. The NUANCE / TRADE-OFF: which dimension varies across methods or models, citing a comparison ([C#] vs [C#]).
  3. The ADJACENT EVIDENCE (not skipped even if target untested): what comparable setups in the evidence tell us — name specific numbers from multiple claims even if the exact combination is missing.
  4. The CAVEAT: what the evidence does NOT cover for this hypothesis's target configuration (model/hardware/context). ONE sentence, not three — do not repeat it.
  5. WHICH METHOD is currently strongest on this dimension, with a citation.

Rules:
- Write as connected prose, not bullets.
- MINIMUM 4 distinct [C#] citations per paragraph. Synthesis means USING the evidence pool, not stating "nothing matches exactly" four different ways.
- Reference EXACT numbers from the evidence (not rounded).
- Do not restate the hypothesis or the bullet evidence verbatim.
- Never use: significantly, substantially, effective, impressive, important, promising.
- If evidence on the exact target is absent, acknowledge it ONCE as part of sentence 4, then pivot back to what IS known from adjacent claims.
- If the evidence pool has 15+ claims, cite 5-6; if it has 5-8 claims, cite 3-4.

OPENING VARIETY (anti-repetition):
- Do NOT start every paragraph the same way. FORBIDDEN openings: "The preponderance of evidence...", "The available evidence...", "Evidence indicates...". These are formulaic.
- Instead, open with one of: a specific number, a named method+result, a named contradiction, a named hardware constraint, or a question the evidence answers. Examples:
  "TurboQuant reports a 6x KV-cache reduction on Gemma models [C65], anchoring the upper bound..."
  "Two RTX 5090 cards cannot fit Gemma-3-27B FP16 even at 4k context..."
  "A direct split appears in the evidence: [C12] reports 10x compression while [C27] caps at 3x..."
- Do NOT close every paragraph with "X currently demonstrates the strongest...". Vary the closing: sometimes name the winner, sometimes name the decisive gap, sometimes name the next experiment.

Output JSON: {"analysis": "<paragraph>"}`,
        prompt: `Hypothesis ${h.id}: ${h.statement}
Acceptance criteria: ${h.acceptance_criteria.map((c) => `${c.name}: ${c.threshold}`).join("; ")}
Critic assessment: ${a?.status ?? "unknown"} (confidence ${((a?.confidence ?? 0) * 100).toFixed(0)}%)
Critic gaps: ${a?.gaps?.join("; ") ?? "none"}

Evidence (${relevant.length} verified claims for this hypothesis):
${evidencePreview}

Write the analytical paragraph. Return JSON: {"analysis": "..."}`,
        maxRetries: 1,
        endpoint: config.endpoints.synth,
      });
      analysisMap.set(h.id, object.analysis);
    } catch (err: any) {
      console.warn(`[synth] analysis fallback for ${h.id}: ${err.message?.slice(0, 80)}`);
    }
  }));

  // Per-hypothesis sections
  for (const h of plan.hypotheses) {
    const a = criticReport.hypothesis_assessments.find(
      (x: any) => x.hypothesis_id === h.id
    );
    lines.push(`## Hypothesis ${h.id}: ${h.statement.slice(0, 80)}${h.statement.length > 80 ? "…" : ""}`, "");
    lines.push(`**Statement:** ${h.statement}`, "");
    lines.push(
      `**Criteria:** ${h.acceptance_criteria.map((c) => `${c.name}: ${c.threshold}`).join("; ")}`,
      ""
    );
    if (a) {
      lines.push(`**Assessment:** ${a.status} (confidence ${(a.confidence * 100).toFixed(0)}%)`, "");
      if (a.supporting_claims?.length) {
        lines.push(`**Supports:** ${a.supporting_claims.map((id: string) => `[${id}]`).join(", ")}`);
      }
      if (a.contradicting_claims?.length) {
        lines.push(`**Contradicts:** ${a.contradicting_claims.map((id: string) => `[${id}]`).join(", ")}`);
      }
      if (a.gaps?.length) {
        lines.push(`**Gaps:** ${a.gaps.join("; ")}`);
      }
      if (a.recommendation) {
        lines.push(`**Next:** ${a.recommendation}`);
      }
      lines.push("");
    }
    // Narrative analysis paragraph (if generated)
    const analysis = analysisMap.get(h.id);
    if (analysis) {
      lines.push("### Analysis", "", analysis, "");
    }
    // Relevant verified claims for this hypothesis
    const relevant = verified.filter((c) => c.hypothesis_id === h.id);
    if (relevant.length) {
      lines.push("**Evidence:**", "");
      for (const c of relevant.slice(0, 15)) {
        lines.push(`- **[${c.id}]** (${c.type}, conf ${(c.confidence * 100).toFixed(0)}%) ${c.statement}`);
      }
      lines.push("");
    }
  }

  // --- Call 4: Method comparison table (one markdown table) ---
  const allClaimsForTable = verified
    .slice(0, 80)
    .map((c) => `[${c.id}] ${c.statement}`)
    .join("\n");
  let comparisonTable = "";
  try {
    const { object } = await generateJson({
      schema: z.object({
        methods: z
          .array(
            z.object({
              name: z.string(),
              headline_metric: z.string(),
              limitation: z.string(),
              citations: z.array(z.string()),
            })
          )
          .describe("4-7 most-cited methods across the verified evidence, one row each"),
      }),
      system: `You extract a comparison table across methods from the verified evidence. Output the 4-7 most concretely-measured methods — those with numerical results, not just mentions.

For each method row:
  - name: exact method name (TurboQuant, KIVI, KVQuant, AWQ, GPTQ, CommVQ, RotorQuant, FP8 KV, etc.). No generic labels.
  - headline_metric: the single most important measured result from the evidence pool — format "<number> <metric> on <benchmark/model>". Use EXACT numbers.
    GOOD: "87.5% FP16 cache reduction on LLaMA-3.1-8B"
    GOOD: "<0.1 perplexity degradation on Wikitext-2 (3-bit)"
    BAD: "good compression with minor quality loss"
  - limitation: the TRADE-OFF, from claims or the contradictions list. One short phrase.
    GOOD: "Accuracy drops on reasoning benchmarks below 3 bits"
    GOOD: "No fused kernel for SM120 (RTX 5090) yet"
    BAD: "Some quality concerns"
  - citations: array of [C#] IDs from the evidence pool that support this row. Include at least 1, prefer 2.

Rules:
- Pick methods that appear in MULTIPLE claims with numbers. Methods mentioned only once should not be in the table.
- If a method has contradictory reports, mention both in the metric or limitation with citations.
- Do NOT fabricate metrics not in the evidence.
- Never use: significantly, substantially, important, promising.

Output JSON: {"methods": [...]}`,
      prompt: `Topic: ${plan.topic}

Verified claims pool:
${allClaimsForTable}

Return JSON: {"methods": [{"name":"...","headline_metric":"...","limitation":"...","citations":["C1","C2"]}]}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    const rows = object.methods
      .slice(0, 7)
      .map((m) => {
        const cites = m.citations.map((c) => (c.startsWith("[") ? c : `[${c}]`)).join(", ");
        const clean = (s: string) => s.replace(/\|/g, "\\|");
        return `| ${clean(m.name)} | ${clean(m.headline_metric)} | ${clean(m.limitation)} | ${cites} |`;
      })
      .join("\n");
    comparisonTable =
      "| Method | Headline metric | Main limitation | Citations |\n" +
      "|---|---|---|---|\n" +
      rows;
  } catch (err: any) {
    console.warn(`[synth] comparison table fallback: ${err.message?.slice(0, 80)}`);
  }

  if (comparisonTable) {
    lines.push("## Method Comparison", "", comparisonTable, "");
  }

  // Contradictions
  if (criticReport.contradictions?.length) {
    lines.push("## Contradictions", "");
    for (const c of criticReport.contradictions) {
      lines.push(`- **[${c.claim_a}] vs [${c.claim_b}]** — ${c.description}`);
    }
    lines.push("");
  }

  // Deployment sequence
  lines.push("## Deployment Sequence", "");
  for (const step of deploymentBullets) {
    lines.push(`${step.startsWith(/\d/.exec(step)?.[0] ?? "X") ? step : "- " + step}`);
  }
  lines.push("");

  // --- Call 6: Reasoned recommendation (conclusion paragraph) ---
  let recommendation = "";
  try {
    const assessmentsBullets = criticReport.hypothesis_assessments
      .map(
        (a: any) =>
          `${a.hypothesis_id}: ${a.status} (${(a.confidence * 100).toFixed(0)}%) — supports: ${(a.supporting_claims ?? []).join(",")} gaps: ${(a.gaps ?? []).join("; ")}`
      )
      .join("\n");
    const { object } = await generateJson({
      schema: z.object({ recommendation: z.string() }),
      system: `You write a Recommendation paragraph (4-6 sentences) that CLOSES a fact-checked research report. This is the reasoned verdict — what would you actually do today, given what the evidence shows and doesn't show.

Structure (as prose, not bullets):
  1. The RECOMMENDED PRIMARY APPROACH: name the method/stack that is best-supported today, with 1-2 [C#] citations. Include a specific config/number.
  2. The REASONING: why this approach over alternatives — what makes it dominant given the constraint set.
  3. The FALLBACK: if the primary approach fails (missing kernel, regression at target context, etc.), what is the SECOND-CHOICE, with a citation.
  4. The TRIGGER for revisiting: what specific measurement should override the recommendation (e.g. "if WikiText-103 ppl delta on Gemma exceeds 2.5% at 128k, fall back to X").

Rules:
- Every factual claim needs a [C#] citation.
- Pick ACTUAL methods from the evidence pool — do not invent.
- Never use: significantly, substantially, effective, impressive, important, promising.
- Do not restate the hypothesis or executive summary.

Output JSON: {"recommendation": "<paragraph>"}`,
      prompt: `Topic: ${plan.topic}\n\nHypothesis assessments:\n${assessmentsBullets}\n\nContradictions already surfaced: ${(criticReport.contradictions ?? []).length}\n\nReturn JSON: {"recommendation": "..."}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    recommendation = object.recommendation;
  } catch (err: any) {
    console.warn(`[synth] recommendation fallback: ${err.message?.slice(0, 80)}`);
  }

  if (recommendation) {
    lines.push("## Recommendation", "", recommendation, "");
  }

  // Methodology
  lines.push("## Methodology Note", "");
  lines.push(
    `Research collected via SearXNG + Arxiv + OpenAlex + Semantic Scholar across ${plan.hypotheses.length} hypotheses and ${plan.tasks.length} tasks (breadth 6 queries per task, depth 1 deepening, pagination 2 SearXNG pages per query, top 6 tier-sorted URLs per query). Pages scraped via Jina Reader. Learnings extracted by ${config.endpoints.evidence.model}; claims extracted from learnings, then FACT-CHECKED in three layers: (1) URL liveness via HTTP GET with Range header, (2) keyword-based quote consistency against the scraped source content, (3) adversarial LLM review for overreach / out-of-context / misread / fabrication. ${rejectedIds.size} of ${verified.length + rejectedIds.size} candidate claims were rejected and are NOT cited in this report. Sources weighted: primary papers (arxiv/openreview/aclanthology/openalex/s2) > official docs > GitHub > blogs > community.`,
    ""
  );

  // References — only include claims that are actually cited in the report
  // prose. Skips tangential claims that got extracted but no synthesis text
  // picked them up (a curation fix for the "too many refs" signal).
  const bodySoFar = lines.join("\n");
  const citedIds = new Set<string>();
  const citeRe = /\[C(\d+)\]/g;
  for (const m of bodySoFar.matchAll(citeRe)) {
    citedIds.add("C" + m[1]);
  }

  lines.push("## References", "");
  const urlMap = new Map<string, { id: string; title: string }>();
  for (const claim of verified) {
    if (!citedIds.has(claim.id)) continue;
    for (const ref of claim.references ?? []) {
      if (!urlMap.has(ref.url)) {
        urlMap.set(ref.url, { id: claim.id, title: ref.title });
      }
    }
  }
  for (const [url, info] of urlMap) {
    lines.push(`- [${info.id}] [${info.title}](${url})`);
  }
  console.log(
    `[synth] References: ${urlMap.size} cited URLs from ${citedIds.size} cited claims (of ${verified.length} verified)`
  );

  const report = lines.join("\n");
  const reportPath = join(projectDir, "REPORT.md");
  writeFileSync(reportPath, report);
  console.log(`[synth] Written: ${reportPath} (${report.length} chars)`);
  return report;
}
