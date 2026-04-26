import { generateToolJson } from "./llm";
import { config } from "./config";
import {
  ResearchPlanSchema,
  type ResearchPlan,
  type ResearchQuestion,
  type Subquestion,
} from "./schemas/plan";
import type { ScoutDigest } from "./scout";

const PLANNER_SYSTEM_PROMPT = `You are a senior research planner. Produce a plan that structures LITERATURE RESEARCH around concrete questions the user wants answered.

## What the plan is (and is NOT)

The plan is a QUESTION STRUCTURE, not a hypothesis with predicted numeric answers.

DO:
  - Formulate questions the user genuinely needs answered to act on the topic.
  - Decompose each question into 2-5 searchable sub-questions that drive literature queries.
  - Let the topic's scope determine the count inside the allowed range: at least 5 research questions, up to 15 for broad / ambiguous / product-critical topics.

DO NOT:
  - Fabricate numeric thresholds ("≥50% reduction", "≤1.5% perplexity") — those are EVIDENCE outputs, not plan inputs.
  - Frame questions as falsifiable assertions ("TurboQuant achieves X"). Questions should be OPEN: "How much memory does TurboQuant save?".
  - Require empirical validation (running benchmarks). This pipeline answers from LITERATURE only; validation infrastructure is out of scope.
  - Treat a target product named in the topic as if its private roadmap, customer deployments, benchmark scores, or internal docs are already public evidence.

## Product-under-evaluation topics

When the topic asks how to improve, evaluate, position, launch, or deploy a product (for example "Syncera before deployment"), the product is the DESIGN TARGET, not an already-proven external source.

DO:
  - Ask what the product SHOULD implement, expose, measure, or prove based on external evidence.
  - Compare against published competitor docs, peer-reviewed methods, public benchmarks, standards, pricing pages, and credible practitioner reports.
  - Frame missing proof as an evidence gap: "What evidence would be needed to validate Syncera's cognitive score?".
  - Search for general trust, attribution, collaboration, evaluation, and reliability literature when the target product has no public docs.

DO NOT:
  - Ask "What benchmark scores has Syncera achieved?", "What customer deployments prove Syncera?", or "How does Syncera implement X?" unless the topic/constraints explicitly supplied public Syncera docs or benchmark reports.
  - Create quoted search targets for non-public product features such as "Syncera trust workflow documentation" when the task is product design rather than vendor due diligence.
  - Convert desired positioning claims ("cognitive superiority") into factual claims that the literature is expected to confirm.

## Shape of a good question

Each question must be concretely answerable from published research, blog posts, or official docs. Use the model / hardware / framework / benchmark names verbatim from the topic.

GOOD questions (answerable from literature):
  ✓ "How much KV-cache VRAM reduction do published methods report for Qwen3 and similar 30B+ MoE models?"
  ✓ "What perplexity degradation has been measured for 4-bit KV quantization on long-context benchmarks?"
  ✓ "Which KV-cache compression methods have upstream vLLM or TensorRT-LLM integration today?"
  ✓ "What are the known failure modes of sub-3-bit KV quantization on reasoning benchmarks?"

BAD questions:
  ✗ "Does TurboQuant achieve ≥50% VRAM reduction on Qwen3.6-35B-A3B?"  — falsifiable assertion with invented threshold
  ✗ "Is quantization effective?"  — not specific enough
  ✗ "What is the best method?"  — subjective; literature doesn't crown winners
  ✗ "How do I implement X?"  — that's engineering, not research

## Categories

Each question has a category that shapes the answer tone:
  - factual: "What X does literature report for Y?"
  - comparative: "How do method A, B, C differ on metric M?"
  - trade_off: "What is the cost of X for gaining Y?"
  - feasibility: "Given constraint C, is approach A viable?"
  - deployment: "What integration paths exist for method M in framework F?"
  - mechanism: "How does technique T work at the architectural level?"

## Subquestions

Each research question decomposes into 2-5 subquestions with a specific angle:
  - benchmark: asks for numerical measurements
  - methodology: asks how the technique works
  - comparison: asks for head-to-head data
  - case_study: asks for production deployment reports
  - feasibility: asks what blockers exist
  - trade_off: asks for negative results or costs

Subquestions drive the harvester's query generation. They must be SEARCHABLE — paper titles, blog posts, or GitHub READMEs would plausibly answer them.

## Verbatim preservation

Model names, hardware names, framework versions from the topic must appear VERBATIM in questions and subquestions. If the topic says "Qwen3.6-35B-A3B", keep that string — do not substitute "Qwen3" or "a 35B model".

## Scope notes

If the topic implies scope that won't be covered, say so in scope_notes. Examples:
  - "Training from scratch is out of scope; this is an inference-only report."
  - "Consumer-GPU context only; datacenter H100/B200 only cited for comparison."

## Output

JSON only, matching the schema. Do NOT include hypotheses, tasks, budget, or acceptance_criteria fields — those belonged to the old schema.`;

