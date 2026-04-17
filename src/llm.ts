import { z } from "zod";
import { config } from "./config";

interface EndpointOverride {
  baseURL: string;
  model: string;
  apiKey: string;
}

interface GenerateJsonOptions<T extends z.ZodType> {
  schema: T;
  system: string;
  prompt: string;
  maxTokens?: number;        // hard safety cap; default = no cap (let model finish)
  temperature?: number;
  maxRetries?: number;
  enableContinuation?: boolean; // if finish_reason=length, re-prompt to continue
  endpoint?: EndpointOverride;  // per-phase model override
}

interface GenerateJsonResult<T> {
  object: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  reasoning: string;
}

// --- Core chat completion call ---

interface ChatCallOptions {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
  endpoint?: EndpointOverride;
}

interface ChatCallResult {
  content: string;
  reasoning: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Always stream responses — prevents Cloudflare/proxy timeouts (524) on long
// generations by keeping the connection active. Retries on transient 5xx.
async function chatCompletion(opts: ChatCallOptions): Promise<ChatCallResult> {
  const ep = opts.endpoint ?? config.gemma;
  const body: Record<string, any> = {
    model: ep.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }
  if (opts.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }

  const maxAttempts = 4;
  let response: Response | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Per-request timeout — Cloudflare kills idle connections at ~100s;
    // a stuck streaming connection on our side should fail too.
    const reqController = new AbortController();
    const reqTimer = setTimeout(() => reqController.abort(), 90_000);
    try {
      response = await fetch(`${ep.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ep.apiKey}`,
          Accept: "text/event-stream",
          "Accept-Encoding": "identity",
        },
        body: JSON.stringify(body),
        signal: reqController.signal,
        decompress: false,
      } as any);
      clearTimeout(reqTimer);

