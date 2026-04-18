import { generateJson } from "./llm";
import { config } from "./config";
import {
  AnalysisReportSchema,
  QuestionAnswerSchema,
  type AnalysisReport,
  type QuestionAnswer,
  type Fact,
} from "./schemas/fact";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

const PER_QUESTION_SYSTEM = `You are a research analyst. Given ONE research question and a pool of verified facts, produce a narrative answer. This is an evidence-grounded synthesis, NOT a verdict against a pre-committed hypothesis.

## What the answer is

A 3-6 sentence narrative in plain prose that ANSWERS the research question using the facts provided. Every factual claim cites [F#]. Open with a concrete finding (a number, a named method, a named contradiction) — never with "The available evidence..." or "Preponderance of evidence...".

## Fact usage

- Use 4-8 distinct facts if the evidence pool has ≥15; 3-5 if smaller; whatever the pool allows if tiny.
- Prefer quantitative facts over qualitative ones when both are available.
- When two facts disagree on the same metric or mechanism, surface the disagreement — do not hide it.
- Preserve exact numbers from facts (do NOT round).
- Never use: significantly, substantially, effective, impressive, important, promising.

## Coverage assessment

Classify how well the facts answer the question:
- complete — the question has a concrete answer from facts, no critical unknowns
- partial — answered for some conditions but not the target config (e.g. "KIVI measured on Llama but not Qwen3.6")
- gaps_critical — facts tangentially relate but core of question is unanswered
- insufficient — basically nothing useful collected

## Gaps

Each gap MUST be specific: "No direct ppl measurement for TurboQuant on Qwen3.6-35B-A3B at 64k context" not "more research needed".

## Conflicting facts

A pair of facts disagree when they report opposing numbers on the same metric/model, or one reports method works while another reports it fails. Surface pairs as {fact_a: F#, fact_b: F#, nature: "same metric, different numbers"}. If no conflicts exist in the pool for this question, emit empty list.

## Follow-ups

1-3 concrete next investigations someone could run — specific benchmarks or source types, not "more research".

Output JSON matching the schema exactly.`;

const OVERALL_SYSTEM = `You write the top-level summary of a question-first research report. Given per-question answers and any cross-question tensions, produce 2-4 sentences of prose that capture what the research found without inventing thresholds or verdicts.

Structure:
  Sentence 1: the single most impactful finding, with [F#] citations.
  Sentence 2: the main tension or trade-off across questions, with citations.
  Sentence 3 (optional): what remains unmeasured at the level most relevant to the reader.
  Sentence 4 (optional): the strongest method / approach identified, or lack thereof.

Rules:
- Every factual assertion cites [F#].
- No fabricated thresholds.
- No "we conclude" / "this report shows" scaffolding — get straight to the finding.
- Never use: significantly, substantially, effective, impressive, important, promising.

Cross-question tensions are findings where something measured for Q1 is in tension with something measured for Q3 — surface 0-3 such tensions. If none exist, emit empty list.

Output JSON matching the schema.`;

