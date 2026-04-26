# Roadmap

## Done

- [x] Question-first pipeline: scout → plan → harvest → evidence → verify → analyze → synth → refine (opt-in)
- [x] 3-layer verifier (URL liveness, exact-quote substring, LLM adversarial review) with 7 verdict types
- [x] Deterministic attribution check in evidence extraction
- [x] Scout phase — literature-survey calibration for the planner
- [x] Refine phase — gap-closing second pass on weak questions
- [x] Multi-endpoint LLM failover via `GEMMA_FALLBACK_URLS`
- [x] `scripts/eval.ts` — measurable comparison against ChatGPT Deep Research baseline
- [x] Web UI dashboard + reading-mode document layout (scroll-spy TOC, citation chips, PDF export)
- [x] SSE streaming of run logs (`/api/runs/stream`)
- [x] Multi-user auth (email/password, scrypt, HMAC session cookies), admin surface, API key store
- [x] REST API + OpenAPI 3.1 spec at `/api/openapi.json`
- [x] Self-hosted SearXNG + Playwright page extraction
- [x] Deploy via `deploy/docker-compose.yml` (docker-out-of-docker so web spawns pipeline containers on shared network)
- [x] Function-calling structured outputs with Zod validation and retry feedback
- [x] Qwen/Gemini provider split, non-stream Runpod mode, and token/cost telemetry
- [x] Cognition/audit product surface: coverage, source filters, verification counts, audit JSON export
- [x] Unit test suite (`bun run test` — 148 tests) + GitHub Actions workflow

## Near-term

- [ ] Run history — track multiple runs per project, diff facts/coverage/confidence over time
- [ ] Configurable breadth/depth/budget per run (currently pipeline-wide defaults)
- [ ] Better chunking for >100kB pages (current: truncate at 20k chars; lose tail content)
- [ ] Per-phase model selection (cheap model for query generation, stronger for evidence/verify)
- [ ] OSS polish: public demo dataset, architecture diagrams, contributor guide, benchmark replay script

## Medium-term

- [ ] Embedding-based fact dedup (current: first-120-chars string match)
- [ ] Semantic tension detection across facts (beyond current LLM analyzer pass)
- [ ] Citation-graph expansion — follow references from primary hits into deeper related work
- [ ] Scheduled re-runs (cron) — keep long-lived projects updated as the literature moves
- [ ] Migrate `zodToJsonHint` to `z.toJSONSchema()` (native in zod 4)

## Longer-term

- [ ] Private-corpus ingestion — upload PDFs, point harvester at them alongside web search
- [ ] MCP tools — expose the pipeline so external agents can run research as a tool call
- [ ] Credential vault for private corpora access (institutional paywalls, internal wikis)
