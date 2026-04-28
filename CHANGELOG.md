# Changelog

## 0.4.1 — 2026-04-28

Product hardening for evidence-led deep research.

### Engine
- Added stable audit aliases for downstream consumers: `scout.json`, `sources.json`, `analysis.json`, `research_debt.json`, and `contradictions.json`.
- Final reports now include a deterministic `Decision Readout` section that separates known evidence, research debt, contradiction pairs, and use boundaries before the per-question analysis.
- Run progress now derives counters from disk artifacts: questions, subquestions, sources, learnings, facts, verification counts, research debt, contradictions, LLM calls, and tokens.

### Web Product
- Live pipeline widgets now show artifact counters instead of only the current phase log line.
- Project loading falls back to per-subquestion source files when `sources/index.json` is absent, so source counts remain visible for manually started or recovered runs.
- Brief constraints now render correctly when planner constraints are stored as a semicolon/newline-delimited string.

### OSS / Security
- Added `SECURITY.md`, `CONTRIBUTING.md`, and an MIT `LICENSE`.
- Deploy docs now recommend `BOOTSTRAP_TOKEN` or admin seed credentials for first production signup.

## 0.4.0 — 2026-04-26

Deep-research product surface, provider split, function-calling structured outputs, and usage telemetry.

### Engine
- Structured LLM outputs now use OpenAI-compatible function calling through `generateJson` / `generateToolJson`; the old `response_format: json_object` path was removed.
- Planner, scout, and all downstream structured calls now share the function-calling path while still validating with Zod and retrying with exact issue paths.
- Planner output is normalized deterministically: enum-like labels are canonicalized, question/subquestion IDs are repaired, and short plans are expanded to the minimum question count instead of failing the run.
- Qwen and Gemini are separate providers (`LLM_PROVIDER=qwen|gemini`) with separate env namespaces, provider-aware concurrency, optional Gemini native search, and non-stream mode for Runpod/llama.cpp proxies that break SSE.
- LLM usage telemetry writes `llm_usage.jsonl` and `llm_usage_summary.json` with calls, prompt/completion/total tokens, phase breakdown, model breakdown, and estimated cost.

### Web Product
- Project view now defaults to Report-first reading, adds a `Cognition` tab, source filters, coverage map, versions, and phase/cost/usage cards.
- New `/api/projects/:slug/audit` endpoint exports the research audit state: cognitive contract, source mix, per-question coverage, fact counts, gaps, follow-ups, verification summary, and usage.
- Rerun now truly regenerates upstream/downstream artifacts with `--rescout --replan --reharvest --re-relevance --re-evidence --re-verify --re-analyze`.
- Runner no longer creates duplicate `docker logs --follow` sidecars during Next dev hot reload; orphan reattach skips runs that already have a live docker-run client.

### Positioning
- README now presents the project as Syncera and documents the cognitive architecture: question-first planning, source-bounded cognition, quote-bound facts, verified-only synthesis, explicit gaps, and audit export.

## 0.3.0 — 2026-04-20

Per-user project isolation, webhooks, scoped API keys, production auth hardening.

### Per-user project isolation
- Projects now carry an owner (sidecar `.owner` file in the project dir). Visibility rule: you own it, OR you're admin (god viewer for moderation), OR the owner is admin (showcase — visible to every signed-in user).
- Legacy projects without `.owner` auto-migrate to the first admin on next listProjects call.
- Dashboard splits into "Your research" (empty for fresh signups) + "Showcase" (admin-owned demos).
- Dashboard stats count *your* projects only — a fresh signup sees 0 / 0 / 0 / 0 instead of inheriting showcase numbers.
- Run ownership: `/api/runs/start` extracts uid from session cookie; `ActiveRuns` + `/api/runs` filter by the same visibility rule as projects.
- Slug collision guard: if a user tries to run a topic whose slug is taken by someone else, the runner appends a `-<uid6>` suffix so each user gets their own project dir without overwriting someone else's artifacts. Re-runs by the same user still share a slug (idempotent resumption).
- Project page shows a `showcase` badge to non-owners of admin-owned projects.
- Non-admin users see a friendly "API keys are admin-only" note in `/settings` instead of a 401 flashbang.

### Scoped API keys
- Each minted API key carries the minter's `owner_uid`. `verifyKey` returns the owner; `viewerUidFromRequest` falls back to the key's owner when no session cookie is present.
- Consumer apps with an admin's API key now see admin-owned projects via API (not showcase-only as before).
- Env-seed `API_KEYS` remain anonymous (owner_uid null) — they only see showcase unless paired with session auth.

