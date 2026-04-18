import { generateJson } from "./llm";
import { config } from "./config";
import { ResearchPlanSchema, type ResearchPlan } from "./schemas/plan";

const PLANNER_SYSTEM_PROMPT = `You are a senior research planner. Produce a plan that structures LITERATURE RESEARCH around concrete questions the user wants answered.

## What the plan is (and is NOT)

The plan is a QUESTION STRUCTURE, not a hypothesis with predicted numeric answers.

DO:
  - Formulate questions the user genuinely needs answered to act on the topic.
  - Decompose each question into 2-4 searchable sub-questions that drive literature queries.
  - Let the topic's scope determine the count — a narrow operational question gets 3 research questions; a broad survey gets 10+. Do not force a target count.

DO NOT:
  - Fabricate numeric thresholds ("≥50% reduction", "≤1.5% perplexity") — those are EVIDENCE outputs, not plan inputs.
  - Frame questions as falsifiable assertions ("TurboQuant achieves X"). Questions should be OPEN: "How much memory does TurboQuant save?".
  - Require empirical validation (running benchmarks). This pipeline answers from LITERATURE only; validation infrastructure is out of scope.

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

Each research question decomposes into 2-4 subquestions with a specific angle:
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
}

export async function makePlan(input: PlannerInput): Promise<ResearchPlan> {
  const prompt = [
    `Research topic: ${input.topic}`,
    input.constraints ? `Additional constraints: ${input.constraints}` : "",
    "",
    "Produce the research plan. Questions count must match the topic scope, not a target number.",
  ]
    .filter(Boolean)
    .join("\n");

  const { object, usage } = await generateJson({
    schema: ResearchPlanSchema,
    system: PLANNER_SYSTEM_PROMPT,
    prompt,
    endpoint: config.endpoints.planner,
  });

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