export interface PlannerInput {
  topic: string;
  constraints?: string;
  scouting?: ScoutDigest | null;
}

export async function makePlan(input: PlannerInput): Promise<ResearchPlan> {
  // If scouting digest is available, inline it into the planner prompt as
  // ground truth the questions should reference. Planner learns what methods
  // exist in literature and which open questions remain, rather than
  // fabricating from Qwen's priors.
  const scoutingBlock = input.scouting
    ? [
        "",
        "=== SCOUTING DIGEST (ground truth from literature survey) ===",
        "",
        "Methods that appear in the literature:",
        input.scouting.methods_in_literature.map((m) => `  - ${m}`).join("\n"),
        "",
        "Representative numbers observed:",
        input.scouting.typical_numbers.map((n) => `  - ${n}`).join("\n"),
        "",
        "Open questions the literature still debates:",
        input.scouting.open_questions.map((q) => `  - ${q}`).join("\n"),
        "",
        input.scouting.consensus_points.length > 0
          ? "Consensus points (do NOT re-ask these):"
          : "",
        input.scouting.consensus_points.map((c) => `  - ${c}`).join("\n"),
        "",
        input.scouting.key_benchmarks.length > 0
          ? "Benchmarks used by the field:"
          : "",
        input.scouting.key_benchmarks.map((b) => `  - ${b}`).join("\n"),
        "",
        input.scouting.hardware_constraints.length > 0
          ? "Hardware/context constraints in scope:"
          : "",
        input.scouting.hardware_constraints.map((h) => `  - ${h}`).join("\n"),
        "",
        "=== PLANNING GUIDANCE ===",
        "- Use method names from 'Methods that appear in the literature' verbatim when referencing them.",
        "- Prefer open questions that are actually debated (listed above) over questions consensus already settled.",
        "- Hardware/context constraints should be preserved verbatim in relevant questions.",
        "",
      ]
        .filter((l) => l !== null && l !== undefined)
        .join("\n")
    : "";

  const prompt = [
    `Research topic: ${input.topic}`,
    input.constraints ? `Additional constraints: ${input.constraints}` : "",
    scoutingBlock,
    "Produce the research plan. Use 5-15 research questions: never fewer than 5; use 10-15 when the topic has many methods, benchmarks, deployment paths, or unresolved trade-offs.",
    "If the topic is a product evaluation or deploy-readiness audit, treat the named product as the target being designed/audited. Ask what it should prove or implement; do not assume public benchmark scores, customer deployments, or implementation details exist unless provided in the topic or constraints.",
    "IDs must be explicit strings: questions Q1, Q2, ... and subquestions Q1.1, Q1.2, ...",
    "Subquestion angle must be exactly one of: benchmark, methodology, comparison, case_study, feasibility, trade_off.",
    "Question category must be exactly one of: factual, comparative, trade_off, feasibility, deployment, mechanism.",
  ]
    .filter(Boolean)
    .join("\n");

  let object: ResearchPlan;
  let usage: { totalTokens: number };
  try {
    const res = await generateToolJson({
      schema: ResearchPlanSchema,
      system: PLANNER_SYSTEM_PROMPT,
      prompt,
      toolName: "create_research_plan",
      toolDescription:
        "Create the complete question-first research plan for the requested topic.",
      endpoint: config.endpoints.planner,
    });
    object = normalizePlan(res.object, input.topic, input.constraints);
    usage = res.usage;
  } catch (err: any) {
    throw new Error(`Function-call planner failed: ${err.message ?? err}`);
  }

  // Ensure topic is preserved verbatim (Qwen sometimes rewrites it).
  object.topic = input.topic;
  if (input.constraints && !object.constraints) {
    object.constraints = input.constraints;
  }

  console.log(
    `[planner] ${object.questions.length} questions, ${object.questions.reduce(
      (n, q) => n + q.subquestions.length,
      0
    )} subquestions (tokens: ${usage.totalTokens})`
  );

  return object;
}