      // Retry on transient backend errors
      if (response.status >= 500 && response.status < 600 && attempt < maxAttempts) {
        const text = await response.text().catch(() => "");
        lastError = `HTTP ${response.status}`;
        const wait = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        console.warn(
          `[llm] ${response.status} transient (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms: ${text.slice(0, 80)}`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text.slice(0, 300)}`);
      }
      break; // success
    } catch (err: any) {
      clearTimeout(reqTimer);
      const isTimeout = err.name === "AbortError" || /abort|aborted/i.test(err.message ?? "");
      if (attempt < maxAttempts && (isTimeout || /fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(err.message ?? ""))) {
        lastError = err.message;
        const wait = 2000 * Math.pow(2, attempt - 1);
        console.warn(
          `[llm] ${isTimeout ? "timeout" : "network error"} (attempt ${attempt}/${maxAttempts}), retry in ${wait}ms`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }

  if (!response || !response.ok) {
    throw new Error(`LLM API error after ${maxAttempts} attempts: ${lastError ?? "unknown"}`);
  }
  if (!response.body) {
    throw new Error("No response body (stream expected)");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason = "unknown";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  // Inter-chunk timeout — if we don't receive a byte for N seconds mid-stream,
  // abort via reqController (same abort signal that killed initial fetch).
  // Promise.race approach didn't work because Bun's reader.read() doesn't
  // yield to the timeout; aborting via signal actually cancels the underlying
  // fetch connection.
  const INTER_CHUNK_TIMEOUT_MS = 45_000;
  let chunkTimer: ReturnType<typeof setTimeout> | undefined;
  const resetChunkTimer = () => {
    if (chunkTimer) clearTimeout(chunkTimer);
    chunkTimer = setTimeout(() => {
      console.warn(`[llm] inter-chunk timeout (${INTER_CHUNK_TIMEOUT_MS}ms) — aborting stream`);
      try { reqController.abort(); } catch {}
    }, INTER_CHUNK_TIMEOUT_MS);
  };
  resetChunkTimer();

  while (true) {
    let readResult: { done: boolean; value?: Uint8Array } | undefined;
    try {
      readResult = await reader.read();
      resetChunkTimer(); // data received — reset watchdog
    } catch (err: any) {
      if (chunkTimer) clearTimeout(chunkTimer);
      // ZlibError from Bun's stream decompressor — take what we have so far
      if (/Zlib|Decompression/i.test(err.message ?? "") || err.name === "ZlibError") {
        break;
      }
      // Abort from inter-chunk watchdog — partial content, break loop
      if (err.name === "AbortError" || /abort/i.test(err.message ?? "")) {
        break;
      }
      throw err;
    }
    if (!readResult || readResult.done) {
      if (chunkTimer) clearTimeout(chunkTimer);
      break;
    }
    buffer += decoder.decode(readResult.value!, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete line for next iteration

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        const choice = ev.choices?.[0];
        if (choice?.delta?.content) content += choice.delta.content;
        if (choice?.delta?.reasoning_content) reasoning += choice.delta.reasoning_content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (ev.usage) {
          usage = {
            promptTokens: ev.usage.prompt_tokens ?? usage.promptTokens,
            completionTokens: ev.usage.completion_tokens ?? usage.completionTokens,
            totalTokens: ev.usage.total_tokens ?? usage.totalTokens,
          };
        }
      } catch {
        // Skip unparseable lines (some servers send keep-alive pings)
      }
    }
  }

  return { content, reasoning, finishReason, usage };
}

// --- Public: generateJson with schema + retry + continuation ---

export async function generateJson<T extends z.ZodType>(
  options: GenerateJsonOptions<T>
): Promise<GenerateJsonResult<z.infer<T>>> {
  const {
    schema,
    system,
    prompt,
    maxTokens,              // no default — let model finish
    temperature = config.planner.temperature,
    maxRetries = config.planner.maxRetries,
    enableContinuation = true,
  } = options;

  const schemaJson = JSON.stringify(zodToJsonHint(schema), null, 2);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? `${prompt}\n\nRespond with valid JSON matching this schema:\n${schemaJson}`
        : `${prompt}\n\nRespond with valid JSON matching this schema:\n${schemaJson}\n\nYour previous response did not match the schema. Follow field names and types EXACTLY.`;

    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: userPrompt },
    ];

    let result = await chatCompletion({
      messages,
      temperature,
      maxTokens,
      responseFormat: "json_object",
      endpoint: options.endpoint,
    });

    // Handle finish_reason=length via continuation (rare with max_tokens unset)
    if (result.finishReason === "length" && enableContinuation) {
      console.warn(`[llm] finish_reason=length, attempting continuation (attempt ${attempt + 1})`);
      const continuation = await chatCompletion({
        messages: [
          ...messages,
          { role: "assistant", content: result.content },
          { role: "user", content: "Continue exactly from where you stopped. Do not repeat. End with complete valid JSON." },
        ],
        temperature,
        maxTokens,
        responseFormat: "json_object",
        endpoint: options.endpoint,
      });
      result = {
        content: result.content + continuation.content,
        reasoning: result.reasoning + "\n---\n" + continuation.reasoning,
        finishReason: continuation.finishReason,
        usage: {
          promptTokens: result.usage.promptTokens + continuation.usage.promptTokens,
          completionTokens: result.usage.completionTokens + continuation.usage.completionTokens,
          totalTokens: result.usage.totalTokens + continuation.usage.totalTokens,
        },
      };
    }

    if (result.finishReason !== "stop" && result.finishReason !== "length") {
      console.warn(`[llm] finish_reason=${result.finishReason}, retry ${attempt + 1}/${maxRetries + 1}`);
      if (attempt < maxRetries) continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      console.warn(
        `[llm] Invalid JSON on attempt ${attempt + 1}/${maxRetries + 1}: ${result.content.slice(0, 200)}`
      );
      if (attempt < maxRetries) continue;
      throw new Error(`Failed to parse JSON after ${maxRetries + 1} attempts`);
    }

    const parseResult = schema.safeParse(parsed);
    if (parseResult.success) {
      return { object: parseResult.data, usage: result.usage, reasoning: result.reasoning };
    }

    console.warn(
      `[llm] Schema validation failed on attempt ${attempt + 1}/${maxRetries + 1}:`,
      parseResult.error.issues.slice(0, 5).map((i: any) => `${i.path.join(".")}: ${i.message}`)
    );
    if (attempt >= maxRetries) {
      throw new Error(
        `Schema validation failed after ${maxRetries + 1} attempts: ${JSON.stringify(parseResult.error.issues.slice(0, 3))}`
      );
    }
  }

  throw new Error("Unreachable");
}

// --- Public: generateText for plain prose (no schema) ---

export async function generateText(opts: {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  endpoint?: EndpointOverride;
}): Promise<{ text: string; usage: ChatCallResult["usage"] }> {
  const result = await chatCompletion({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    endpoint: opts.endpoint,
  });
  return { text: result.content, usage: result.usage };
}

// --- Token counting via llama.cpp /tokenize (exact, no approximation) ---

export async function countTokens(text: string): Promise<number> {
  const base = config.gemma.baseURL.replace(/\/v1\/?$/, "");
  const resp = await fetch(`${base}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!resp.ok) {
    // Fallback to rough estimate if /tokenize unavailable
    return Math.ceil(text.length / 3);
  }
  const data = await resp.json();
  return data.tokens?.length ?? Math.ceil(text.length / 3);
}

// Cached — context window doesn't change during a run
let cachedContextWindow: number | null = null;

export async function getContextWindow(): Promise<number> {
  if (cachedContextWindow !== null) return cachedContextWindow;
  const base = config.gemma.baseURL.replace(/\/v1\/?$/, "");
  try {
    const resp = await fetch(`${base}/props`);
    if (resp.ok) {
      const data = await resp.json();
      const n = data.default_generation_settings?.n_ctx ?? 128000;
      cachedContextWindow = n;
      return n;
    }
  } catch {}
  cachedContextWindow = 128000; // safe fallback
  return 128000;
}

// Budget remaining for input after reserving for output + safety
export async function inputTokenBudget(outputReserve = 32000, safety = 2000): Promise<number> {
  const nCtx = await getContextWindow();
  return nCtx - outputReserve - safety;
}

// --- Zod schema → human-readable JSON hint for prompts ---

function zodToJsonHint(schema: z.ZodType): any {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._zod?.def?.shape;
    if (!shape) return {};
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(shape)) {
      const desc = (value as any)?._zod?.def?.description;
      const hint = zodToJsonHint(value as z.ZodType);
      result[key] = desc ? `${JSON.stringify(hint)} // ${desc}` : hint;
    }
    return result;
  }
  if (schema instanceof z.ZodArray) {
    return [zodToJsonHint((schema as any)._zod?.def?.element)];
  }
  if (schema instanceof z.ZodEnum) {
    return (schema as any)._zod?.def?.entries?.join?.("|") ?? "enum";
  }
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodOptional) {
    return zodToJsonHint((schema as any)._zod?.def?.innerType) + " (optional)";
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonHint((schema as any)._zod?.def?.innerType);
  }
  return "any";
}