export async function analyze(
  plan: ResearchPlan,
  projectDir: string
): Promise<AnalysisReport> {
  const facts: Fact[] = JSON.parse(
    readFileSync(join(projectDir, "facts.json"), "utf-8")
  );

  // Filter to verified facts using verification.json
  const verificationPath = join(projectDir, "verification.json");
  let verified: Fact[] = facts;
  const rejected: { fact: Fact; verification: Verification }[] = [];

  if (existsSync(verificationPath)) {
    const verData = JSON.parse(readFileSync(verificationPath, "utf-8"));
    const verMap = new Map<string, Verification>();
    for (const v of verData.verifications ?? []) verMap.set(v.fact_id, v);

    verified = [];
    for (const f of facts) {
      const v = verMap.get(f.id);
      if (!v || v.verdict === "verified") {
        verified.push(f);
      } else {
        rejected.push({ fact: f, verification: v });
      }
    }
    console.log(
      `[analyzer] Using ${verified.length} verified / ${rejected.length} rejected (${facts.length} total)`
    );
  }

  const factsById = new Map(verified.map((f) => [f.id, f]));

  // Build per-question answers in parallel (endpoint has 5 slots,
  // typical plans have 3-12 questions — parallelize with cap)
  const ANALYZER_CONCURRENCY = 4;
  const answers: QuestionAnswer[] = new Array(plan.questions.length);

  async function answerOne(i: number): Promise<void> {
    const q = plan.questions[i]!;

    // Evidence pool for this question:
    //   1. facts tagged with this question_id
    //   2. keyword-matched facts from other questions (topic-adjacent evidence)
    const pool = new Map<string, Fact>();
    for (const f of verified.filter((f) => f.question_id === q.id)) {
      pool.set(f.id, f);
    }
    const questionText = (
      q.question + " " + q.subquestions.map((s) => s.text).join(" ")
    ).toLowerCase();
    const kwTokens = questionText
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const kwSet = new Set(kwTokens);
    const scored = verified
      .filter((f) => !pool.has(f.id))
      .map((f) => {
        const t = f.statement.toLowerCase();
        let score = 0;
        for (const k of kwSet) if (t.includes(k)) score++;
        return { f, score };
      })
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    for (const { f } of scored) pool.set(f.id, f);

    const factList = Array.from(pool.values())
      .slice(0, 30)
      .map(
        (f) =>
          `[${f.id}] (${f.factuality}, conf ${f.confidence}) ${f.statement}`
      )
      .join("\n");

    try {
      const { object } = await generateJson({
        schema: QuestionAnswerSchema,
        system: PER_QUESTION_SYSTEM,
        prompt: `Research question ${q.id} [${q.category}]: ${q.question}

Subquestions:
${q.subquestions.map((s) => `  ${s.id} [${s.angle}]: ${s.text}`).join("\n")}

Verified facts available (${pool.size}):
${factList}

Return JSON matching the schema — answer, key_facts, conflicting_facts, coverage, gaps, follow_ups. Use question_id="${q.id}".`,
        temperature: 0.2,
        maxRetries: 1,
        endpoint: config.endpoints.critic,
      });
      object.question_id = q.id;
      answers[i] = object;
    } catch (err: any) {
      console.warn(
        `[analyzer] ${q.id} answer failed: ${err.message?.slice(0, 100)}`
      );
      answers[i] = {
        question_id: q.id,
        answer: `[Answer generation failed: ${err.message?.slice(0, 80)}]`,
        key_facts: [],
        conflicting_facts: [],
        coverage: "insufficient",
        gaps: ["Analyzer LLM call failed — re-run critic phase"],
        follow_ups: [],
      };
    }
  }

  const queue = plan.questions.map((_, i) => i);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < ANALYZER_CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const i = queue.shift();
          if (i === undefined) return;
          await answerOne(i);
        }
      })()
    );
  }
  await Promise.all(workers);

  // Overall top-level summary + cross-question tensions in one call
  let overall_summary = "";
  let cross_question_tensions: AnalysisReport["cross_question_tensions"] = [];
  try {
    const answerSummaryList = answers
      .map(
        (a) =>
          `${a.question_id} (${a.coverage}): ${a.answer.slice(0, 300)}${a.answer.length > 300 ? "…" : ""}`
      )
      .join("\n\n");
    const { object } = await generateJson({
      schema: z.object({
        overall_summary: z.string(),
        cross_question_tensions: z
          .array(
            z.object({
              description: z.string(),
              involved_questions: z.array(z.string()),
              involved_facts: z.array(z.string()),
            })
          )
          .default([]),
      }),
      system: OVERALL_SYSTEM,
      prompt: `Topic: ${plan.topic}

Per-question answers:
${answerSummaryList}

Return JSON with overall_summary and cross_question_tensions.`,
      temperature: 0.2,
      maxRetries: 1,
      endpoint: config.endpoints.critic,
    });
    overall_summary = object.overall_summary;
    cross_question_tensions = object.cross_question_tensions ?? [];
  } catch (err: any) {
    overall_summary = answers
      .map((a) => a.answer.split(".")[0] + ".")
      .join(" ");
    console.warn(
      `[analyzer] overall summary fallback: ${err.message?.slice(0, 80)}`
    );
  }

  const report: AnalysisReport = {
    answers,
    cross_question_tensions,
    overall_summary,
  };

  const reportPath = join(projectDir, "analysis_report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[analyzer] Written: ${reportPath}`);
  const coverages = answers.map((a) => a.coverage);
  const conflictCount = answers.reduce(
    (n, a) => n + (a.conflicting_facts?.length ?? 0),
    0
  );
  console.log(
    `[analyzer] Coverage: ${coverages.join(" / ")} — ${conflictCount} conflicts + ${cross_question_tensions.length} cross-question tensions`
  );

  return report;
}
