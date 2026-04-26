import { makePlan } from "./planner";
import { scout } from "./scout";
import type { ScoutDigest } from "./scout";
import { refine } from "./refine";
import { harvest } from "./harvester";
import { extractEvidence } from "./evidence";
import { verifyAll } from "./verifier";
import { analyze } from "./analyzer";
import { synthesize } from "./synthesizer";
import { runRelevancePhase } from "./relevance";
import { writeEpistemicGraph } from "./epistemic";
import { config } from "./config";
import { initLlmTelemetry, setLlmTelemetryPhase } from "./llm";
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
  // FORCE_SLUG lets the web-side /api/projects/<s>/extend endpoint pin
  // the output slug to a precomputed name (e.g. original slug + extension
  // suffix), so the "extend" flow can pre-copy the source project's
  // artifacts into the new slug dir before the pipeline starts.
  const slug = process.env.FORCE_SLUG || slugify(topic);
  const projectDir = join(PROJECTS_DIR, slug);

  console.log(`\n=== Research Lab ===`);
  console.log(`Topic: ${topic}`);
  console.log(`Project: ${projectDir}\n`);

  for (const sub of ["sources", "runs"]) {
    mkdirSync(join(projectDir, sub), { recursive: true });
  }
  initLlmTelemetry(projectDir);

  // Ownership self-heal: if the web app's pre-claim mkdir raced or failed
  // (e.g. EACCES on a freshly-mounted volume), the pipeline runs as root
  // and would otherwise leave the dir ownerless. Writing `.owner` from
  // here guarantees the project always has a known owner even when the
  // pre-spawn pre-claim in apps/web/lib/runner.ts couldn't create it.
  const ownerUidEnv = process.env.OWNER_UID;
  if (ownerUidEnv) {
    const ownerPath = join(projectDir, ".owner");
    if (!existsSync(ownerPath)) {
      try {
        writeFileSync(ownerPath, ownerUidEnv);
      } catch {}
    }
  }

  // User-curated corpus mode: if USER_SOURCES_FILE env points to a JSON
  // list of URLs, skip scout+harvest and seed evidence from those URLs
  // only. Planner still runs normally.
  const { loadUserSourcesFromEnv, ingestUserSources } = await import(
    "./user-sources"
  );
  const userUrls = loadUserSourcesFromEnv();
  const userCuratedMode = !!userUrls && userUrls.length > 0;
  if (userCuratedMode) {
    console.log(
      `[user-sources] mode active — ${userUrls!.length} URLs provided, scout+harvest will be skipped`
    );
  }

  // --- Phase 0: Scouting ---
  // Optional broad literature survey before planning. Calibrates the
  // planner's questions against what actually exists in the field.
  // Disable with SCOUT_DISABLED=1 or by caching scout_digest.json manually.
  // Also skipped entirely in user-curated mode — the user picked the
  // corpus, no need to calibrate against external literature.
  const scoutPath = join(projectDir, "scout_digest.json");
  let scoutDigest: ScoutDigest | null = null;
  if (userCuratedMode) {
    console.log("[phase:scout] Skipped — user-curated sources mode");
  } else if (existsSync(scoutPath) && !process.argv.includes("--rescout")) {
    console.log("[phase:scout] Using existing scout_digest.json");
    scoutDigest = JSON.parse(readFileSync(scoutPath, "utf-8"));
  } else if (!existsSync(join(projectDir, "plan.json")) || process.argv.includes("--rescout")) {
    setLlmTelemetryPhase("scout");
    console.log("[phase:scout] Surveying literature…");
    const ts = Date.now();
    scoutDigest = await scout(topic);
    if (scoutDigest) {
      writeFileSync(scoutPath, JSON.stringify(scoutDigest, null, 2));
      console.log(
        `[phase:scout] Done in ${((Date.now() - ts) / 1000).toFixed(1)}s\n`
      );
    } else {
      console.log(
        `[phase:scout] Scout returned no digest — planner will run without calibration context\n`
      );
    }
  }

  // --- Phase 1: Planner ---
  let plan: ResearchPlan;
  const planPath = join(projectDir, "plan.json");

  if (existsSync(planPath) && !process.argv.includes("--replan")) {
    console.log("[phase:plan] Using existing plan.json");
    plan = JSON.parse(readFileSync(planPath, "utf-8"));
  } else {
    setLlmTelemetryPhase("plan");
    console.log("[phase:plan] Generating research plan...");
    const t0 = Date.now();
    plan = await makePlan({ topic, constraints, scouting: scoutDigest });
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
  if (userCuratedMode) {
    console.log("[phase:harvest] Skipped — ingesting user-curated URLs");
    const t1 = Date.now();
    const res = await ingestUserSources({
      urls: userUrls!,
      plan,
      projectDir,
    });
    console.log(
      `[phase:harvest] User ingestion done in ${((Date.now() - t1) / 1000).toFixed(1)}s — ${res.ingested} ingested, ${res.failed} failed\n`
    );
  } else if (existsSync(sourcesIndex) && !process.argv.includes("--reharvest")) {
    console.log("[phase:harvest] Using existing sources");
  } else {
    setLlmTelemetryPhase("harvest");
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

  // --- Phase 2.5: Relevance gate ---
  // Rejects sources that keyword-match the topic but operate in a
  // different field (cosmetic TiO2 research → physics paper about
  // radiopure titanium for dark-matter detectors). Per-source LLM call;
  // verdicts stored in-line on each sources/<SQ>.json entry.
  // Cached: already-assessed sources skipped unless --re-relevance.
  if (!process.argv.includes("--skip-relevance")) {
    setLlmTelemetryPhase("relevance");
    console.log("[phase:relevance] Gating off-domain sources...");
    const tr = Date.now();
    const rel = await runRelevancePhase(plan, projectDir, {
      concurrency: config.concurrency.relevance,
      force: process.argv.includes("--re-relevance"),
    });
    console.log(
      `[phase:relevance] Done in ${((Date.now() - tr) / 1000).toFixed(1)}s — ${rel.accepted}/${rel.totalChecked} on-domain${rel.weakSubquestions.length ? `, weak: ${rel.weakSubquestions.join(",")}` : ""}\n`
    );
  }

  // --- Phase 3: Evidence (facts extraction) ---
  const factsPath = join(projectDir, "facts.json");
  if (existsSync(factsPath) && !process.argv.includes("--re-evidence")) {
    console.log("[phase:evidence] Using existing facts.json");
  } else {
    setLlmTelemetryPhase("evidence");
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
    setLlmTelemetryPhase("verify");
    console.log("[phase:verify] Fact-checking facts against sources...");
    const tv = Date.now();
    const facts: Fact[] = JSON.parse(readFileSync(factsPath, "utf-8"));
    await verifyAll({ facts, projectDir, concurrency: config.concurrency.verifier });
    console.log(
      `[phase:verify] Done in ${((Date.now() - tv) / 1000).toFixed(1)}s\n`
    );
  }

  // --- Phase 4: Analyzer ---
  const analysisPath = join(projectDir, "analysis_report.json");
  if (existsSync(analysisPath) && !process.argv.includes("--re-analyze")) {
    console.log("[phase:analyze] Using existing analysis_report.json");
  } else {
    setLlmTelemetryPhase("analyze");
    console.log("[phase:analyze] Synthesizing per-question answers...");
    const t3 = Date.now();
    await analyze(plan, projectDir);
    console.log(
      `[phase:analyze] Done in ${((Date.now() - t3) / 1000).toFixed(1)}s\n`
    );
  }

  // --- Phase 4.5: Epistemic graph ---
  // Deterministic claim lifecycle graph: claim → evidence →
  // counterevidence → confidence → freshness → dependencies → open
  // questions. Cheap to rebuild, but cached unless upstream evidence /
  // verification / analysis changed or --re-epistemic is passed.
  const epistemicPath = join(projectDir, "epistemic_graph.json");
  const shouldRebuildEpistemic =
    process.argv.includes("--re-epistemic") ||
    process.argv.includes("--re-evidence") ||
    process.argv.includes("--re-verify") ||
    process.argv.includes("--re-analyze") ||
    !existsSync(epistemicPath);
  if (!shouldRebuildEpistemic) {
    console.log("[phase:epistemic] Using existing epistemic_graph.json");
  } else {
    console.log("[phase:epistemic] Building claim lifecycle graph...");
    const te = Date.now();
    const graph = writeEpistemicGraph({ plan, projectDir });
    console.log(
      `[phase:epistemic] Done in ${((Date.now() - te) / 1000).toFixed(1)}s — ${graph.claims.length} claims, ${graph.research_debt.length} debt items, ${graph.contradictions.length} contradictions\n`
    );
  }

  // --- Phase 5: Synthesizer ---
  setLlmTelemetryPhase("synth");
  console.log("[phase:synth] Generating final report...");
  const t4 = Date.now();
  await synthesize(plan, projectDir);
  console.log(
    `[phase:synth] Done in ${((Date.now() - t4) / 1000).toFixed(1)}s\n`
  );

  // --- Phase 6: Refinement (optional, --refine) ---
  // Iterative gap-filling: if some questions came back insufficient/gaps_critical,
  // run targeted re-harvest + re-extract + re-verify + re-analyze + re-synth
  // to close specific holes. Off by default (adds 20-40 min).
  if (process.argv.includes("--refine")) {
    setLlmTelemetryPhase("refine");
    console.log("[phase:refine] Targeting weak questions...");
    const tr = Date.now();
    const result = await refine(plan, projectDir);
    console.log(
      `[phase:refine] Done in ${((Date.now() - tr) / 1000).toFixed(1)}s — refined ${result.questionsRefined.length} questions, +${result.additionalFacts} learnings\n`
    );

    if (result.additionalFacts > 0) {
      console.log("[phase:evidence→verify→analyze→synth] Re-running downstream with new learnings...");
      const t5 = Date.now();
      setLlmTelemetryPhase("refine-evidence");
      const facts2 = await extractEvidence(plan, projectDir);
      const factsForVerify: Fact[] = JSON.parse(
        readFileSync(factsPath, "utf-8")
      );
      setLlmTelemetryPhase("refine-verify");
      await verifyAll({ facts: factsForVerify, projectDir, concurrency: config.concurrency.verifier });
      setLlmTelemetryPhase("refine-analyze");
      await analyze(plan, projectDir);
      writeEpistemicGraph({ plan, projectDir });
      setLlmTelemetryPhase("refine-synth");
      await synthesize(plan, projectDir);
      console.log(
        `[phase:refine-downstream] Done in ${((Date.now() - t5) / 1000).toFixed(1)}s — facts now: ${facts2.length}\n`
      );
    }
  }

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
  const usageSummaryPath = join(projectDir, "llm_usage_summary.json");
  if (existsSync(usageSummaryPath)) {
    const usage = JSON.parse(readFileSync(usageSummaryPath, "utf-8"));
    const totals = usage.totals ?? {};
    console.log(
      `[usage] LLM calls: ${totals.calls ?? 0}, tokens: ${totals.total_tokens ?? 0}, estimated cost: $${Number(totals.estimated_cost_usd ?? 0).toFixed(4)}`
    );
    console.log(`USAGE: ${usageSummaryPath}`);
  }
}

main().catch((err) => {
  console.error("[run] Fatal:", err);
  process.exit(1);
});
