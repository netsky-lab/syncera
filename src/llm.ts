import { z } from "zod";
import { config } from "./config";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

interface EndpointOverride {
  baseURL: string;
  model: string;
  apiKey: string;
}

type EndpointConfig = EndpointOverride;

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
  usage: LlmUsage;
  reasoning: string;
}

interface GenerateToolJsonOptions<T extends z.ZodType> extends GenerateJsonOptions<T> {
  toolName: string;
  toolDescription: string;
}

interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated?: boolean;
  estimatedCostUsd?: number;
}

// --- Core chat completion call ---

interface ChatCallOptions {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  endpoint?: EndpointOverride;
  tools?: any[];
  toolChoice?: any;
}

interface ChatCallResult {
  content: string;
  reasoning: string;
  finishReason: string;
  usage: LlmUsage;
  toolCalls: {
    id?: string;
    type?: string;
    function: { name?: string; arguments: string };
  }[];
}

let telemetryProjectDir: string | null = null;
let telemetryPhase = "unknown";
let llmActive = 0;
const llmQueue: Array<() => void> = [];

export function setLlmTelemetryProject(projectDir: string | null) {
  telemetryProjectDir = projectDir;
}

export function setLlmTelemetryPhase(phase: string) {
  telemetryPhase = phase || "unknown";
}

export function initLlmTelemetry(projectDir: string) {
  telemetryProjectDir = projectDir;
  telemetryPhase = "startup";
  try {
    rotateTelemetryFile(projectDir, "llm_usage.jsonl");
    rotateTelemetryFile(projectDir, "llm_usage_summary.json");
    writeFileSync(join(projectDir, "llm_usage.jsonl"), "");
    writeFileSync(
      join(projectDir, "llm_usage_summary.json"),
      JSON.stringify(
        {
          currency: "USD",
          pricing: {
            input_usd_per_1m: config.llm.pricing.inputUsdPer1M,
            output_usd_per_1m: config.llm.pricing.outputUsdPer1M,
          },
          totals: emptyUsageBucket(),
          by_phase: {},
          models: {},
          updated_at: null,
        },
        null,
        2
      )
    );
  } catch (err: any) {
    console.warn(`[usage] failed to initialize telemetry: ${err?.message ?? err}`);
  }
}

function rotateTelemetryFile(projectDir: string, fileName: string) {
  const path = join(projectDir, fileName);
  if (!existsSync(path)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dot = fileName.lastIndexOf(".");
  const rotated =
    dot > 0
      ? `${fileName.slice(0, dot)}.${stamp}${fileName.slice(dot)}`
      : `${fileName}.${stamp}`;
  try {
    renameSync(path, join(projectDir, rotated));
  } catch (err: any) {
    console.warn(`[usage] failed to rotate ${fileName}: ${err?.message ?? err}`);
  }
}

async function withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = config.llm.maxConcurrency;
  if (llmActive >= max) {
    await new Promise<void>((resolve) => llmQueue.push(resolve));
  }
  llmActive += 1;
  try {
    return await fn();
  } finally {
    llmActive = Math.max(0, llmActive - 1);
    llmQueue.shift()?.();
  }
}

// Always stream responses — prevents Cloudflare/proxy timeouts (524) on long
// generations by keeping the connection active. Retries on transient 5xx.
async function chatCompletion(opts: ChatCallOptions): Promise<ChatCallResult> {
  return withLlmSlot(() => chatCompletionInner(opts));
}

