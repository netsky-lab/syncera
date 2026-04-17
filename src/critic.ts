import { generateJson } from "./llm";
import { CriticReportSchema, type Claim, type CriticReport } from "./schemas/claim";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CRITIC_SYSTEM = `You are a research critic. You evaluate whether the FACT-CHECKED evidence adequately supports or contradicts each hypothesis.

Rules:
- Only use the verified claims provided. Rejected claims are listed separately; do NOT cite them.
- For each hypothesis, assess: well_supported / partially_supported / unsupported / contradicted.
- List supporting and contradicting claim IDs.
- Identify gaps: what evidence is MISSING to make a confident determination? Be specific about WHAT experiments/sources would close the gap.
- Find cross-claim contradictions (e.g. "Paper A shows X improves, Paper B shows X degrades on same benchmark").
- Set confidence 0.0-1.0 per hypothesis AND overall.
- Be harsh. If evidence is weak, say so.
- Summary: 2-3 sentences on the overall research state.`;

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
  });

  const reportPath = join(projectDir, "critic_report.json");
  writeFileSync(reportPath, JSON.stringify(object, null, 2));
  console.log(`[critic] Written: ${reportPath}`);
  console.log(
    `[critic] Overall confidence: ${(object.overall_confidence * 100).toFixed(0)}%`
  );

  return object;
}
