interface EndpointConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

type LlmProvider = "qwen" | "gemini";

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "");
}

function normalizeProvider(value: string | undefined): LlmProvider {
  const v = value?.trim().toLowerCase();
  if (v === "gemini") return "gemini";
  // Back-compat aliases for the old single OpenAI-compatible endpoint naming.
  if (v === "openai-compatible" || v === "gemma" || v === "qwen") return "qwen";
  return "qwen";
}

const provider = normalizeProvider(process.env.LLM_PROVIDER);
const isGemini = provider === "gemini";
const geminiOpenAIBaseURL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const geminiNativeBaseURL = "https://generativelanguage.googleapis.com/v1beta";

const qwenEndpoint: EndpointConfig = {
  baseURL: normalizeBaseURL(
    firstEnv("QWEN_BASE_URL", "GEMMA_BASE_URL") ?? "http://localhost:8080/v1"
  ),
  model: firstEnv("QWEN_MODEL", "GEMMA_MODEL") ?? "qwen3.6-35b-a3b",
  apiKey: firstEnv("QWEN_API_KEY", "GEMMA_API_KEY") ?? "test",
};

const geminiEndpoint: EndpointConfig = {
  baseURL: normalizeBaseURL(
    firstEnv("GEMINI_OPENAI_BASE_URL", "GEMINI_BASE_URL") ??
      geminiOpenAIBaseURL
  ),
  model: firstEnv("GEMINI_MODEL") ?? "gemini-3-flash-preview",
  apiKey: firstEnv("GEMINI_API_KEY") ?? "test",
};

const activeEndpoint = isGemini ? geminiEndpoint : qwenEndpoint;

// Per-phase model override. QWEN_* and GEMINI_* stay separate; GEMMA_* is only
// legacy back-compat for old qwen/vLLM deployments.
function endpoint(phase: string, fallback: EndpointConfig): EndpointConfig {
  const legacyPrefix = `GEMMA_${phase}`;
  const qwenPrefix = `QWEN_${phase}`;
  const geminiPrefix = `GEMINI_${phase}`;
  const baseNames = isGemini
    ? [`${geminiPrefix}_OPENAI_BASE_URL`, `${geminiPrefix}_BASE_URL`]
    : [`${qwenPrefix}_BASE_URL`, `${legacyPrefix}_BASE_URL`];
  const modelNames = isGemini
    ? [`${geminiPrefix}_MODEL`]
    : [`${qwenPrefix}_MODEL`, `${legacyPrefix}_MODEL`];
  const keyNames = isGemini
    ? [`${geminiPrefix}_API_KEY`, "GEMINI_API_KEY"]
    : [`${qwenPrefix}_API_KEY`, `${legacyPrefix}_API_KEY`, "QWEN_API_KEY", "GEMMA_API_KEY"];
  return {
    baseURL: normalizeBaseURL(firstEnv(...baseNames) ?? fallback.baseURL),
    model: firstEnv(...modelNames) ?? fallback.model,
    apiKey: firstEnv(...keyNames) ?? fallback.apiKey,
  };
}

// Optional failover endpoints. Comma-separated list of base URLs to try in
// order when the primary returns 5xx or hangs past the inter-chunk timeout.
// Model + API key are assumed shared across the fallback set (typical case:
// multiple Runpod pods running the same model). Set GEMMA_FALLBACK_URLS=...
// to enable.
const fallbackUrlValue = isGemini
  ? firstEnv("GEMINI_FALLBACK_URLS")
  : firstEnv("QWEN_FALLBACK_URLS", "GEMMA_FALLBACK_URLS");
