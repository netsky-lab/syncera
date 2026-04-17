import { generateJson } from "./llm";
import { ResearchPlanSchema, type ResearchPlan } from "./schemas/plan";

const PLANNER_SYSTEM_PROMPT = `You are a research planner. Your job is to create a structured research plan.

Rules:
- Generate 3-10 concrete, falsifiable hypotheses. Each must have measurable acceptance criteria.
- Generate 5-15 research tasks. Each task supports a specific hypothesis.
- Tasks can depend on other tasks (use depends_on with task IDs).
- If hypotheses require empirical validation (running code, benchmarks, infrastructure), set validation_needed=true and describe what infra is needed.
- Be specific: use real metric names, real tools, real model names. No vague statements.
- Output valid JSON matching the provided schema EXACTLY. Use the exact field names from the schema.`;

export interface PlannerInput {
  topic: string;
  constraints?: string;
}

export async function makePlan(input: PlannerInput): Promise<ResearchPlan> {
  const prompt = [
    `Research topic: ${input.topic}`,
    input.constraints ? `Constraints: ${input.constraints}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { object, usage } = await generateJson({
    schema: ResearchPlanSchema,
    system: PLANNER_SYSTEM_PROMPT,
    prompt,
  });

  console.log(
    `[planner] tokens: ${usage.totalTokens} (prompt: ${usage.promptTokens}, completion: ${usage.completionTokens})`
  );

  return object;
}
