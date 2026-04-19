// Question-first synthesizer. Builds REPORT.md from:
//   - plan.json (questions + subquestions)
//   - facts.json (verified + rejected)
//   - verification.json (per-fact verdict)
//   - analysis_report.json (per-question narrative answer + cross-q tensions)
//
// LLM calls are minimized and run in parallel. The analyzer already wrote the
// narrative — the synthesizer adds an Introduction, a Method Comparison table,
// a Deployment Sequence, a Recommendation paragraph, and deterministic assembly
// of the rest.

import { generateJson, generateText } from "./llm";
import { config } from "./config";
import type { Fact, AnalysisReport, QuestionAnswer } from "./schemas/fact";
import type { Verification } from "./schemas/verification";
import type { ResearchPlan } from "./schemas/plan";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

export async function synthesize(
  plan: ResearchPlan,
  projectDir: string
): Promise<string> {
  const allFacts: Fact[] = JSON.parse(
    readFileSync(join(projectDir, "facts.json"), "utf-8")
  );
  const analysis: AnalysisReport = JSON.parse(
    readFileSync(join(projectDir, "analysis_report.json"), "utf-8")
  );

  // Filter to verified
  const verificationPath = join(projectDir, "verification.json");
  let verified: Fact[] = allFacts;
  const rejectedIds = new Set<string>();
  if (existsSync(verificationPath)) {
    const verData = JSON.parse(readFileSync(verificationPath, "utf-8"));
    const verMap = new Map<string, Verification>();
    for (const v of verData.verifications ?? []) verMap.set(v.fact_id, v);
    verified = [];
    for (const f of allFacts) {
      const v = verMap.get(f.id);
      if (!v || v.verdict === "verified") verified.push(f);
      else rejectedIds.add(f.id);
    }
  }
  console.log(
    `[synth] ${verified.length} verified / ${rejectedIds.size} rejected`
  );

  const verifiedById = new Map(verified.map((f) => [f.id, f]));

  // Pick a compact evidence sample for the LLM calls — top facts by confidence.
  const topFactsForPrompt = [...verified]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 60)
    .map(
      (f) =>
        `[${f.id}] (${f.factuality}, conf ${f.confidence}) ${f.statement.slice(0, 260)}`
    )
    .join("\n");

  // --- Fire the 4 LLM-generated sections in parallel ---
  //   intro, comparison table, deployment sequence, recommendation.
  // Each is independent; endpoint has 5 slots.

  const [introduction, comparisonTable, deploymentSteps, recommendation] =
    await Promise.all([
      genIntroduction(plan),
      genComparisonTable(plan, topFactsForPrompt),
      genDeploymentSequence(plan, topFactsForPrompt, analysis),
      genRecommendation(plan, analysis),
    ]);

  // --- Deterministic assembly ---
  const lines: string[] = [];
  lines.push(`# Research Report: ${plan.topic}`, "");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push(
    `*Evidence: ${verified.length} verified facts${rejectedIds.size ? `, ${rejectedIds.size} rejected` : ""} across ${plan.questions.length} questions*`,
    ""
  );

  if (introduction) {
    lines.push("## Introduction", "", introduction, "");
  }

  lines.push("## Summary", "", analysis.overall_summary, "");

  // Per-question sections
  for (const q of plan.questions) {
    const answer = analysis.answers.find((a) => a.question_id === q.id);
    lines.push(
      `## ${q.id}: ${q.question.length > 140 ? q.question.slice(0, 140) + "…" : q.question}`,
      ""
    );
    lines.push(`**Question:** ${q.question}`);
    lines.push(`**Category:** ${q.category}`, "");
    if (q.subquestions.length > 0) {
      lines.push(
        "**Subquestions:**",
        ...q.subquestions.map(
          (s) => `- ${s.id} [${s.angle}] — ${s.text}`
        ),
        ""
      );
    }
    if (answer) {
      lines.push(`**Coverage:** ${answer.coverage}`, "");
      lines.push("### Answer", "", answer.answer, "");
      if (answer.conflicting_facts && answer.conflicting_facts.length > 0) {
        lines.push("**Conflicting findings within this question:**", "");
        for (const cf of answer.conflicting_facts) {
          lines.push(
            `- [${cf.fact_a}] vs [${cf.fact_b}] — ${cf.nature}`
          );
        }
        lines.push("");
      }
      if (answer.gaps && answer.gaps.length > 0) {
        lines.push("**Gaps:**", "");
        for (const g of answer.gaps) lines.push(`- ${g}`);
        lines.push("");
      }
      if (answer.follow_ups && answer.follow_ups.length > 0) {
        lines.push("**Follow-up investigations:**", "");
        for (const f of answer.follow_ups) lines.push(`- ${f}`);
        lines.push("");
      }
    }
    // Up to 15 evidence facts for this question (verified), sorted by confidence
    const qFacts = verified
      .filter((f) => f.question_id === q.id)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);
    if (qFacts.length > 0) {
      lines.push("**Evidence:**", "");
      for (const f of qFacts) {
        lines.push(
          `- **[${f.id}]** (${f.factuality}, conf ${(f.confidence * 100).toFixed(0)}%) ${f.statement}`
        );
      }
      lines.push("");
    }
  }

  // Cross-question tensions
  if (
    analysis.cross_question_tensions &&
    analysis.cross_question_tensions.length > 0
  ) {
    lines.push("## Cross-Question Tensions", "");
    for (const t of analysis.cross_question_tensions) {
      const qs = t.involved_questions.join(", ");
      const fs = t.involved_facts.map((f) => `[${f}]`).join(", ");
      lines.push(`- **Across ${qs}** (${fs}) — ${t.description}`);
    }
    lines.push("");
  }

  // Method comparison table
  if (comparisonTable) {
    lines.push("## Method Comparison", "", comparisonTable, "");
  }

  // Deployment sequence
  if (deploymentSteps.length > 0) {
    lines.push("## Deployment Sequence", "");
    for (const step of deploymentSteps) {
      lines.push(
        `${step.startsWith(/\d/.exec(step)?.[0] ?? "X") ? step : "- " + step}`
      );
    }
    lines.push("");
  }

  // Recommendation
  if (recommendation) {
    lines.push("## Recommendation", "", recommendation, "");
  }

  // Methodology
  lines.push("## Methodology", "");
  lines.push(
    `Question-first research pipeline: planner decomposes the topic into ${plan.questions.length} research questions (${plan.questions.reduce((n, q) => n + q.subquestions.length, 0)} subquestions) without pre-committing to numeric thresholds; harvester collects sources per subquestion via SearXNG + Arxiv + OpenAlex + Semantic Scholar (tier-sorted, primary-first); evidence extraction produces structured facts tagged by subquestion; verifier runs three-layer fact-check (URL liveness / quote-keyword consistency / adversarial LLM review); analyzer synthesizes per-question narrative answers grounded only in verified facts (no thresholds fabricated); synthesizer assembles the final report. ${rejectedIds.size} of ${allFacts.length} candidate facts were rejected and are NOT cited.`,
    ""
  );

  // References — only cited facts
  const bodySoFar = lines.join("\n");
  const citedIds = new Set<string>();
  for (const m of bodySoFar.matchAll(/\[(F\d+)\]/g)) citedIds.add(m[1]!);

  lines.push("## References", "");
  const urlMap = new Map<string, { id: string; title: string }>();
  for (const f of verified) {
    if (!citedIds.has(f.id)) continue;
    for (const ref of f.references ?? []) {
      if (!urlMap.has(ref.url)) {
        urlMap.set(ref.url, { id: f.id, title: ref.title });
      }
    }
  }
  for (const [url, info] of urlMap) {
    lines.push(`- [${info.id}] [${info.title}](${url})`);
  }
  console.log(
    `[synth] References: ${urlMap.size} cited URLs from ${citedIds.size} cited facts (of ${verified.length} verified)`
  );

  const report = lines.join("\n");
  const reportPath = join(projectDir, "REPORT.md");
  writeFileSync(reportPath, report);
  console.log(`[synth] Written: ${reportPath} (${report.length} chars)`);
  return report;
}

