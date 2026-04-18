import { generateJson } from "./llm";
import { config } from "./config";
import { CriticReportSchema, type Claim, type CriticReport } from "./schemas/claim";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CRITIC_SYSTEM = `You are an adversarial research critic. Evaluate whether verified evidence is sufficient to adopt or reject each hypothesis. Use ONLY the verified claims.

## Decision framework for hypothesis status

Apply the following rules MECHANICALLY, in order. A "topic-relevant claim" is one that mentions the hypothesis's method/technique OR model family OR benchmark — it does not have to match all three.

1. "contradicted" if contradicting claims OUTNUMBER supporting claims of comparable specificity AND source tier.
2. "well_supported" if ≥2 supporting claims where at least ONE directly matches the acceptance criterion (same metric, same method family) AND no unrefuted contradictions.
3. "unsupported" ONLY if ZERO topic-relevant claims exist (not even adjacent evidence). This is rare — it means the research collected nothing useful on the hypothesis subject.
4. "partially_supported" — DEFAULT when topic-relevant claims exist but none hits the exact target config. Partial evidence from adjacent conditions (same method on different model, same metric on different hardware) is partial support, NOT zero support.

Key principle: adjacent evidence IS evidence. If the hypothesis is about "method X on model Y at hardware Z" and claims measure "method X on model Y at hardware W", that's partial support — the method+model combo is validated, only the hardware transfer is untested. Do not mark such cases "unsupported".

## Confidence calibration (per-hypothesis)

- 0.8-1.0: "well_supported" with exact numeric match from ≥2 primary sources.
- 0.55-0.8: "well_supported" without exact criterion match, OR "partially_supported" with strong adjacent evidence from primary sources.
- 0.35-0.55: "partially_supported" with adjacent evidence from mixed sources, OR "contradicted" with clear contradiction.
- 0.15-0.35: "partially_supported" with only blog/community evidence, OR "contradicted" at mixed quality.
- 0.0-0.15: "unsupported" (zero topic-relevant evidence — must justify in gaps).

CRITICAL — confidences MUST DIFFER across hypotheses unless evidence is truly identical. The default anti-pattern is picking 0.60 for all hypotheses — that means you didn't rank them. Before emitting, rank the hypotheses from best-supported to worst, then assign confidences that respect the ranking. Use at least 0.10 spread between consecutive ranks. If you cannot rank (genuine tie), say so in the summary.

## Overall confidence

Arithmetic mean of per-hypothesis confidences. DO NOT average upward — if 2 of 3 hypotheses are unsupported (0.2 + 0.3 + 0.9), the overall is 0.47, not 0.7.

## Gaps section — must be SPECIFIC

For each hypothesis with status != "well_supported", list AT LEAST 1 concrete gap in the format:
  "No benchmark on <dataset> for <method>+<model> combination"
  "Source claims <X> but no measurement of <Y> at target hardware config"
  "Only blog evidence; no peer-reviewed paper covers <specific claim>"

BAD gap: "Need more evidence" (useless).
GOOD gap: "No WikiText-103 perplexity delta measured for INT4 TurboQuant on Gemma-2-27B — only generic Llama-3 numbers available".

## Contradictions — cross-claim only (ACTIVELY SEARCH, do not skip)

Scan ALL verified claims (not just supporting/contradicting labels) for pairs that disagree. Types of contradictions to look for:

1. SAME-METRIC DISAGREEMENT: two claims report the same metric (perplexity, throughput, accuracy) on comparable setups with materially different numbers.
   ✓ "C18: KVQuant <0.1 ppl degradation at 3-bit" vs "C24: per-tensor INT4 causes 25% MMLU drop"
   ✓ "C12: method X +10.9x decode throughput" vs "C33: method X +2.3x on same batch size"

2. MECHANISM DISAGREEMENT: claims about whether a technique works/fails under similar conditions.
   ✓ "C88: vLLM Marlin W4A16 achieves 50.5 tok/s on SM120" vs "C89: vLLM CUTLASS NVFP4 fails on SM120 garbage output"
   ✓ "C45: 2-bit quantization lossless with mixed precision" vs "C16: 2-bit degrades reasoning on AIME/MATH500"

3. SCALING CLAIMS: one claim reports linear scaling, another reports saturation/degradation at similar scale.

For each contradiction you emit, confirm: (a) both claims are on the verified list, (b) they're about measurably comparable things (same model family OR same method OR same metric — not totally unrelated), (c) the numbers or outcomes are genuinely opposed, not just different.

MINIMUM COUNT: if ≥30 verified claims covering ≥3 distinct methods, emit at least 2 contradictions. If ≥100 verified claims, emit at least 3. Realistic multi-method research always surfaces quality/throughput/method-validity disagreements — zero contradictions at this scale means you stopped looking, not that they don't exist. Before emitting the final list, scan the claims a second time looking specifically for: (a) same-method performance numbers that differ by >2x on comparable benchmarks, (b) one claim calling a method "works" and another calling it "fails"/"degrades", (c) opposing perplexity/accuracy deltas at the same bit-width on the same model family.

NOT a contradiction:
  ✗ "C5 discusses INT4, C9 discusses FP8" — just different methods on different setups

## Recommendation — actionable

Each hypothesis's recommendation must be an EXPERIMENT someone can run:
  ✓ "Benchmark INT4 TurboQuant perplexity on WikiText-103 with Gemma-2-27B across 5 seeds to confirm <2% delta"
  ✗ "Do more research"

## Summary

2-3 sentences. First sentence: single biggest finding with numbers. Second: main tension/contradiction. Third: what's the most important remaining uncertainty.

Output JSON only matching the schema.`;

