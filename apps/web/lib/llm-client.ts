// Minimal OpenAI-compatible chat-completions helper for web-side LLM
// calls (pre-research chat, etc). Mirrors the shape of src/llm.ts but
// lives in apps/web to avoid cross-monorepo imports that confuse the
// Next standalone tracer.
//
// Env: LLM_* / GEMINI_* / legacy GEMMA_*. Same vars the pipeline uses.

import { z } from "zod";

export interface GenerateJsonOptions<T extends z.ZodType> {
  schema: T;
  system: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
}

export async function generateJson<T extends z.ZodType>(
  opts: GenerateJsonOptions<T>
): Promise<z.infer<T>> {
  const provider = process.env.LLM_PROVIDER?.toLowerCase() === "gemini"
    ? "gemini"
    : "qwen";
  const base = (
    provider === "gemini"
      ? process.env.GEMINI_OPENAI_BASE_URL ??
        process.env.GEMINI_BASE_URL ??
        "https://generativelanguage.googleapis.com/v1beta/openai"
      : process.env.QWEN_BASE_URL ??
        process.env.GEMMA_BASE_URL ??
        ""
  ).replace(/\/+$/, "");
  if (!base) throw new Error("LLM_BASE_URL is not set");
  const model =
    provider === "gemini"
      ? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"
      : process.env.QWEN_MODEL ??
        process.env.GEMMA_MODEL ??
        "qwen3.6-35b-a3b";
  const apiKey =
    provider === "gemini"
      ? process.env.GEMINI_API_KEY ?? "dummy"
      : process.env.QWEN_API_KEY ?? process.env.GEMMA_API_KEY ?? "dummy";
  const url = `${base}/chat/completions`;
  const temperature = opts.temperature ?? 0.2;
  const maxRetries = opts.maxRetries ?? 1;

  let lastError: string | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? `${opts.prompt}\n\nCall the submit_structured_output function exactly once with the complete object. Do not answer in prose.`
        : `${opts.prompt}\n\nCall the submit_structured_output function exactly once with corrected arguments. Previous arguments failed validation:\n${lastError}`;
    try {
      const body: Record<string, any> = {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userPrompt },
        ],
        temperature,
        tools: [
          {
            type: "function",
            function: {
              name: "submit_structured_output",
              description:
                "Submit the complete structured object requested by the caller.",
              parameters: zodToToolParameters(opts.schema),
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "submit_structured_output" },
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const message = data?.choices?.[0]?.message ?? {};
      const toolCall = message.tool_calls?.find(
        (tc: any) => tc.function?.name === "submit_structured_output"
      ) ?? message.tool_calls?.[0];
      const content =
        toolCall?.function?.arguments ??
        message.content ??
        "";
      if (!content) throw new Error("empty LLM response");
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonPayload(content));
      } catch (err: any) {
        lastError = `JSON parse: ${err?.message ?? "malformed"}`;
        if (attempt < maxRetries) continue;
        throw new Error(lastError);
      }
      const check = opts.schema.safeParse(parsed);
      if (check.success) return check.data;
      lastError = check.error.issues
        .slice(0, 5)
        .map((i: any) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      if (attempt >= maxRetries) {
        throw new Error(`Schema validation failed:\n${lastError}`);
      }
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      lastError = err?.message ?? String(err);
    }
  }
  throw new Error("Unreachable");
}

function zodToToolParameters(schema: z.ZodType): any {
  const toJSONSchema = (z as any).toJSONSchema;
  if (typeof toJSONSchema === "function") {
    const json = toJSONSchema(schema);
    delete json.$schema;
    return json;
  }
  return {
    type: "object",
    additionalProperties: true,
    properties: {},
  };
}

function extractJsonPayload(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) return text.slice(firstObj, lastObj + 1);
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) return text.slice(firstArr, lastArr + 1);
  return text;
}