async function chatCompletionInner(opts: ChatCallOptions): Promise<ChatCallResult> {
  const primaryEp = opts.endpoint ?? config.gemma;
  // Endpoint rotation: primary first, then each failover URL in order.
  // On 5xx / timeout / network error, attempt N+1 tries the next endpoint
  // (wrapping to primary when the list is exhausted). Keeps model / apiKey
  // from the original endpoint — we assume failover pods run the same model.
  const endpoints: EndpointConfig[] = [
    primaryEp,
    ...config.failover.map((f) => ({
      baseURL: f.baseURL,
      model: primaryEp.model,
      apiKey: primaryEp.apiKey,
    })),
  ];

  const maxAttempts = Math.max(4, endpoints.length);
  let response: Response | null = null;
  let lastError: string | null = null;
  let ep: EndpointConfig = primaryEp;
  const body: Record<string, any> = {
    model: primaryEp.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    stream: config.llm.stream,
  };
  if (config.llm.stream && config.llm.includeStreamUsage) {
    body.stream_options = { include_usage: true };
  }
  if (config.llm.reasoningEffort) {
    body.reasoning_effort = config.llm.reasoningEffort;
  }
  if (opts.maxTokens && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }
  if (opts.tools?.length) {
    body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Pick endpoint for this attempt: round-robin through the list so we
    // exhaust the primary before repeating. At attempt 1 we're always on
    // primary; at attempt N we're on endpoints[(N-1) % endpoints.length].
    ep = endpoints[(attempt - 1) % endpoints.length]!;
    if (attempt > 1 && endpoints.length > 1) {
      console.warn(
        `[llm] attempt ${attempt}/${maxAttempts} via failover endpoint: ${ep.baseURL}`
      );
    }
    // Per-request timeout — Cloudflare kills idle connections at ~100s;
    // a stuck streaming connection on our side should fail too.
    const reqController = new AbortController();
    const configuredTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? "");
    const requestTimeoutMs =
      Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
        ? configuredTimeoutMs
        : config.llm.stream
          ? 90_000
          : 180_000;
    const reqTimer = setTimeout(() => reqController.abort(), requestTimeoutMs);
    try {
      response = await fetch(`${ep.baseURL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ep.apiKey}`,
          Accept: config.llm.stream ? "text/event-stream" : "application/json",
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
  if (!config.llm.stream) {
    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const reasoning = choice?.message?.reasoning_content ?? "";
    const finishReason = choice?.finish_reason ?? "unknown";
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.function?.name,
        arguments:
          typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {}),
      },
    }));
    const usage = normalizeUsage({
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      messages: opts.messages,
      content: `${content}\n${toolCalls.map((tc: any) => tc.function.arguments).join("\n")}`,
      reasoning,
    });
    recordLlmUsage({
      endpoint: ep,
      mode: opts.tools?.length ? "tool_call" : "text",
      temperature: opts.temperature ?? 0.3,
      finishReason,
      usage,
    });
    return { content, reasoning, finishReason, usage, toolCalls };
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
  const toolCalls: ChatCallResult["toolCalls"] = [];

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
      try { reader.cancel().catch(() => {}); } catch {}
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
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const index = Number(tc.index ?? 0);
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: tc.id,
              type: tc.type,
              function: { name: tc.function?.name, arguments: "" },
            };
          }
          if (tc.id) toolCalls[index]!.id = tc.id;
          if (tc.type) toolCalls[index]!.type = tc.type;
          if (tc.function?.name) toolCalls[index]!.function.name = tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[index]!.function.arguments += tc.function.arguments;
          }
        }
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

  usage = normalizeUsage({
    usage,
    messages: opts.messages,
    content: `${content}\n${toolCalls.map((tc) => tc?.function.arguments ?? "").join("\n")}`,
    reasoning,
  });
  recordLlmUsage({
    endpoint: ep,
    mode: opts.tools?.length ? "tool_call" : "text",
    temperature: opts.temperature ?? 0.3,
    finishReason,
    usage,
  });

  return { content, reasoning, finishReason, usage, toolCalls: toolCalls.filter(Boolean) };
}

// --- Public: generateJson with schema + retry + continuation ---

export async function generateJson<T extends z.ZodType>(
  options: GenerateJsonOptions<T>
): Promise<GenerateJsonResult<z.infer<T>>> {
  return generateToolJson({
    ...options,
    toolName: "submit_structured_output",
    toolDescription:
      "Submit the complete structured object requested by the caller.",
  });
}

// --- Public: generate JSON via OpenAI-compatible function calling ---

