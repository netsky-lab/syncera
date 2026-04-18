import { makePlan } from "./planner";
import { harvest } from "./harvester";
import { extractEvidence } from "./evidence";
import { verifyAll } from "./verifier";
import { analyze } from "./analyzer";
import { synthesize } from "./synthesizer";
import type { ResearchPlan } from "./schemas/plan";
import type { Fact } from "./schemas/fact";
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

  for (const sub of ["sources", "runs"]) {
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
    const subqCount = plan.questions.reduce(
      (n, q) => n + q.subquestions.length,
      0
    );
    console.log(
      `[phase:plan] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${plan.questions.length} questions, ${subqCount} subquestions\n`
    );
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
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
    console.log(
      `[phase:harvest] Done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${total} sources\n`
    );
  }

  // --- Phase 3: Evidence (facts extraction) ---
  const factsPath = join(projectDir, "facts.json");
  if (existsSync(factsPath) && !process.argv.includes("--re-evidence")) {
    console.log("[phase:evidence] Using existing facts.json");
  } else {
    console.log("[phase:evidence] Extracting facts from sources...");
    const t2 = Date.now();
    const facts = await extractEvidence(plan, projectDir);
    console.log(
      `[phase:evidence] Done in ${((Date.now() - t2) / 1000).toFixed(1)}s — ${facts.length} facts\n`
    );
  }

  // --- Phase 3.5: Verifier ---
  const verificationPath = join(projectDir, "verification.json");
  if (existsSync(verificationPath) && !process.argv.includes("--re-verify")) {
    console.log("[phase:verify] Using existing verification.json");
  } else {
    console.log("[phase:verify] Fact-checking facts against sources...");
    const tv = Date.now();
    const facts: Fact[] = JSON.parse(readFileSync(factsPath, "utf-8"));
    await verifyAll({ facts, projectDir, concurrency: 5 });
    console.log(
      `[phase:verify] Done in ${((Date.now() - tv) / 1000).toFixed(1)}s\n`
    );
  }

  // --- Phase 4: Analyzer ---
  const analysisPath = join(projectDir, "analysis_report.json");
  if (existsSync(analysisPath) && !process.argv.includes("--re-analyze")) {
    console.log("[phase:analyze] Using existing analysis_report.json");
  } else {
    console.log("[phase:analyze] Synthesizing per-question answers...");
    const t3 = Date.now();
    await analyze(plan, projectDir);
    console.log(
      `[phase:analyze] Done in ${((Date.now() - t3) / 1000).toFixed(1)}s\n`
    );
  }

  // --- Phase 5: Synthesizer ---
  console.log("[phase:synth] Generating final report...");
  const t4 = Date.now();
  await synthesize(plan, projectDir);
  console.log(
    `[phase:synth] Done in ${((Date.now() - t4) / 1000).toFixed(1)}s\n`
  );

  // --- Update README ---
  const facts: Fact[] = JSON.parse(readFileSync(factsPath, "utf-8"));
  const analysisReport = JSON.parse(readFileSync(analysisPath, "utf-8"));
  const coverageTally: Record<string, number> = {};
  for (const a of analysisReport.answers ?? []) {
    coverageTally[a.coverage] = (coverageTally[a.coverage] ?? 0) + 1;
  }
  const readme = [
    `# ${plan.topic}`,
    "",
    `**Generated**: ${new Date().toISOString()}`,
    `**Questions**: ${plan.questions.length}`,
    `**Facts**: ${facts.length}`,
    `**Coverage tally**: ${Object.entries(coverageTally).map(([k, n]) => `${k}:${n}`).join(" / ")}`,
    "",
    "## Questions",
    ...plan.questions.map((q) => {
      const a = analysisReport.answers?.find(
        (x: any) => x.question_id === q.id
      );
      const icon =
        a?.coverage === "complete"
          ? "[x]"
          : a?.coverage === "partial"
            ? "[~]"
            : a?.coverage === "gaps_critical"
              ? "[!]"
              : "[ ]";
      return `- ${icon} **${q.id}** [${q.category}]: ${q.question}`;
    }),
    "",
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
