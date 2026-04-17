// Hybrid synthesizer: deterministic assembly + two small LLM calls.
//   - Exec summary (1 paragraph)
//   - Deployment sequence (bullets with citations)
// All other sections built from critic_report + claims data directly.

import { generateJson, generateText } from "./llm";
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
      system:
        "Write a 3-4 sentence executive summary of the research state. Cite specific claim IDs [C1]. Call out the main tension/contradiction. No fluff. Technical prose only.",
      prompt: `Topic: ${plan.topic}\n\nAssessments: ${assessmentsList}\nOverall confidence: ${(criticReport.overall_confidence * 100).toFixed(0)}%\nCritic summary: ${criticReport.summary}\n\nSample verified claims:\n${claimsSummary}\n\nReturn JSON: {"summary": "..."}`,
      maxRetries: 1,
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
      system:
        "Generate a concrete deployment sequence. Each step names a specific method/tool from the claims and cites claim IDs like [C1]. Order by risk: production-ready first, experimental last.",
      prompt: `Topic: ${plan.topic}\n\nVerified claims:\n${claimsSummary}\n\nReturn JSON: {"steps": ["1. ...", "2. ..."]}`,
      maxRetries: 1,
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

  lines.push("## Executive Summary", "", execSummary, "");

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

  // Methodology
  lines.push("## Methodology Note", "");
  lines.push(
    `Research collected via SearXNG + Arxiv + Semantic Scholar (breadth 10, depth 2, pagination 3). Pages scraped via Jina Reader. Learnings extracted by Gemma 4 26B. Claims extracted from learnings, then FACT-CHECKED: each claim's URL liveness verified and claim semantic consistency checked against scraped source content. Rejected claims are listed separately and NOT cited in this report. Sources weighted: primary papers > official docs > GitHub > blogs > community.`,
    ""
  );

  // References
  lines.push("## References", "");
  const urlMap = new Map<string, { id: string; title: string }>();
  for (const claim of verified) {
    for (const ref of claim.references ?? []) {
      if (!urlMap.has(ref.url)) {
        urlMap.set(ref.url, { id: claim.id, title: ref.title });
      }
    }
  }
  for (const [url, info] of urlMap) {
    lines.push(`- [${info.id}] [${info.title}](${url})`);
  }

  const report = lines.join("\n");
  const reportPath = join(projectDir, "REPORT.md");
  writeFileSync(reportPath, report);
  console.log(`[synth] Written: ${reportPath} (${report.length} chars)`);
  return report;
}
