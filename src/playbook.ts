import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { generateJson } from "./llm";
import type { ResearchPlan } from "./schemas/plan";
import type { AnalysisReport, Fact } from "./schemas/fact";
import type { Verification } from "./schemas/verification";
import { PlaybookSchema, type Playbook } from "./schemas/playbook";
import type { EpistemicGraph } from "./epistemic";
import {
  applySourceTrustToFact,
  readSourceStatus,
  sourceTrustForFact,
} from "./source-status";

const PLAYBOOK_SYSTEM = `You are the Knowledge-to-Playbook Compiler for a verified research engine.

Your job is to convert a research report into operational knowledge:
rules, checklists, decision trees, evals, failure modes, interventions, and reusable templates.

Hard rules:
- Use ONLY verified facts supplied in the prompt.
- Every operational claim must cite fact IDs.
- Do not invent thresholds, tools, procedures, or pass/fail criteria that are not grounded in facts.
- If the evidence is thin, turn uncertainty into evals and research debt instead of confident rules.
- Write for a professional operator: founder, analyst, researcher, engineer, or R&D team.
- Prefer specific actions over summaries.
- Never use: significantly, substantially, effective, impressive, important, promising.

Output JSON matching the schema exactly.`;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function verifiedFacts(projectDir: string): Fact[] {
  const allFacts = readJson<Fact[]>(join(projectDir, "facts.json"), []);
  const verification = readJson<{ verifications?: Verification[] }>(
    join(projectDir, "verification.json"),
    {}
  );
  const sourceStatus = readSourceStatus(projectDir);
  const verByFact = new Map(
    (verification.verifications ?? []).map((v) => [v.fact_id, v])
  );
  return allFacts
    .filter((fact) => {
      if (sourceTrustForFact(sourceStatus, fact) === "ignored") return false;
      const verdict = verByFact.get(fact.id)?.verdict;
      return !verdict || verdict === "verified";
    })
    .map((fact) => applySourceTrustToFact(sourceStatus, fact));
}

function factBlock(facts: Fact[]): string {
  return facts
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 80)
    .map((f) => {
      const refs = (f.references ?? [])
        .slice(0, 2)
        .map((r) => r.title || r.url)
        .join("; ");
      return `[${f.id}] (${f.question_id}/${f.subquestion_id}, ${f.factuality}, conf ${f.confidence}) ${f.statement}${refs ? ` Source: ${refs}` : ""}`;
    })
    .join("\n");
}

function analysisBlock(analysis: AnalysisReport): string {
  return [
    `Summary: ${analysis.overall_summary}`,
    "",
    ...(analysis.answers ?? []).map((a) =>
      `${a.question_id} (${a.coverage}): ${a.answer}\nGaps: ${(a.gaps ?? []).join("; ") || "none"}\nFollow-ups: ${(a.follow_ups ?? []).join("; ") || "none"}`
    ),
  ].join("\n\n");
}

function debtBlock(graph: EpistemicGraph | null): string {
  if (!graph?.research_debt?.length) return "(none)";
  return graph.research_debt
    .slice(0, 35)
    .map(
      (d) =>
        `[${d.id}] ${d.severity}/${d.kind} ${d.item} Next: ${d.next_check ?? "none"} Claims: ${(d.depends_on_claims ?? []).slice(0, 8).join(",")}`
    )
    .join("\n");
}

function normalizeCitations(playbook: Playbook, facts: Fact[]): Playbook {
  const valid = new Set(facts.map((f) => f.id));
  const clean = (items: string[] | undefined) =>
    [...new Set((items ?? []).map((c) => c.replace(/^\[|\]$/g, "")).filter((c) => valid.has(c)))];

  for (const rule of playbook.operating_principles) rule.citations = clean(rule.citations);
  for (const checklist of playbook.checklists) {
    for (const item of checklist.items) item.citations = clean(item.citations);
  }
  for (const tree of playbook.decision_trees) {
    for (const branch of tree.branches) branch.citations = clean(branch.citations);
  }
  for (const ev of playbook.evals) ev.citations = clean(ev.citations);
  for (const fm of playbook.failure_modes) fm.citations = clean(fm.citations);
  for (const template of playbook.templates) template.citations = clean(template.citations);
  return playbook;
}

function cited(ids: string[]): string {
  return ids.length ? ` ${ids.map((id) => `[${id}]`).join(" ")}` : "";
}

