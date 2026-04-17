import { z } from "zod";

export const AcceptanceCriterionSchema = z.object({
  name: z.string().describe("Metric name, e.g. 'Perplexity Delta'"),
  threshold: z.string().describe("Pass/fail threshold, e.g. '< 2%'"),
});

export const HypothesisSchema = z.object({
  id: z.string().describe("Unique ID, e.g. H1, H2"),
  statement: z.string().describe("Concrete, falsifiable hypothesis in 1-2 sentences"),
  acceptance_criteria: z.array(AcceptanceCriterionSchema).describe("Measurable criteria"),
});

export const TaskSchema = z.object({
  id: z.string().describe("Unique ID, e.g. T1, T2"),
  hypothesis_id: z.string().describe("Which hypothesis this task supports"),
  type: z.string().describe("Task type, e.g. search_web, read_source, benchmark, implement, compare, evaluate"),
  goal: z.string().describe("What this task aims to find or produce"),
  depends_on: z.array(z.string()).default([]).describe("Task IDs that must complete first"),
});

export const ResearchPlanSchema = z.object({
  topic: z.string().describe("Research topic"),
  hypotheses: z.array(HypothesisSchema).describe("3-10 falsifiable hypotheses"),
  tasks: z.array(TaskSchema).describe("5-15 research tasks"),
  budget: z.object({
    max_steps: z.number().describe("Max research steps"),
    max_sources: z.number().describe("Max sources to collect"),
  }),
  validation_needed: z.boolean().describe("Whether hypotheses need empirical validation"),
  validation_infra: z.string().optional().describe("Infra needed for validation, e.g. 'Runpod with 4x RTX 5090'"),
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type Task = z.infer<typeof TaskSchema>;
