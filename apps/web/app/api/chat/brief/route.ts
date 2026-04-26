// POST /api/chat/brief — pre-research clarifying chat.
//
// Stateless: the client sends the full message history each turn. The
// assistant asks 1-3 clarifying questions to pin down domain/scope, then
// emits a final brief (topic_refined + domain_hints + constraints +
// question_preview) that the client renders as a Run Research card.
//
// Why: users drop raw INCI ingredient lists or overloaded prompts that
// later cause off-domain matches in harvester (physics-titanium on a
// cosmetic-sunscreen topic). Pinning domain upfront lets the pipeline
// stay on-topic without guessing.

import { requireAuth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const BriefSchema = z.object({
  topic_refined: z.string(),
  domain_hints: z.array(z.string()).describe("Domain keywords the harvester should favor — e.g. 'cosmetic skincare', 'dermatology'"),
  constraints: z
    .array(z.string())
    .describe("Scope limits — e.g. 'exclude food-grade emulsions', 'focus on leave-on products'"),
  question_preview: z
    .array(z.string())
    .describe("3-6 research questions the pipeline will answer"),
});

const ResponseSchema = z.object({
  message: z.string().describe("Assistant's next message — question, clarification, or wrap-up"),
  done: z
    .boolean()
    .describe("True when enough context is gathered and `brief` is ready"),
  brief: BriefSchema.nullish().describe("Final brief, present only when done=true"),
});

const SYSTEM = `You are a research-scope clarifying assistant for an OSS research engine. The user gives you a topic (sometimes messy — raw ingredient lists, compound questions, or vague prompts). Your job is to pin the scope in **at most 3 short turns** so the downstream pipeline (planner → harvester → evidence → verifier → synth) stays on-domain.

HARD CONTRACT (violating any of these breaks the app):
1. If you set done=true, you MUST populate brief with all four fields filled (topic_refined, domain_hints[≥1], constraints[≥0], question_preview[≥3]). brief=null with done=true is FORBIDDEN.
2. If your message to the user claims the brief is ready, locked, generated, сформирован, сгенерирован, OR any synonym — you MUST set done=true AND populate brief in the SAME response. Never announce readiness without emitting the brief payload.
3. If done=false, your message MUST be a single concrete clarifying question. Never narrate "generating", "processing", "locked" with done=false.

Style:
- Terse. One question per turn. No boilerplate.
- Ask the SMALLEST number of questions needed. If the topic is already specific and unambiguous, set done=true on the first turn.
- Questions should resolve: (1) domain / field, (2) scope boundaries / exclusions, (3) primary angle (safety? performance? comparison? deployment?).
- Mirror the user's language (Russian/English/mixed — match them).

Example of a GOOD first turn on an INCI list:
  user: "Water, Cetearyl Alcohol, Polysorbate 60, ..., Titanium Dioxide, ..."
  you: {message: "Это состав какого продукта — cosmetic skincare (крем/лосьон) или food-grade emulsion? И что именно интересует: безопасность для кожи, photostability UV-фильтров, или взаимодействие компонентов?", done: false, brief: null}

Example of a GOOD first turn on an already-specific topic:
  user: "Compare LoRA, QLoRA, DoRA, and full fine-tuning on a 70B model for domain adaptation: VRAM footprint, task degradation, and inference latency impact"
  you: {message: "Scope clear. Emitting research brief.", done: true, brief: {topic_refined: "...", domain_hints: ["LLM fine-tuning", "parameter-efficient methods"], constraints: ["focus on 70B+ scale", "domain adaptation use case"], question_preview: ["How does VRAM footprint scale across LoRA/QLoRA/DoRA/Full-FT?", "...", "..."]}}

Example of BAD first turn:
  user: same INCI list
  you: {message: "Thanks for sharing! Can you provide more context?", done: false, brief: null}  ← flabby, no concrete options

Output JSON only matching the schema — never wrap in markdown, never add prefixes.`;

const EXTEND_SYSTEM = `You are a clarifying assistant for an EXTEND flow. The user already has a completed research on SOURCE_TOPIC; they want to spawn a second research that reuses the same sources but reframes the analysis around an additional angle. Your job is to pin the ANGLE in at most 3 short turns — not restart the whole scope.

HARD CONTRACT (same as scope chat):
1. If done=true, brief MUST be populated. topic_refined = the angle phrased as a 1-sentence research question that BUILDS ON the source topic; domain_hints = 2-4 keywords the new pipeline should favor (often narrower than source); constraints = 1-4 exclusions or emphases; question_preview = 3-6 questions specifically about the new angle.
2. If your message claims readiness, done=true + brief is mandatory.
3. If done=false, message = one concrete clarifying question, never narration.

Style:
- Terse. One question per turn. Mirror user's language.
- Questions resolve: narrower audience / exclusion (drop sources?) / measurement focus / reframing target.

Example:
  source_topic: "How does this cream composition affect skin"
  user angle: "focus on baby/pediatric safety"
  good first turn: {message: "Сузить до pediatric (≤12 лет) или до infants (<2 лет)? И что важнее — аллергический риск или системная абсорбция?", done: false, brief: null}

Output JSON only matching the schema.`;

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const messages = z.array(MessageSchema).safeParse(body.messages ?? []);
  if (!messages.success || messages.data.length === 0) {
    return Response.json(
      { error: "messages array required, at least one user message" },
      { status: 400 }
    );
  }

  const mode = body.mode === "extend" ? "extend" : "new";
  const sourceTopic = String(body.source_topic ?? "").trim();
  const systemPrompt = mode === "extend" ? EXTEND_SYSTEM : SYSTEM;

  // Build a transcript the LLM can follow without ChatCompletion tools.
  // Each turn prefixed by role label. In extend mode we prepend the
  // source research topic so the LLM knows what the user is extending.
  const contextPreamble =
    mode === "extend" && sourceTopic
      ? `SOURCE_TOPIC (the research the user is extending):\n${sourceTopic}\n\n---\n\n`
      : "";
  const transcript =
    contextPreamble +
    messages.data
      .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
      .join("\n\n");

  // Detect a "the model keeps saying 'brief ready' without actually
  // emitting the payload" loop — after the 3rd assistant turn we force
  // done=true regardless of what it thinks.
  const assistantTurns = messages.data.filter((m) => m.role === "assistant").length;
  const forceClose = assistantTurns >= 3;

  const READINESS_RE = /\b(brief|scope|сформирован|сгенерирован|готов|ready|locked|generating|generated|locked in|emitting)\b/i;

  try {
    const { generateJson } = await import("@/lib/llm-client");

    const firstTurnPrompt = forceClose
      ? `Conversation so far:\n\n${transcript}\n\nYou've used 3+ turns already. EMIT THE BRIEF NOW. Set done=true and populate brief with topic_refined, domain_hints, constraints, question_preview. Ask NO more questions.`
      : `Conversation so far:\n\n${transcript}\n\nReply as the assistant. If you have enough context, set done=true AND populate brief in the same response. Otherwise ask ONE clarifying question with done=false and brief=null.`;

    let object = await generateJson({
      schema: ResponseSchema,
      system: systemPrompt,
      prompt: firstTurnPrompt,
      temperature: 0.3,
      maxRetries: 1,
    });

    // Post-check: if the message claims the brief is ready but the model
    // forgot to emit the brief object (or set done=false while claiming
    // readiness), re-call with a strict "emit now" directive. This is
    // the exact failure mode users hit: model narrates "brief locked"
    // but never produces the JSON payload.
    const claimsReady = READINESS_RE.test(object.message ?? "");
    const needsForceEmit =
      (object.done && !object.brief) ||
      (claimsReady && !object.brief) ||
      (forceClose && !object.brief);

    if (needsForceEmit) {
      object = await generateJson({
        schema: ResponseSchema,
        system: systemPrompt,
        prompt: `Conversation so far:\n\n${transcript}\n\n${object.message ? `You just said: "${object.message}" — but you FORGOT to include the brief payload. ` : ""}EMIT THE BRIEF NOW as JSON. Set done=true. Fill brief with topic_refined (1 sentence), domain_hints (2-4 keywords), constraints (1-4 items), question_preview (3-6 concrete questions). DO NOT ask another question.`,
        temperature: 0.2,
        maxRetries: 2,
      });
    }

    // Final guarantee: if done=true came back but somehow brief is still
    // null, demote to done=false + fallback message so the UI doesn't
    // render an empty BriefCard.
    if (object.done && !object.brief) {
      object = {
        ...object,
        done: false,
        message:
          object.message ||
          "Could not finalize the brief. Give me one more sentence about the angle you care about most.",
      };
    }

    return Response.json(object);
  } catch (err: any) {
    return Response.json(
      { error: `Chat failed: ${err?.message ?? String(err)}` },
      { status: 502 }
    );
  }
}