export async function runCritic(
  plan: ResearchPlan,
  projectDir: string
): Promise<CriticReport> {
  const claims: Claim[] = JSON.parse(
    readFileSync(join(projectDir, "claims.json"), "utf-8")
  );

  // Load verification report (if available) to filter claims
  const verificationPath = join(projectDir, "verification.json");
  let verified: Claim[] = claims;
  let rejected: { claim: Claim; verification: Verification }[] = [];

  if (existsSync(verificationPath)) {
    const verData = JSON.parse(readFileSync(verificationPath, "utf-8"));
    const verMap = new Map<string, Verification>();
    for (const v of verData.verifications ?? []) verMap.set(v.claim_id, v);

    verified = [];
    for (const c of claims) {
      const v = verMap.get(c.id);
      if (!v || v.verdict === "verified") {
        verified.push(c);
      } else {
        rejected.push({ claim: c, verification: v });
      }
    }
    console.log(
      `[critic] Using ${verified.length} verified / ${rejected.length} rejected (${claims.length} total)`
    );
  } else {
    console.log(`[critic] No verification.json found — using all ${claims.length} claims`);
  }

  const claimsSummary = verified
    .map((c) => `${c.id} [${c.type}, conf=${c.confidence}] (${c.hypothesis_id}): ${c.statement}`)
    .join("\n");

  const rejectedSummary = rejected.length
    ? `\n\nREJECTED claims (for reference only, do NOT cite):\n${rejected
        .map(
          ({ claim, verification }) =>
            `${claim.id} [${verification.verdict}] ${claim.statement.slice(0, 120)} — ${verification.notes.slice(0, 120)}`
        )
        .join("\n")}`
    : "";

  const hypothesesSummary = plan.hypotheses
    .map(
      (h) =>
        `${h.id}: "${h.statement}" | Criteria: ${h.acceptance_criteria.map((a) => `${a.name}: ${a.threshold}`).join(", ")}`
    )
    .join("\n");

  const prompt = `Hypotheses:
${hypothesesSummary}

Verified claims (${verified.length}):
${claimsSummary}${rejectedSummary}

Evaluate the evidence against each hypothesis. Be critical. Use only verified claims.`;

  console.log(
    `[critic] Evaluating ${verified.length} verified claims against ${plan.hypotheses.length} hypotheses...`
  );

  const { object } = await generateJson({
    schema: CriticReportSchema,
    system: CRITIC_SYSTEM,
    prompt,
    temperature: 0.2,
    endpoint: config.endpoints.critic,
  });

  // Enforce contradiction floor: critic prompt requires 3+ contradictions at
  // 100+ verified claims, but Qwen routinely emits 2 and stops. If we're
  // under floor, make a targeted second call asking for ADDITIONAL
  // contradictions and merge them into the report.
  const contradictionFloor = verified.length >= 150 ? 3 : verified.length >= 30 ? 2 : 0;
  if (
    contradictionFloor > 0 &&
    (object.contradictions?.length ?? 0) < contradictionFloor
  ) {
    const current = object.contradictions ?? [];
    const needed = contradictionFloor - current.length;
    console.log(
      `[critic] Contradiction floor ${contradictionFloor}, found ${current.length} — requesting ${needed} more`
    );
    try {
      const existing =
        current.length > 0
          ? `Already-identified contradictions (DO NOT repeat these pairs):\n${current
              .map((c: any) => `  [${c.claim_a}] vs [${c.claim_b}]: ${c.description}`)
              .join("\n")}\n\n`
          : "";
      const { object: extra } = await generateJson({
        schema: (await import("./schemas/claim")).CriticReportSchema.pick({
          contradictions: true,
        }),
        system: `You are the same adversarial research critic. The previous pass emitted too few contradictions. Find ${needed} ADDITIONAL contradictions from the verified claims — pairs that genuinely disagree, using the types: same-metric disagreement, mechanism disagreement, scaling-claim divergence. Each contradiction MUST cite real claim IDs from the list. Do not repeat already-identified pairs.`,
        prompt: `Verified claims (${verified.length}):\n${claimsSummary}\n\n${existing}Return JSON: {"contradictions": [{"claim_a":"C#","claim_b":"C#","description":"..."}]}`,
        temperature: 0.3,
        maxRetries: 1,
        endpoint: config.endpoints.critic,
      });
      const moreFound = (extra.contradictions ?? []).slice(0, needed);
      if (moreFound.length > 0) {
        object.contradictions = [...current, ...moreFound];
        console.log(`[critic] Added ${moreFound.length} contradictions from second pass`);
      }
    } catch (err: any) {
      console.warn(`[critic] Second-pass contradiction fetch failed: ${err.message?.slice(0, 80)}`);
    }
  }

  const reportPath = join(projectDir, "critic_report.json");
  writeFileSync(reportPath, JSON.stringify(object, null, 2));
  console.log(`[critic] Written: ${reportPath}`);
  console.log(
    `[critic] Overall confidence: ${(object.overall_confidence * 100).toFixed(0)}% — ${(object.contradictions ?? []).length} contradictions`
  );

  return object;
}
