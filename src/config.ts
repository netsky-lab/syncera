export const config = {
  gemma: {
    baseURL: process.env.GEMMA_BASE_URL ?? "http://localhost:8080/v1",
    model: process.env.GEMMA_MODEL ?? "gemma-4-26b-a4b-public-safe",
    apiKey: process.env.GEMMA_API_KEY ?? "test",
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
