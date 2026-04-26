# AGENTS.md

Guidance for AI agents (coding assistants, Claude Code, etc.) working on this repo.

## What this project is

Question-first research engine. Takes a topic → literature-calibrated question tree → deep per-subquestion harvesting → exact-quote facts → three-layer verifier → narrative analysis → citation-backed report. Filesystem artifacts at every step, every phase resumable.

## Tech stack

- **Runtime**: Bun (≥ 1.2). Use `bun`, `bun run`, `bun test`, `bun add` — not npm/yarn/pnpm.
- **LLM**: OpenAI-compatible HTTP. Default: `qwen3.6-35b-a3b` on vLLM/Runpod. See `src/llm.ts`. Multi-endpoint failover via `GEMMA_FALLBACK_URLS`.
- **Schemas**: Zod 4 (`src/schemas/`). All LLM outputs go through `generateJson` which renders the schema as a hint, parses, validates, and retries with the specific error paths on failure.
- **Search**: SearXNG self-hosted (`infra/searxng/`), Arxiv, OpenAlex, Semantic Scholar.
- **Scraping**: Playwright with system chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).
- **UI**: Next.js 16 App Router + Tailwind + shadcn/ui. In `apps/web/`. Edge middleware for auth/CORS/rate-limit; Node route handlers for filesystem and scrypt.
- **Tests**: `bun test` for unit. The root `bun run test` runs both pipeline and web lib suites (111 tests today).

## Layout

```
src/                  pipeline (bun)
  llm.ts              OpenAI-compatible client + Zod hint + retry + failover
  config.ts           env config
  search.ts           SearXNG / Arxiv / OpenAlex / Semantic Scholar
  reader.ts           Playwright URL → markdown
  sourcing.ts         tiered source scoring (primary/official/code/blog/community)
  scout.ts            phase 0: literature survey → calibration digest
  planner.ts          phase 1: topic + digest → ResearchPlan (questions × subquestions)
  harvester.ts        phase 2: plan → sources (search + scrape + learnings)
  evidence.ts         phase 3: sources → facts (with attribution check)
  verifier.ts         phase 3.5: 3-layer fact verification
  analyzer.ts         phase 4: facts → per-question answers + tensions
  synthesizer.ts      phase 5: verified facts → REPORT.md
  refine.ts           phase 6: opt-in gap-closing pass for weak questions
  run.ts              CLI entry point
  schemas/            Zod schemas (plan, fact, verification, source, learning)
apps/web/             Next.js UI + REST API + auth
  app/                routes (App Router)
  lib/                session cookies, scrypt users, API keys, projects loader
  components/         UI
deploy/               docker-compose + env template + README
infra/searxng/        SearXNG compose
scripts/eval.ts       portfolio metric script against ChatGPT Deep Research baseline
projects/             per-project artifacts (gitignored)
data/                 users.json + api_keys.json (gitignored)
```

## Rules for agents

- **No new LLM abstractions.** Use `generateJson({schema, system, prompt, ...})` from `src/llm.ts`. Do not introduce Vercel AI SDK's `generateObject` / `generateText` — they silently drop `response_format` for non-OpenAI providers.
- **Zod 4 internals are fragile.** `zodToJsonHint` already had three compat bugs (enum entries shape, description location, missing nullable branch). If you touch Zod introspection, render the output for a real schema and eyeball it; prefer the native `z.toJSONSchema()` if migrating.
- **All structured LLM outputs use Zod schemas** in `src/schemas/`. Add new schemas there. Use `.describe()` liberally — descriptions reach the LLM as `// comment` hints.
- **Filesystem is source of truth.** No database. Each phase writes a JSON artifact to `projects/<slug>/`. UI reads fresh content on every request.
- **Phases must be resumable.** Check if the artifact exists and skip unless a `--re<phase>` flag is passed (`--rescout / --replan / --reharvest / --re-evidence / --re-verify / --re-analyze / --refine`). Synth runs every invocation.
- **Deep research, not metadata parsing.** Always fetch full page content via Playwright. Don't do LLM extraction on search snippets only.
- **Verified-only synthesis.** The synthesizer takes only `verification.verdict === "verified"` facts as input. Never bypass.
- **Attribution discipline.** In `evidence.ts`, the extractor must cite sources that actually discuss the fact's primary named entity. Three defense layers: prompt (model-level), `extractPrimaryEntity` + `contentContainsEntity` post-check (deterministic), verifier L3 (LLM adversarial). Don't weaken any without replacing.
- **Per-call env reads.** `users.ts`, `keys.ts`, `projects.ts` resolve their store paths per-call via a helper function, not captured at module init. This keeps tests isolated and env changes taking effect.
- **Keep `src/` Bun-native.** `apps/web/` has its own dependencies and Next.js tsconfig with `@/*` → `./*` alias.
- **When editing docs, keep them in sync**: README, ARCHITECTURE, ROADMAP, CHANGELOG, deploy/README, deploy/API.
- **Tests first for deterministic logic.** Attribution heuristics, URL tier scoring, session crypto, verdict normalization are all unit-tested; extend the suite rather than adding ad-hoc checks.