export function renderPlaybookMarkdown(playbook: Playbook): string {
  const lines: string[] = [];
  lines.push(`# Operational Playbook: ${playbook.topic}`, "");
  lines.push(`*Generated: ${new Date().toISOString()}*`, "");

  if (playbook.operating_principles.length) {
    lines.push("## Operating Principles", "");
    for (const rule of playbook.operating_principles) {
      lines.push(`### ${rule.id}: ${rule.title}`, "");
      lines.push(`**Rule:** ${rule.rule}${cited(rule.citations)}`);
      lines.push(`**Why:** ${rule.rationale}`);
      lines.push(`**Confidence:** ${rule.confidence}`, "");
    }
  }

  if (playbook.checklists.length) {
    lines.push("## Checklists", "");
    for (const checklist of playbook.checklists) {
      lines.push(`### ${checklist.id}: ${checklist.title}`, "");
      for (const item of checklist.items) {
        lines.push(`- ${item.text}${cited(item.citations)}`);
      }
      lines.push("");
    }
  }

  if (playbook.decision_trees.length) {
    lines.push("## Decision Trees", "");
    for (const tree of playbook.decision_trees) {
      lines.push(`### ${tree.id}: ${tree.title}`, "");
      lines.push(`**Start:** ${tree.entry_question}`, "");
      for (const branch of tree.branches) {
        lines.push(`- **If ${branch.condition}:** ${branch.action}${cited(branch.citations)}`);
      }
      lines.push("");
    }
  }

  if (playbook.evals.length) {
    lines.push("## Evals", "");
    for (const ev of playbook.evals) {
      lines.push(`### ${ev.id}: ${ev.name}`, "");
      lines.push(`**Purpose:** ${ev.purpose}${cited(ev.citations)}`);
      lines.push(`**Procedure:** ${ev.procedure}`);
      lines.push(`**Pass criteria:** ${ev.pass_criteria}`, "");
    }
  }

  if (playbook.failure_modes.length) {
    lines.push("## Failure Modes", "");
    for (const fm of playbook.failure_modes) {
      lines.push(`### ${fm.id}: ${fm.failure_mode}`, "");
      lines.push("**Signals:**");
      for (const signal of fm.signals) lines.push(`- ${signal}`);
      lines.push("**Likely causes:**");
      for (const cause of fm.likely_causes) lines.push(`- ${cause}`);
      lines.push("**Interventions:**");
      for (const intervention of fm.interventions) lines.push(`- ${intervention}${cited(fm.citations)}`);
      lines.push("");
    }
  }

  if (playbook.templates.length) {
    lines.push("## Templates", "");
    for (const template of playbook.templates) {
      lines.push(`### ${template.id}: ${template.name}`, "");
      lines.push(`**Use case:** ${template.use_case}${cited(template.citations)}`, "");
      lines.push("```text", template.body, "```", "");
    }
  }

  if (playbook.research_debt.length) {
    lines.push("## Research Debt", "");
    for (const debt of playbook.research_debt) {
      lines.push(
        `- **${debt.severity}:** ${debt.item} Next check: ${debt.next_check}${cited(debt.depends_on_claims)}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function fallbackPlaybook(plan: ResearchPlan, facts: Fact[], graph: EpistemicGraph | null): Playbook {
  const top = facts.slice(0, 8).map((f) => f.id);
  return {
    schema_version: 1,
    topic: plan.topic,
    operating_principles: [
      {
        id: "R1",
        title: "Treat verified evidence as the operating boundary",
        rule: "Do not turn a finding into a rule unless it is backed by verified facts from the run.",
        rationale: top.length
          ? `The current run has verified facts available for synthesis (${top.map((id) => `[${id}]`).join(" ")}).`
          : "The current run has no verified facts available for synthesis.",
        citations: top.slice(0, 5),
        confidence: top.length ? "medium" : "low",
      },
    ],
    checklists: [],
    decision_trees: [],
    evals: [],
    failure_modes: [],
    templates: [],
    research_debt: (graph?.research_debt ?? []).slice(0, 10).map((d) => ({
      item: d.item,
      next_check: d.next_check ?? "Collect stronger verified evidence.",
      severity: d.severity,
      depends_on_claims: d.depends_on_claims ?? [],
    })),
  };
}

export async function compilePlaybook(
  plan: ResearchPlan,
  projectDir: string
): Promise<Playbook> {
  const facts = verifiedFacts(projectDir);
  const analysis = readJson<AnalysisReport>(join(projectDir, "analysis_report.json"), {
    answers: [],
    cross_question_tensions: [],
    overall_summary: "",
  });
  const graph = readJson<EpistemicGraph | null>(
    join(projectDir, "epistemic_graph.json"),
    null
  );

  let playbook: Playbook;
  if (facts.length === 0) {
    playbook = fallbackPlaybook(plan, facts, graph);
  } else {
    try {
      const { object } = await generateJson({
        schema: PlaybookSchema,
        system: PLAYBOOK_SYSTEM,
        prompt: `Topic: ${plan.topic}

Research questions:
${plan.questions.map((q) => `${q.id} [${q.category}]: ${q.question}`).join("\n")}

Verified facts:
${factBlock(facts)}

Analysis:
${analysisBlock(analysis)}

Research debt and next checks:
${debtBlock(graph)}

Compile the operational playbook. Prefer:
- 5-9 operating principles
- 2-4 checklists
- 1-3 decision trees
- 2-5 evals
- 3-7 failure modes
- 1-4 reusable templates

If evidence does not support a section, return fewer items instead of padding.`,
        temperature: 0.2,
        maxRetries: 1,
        endpoint: config.endpoints.synth,
      });
      playbook = normalizeCitations({ ...object, topic: plan.topic }, facts);
    } catch (err: any) {
      console.warn(`[playbook] compiler fallback: ${err.message?.slice(0, 100)}`);
      playbook = fallbackPlaybook(plan, facts, graph);
    }
  }

  const jsonPath = join(projectDir, "playbook.json");
  const mdPath = join(projectDir, "PLAYBOOK.md");
  writeFileSync(jsonPath, JSON.stringify(playbook, null, 2));
  writeFileSync(mdPath, renderPlaybookMarkdown(playbook));
  console.log(`[playbook] Written: ${mdPath}`);
  return playbook;
}
