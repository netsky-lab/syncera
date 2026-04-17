interface EndpointConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

// Per-phase model override: set GEMMA_EVIDENCE_* etc. to route a specific
// phase to a stronger (slower) endpoint while keeping cheap one for others.
function endpoint(prefix: string, fallback: EndpointConfig): EndpointConfig {
  return {
    baseURL: process.env[`${prefix}_BASE_URL`] ?? fallback.baseURL,
    model: process.env[`${prefix}_MODEL`] ?? fallback.model,
    apiKey: process.env[`${prefix}_API_KEY`] ?? fallback.apiKey,
  };
}

const defaultEndpoint: EndpointConfig = {
  baseURL: process.env.GEMMA_BASE_URL ?? "http://localhost:8080/v1",
  model: process.env.GEMMA_MODEL ?? "gemma-4-26b-a4b-public-safe",
  apiKey: process.env.GEMMA_API_KEY ?? "test",
};

export const config = {
  gemma: defaultEndpoint,
  endpoints: {
    planner: endpoint("GEMMA_PLANNER", defaultEndpoint),
    harvester: endpoint("GEMMA_HARVESTER", defaultEndpoint),
    evidence: endpoint("GEMMA_EVIDENCE", defaultEndpoint),
    verifier: endpoint("GEMMA_VERIFIER", defaultEndpoint),
    critic: endpoint("GEMMA_CRITIC", defaultEndpoint),
    synth: endpoint("GEMMA_SYNTH", defaultEndpoint),
  },
  searxng: {
    url: process.env.SEARXNG_URL ?? "http://localhost:8888",
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
    defaultContextWindow: 128000,
    // Cloudflare proxy times out if first-byte-time > ~100s. Large inputs
    // trigger cold prefill > timeout. Keep batches small enough that prefill
    // + first token stay under the proxy window.
    outputReserve: 190000,  // keeps input batch ≤ ~38k tokens on 230k context
    safetyMargin: 2000,
  },
};
