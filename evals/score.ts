// Eval scorer — runs over existing projects matching evals/topics.json
// entries and produces a score table covering coverage, hallucination
// rate, citation accuracy, contradiction detection.
//
// Usage:
//   bun run evals/score.ts                    # score all topics that have a project
//   bun run evals/score.ts --topic eval-01    # score one
//   bun run evals/score.ts --md               # emit README-friendly markdown table
//
// The harness is read-only — it doesn't launch pipeline runs. Pipelines
// are kicked off manually (or via /api/runs/start) and the scorer
// picks up the resulting projects/<slug>/ artifacts.

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const PROJECTS_DIR = process.env.PROJECTS_DIR ?? join(ROOT, "projects");

type EvalTopic = {
  id: string;
  topic: string;
  domain: string;
  expected_concepts: string[];
  expected_contradictions: string[];
  notes?: string;
};

type Score = {
  topic_id: string;
  project_slug: string | null;
  // % of expected_concepts that appear (case-insensitive substring) in REPORT.md
  coverage_pct: number;
  missing_concepts: string[];
  // facts rejected by verifier / facts extracted — lower is better
  hallucination_rate: number;
  verified: number;
  rejected: number;
  total_facts: number;
  // cross-question tensions surfaced
  contradictions_surfaced: number;
  // # of expected contradictions explicitly mentioned in REPORT.md
  contradictions_hit: number;
  total_sources: number;
  has_report: boolean;
  notes?: string;
};

