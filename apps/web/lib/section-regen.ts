// Section regenerators for the tweak-and-switch flow. Mirror the prompts
// in src/synthesizer.ts but use the web-side llm-client so we don't pull
// the pipeline's Node toolchain into the Next build.
//
// Keep the prompts in sync with src/synthesizer.ts when updating one.
// This is a duplication but it lets the tweak endpoint stay inside the
// web container — no docker exec, no pipeline spawn per tweak.

import { z } from "zod";
import { generateJson } from "@/lib/llm-client";

const ANTI_STYLE = "Never use: significantly, substantially, effective, impressive, important, promising.";

function tweakHint(hint?: string): string {
  if (!hint || !hint.trim()) return "";
  return `\n\nUSER ADJUSTMENT (apply this to the output — overrides conflicting defaults):\n${hint.trim()}`;
}

export async function tweakIntroduction(
  plan: any,
  hint: string
): Promise<string> {
  const { introduction } = await generateJson({
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
- ${ANTI_STYLE}

Output JSON: {"introduction": "<paragraph>"}`,
    prompt: `Topic: ${plan.topic}

Research questions the report will answer:
${(plan.questions ?? []).map((q: any) => `${q.id} [${q.category}]: ${q.question}`).join("\n")}
${tweakHint(hint)}

Return JSON: {"introduction": "..."}`,
    temperature: 0.3,
    maxRetries: 1,
  });
  return introduction;
}

export async function tweakRecommendation(
  plan: any,
  analysis: any,
  hint: string
): Promise<string> {
  const answersBlock = (analysis?.answers ?? [])
    .map(
      (a: any) =>
        `${a.question_id} (${a.coverage}): ${String(a.answer ?? "").slice(0, 300)}`
    )
    .join("\n\n");
  const { recommendation } = await generateJson({
    schema: z.object({ recommendation: z.string() }),
    system: `You write a Recommendation paragraph (5-7 sentences) that closes a question-first research report. This is the reasoned verdict — what to actually do today given what the evidence shows.

Structure (as prose, not bullets):
  1. LAB / MEASUREMENT PROTOCOL: the best-supported experimental or validation protocol, with 1-2 [F#] citations and a specific config.
  2. PRODUCT / REAL-WORLD DOSING: the safer operational choice for actual product use, field deployment, or customer workflow; do not reuse lab saturation protocols as usage advice unless the evidence explicitly says so.
  3. REASONING: why these contexts differ.
  4. FALLBACK: if the primary protocol or product choice fails, what's the second choice + a citation.
  5. TRIGGER for revisiting: what specific measurement should override the recommendation.

Rules:
- Every factual claim cites [F#].
- Pick ACTUAL methods from evidence — do not invent.
- ${ANTI_STYLE}
- Keep measurement protocols separate from real-world deployment advice. If a high-dose, stress, benchmark, saturation, or accelerated-aging setup is useful for measurement, say it is for measurement/testing only.
- If the evidence does not establish an exact operating threshold for product use, name the missing threshold instead of presenting a lab condition as the product recommendation.
- Do not invert measurement-correction facts. If evidence says excluding, omitting, or failing to account for a correction changes the result, recommend accounting for that correction, not excluding it.

INSTRUMENT GENERICITY (critical):
- When a cited fact names a specific brand / commercial instrument as an example of a measurement category (e.g. VapoMeter, Tewameter, Corneometer), the recommendation MUST generalize to the instrument CATEGORY (e.g. "a TEWL meter", "a skin-barrier probe") unless the study's finding is specifically about that instrument's unique capability.

ANTI-SPECULATION:
- Do NOT chain facts from different methods or papers into unverified integration claims.

Output JSON: {"recommendation": "<paragraph>"}`,
    prompt: `Topic: ${plan.topic}

Per-question answers:
${answersBlock}

Cross-question tensions:
${(analysis?.cross_question_tensions ?? []).map((t: any) => `  - ${t.description}`).join("\n") || "  (none)"}
${tweakHint(hint)}

Return JSON: {"recommendation": "..."}`,
    temperature: 0.3,
    maxRetries: 1,
  });
  return recommendation;
}

export async function tweakSummary(
  plan: any,
  analysis: any,
  hint: string
): Promise<string> {
  const answersBlock = (analysis?.answers ?? [])
    .map(
      (a: any) =>
        `${a.question_id} (${a.coverage}): ${String(a.answer ?? "").slice(0, 300)}`
    )
    .join("\n\n");
  const { summary } = await generateJson({
    schema: z.object({ summary: z.string() }),
    system: `You write the OVERALL SUMMARY paragraph (3-5 sentences) at the top of a research report. This is an editorial synopsis of what the evidence revealed across ALL questions.

Rules:
- Plain prose, no bullets.
- Cite facts as [F#] where load-bearing.
- Be honest about gaps: if most questions have coverage=insufficient or gaps_critical, the summary MUST open by naming that gap, not hide it.
- ${ANTI_STYLE}

Output JSON: {"summary": "<paragraph>"}`,
    prompt: `Topic: ${plan.topic}

Per-question answers:
${answersBlock}

Cross-question tensions:
${(analysis?.cross_question_tensions ?? []).map((t: any) => `  - ${t.description}`).join("\n") || "  (none)"}
${tweakHint(hint)}

Return JSON: {"summary": "..."}`,
    temperature: 0.3,
    maxRetries: 1,
  });
  return summary;
}

export async function tweakComparisonTable(
  plan: any,
  topFactsBlock: string,
  hint: string
): Promise<string> {
  const { methods } = await generateJson({
    schema: z.object({
      methods: z.array(
        z.object({
          name: z.string(),
          headline_metric: z.string(),
          limitation: z.string(),
          citations: z.array(z.string()),
        })
      ),
    }),
    system: `You extract a comparison table across methods from verified facts.

For each row:
  - name: exact method name.
  - headline_metric: single most important measured result.
  - limitation: TRADE-OFF of the method itself. One short phrase.
  - citations: [F#] IDs from the evidence pool.

DOMAIN COHESION (critical):
- Each row must describe a SINGLE method in a SINGLE application context.
- Never merge facts from different application domains (e.g. cosmetic skincare + ophthalmic drug delivery) into one row.
- limitation must be a trade-off of the method ITSELF, not the source's scope.

Rules:
- Pick methods appearing in MULTIPLE facts with numbers.
- Do NOT fabricate metrics.
- ${ANTI_STYLE}

Output JSON: {"methods": [...]}`,
    prompt: `Topic: ${plan.topic}

Verified facts pool (top by confidence):
${topFactsBlock}
${tweakHint(hint)}

Return JSON: {"methods": [{"name":"...","headline_metric":"...","limitation":"...","citations":["F1","F2"]}]}`,
    temperature: 0.2,
    maxRetries: 1,
  });
  const rows = methods
    .slice(0, 7)
    .map((m: any) => {
      const cites = m.citations
        .map((c: string) => (c.startsWith("[") ? c : `[${c}]`))
        .join(", ");
      const clean = (s: string) => String(s).replace(/\|/g, "\\|");
      return `| ${clean(m.name)} | ${clean(m.headline_metric)} | ${clean(m.limitation)} | ${cites} |`;
    })
    .join("\n");
  return `| Method | Headline metric | Main limitation | Citations |\n|---|---|---|---|\n${rows}`;
}

export async function tweakDeployment(
  plan: any,
  topFactsBlock: string,
  analysis: any,
  hint: string
): Promise<string> {
  const blockerSnippets = (analysis?.answers ?? [])
    .filter(
      (a: any) =>
        a.coverage === "insufficient" || a.coverage === "gaps_critical"
    )
    .map(
      (a: any) =>
        `${a.question_id} [${a.coverage}]: ${String(a.answer ?? "").slice(0, 220)}`
    )
    .join("\n");
  const { steps } = await generateJson({
    schema: z.object({ steps: z.array(z.string()) }),
    system: `You generate a deployment sequence — numbered steps an engineer can execute TODAY. Each step cites a verified fact [F#].

Rules:
- 3-6 steps, ordered by risk (production-ready first).
- Do NOT invent CLI flags that aren't in the cited fact.
- If a method is flagged as not deployable, skip it or explicitly mark as experimental.
- ${ANTI_STYLE}

Output JSON: {"steps": ["1. ...", "2. ..."]}`,
    prompt: `Topic: ${plan.topic}

Analyzer-flagged limitations:
${blockerSnippets || "(none)"}

Verified facts:
${topFactsBlock}
${tweakHint(hint)}

Return JSON: {"steps": ["1. ...", "2. ..."]}`,
    temperature: 0.2,
    maxRetries: 1,
  });
  return steps
    .slice(0, 6)
    .map((s: string, i: number) => `${i + 1}. ${s.replace(/^\d+\.\s*/, "")}`)
    .join("\n");
}