export function normalizePlan(
  plan: ResearchPlan,
  topic: string,
  constraints?: string
): ResearchPlan {
  const questions = (plan.questions ?? [])
    .filter((q) => q.question?.trim())
    .slice(0, 15)
    .map((q, i) => normalizeQuestion(q, i));

  while (questions.length < 5) {
    const i = questions.length;
    questions.push(
      normalizeQuestion(makeFallbackQuestion(topic, i, constraints), i)
    );
  }

  return {
    ...plan,
    topic,
    constraints: plan.constraints || constraints,
    questions,
  };
}

function normalizeQuestion(q: ResearchQuestion, index: number): ResearchQuestion {
  const id = `Q${index + 1}`;
  const subquestions = (q.subquestions ?? [])
    .filter((s) => s.text?.trim())
    .slice(0, 5);
  while (subquestions.length < 2) {
    subquestions.push(makeFallbackSubquestion(q.question, subquestions.length));
  }
  return {
    ...q,
    id,
    subquestions: subquestions.map((s, i) => ({
      ...s,
      id: `${id}.${i + 1}`,
    })),
  };
}

function makeFallbackSubquestion(question: string, index: number): Subquestion {
  return index === 0
    ? {
        id: "",
        text: `What primary evidence directly answers: ${question}`,
        angle: "benchmark",
      }
    : {
        id: "",
        text: `What limitations, contradictions, or missing evidence affect: ${question}`,
        angle: "trade_off",
      };
}

function makeFallbackQuestion(
  topic: string,
  index: number,
  constraints?: string
): ResearchQuestion {
  const templates = [
    {
      question: `What source types provide the strongest evidence for ${topic}?`,
      category: "factual" as const,
      angles: ["methodology", "comparison"] as const,
    },
    {
      question: `Where do credible sources disagree or leave unresolved gaps on ${topic}?`,
      category: "trade_off" as const,
      angles: ["comparison", "trade_off"] as const,
    },
    {
      question: `What adoption, workflow, or deployment constraints determine whether ${topic} is useful in practice?`,
      category: "deployment" as const,
      angles: ["case_study", "feasibility"] as const,
    },
    {
      question: `Which measurable outcomes should be used to evaluate ${topic}?`,
      category: "mechanism" as const,
      angles: ["benchmark", "methodology"] as const,
    },
    {
      question: `What boundary conditions should prevent overgeneralizing findings about ${topic}${constraints ? ` under ${constraints}` : ""}?`,
      category: "feasibility" as const,
      angles: ["feasibility", "trade_off"] as const,
    },
  ];
  const t = templates[index % templates.length]!;
  return {
    id: "",
    question: t.question,
    category: t.category,
    subquestions: [
      {
        id: "",
        text: `Which primary or official sources directly address: ${t.question}`,
        angle: t.angles[0],
      },
      {
        id: "",
        text: `What evidence would falsify or weaken: ${t.question}`,
        angle: t.angles[1],
      },
    ],
  };
}
