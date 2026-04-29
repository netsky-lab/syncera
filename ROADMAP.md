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
- [x] Evidence workbench: claim lifecycle, source trust, source recheck, research debt, contradiction resolver, and playbook layer
- [x] Stable audit aliases for downstream consumers (`sources.json`, `analysis.json`, `research_debt.json`, `contradictions.json`)
- [x] Unit test suite (`bun run test` — 148 tests) + GitHub Actions workflow

## Near-term

- [x] Run history — persist run metadata per project and surface attempts in the Versions tab
- [x] Configurable breadth/depth/budget per run from the web UI/API
- [x] Stronger run-history diff UI — compare source overlap plus verified facts, source quality, debt, and contradictions between reruns
- [x] Run-health warnings for long-silent pipeline phases
- [x] Source-quality summary across CLI artifacts, project loader, REST API, dashboard, live run UI, and project source review
- [x] Syncera OSS/deploy polish: product naming, env examples, operations docs, security model, readiness checklist
- [x] Run phase telemetry: `/api/runs` timeline, phase token/call/cost breakdown, dashboard phase chips
- [x] Phase-aware rerun controls: rerun from scout, plan, sources, evidence, verify, analyze, report, or playbook
- [x] Audit ZIP export with report/playbook/artifacts/source index/run logs
- [x] Capability-scoped API keys (`project:read`, `run:start`, `project:write`)
- [x] Batch source-trust actions for filtered source review
- [ ] Better chunking for >100kB pages (current: truncate at 20k chars; lose tail content)
- [ ] Per-phase model selection (cheap model for query generation, stronger for evidence/verify)
- [ ] Public demo dataset, benchmark replay script, short screencast/GIF
- [ ] First-class source relevance review queue with accept/reject keyboard workflow
- [ ] Per-phase timeout/backoff policy visible in settings

## Medium-term

- [ ] Embedding-based fact dedup (current: first-120-chars string match)
- [ ] Semantic tension detection across facts (beyond current LLM analyzer pass)
- [ ] Citation-graph expansion — follow references from primary hits into deeper related work
- [ ] Claim graph visual page with dependency/counterevidence edges
- [ ] Contradiction resolver workbench with side-by-side source excerpts and resolution labels
- [ ] Research debt board with owners, status, branches, and follow-up run links
- [ ] Report diff and playbook diff between project versions
- [ ] Export/import project bundle for moving artifacts between self-hosted instances
- [ ] Scheduled re-runs (cron) — keep long-lived projects updated as the literature moves
- [ ] Migrate `zodToJsonHint` to `z.toJSONSchema()` (native in zod 4)

## Longer-term

- [ ] Private-corpus ingestion — upload PDFs, point harvester at them alongside web search
- [ ] Workspace/org model with roles beyond admin/user
- [ ] Fine-grained API key rate limits and per-key usage ledger
- [ ] Provider health dashboard and model-router policy per phase
- [ ] Encrypted artifact store option for private corpora
- [ ] Hosted multi-tenant security hardening: database, audit log, object storage, secrets vault
- [ ] MCP tools — expose the pipeline so external agents can run research as a tool call
- [ ] Credential vault for private corpora access (institutional paywalls, internal wikis)