function slugify(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function loadTopics(): EvalTopic[] {
  const p = join(ROOT, "evals", "topics.json");
  const data = JSON.parse(readFileSync(p, "utf-8"));
  return data.topics;
}

// Find the project slug that matches this eval topic. First tries
// slugify(topic), then falls back to scanning projects/ for the same
// plan.topic (in case slug got suffixed due to ownership collision).
function findProjectSlug(topic: EvalTopic): string | null {
  const direct = slugify(topic.topic);
  if (existsSync(join(PROJECTS_DIR, direct, "plan.json"))) return direct;
  if (!existsSync(PROJECTS_DIR)) return null;
  for (const d of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const planPath = join(PROJECTS_DIR, d.name, "plan.json");
    if (!existsSync(planPath)) continue;
    try {
      const plan = JSON.parse(readFileSync(planPath, "utf-8"));
      // Match on exact topic (handles `-<uid>` suffixed slugs).
      if (plan.topic === topic.topic) return d.name;
    } catch {}
  }
  return null;
}

function scoreOne(topic: EvalTopic): Score {
  const slug = findProjectSlug(topic);
  const base: Score = {
    topic_id: topic.id,
    project_slug: slug,
    coverage_pct: 0,
    missing_concepts: [...topic.expected_concepts],
    hallucination_rate: 0,
    verified: 0,
    rejected: 0,
    total_facts: 0,
    contradictions_surfaced: 0,
    contradictions_hit: 0,
    total_sources: 0,
    has_report: false,
  };
  if (!slug) {
    base.notes = "no matching project — run the pipeline on this topic first";
    return base;
  }
  const dir = join(PROJECTS_DIR, slug);
  const reportPath = join(dir, "REPORT.md");
  const hasReport = existsSync(reportPath);
  base.has_report = hasReport;
  if (!hasReport) {
    base.notes = "project exists but REPORT.md not yet generated";
    return base;
  }

  const report = readFileSync(reportPath, "utf-8").toLowerCase();
  const missing: string[] = [];
  let hit = 0;
  for (const c of topic.expected_concepts) {
    if (report.includes(c.toLowerCase())) hit++;
    else missing.push(c);
  }
  base.coverage_pct =
    topic.expected_concepts.length > 0
      ? (hit / topic.expected_concepts.length) * 100
      : 0;
  base.missing_concepts = missing;

  // Expected contradictions: score on substring hits of distinctive
  // phrases from each contradiction description.
  for (const c of topic.expected_contradictions) {
    // Take 3-4 salient words from the contradiction description.
    const words = c.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
    const probe = words.slice(0, 2).join(" ");
    if (probe && report.includes(probe)) base.contradictions_hit++;
  }

  // Verifier stats — directly from verification.json.
  const verifPath = join(dir, "verification.json");
  if (existsSync(verifPath)) {
    try {
      const v = JSON.parse(readFileSync(verifPath, "utf-8"));
      base.verified = v?.summary?.verified ?? 0;
      const total = v?.summary?.total ?? 0;
      base.total_facts = total;
      base.rejected = Math.max(0, total - base.verified);
      base.hallucination_rate =
        total > 0 ? (base.rejected / total) * 100 : 0;
    } catch {}
  }

  // Cross-question tensions from analysis.
  const analysisPath = join(dir, "analysis_report.json");
  if (existsSync(analysisPath)) {
    try {
      const a = JSON.parse(readFileSync(analysisPath, "utf-8"));
      base.contradictions_surfaced = (a?.cross_question_tensions ?? []).length;
    } catch {}
  }

  // Sources count.
  const srcIdxPath = join(dir, "sources", "index.json");
  if (existsSync(srcIdxPath)) {
    try {
      const s = JSON.parse(readFileSync(srcIdxPath, "utf-8"));
      base.total_sources = s?.total_sources ?? 0;
    } catch {}
  }

  return base;
}

function formatTable(scores: Score[]): string {
  const rows: string[][] = [
    [
      "Topic",
      "Coverage %",
      "Verified / Total",
      "Hallucination %",
      "Contradictions (surfaced / expected)",
      "Sources",
    ],
    [":---", "---:", "---:", "---:", "---:", "---:"],
  ];
  for (const s of scores) {
    const covered = s.has_report ? s.coverage_pct.toFixed(0) + "%" : "—";
    const verified = s.has_report ? `${s.verified} / ${s.total_facts}` : "—";
    const hallu = s.has_report ? s.hallucination_rate.toFixed(1) + "%" : "—";
    const contr = s.has_report
      ? `${s.contradictions_surfaced} / ${s.contradictions_hit}`
      : "—";
    const sources = s.has_report ? String(s.total_sources) : "—";
    rows.push([s.topic_id, covered, verified, hallu, contr, sources]);
  }
  return rows.map((r) => "| " + r.join(" | ") + " |").join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const topicFilter = args.includes("--topic")
    ? args[args.indexOf("--topic") + 1]
    : null;
  const asMarkdown = args.includes("--md");

  const topics = loadTopics().filter(
    (t) => !topicFilter || t.id === topicFilter
  );
  const scores: Score[] = [];
  for (const t of topics) {
    scores.push(scoreOne(t));
  }

  if (asMarkdown) {
    console.log(formatTable(scores));
    return;
  }

  for (const s of scores) {
    console.log(`\n=== ${s.topic_id} ===`);
    if (!s.has_report) {
      console.log(`  project: ${s.project_slug ?? "(none)"}`);
      console.log(`  ${s.notes ?? "n/a"}`);
      continue;
    }
    console.log(`  project: ${s.project_slug}`);
    console.log(`  coverage: ${s.coverage_pct.toFixed(0)}% (${s.missing_concepts.length} concepts missing)`);
    if (s.missing_concepts.length > 0) {
      console.log(`    missing: ${s.missing_concepts.join(", ")}`);
    }
    console.log(`  verifier: ${s.verified}/${s.total_facts} verified — hallucination ${s.hallucination_rate.toFixed(1)}%`);
    console.log(`  contradictions: ${s.contradictions_surfaced} surfaced / ${s.contradictions_hit} expected hit`);
    console.log(`  sources: ${s.total_sources}`);
  }

  const reported = scores.filter((s) => s.has_report);
  if (reported.length > 0) {
    const avgCov = reported.reduce((n, s) => n + s.coverage_pct, 0) / reported.length;
    const avgHallu = reported.reduce((n, s) => n + s.hallucination_rate, 0) / reported.length;
    console.log(`\n=== AGGREGATE (${reported.length} / ${topics.length} scored) ===`);
    console.log(`  avg coverage:    ${avgCov.toFixed(1)}%`);
    console.log(`  avg hallucination: ${avgHallu.toFixed(1)}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