export async function generateToolJson<T extends z.ZodType>(
  options: GenerateToolJsonOptions<T>
): Promise<GenerateJsonResult<z.infer<T>>> {
  const {
    schema,
    system,
    prompt,
    maxTokens,
    temperature = config.planner.temperature,
    maxRetries = config.planner.maxRetries,
    toolName,
    toolDescription,
  } = options;

  const parameters = zodToToolParameters(schema);
  let lastErrorHint: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? `${prompt}\n\nCall the ${toolName} function exactly once with the complete object. Do not answer in prose.`
        : `${prompt}\n\nCall the ${toolName} function exactly once with corrected arguments. Previous arguments failed validation:${lastErrorHint ? "\n" + lastErrorHint : ""}`;

    const result = await chatCompletion({
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      temperature,
      maxTokens,
      endpoint: options.endpoint,
      tools: [
        {
          type: "function",
          function: {
            name: toolName,
            description: toolDescription,
            parameters,
          },
        },
      ],
      toolChoice: { type: "function", function: { name: toolName } },
    });

    const call = result.toolCalls.find((tc) => tc.function.name === toolName) ?? result.toolCalls[0];
    const rawArgs = call?.function.arguments?.trim() || result.content.trim();
    if (!rawArgs) {
      lastErrorHint = "No function-call arguments were returned.";
      console.warn(`[llm] Tool call missing arguments on attempt ${attempt + 1}/${maxRetries + 1}`);
      if (attempt < maxRetries) continue;
      throw new Error(`Tool call failed after ${maxRetries + 1} attempts: no arguments`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonPayload(rawArgs));
    } catch (err: any) {
      lastErrorHint = `Tool argument JSON parse error: ${err?.message ?? "malformed JSON"}`;
      console.warn(
        `[llm] Invalid tool JSON on attempt ${attempt + 1}/${maxRetries + 1}: ${rawArgs.slice(0, 200)}`
      );
      if (attempt < maxRetries) continue;
      throw new Error(`Failed to parse tool arguments after ${maxRetries + 1} attempts`);
    }

    const parseResult = schema.safeParse(parsed);
    if (parseResult.success) {
      return { object: parseResult.data, usage: result.usage, reasoning: result.reasoning };
    }

    const issueLines = parseResult.error.issues
      .slice(0, 8)
      .map((i: any) => `- ${i.path.join(".") || "(root)"}: ${i.message}`);
    console.warn(
      `[llm] Tool schema validation failed on attempt ${attempt + 1}/${maxRetries + 1}:`,
      issueLines
    );
    lastErrorHint = issueLines.join("\n");
    if (attempt >= maxRetries) {
      throw new Error(
        `Tool schema validation failed after ${maxRetries + 1} attempts: ${JSON.stringify(parseResult.error.issues.slice(0, 3))}`
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

// --- Usage telemetry / cost estimate ---

function normalizeUsage(args: {
  usage: LlmUsage;
  messages: { role: string; content: string }[];
  content: string;
  reasoning: string;
}): LlmUsage {
  const hasProviderUsage = args.usage.totalTokens > 0;
  const promptTokens = hasProviderUsage
    ? args.usage.promptTokens
    : estimateTokens(args.messages.map((m) => m.content).join("\n"));
  const completionTokens = hasProviderUsage
    ? args.usage.completionTokens
    : estimateTokens(`${args.content}\n${args.reasoning}`);
  const totalTokens = hasProviderUsage
    ? args.usage.totalTokens
    : promptTokens + completionTokens;
  const estimatedCostUsd = estimateCostUsd(promptTokens, completionTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimated: args.usage.estimated ?? !hasProviderUsage,
    estimatedCostUsd,
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // Cheap cross-provider fallback for streaming APIs that omit usage.
  // English/code/research prose tends to land near 3.5-4 chars/token.
  return Math.max(1, Math.ceil(text.length / 4));
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

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  const input = (promptTokens / 1_000_000) * config.llm.pricing.inputUsdPer1M;
  const output =
    (completionTokens / 1_000_000) * config.llm.pricing.outputUsdPer1M;
  return Number((input + output).toFixed(6));
}

function recordLlmUsage(args: {
  endpoint: EndpointOverride;
  mode: "tool_call" | "text";
  temperature: number;
  finishReason: string;
  usage: LlmUsage;
}) {
  if (!telemetryProjectDir) return;
  const record = {
    ts: new Date().toISOString(),
    phase: telemetryPhase,
    provider: config.llm.provider,
    model: args.endpoint.model,
    endpoint: safeEndpointLabel(args.endpoint.baseURL),
    mode: args.mode,
    temperature: args.temperature,
    finish_reason: args.finishReason,
    usage: {
      prompt_tokens: args.usage.promptTokens,
      completion_tokens: args.usage.completionTokens,
      total_tokens: args.usage.totalTokens,
      estimated: Boolean(args.usage.estimated),
      estimated_cost_usd: args.usage.estimatedCostUsd ?? 0,
    },
  };

  try {
    appendFileSync(
      join(telemetryProjectDir, "llm_usage.jsonl"),
      `${JSON.stringify(record)}\n`
    );
    updateUsageSummary(record);
  } catch (err: any) {
    console.warn(`[usage] failed to write telemetry: ${err?.message ?? err}`);
  }
}

function updateUsageSummary(record: any) {
  if (!telemetryProjectDir) return;
  const path = join(telemetryProjectDir, "llm_usage_summary.json");
  const summary = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8"))
    : {
        currency: "USD",
        pricing: {
          input_usd_per_1m: config.llm.pricing.inputUsdPer1M,
          output_usd_per_1m: config.llm.pricing.outputUsdPer1M,
        },
        totals: emptyUsageBucket(),
        by_phase: {},
        models: {},
        updated_at: null,
      };

  addUsage(summary.totals, record.usage);
  if (!summary.by_phase[record.phase]) summary.by_phase[record.phase] = emptyUsageBucket();
  addUsage(summary.by_phase[record.phase], record.usage);
  if (!summary.models[record.model]) summary.models[record.model] = emptyUsageBucket();
  addUsage(summary.models[record.model], record.usage);
  summary.updated_at = record.ts;

  writeFileSync(path, JSON.stringify(summary, null, 2));
}

function emptyUsageBucket() {
  return {
    calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_calls: 0,
    estimated_cost_usd: 0,
  };
}

function addUsage(bucket: any, usage: any) {
  bucket.calls += 1;
  bucket.prompt_tokens += usage.prompt_tokens;
  bucket.completion_tokens += usage.completion_tokens;
  bucket.total_tokens += usage.total_tokens;
  if (usage.estimated) bucket.estimated_calls += 1;
  bucket.estimated_cost_usd = Number(
    (bucket.estimated_cost_usd + (usage.estimated_cost_usd ?? 0)).toFixed(6)
  );
}

function safeEndpointLabel(baseURL: string): string {
  try {
    const u = new URL(baseURL);
    return `${u.protocol}//${u.host}`;
  } catch {
    return baseURL.replace(/[?&]key=[^&]+/i, "key=redacted");
  }
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
      const n =
        data.default_generation_settings?.n_ctx ??
        config.tokens.defaultContextWindow;
      cachedContextWindow = n;
      return n;
    }
  } catch {}
  cachedContextWindow = config.tokens.defaultContextWindow;
  return config.tokens.defaultContextWindow;
}

// Budget remaining for input after reserving for output + safety
export async function inputTokenBudget(outputReserve = 32000, safety = 2000): Promise<number> {
  const nCtx = await getContextWindow();
  return nCtx - outputReserve - safety;
}

// --- Zod schema → human-readable JSON hint for prompts ---

export function zodToJsonHint(schema: z.ZodType): any {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._zod?.def?.shape;
    if (!shape) return {};
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(shape)) {
      // zod 4: description lives on the meta registry (accessed via .meta());
      // zod 3 stashed it on _zod.def.description. Support both.
      const desc =
        (value as any)?.meta?.()?.description ??
        (value as any)?._zod?.def?.description;
      const hint = zodToJsonHint(value as z.ZodType);
      result[key] = desc ? `${JSON.stringify(hint)} // ${desc}` : hint;
    }
    return result;
  }
  if (schema instanceof z.ZodArray) {
    return [zodToJsonHint((schema as any)._zod?.def?.element)];
  }
  if (schema instanceof z.ZodEnum) {
    // zod 4 stores enum entries as an object { "a": "a", "b": "b" };
    // earlier versions used an array. Object.values handles both.
    const entries = (schema as any)._zod?.def?.entries;
    if (entries) {
      const values = Array.isArray(entries) ? entries : Object.values(entries);
      return values.join("|");
    }
    return "enum";
  }
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodOptional) {
    return zodToJsonHint((schema as any)._zod?.def?.innerType) + " (optional)";
  }
  if (schema instanceof z.ZodNullable) {
    return zodToJsonHint((schema as any)._zod?.def?.innerType) + " (nullable)";
  }
  if (schema instanceof z.ZodDefault) {
    return zodToJsonHint((schema as any)._zod?.def?.innerType);
  }
  return "any";
}

function zodToToolParameters(schema: z.ZodType): any {
  const toJSONSchema = (z as any).toJSONSchema;
  if (typeof toJSONSchema === "function") {
    const json = toJSONSchema(schema);
    delete json.$schema;
    return json;
  }
  // Conservative fallback. Current Zod 4 provides toJSONSchema(), but keep
  // the function-call path usable if that API ever disappears.
  return {
    type: "object",
    additionalProperties: true,
    properties: {},
  };
}