### Webhooks
- **Per-user webhook delivery** (`/api/auth/webhook` GET/POST/DELETE): each user configures a target URL + HMAC secret; when a pipeline run they started finishes, the web container POSTs `run.completed` or `run.failed` to that URL with artifact links (`report`, `facts`, `analysis`, `pdf`) resolved from `PUBLIC_URL`. Signature in `X-Signature-256: sha256=<hmac-sha256(body, secret)>`. Raw secret is minted server-side, shown once on creation, rotatable. 3 delivery attempts with 1s/5s/30s exponential backoff; terminal failures logged to `data/webhook-failures.jsonl` for manual replay.
- **Run ownership tracking**: `/api/runs/start` extracts owner uid from the session cookie; API-key runs carry uid=null (no webhook fired).
- Settings UI: `WebhookCard` with URL input, Save/Rotate/Disable, one-time secret reveal.

### Auth hardening
- `/api/runs/start`, `/api/runs/stream`, `/api/sources/content` now require auth — previously were **completely open**, meaning anyone could spawn LLM-burning pipeline runs.
- `requireAuth` now accepts session cookies — previously a logged-in browser user got 401 on every `/api/*` call (silently broke `ActiveRuns` component among other things).
- PDF export forwards the caller's session cookie (or mints a short-lived internal one for API-key callers) to Playwright — previously rendered the login page as PDF instead of the report.
- `/api/auth/*` moved out of middleware-exclusion, now rate-limited 60 req/min per IP — previously unbounded login brute-force.
- Logged-in users hitting `/login` or `/signup` now 307 to `/`.
- `writeFileSync` for users.json and api_keys.json uses mode `0o600` (dir `0o700`) — prevents world-read of scrypt/API key hashes.
- Webhook config uses plaintext storage (URL + secret) in users.json — necessary since we sign outbound, but 0o600 + gitignore contains blast radius.

### Dockerfile + deploy
- Healthcheck switched from `localhost` to `127.0.0.1` — container's `/etc/hosts` listed `::1 localhost` first, wget preferred IPv6, Next.js binds IPv4 only → perma-unhealthy. Lived ~8 hours of FailingStreak=888 before discovery.
- Request body cap 1MB via `proxyClientMaxBodySize` (Next 16 default was 10MB). Matches legitimate traffic shape (topic + constraints).
- `next.config.ts`, `deploy/.env.example`, `deploy/docker-compose.yml` updated with `PUBLIC_URL` for webhook artifact links.

### Pipeline
- **Three zod 4 bugs fixed in `zodToJsonHint`** (`src/llm.ts`): enum entries shape (was object in zod 4, was array in zod 3 — code returned `"enum"` instead of `"a|b|c"`); `.describe()` strings stored on `.meta()` not `_zod.def.description` (every field description silently dropped); missing `ZodNullable` branch (nullable fields rendered as `"any (nullable)"`). Likely contributed to the 28% verifier rejection rate on the benchmark run — prompts were under-specified across planner/evidence/verifier/analyzer.
- Retry feedback in `generateJson` now includes the specific zod issue paths (`facts.0.confidence: Expected number, received string`) in the retry prompt — previously just "did not match".
- `EVIDENCE_SYSTEM` prompt has explicit ATTRIBUTION section forbidding mis-assigning facts to sources that don't discuss the fact's primary named entity.

### Tests
- +8 new test files, 126 total (111 → 126) including webhook sign/deliver (real HTTP capture via Bun.serve), OpenAPI spec lint (dangling refs, undeclared tags, regression-guard on auth/admin paths), session cookie in requireAuth, verifier/evidence regex with real rejected-fact fixtures.

## 0.2.0 — 2026-04-19

Question-first pipeline, session auth, 3-layer verifier, eval against ChatGPT Deep Research baseline.

