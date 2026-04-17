# Changelog

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
