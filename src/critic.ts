import { generateJson } from "./llm";
import { config } from "./config";
import { CriticReportSchema, type Claim, type CriticReport } from "./schemas/claim";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CRITIC_SYSTEM = `You are an adversarial research critic. Evaluate whether verified evidence is sufficient to adopt or reject each hypothesis. Use ONLY the verified claims.

## Decision framework for hypothesis status

Apply the following rules MECHANICALLY, in order:

1. "contradicted" if contradicting claims >= supporting claims of comparable specificity.
2. "unsupported" if <1 direct supporting claim with exact metric/benchmark match to the hypothesis's acceptance criterion.
3. "well_supported" if >=3 supporting claims from at least 2 DISTINCT primary sources AND no contradictions of similar severity.
4. "partially_supported" otherwise (most common).

## Confidence calibration (per-hypothesis)

- 0.8-1.0: status is "well_supported" AND criterion has numeric match.
- 0.5-0.8: status is "well_supported" without exact criterion match, OR "partially_supported" with strong indirect evidence.
- 0.3-0.5: "partially_supported" with weak/indirect evidence, OR "contradicted" with clear contradiction.
- 0.0-0.3: "unsupported".

## Overall confidence

Arithmetic mean of per-hypothesis confidences. DO NOT average upward — if 2 of 3 hypotheses are unsupported (0.2 + 0.3 + 0.9), the overall is 0.47, not 0.7.

## Gaps section — must be SPECIFIC

For each hypothesis with status != "well_supported", list AT LEAST 1 concrete gap in the format:
  "No benchmark on <dataset> for <method>+<model> combination"
  "Source claims <X> but no measurement of <Y> at target hardware config"
  "Only blog evidence; no peer-reviewed paper covers <specific claim>"

BAD gap: "Need more evidence" (useless).
GOOD gap: "No WikiText-103 perplexity delta measured for INT4 TurboQuant on Gemma-2-27B — only generic Llama-3 numbers available".

## Contradictions — cross-claim only

Find claim pairs where two verified claims make OPPOSING empirical assertions about the same measurable outcome.
  ✓ "C12 says 4-bit Llama -0.7% perplexity; C18 says 4-bit Llama +2.8% perplexity" — real contradiction
  ✗ "C5 discusses INT4, C9 discusses FP8" — just different methods, NOT contradiction

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

  const reportPath = join(projectDir, "critic_report.json");
  writeFileSync(reportPath, JSON.stringify(object, null, 2));
  console.log(`[critic] Written: ${reportPath}`);
  console.log(
    `[critic] Overall confidence: ${(object.overall_confidence * 100).toFixed(0)}%`
  );

  return object;
}