### Engine
- Pipeline migrated from hypothesis-first to **question-first**: planner emits `ResearchQuestion[]` (6 categories × 6 angles) instead of pre-committed hypotheses. Facts carry verification verdicts instead of supports/contradicts labels. Analyzer produces per-question narrative answers + cross-question tensions; synthesizer uses only verified facts.
- **Three-layer verifier** (`src/verifier.ts`): L1 HEAD on URL, L2 keyword substring on `exact_quote`, L3 LLM adversarial review. Verdicts: `verified | url_dead | quote_fabricated | overreach | out_of_context | cherry_picked | misread`.
- **Scout phase** surveys literature before planning; planner prompt is calibrated against the digest.
- **Refine phase** (opt-in `--refine`): for questions flagged `insufficient`/`gaps_critical`, generates narrower queries from the gap list, re-harvests, re-runs downstream.
- **Deterministic attribution check** in evidence extraction (`src/evidence.ts`): extracts the fact's primary named entity (CamelCase/KV-stem/ACRONYM/hyphenated), swaps the cited source URL if the entity is absent from the scraped content, downgrades confidence otherwise.
- **Multi-endpoint LLM failover** via `GEMMA_FALLBACK_URLS`.
- **zod 4 compat** in `zodToJsonHint`: enum literals and `.describe()` strings were silently dropped; nullable branch was missing. Fixed — every `generateJson` prompt now correctly surfaces enum values, field descriptions, and nullable markers.
- **Specific retry feedback**: schema-validation failures now feed the exact zod issue paths back into the retry prompt.

### Eval
- `scripts/eval.ts` measures a finished project against a ChatGPT Deep Research baseline. On the KV-cache compression benchmark topic: **92.5% primary-source share** (vs 85%), **71.6% verified facts** (149/208), 14/18 key concepts covered, 17 url_dead + 5 quote_fabricated + 37 LLM-rejected.

### Web (apps/web/)
- **Auth**: email/password accounts (scrypt N=16384), HMAC-SHA256 signed session cookies (30-day Max-Age, HttpOnly, SameSite=Lax), Edge-compatible verification in middleware via Web Crypto.
- **Admin surface**: `/api/admin/users`, `/api/admin/keys` (session-gated, admin-role only). Self-delete and last-admin guards. First signup becomes admin; subsequent signups require `ALLOW_SIGNUP=1`.
- **API key store** (`lib/keys.ts`): SHA-256 hashed, raw key shown once on mint, `last_used_at` tracked, revocation is idempotent.
- **Per-call store path resolution** (users/keys/projects) so env changes take effect without module reload.
- **OpenAPI 3.1 spec** at `/api/openapi.json` covers every endpoint including auth + admin, with `SessionCookie` security scheme.
- **Reading-mode layout** for question-first projects (Perplexity/arxiv-inspired): scroll-spy TOC, citation chips `[F#]` with hover tooltips, print.css overrides for PDF export, `JumpToTop`.
- **Rerun button** on project pages, login `?next=<path>` with same-origin validation, branded 404 page, signup-closed state when `ALLOW_SIGNUP=0`.
- **Mobile** adaptation across dashboard, project view, settings, docs.

### Deploy
- `deploy/docker-compose.yml`: SearXNG + web with **docker-out-of-docker** (mount host `/var/run/docker.sock`, `group_add: 988`) so the web container can spawn pipeline containers on the shared network. Persistent volume `../data:/app/data:rw` for users/keys stores.
- Playwright uses system chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- CORS preflight + token-bucket rate limiting (60 req/min) in Edge middleware.

### Tests
- 111 unit tests (`bun run test`, ~1s): evidence attribution heuristic, verifier deterministic layers, session cookie crypto (tamper + expiry), scrypt auth, API key store, requireAuth/requireBasicAuth branches, project loader, runner phase regex, source tier scoring, `zodToJsonHint`.
- GitHub Actions workflow (`.github/workflows/test.yml`) runs the suite on push/PR.

### Breaking
- Legacy `claims.json` / `critic_report.json` consumers still read, but new projects write `facts.json` / `analysis_report.json`. UI and API serve both.

## 0.1.0 — 2026-04-17

Initial working pipeline.

### Engine
- Planner, Harvester, Evidence, Critic, Synthesizer phases implemented.
- `src/llm.ts`: OpenAI-compatible HTTP wrapper with Zod schema validation + retry.
- Default LLM: Gemma 4 26B on vLLM (Runpod), configurable via `GEMMA_BASE_URL`.
- Harvester uses breadth × depth recursive search (dzhng-style) with full-page scraping via Jina Reader.
- Per-project folder with `plan.json`, `sources/`, `claims.json`, `critic_report.json`, `REPORT.md`.
- Phases are resumable; `--replan / --reharvest / --re-evidence / --re-critic` flags re-run individual phases.

### Infrastructure
- SearXNG self-hosted via docker compose (`infra/searxng/`).
- Jina Reader for URL → markdown (free, no key).
- Arxiv + Semantic Scholar as academic supplement.

### UI
- Next.js 16 + Tailwind + shadcn/ui dashboard in `apps/web/`.
- Project list, per-project detail with Plan / Hypotheses / Claims / Sources / Critic / Report tabs.
- 13 Playwright e2e tests, all green.