// ---------------- LLM sections ----------------

async function genIntroduction(plan: ResearchPlan): Promise<string> {
  try {
    const { object } = await generateJson({
      schema: z.object({ introduction: z.string() }),
      system: `You write the Introduction for a question-first research report — one paragraph (4-6 sentences) of plain-English problem framing.

Structure:
  1. State the practical problem as a reader would encounter it.
  2. Explain WHY it matters (what breaks / what costs / what's at stake).
  3. Name the main approach families the report will cover (from the research questions).
  4. Set expectations: this report answers literature-based research questions, not benchmark-based verdicts.

Rules:
- Plain prose, no bullets, no citations (citations are in per-question sections).
- Do not summarize findings — that's the Summary section's job.
- Write for a senior engineer or researcher.
- Never use: significantly, substantially, effective, impressive, important, promising.

HARDWARE ARITHMETIC (if topic contains GPU/VRAM/context constraints):
- Make the resource budget explicit in one sentence. RTX 5090 = 32GB VRAM, H100 = 80GB, A100 = 40 or 80GB.

Output JSON: {"introduction": "<paragraph>"}`,
      prompt: `Topic: ${plan.topic}

Research questions the report will answer:
${plan.questions.map((q) => `${q.id} [${q.category}]: ${q.question}`).join("\n")}

${plan.scope_notes ? `Scope notes: ${plan.scope_notes}` : ""}

Return JSON: {"introduction": "..."}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    return object.introduction;
  } catch (err: any) {
    console.warn(`[synth] introduction fallback: ${err.message?.slice(0, 80)}`);
    return "";
  }
}

async function genComparisonTable(
  plan: ResearchPlan,
  topFactsBlock: string
): Promise<string> {
  try {
    const { object } = await generateJson({
      schema: z.object({
        methods: z
          .array(
            z.object({
              name: z.string(),
              headline_metric: z.string(),
              limitation: z.string(),
              citations: z.array(z.string()),
            })
          )
          .describe("4-7 most-cited methods across the verified evidence"),
      }),
      system: `You extract a comparison table across methods from verified facts.

For each method row:
  - name: exact method name (TurboQuant, KIVI, KVQuant, AWQ, GPTQ, CommVQ, RotorQuant, FP8 KV, etc.). No generic labels.
  - headline_metric: the single most important measured result — "<number> <metric> on <benchmark/model>". EXACT numbers.
    GOOD: "87.5% FP16 cache reduction on LLaMA-3.1-8B"
  - limitation: the TRADE-OFF. One short phrase.
    GOOD: "Accuracy drops on reasoning benchmarks below 3 bits"
  - citations: array of [F#] IDs from the evidence pool. ≥1, prefer 2.

Rules:
- Pick methods appearing in MULTIPLE facts with numbers.
- If contradictory reports, mention both in the metric or limitation with citations.
- Do NOT fabricate metrics not in the facts.
- Never use: significantly, substantially, important, promising.

Output JSON: {"methods": [...]}`,
      prompt: `Topic: ${plan.topic}

Verified facts pool (top by confidence):
${topFactsBlock}

Return JSON: {"methods": [{"name":"...","headline_metric":"...","limitation":"...","citations":["F1","F2"]}]}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    const rows = object.methods
      .slice(0, 7)
      .map((m) => {
        const cites = m.citations
          .map((c) => (c.startsWith("[") ? c : `[${c}]`))
          .join(", ");
        const clean = (s: string) => s.replace(/\|/g, "\\|");
        return `| ${clean(m.name)} | ${clean(m.headline_metric)} | ${clean(m.limitation)} | ${cites} |`;
      })
      .join("\n");
    return (
      "| Method | Headline metric | Main limitation | Citations |\n" +
      "|---|---|---|---|\n" +
      rows
    );
  } catch (err: any) {
    console.warn(`[synth] comparison table fallback: ${err.message?.slice(0, 80)}`);
    return "";
  }
}

async function genDeploymentSequence(
  plan: ResearchPlan,
  topFactsBlock: string,
  analysis: AnalysisReport
): Promise<string[]> {
  // Extract blockers: facts/methods analyzer flagged as unavailable.
  // These are the methods we MUST NOT include deployment steps for,
  // or must flag as experimental/unavailable when referencing.
  const blockerSnippets = analysis.answers
    .filter(
      (a) => a.coverage === "insufficient" || a.coverage === "gaps_critical"
    )
    .map(
      (a) => `${a.question_id} [${a.coverage}]: ${a.answer.slice(0, 220)}`
    )
    .join("\n");
  try {
    const { object } = await generateJson({
      schema: z.object({
        steps: z
          .array(z.string())
          .describe(
            "3-6 operational steps for an engineer today, ordered by risk (production-ready first). Cite fact IDs [F#]."
          ),
      }),
      system: `You generate a deployment sequence — numbered steps an engineer can execute TODAY. Each step must include a concrete actionable primitive (CLI flag, config, repo URL) and cite a verified fact [F#].

FLAG AUTHENTICITY (critical):
- A CLI flag belongs in a step ONLY IF the verbatim token appears inside the cited fact's statement. Do NOT invent plausible-looking flags.
- If the cited fact names a method without a flag, reference the library / repo / paper, not a fabricated flag.
- FORBIDDEN: invented flags like "--kv-cache-bits=3.5", "--kv-cache-dtype=kvquant".

COHERENCE WITH ANALYZER (critical):
- The analyzer already identified which questions could NOT be answered ("insufficient" or "gaps_critical" coverage). Below you'll see those answers. You MUST NOT propose a deployment step for a method the analyzer flagged as lacking a working implementation, native kernel, or integration path — doing so contradicts our own report and destroys credibility.
- If a method is flagged as not deployable today, either (a) skip it entirely, or (b) include it as the EXPLICITLY experimental last step with wording like "Prototype <method> using the reference implementation at <repo>; note this lacks a <framework>-native kernel as reported in [F#]."
- Prefer methods the analyzer identified as having concrete measurements from primary sources.

Ordering: step 1 = most production-ready, step N = most experimental. 3-6 steps.

Never use: significantly, substantially, important, effective, promising.

Output JSON: {"steps": ["1. ...", "2. ..."]}`,
      prompt: `Topic: ${plan.topic}

Analyzer-flagged limitations you must respect (DO NOT propose steps for methods these answers describe as not deployable):
${blockerSnippets || "(none)"}

Verified facts:
${topFactsBlock}

Return JSON: {"steps": ["1. ...", "2. ..."]}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    return object.steps.slice(0, 6);
  } catch (err: any) {
    console.warn(`[synth] deployment fallback: ${err.message?.slice(0, 80)}`);
    return [];
  }
}

async function genRecommendation(
  plan: ResearchPlan,
  analysis: AnalysisReport
): Promise<string> {
  try {
    const answersBlock = analysis.answers
      .map(
        (a) =>
          `${a.question_id} (${a.coverage}): ${a.answer.slice(0, 300)}`
      )
      .join("\n\n");
    const { object } = await generateJson({
      schema: z.object({ recommendation: z.string() }),
      system: `You write a Recommendation paragraph (4-6 sentences) that closes a question-first research report. This is the reasoned verdict — what to actually do today given what the evidence shows.

Structure (as prose, not bullets):
  1. RECOMMENDED PRIMARY APPROACH: the method/stack best-supported today, with 1-2 [F#] citations and a specific config.
  2. REASONING: why this over alternatives.
  3. FALLBACK: if the primary fails, what's the second choice + a citation.
  4. TRIGGER for revisiting: what specific measurement should override the recommendation.

Rules:
- Every factual claim cites [F#].
- Pick ACTUAL methods from evidence — do not invent.
- Never use: significantly, substantially, effective, impressive, important, promising.

ANTI-SPECULATION (critical):
- Do NOT chain facts from different methods or different papers into an unverified integration claim. If F100 says "method A exists" and F140 says "framework B exists", you CANNOT recommend "deploy A via B" unless a third fact explicitly documents that integration.
- If the best-supported approach comes from a different setup (different model, hardware) than the topic's target, say so explicitly rather than pretending the fit is known.
- If the analyzer marked most questions as "insufficient" / "gaps_critical", the honest primary recommendation is "run the specific benchmarks listed in the follow-ups section before committing to any stack", not a confident stack choice.

Output JSON: {"recommendation": "<paragraph>"}`,
      prompt: `Topic: ${plan.topic}

Per-question answers:
${answersBlock}

Cross-question tensions:
${(analysis.cross_question_tensions ?? []).map((t) => `  - ${t.description}`).join("\n") || "  (none)"}

Return JSON: {"recommendation": "..."}`,
      maxRetries: 1,
      endpoint: config.endpoints.synth,
    });
    return object.recommendation;
  } catch (err: any) {
    console.warn(`[synth] recommendation fallback: ${err.message?.slice(0, 80)}`);
    return "";
  }
}
