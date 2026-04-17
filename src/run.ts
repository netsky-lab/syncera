import { makePlan } from "./planner";
import { harvest } from "./harvester";
import { extractEvidence } from "./evidence";
import { verifyAll } from "./verifier";
import { runCritic } from "./critic";
import { synthesize } from "./synthesizer";
import type { ResearchPlan } from "./schemas/plan";
import type { Claim } from "./schemas/claim";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECTS_DIR = join(import.meta.dir, "..", "projects");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function main() {
  const topic = process.argv[2];
  if (!topic) {
    console.error("Usage: bun run src/run.ts <topic> [constraints]");
    process.exit(1);
  }

  const constraints = process.argv[3];
  const slug = slugify(topic);
  const projectDir = join(PROJECTS_DIR, slug);

  console.log(`\n=== Research Lab ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Project: ${projectDir}\n`);

  for (const sub of ["hypotheses", "sources", "runs"]) {
    mkdirSync(join(projectDir, sub), { recursive: true });
  }

  // --- Phase 1: Planner ---
  let plan: ResearchPlan;
  const planPath = join(projectDir, "plan.json");

  if (existsSync(planPath) && !process.argv.includes("--replan")) {
    console.log("[phase:plan] Using existing plan.json");
    plan = JSON.parse(readFileSync(planPath, "utf-8"));
  } else {
    console.log("[phase:plan] Generating research plan...");
    const t0 = Date.now();
    plan = await makePlan({ topic, constraints });
    console.log(`[phase:plan] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${plan.hypotheses.length} hypotheses, ${plan.tasks.length} tasks\n`);
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
    for (const h of plan.hypotheses) {
      writeFileSync(
        join(projectDir, "hypotheses", `${h.id}.md`),
        [`# ${h.id}: ${h.statement}`, "", "## Acceptance Criteria", ...h.acceptance_criteria.map((c) => `- **${c.name}**: ${c.threshold}`), "", "## Status", "- [ ] Research complete", "- [ ] Validated", ""].join("\n")
      );
    }
  }

  // --- Phase 2: Harvester ---
  const sourcesIndex = join(projectDir, "sources", "index.json");
  if (existsSync(sourcesIndex) && !process.argv.includes("--reharvest")) {
    console.log("[phase:harvest] Using existing sources");
  } else {
    console.log("[phase:harvest] Collecting sources...");
    const t1 = Date.now();
    const sources = await harvest({
      plan,
      projectDir,
      force: process.argv.includes("--reharvest"),
    });
    const total = sources.reduce((n, s) => n + s.results.length, 0);
    console.log(`[phase:harvest] Done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${total} sources\n`);
  }

  // --- Phase 3: Evidence ---
  const claimsPath = join(projectDir, "claims.json");
  if (existsSync(claimsPath) && !process.argv.includes("--re-evidence")) {
    console.log("[phase:evidence] Using existing claims.json");
  } else {
    console.log("[phase:evidence] Extracting claims from sources...");
    const t2 = Date.now();
    const claims = await extractEvidence(plan, projectDir);
    console.log(`[phase:evidence] Done in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${claims.length} claims\n`);
  }

  // --- Phase 3.5: Verifier ---
  const verificationPath = join(projectDir, "verification.json");
  if (existsSync(verificationPath) && !process.argv.includes("--re-verify")) {
    console.log("[phase:verify] Using existing verification.json");
  } else {
    console.log("[phase:verify] Fact-checking claims against sources...");
    const tv = Date.now();
    const claimsForVerify: Claim[] = JSON.parse(
      readFileSync(join(projectDir, "claims.json"), "utf-8")
    );
    await verifyAll({
      claims: claimsForVerify,
      projectDir,
      concurrency: 5,
    });
    console.log(`[phase:verify] Done in ${((Date.now() - tv) / 1000).toFixed(1)}s\n`);
  }

  // --- Phase 4: Critic ---
  const criticPath = join(projectDir, "critic_report.json");
  if (existsSync(criticPath) && !process.argv.includes("--re-critic")) {
    console.log("[phase:critic] Using existing critic_report.json");
  } else {
    console.log("[phase:critic] Running critic...");
    const t3 = Date.now();
    const report = await runCritic(plan, projectDir);
    console.log(`[phase:critic] Done in ${((Date.now() - t3) / 1000).toFixed(1)}s\n`);
  }

  // --- Phase 5: Synthesizer ---
  console.log("[phase:synth] Generating final report...");
  const t4 = Date.now();
  await synthesize(plan, projectDir);
  console.log(`[phase:synth] Done in ${((Date.now() - t4) / 1000).toFixed(1)}s\n`);

  // --- Update README ---
  const claims = JSON.parse(readFileSync(join(projectDir, "claims.json"), "utf-8"));
  const criticReport = JSON.parse(readFileSync(join(projectDir, "critic_report.json"), "utf-8"));
  const readme = [
    `# ${plan.topic}`,
    "",
    `**Generated**: ${new Date().toISOString()}`,
    `**Overall Confidence**: ${(criticReport.overall_confidence * 100).toFixed(0)}%`,
    `**Validation needed**: ${plan.validation_needed}`,
    plan.validation_infra ? `**Validation infra**: ${plan.validation_infra}` : "",
    "",
    "## Hypotheses",
    ...criticReport.hypothesis_assessments.map((a: any) => {
      const h = plan.hypotheses.find((h) => h.id === a.hypothesis_id);
      const icon = a.status === "well_supported" ? "[x]" : a.status === "contradicted" ? "[-]" : "[ ]";
      return `- ${icon} **${a.hypothesis_id}** (${a.status}, ${(a.confidence * 100).toFixed(0)}%): ${h?.statement ?? ""}`;
    }),
    "",
    `## Evidence: ${claims.length} claims extracted`,
    `## Report: [REPORT.md](./REPORT.md)`,
  ].join("\n");
  writeFileSync(join(projectDir, "README.md"), readme);

  console.log(`=== Done ===`);
  console.log(`Project: ${projectDir}`);
  console.log(`REPORT: ${join(projectDir, "REPORT.md")}`);
}

main().catch((err) => {
  console.error("[run] Fatal:", err);
  process.exit(1);
});