const fallbackUrls = (fallbackUrlValue ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const failoverEndpoints: EndpointConfig[] = fallbackUrls.map((url) => ({
  baseURL: normalizeBaseURL(url),
  model: activeEndpoint.model,
  apiKey: activeEndpoint.apiKey,
}));

function concurrency(name: string, qwenDefault: number, geminiDefault: number): number {
  const value = Number(process.env[`CONCURRENCY_${name}`] ?? "");
  if (Number.isFinite(value) && value > 0) return Math.floor(value);
  return isGemini ? geminiDefault : qwenDefault;
}

function price(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  if (Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

export const config = {
  // `gemma` name is kept so existing imports don't churn; it is now the active
  // chat endpoint selected by LLM_PROVIDER.
  gemma: activeEndpoint,
  llm: {
    provider,
    qwen: qwenEndpoint,
    gemini: {
      chat: geminiEndpoint,
      nativeBaseURL: normalizeBaseURL(
        firstEnv("GEMINI_NATIVE_BASE_URL") ?? geminiNativeBaseURL
      ),
    },
    // Gemini's OpenAI-compatible streaming docs omit stream_options; keep it
    // off by default there to avoid provider-side 400s on optional fields.
    includeStreamUsage:
      process.env.LLM_INCLUDE_STREAM_USAGE != null
        ? process.env.LLM_INCLUDE_STREAM_USAGE === "1"
        : !isGemini,
    stream: process.env.LLM_STREAM !== "0",
    reasoningEffort:
      process.env.LLM_REASONING_EFFORT?.trim() ||
      (isGemini
        ? process.env.GEMINI_REASONING_EFFORT?.trim()
        : process.env.QWEN_REASONING_EFFORT?.trim()),
    pricing: {
      // USD per 1M tokens. Gemini 3 Flash Preview defaults match Google's
      // public paid-tier pricing; self-hosted Qwen defaults to 0 unless the
      // operator wants to model infra cost via env.
      inputUsdPer1M: price("LLM_INPUT_USD_PER_1M", isGemini ? 0.5 : 0),
      outputUsdPer1M: price("LLM_OUTPUT_USD_PER_1M", isGemini ? 3 : 0),
    },
  },
  failover: failoverEndpoints,
  endpoints: {
    planner: endpoint("PLANNER", activeEndpoint),
    harvester: endpoint("HARVESTER", activeEndpoint),
    evidence: endpoint("EVIDENCE", activeEndpoint),
    verifier: endpoint("VERIFIER", activeEndpoint),
    critic: endpoint("CRITIC", activeEndpoint),
    synth: endpoint("SYNTH", activeEndpoint),
  },
  searxng: {
    url: process.env.SEARXNG_URL ?? "http://localhost:8888",
  },
  geminiSearch: {
    enabled: process.env.GEMINI_SEARCH_GROUNDING === "1",
    baseURL: firstEnv("GEMINI_NATIVE_BASE_URL") ?? geminiNativeBaseURL,
    model:
      process.env.GEMINI_SEARCH_MODEL ??
      process.env.GEMINI_MODEL ??
      "gemini-3-flash-preview",
    apiKey:
      process.env.GEMINI_SEARCH_API_KEY ??
      process.env.GEMINI_API_KEY ??
      "",
    maxResults: Number(process.env.GEMINI_SEARCH_MAX_RESULTS ?? 5),
    timeoutMs: Number(process.env.GEMINI_SEARCH_TIMEOUT_MS ?? 20000),
  },
  concurrency: {
    harvest: concurrency("HARVEST", 3, 6),
    evidence: concurrency("EVIDENCE", 3, 8),
    analyzer: concurrency("ANALYZER", 4, 8),
    relevance: concurrency("RELEVANCE", 5, 12),
    verifier: concurrency("VERIFIER", 5, 12),
  },
  planner: {
    temperature: 0.3,
    maxRetries: 3,
  },
  // Token budget safety: we use /tokenize for measurement, but these are
  // fallback defaults if /props is unavailable.
  // outputReserve is set HIGH to keep per-batch input manageable — large inputs
  // trigger multi-minute reasoning and proxy timeouts. We'd rather make more
  // smaller LLM calls than fewer giant ones.
  tokens: {
    defaultContextWindow: isGemini ? 1048576 : 128000,
    // Cloudflare proxy times out if first-byte-time > ~100s. Large inputs
    // trigger cold prefill > timeout. Keep batches small enough that prefill
    // + first token stay under the proxy window.
    outputReserve: 190000,  // keeps input batch ≤ ~38k tokens on 230k context
    safetyMargin: 2000,
  },
};
