# AGENTS.md

Guidance for AI agents (coding assistants, Claude Code, etc.) working on this repo.

## What this project is

Hypothesis-driven research engine. Takes a topic → structured plan → deep web research → citation-backed report. 5-phase pipeline, filesystem artifacts at every step.

## Tech stack

- **Runtime**: Bun (≥ 1.2). Use `bun`, `bun run`, `bun test`, `bun add` — not npm/yarn/pnpm.
- **LLM**: OpenAI-compatible HTTP (default: Gemma 4 on vLLM). See `src/llm.ts`.
- **Schemas**: Zod (`src/schemas/`). All LLM outputs are schema-validated with retry.
- **Search**: SearXNG self-hosted (`infra/searxng/`), Arxiv, Semantic Scholar.
- **Scraping**: Jina Reader (`r.jina.ai`) — free, no key.
- **UI**: Next.js 16 App Router + Tailwind + shadcn/ui. In `apps/web/`.
- **Tests**: Bun for unit, Playwright for UI e2e.

## Layout

```
src/                  backend pipeline (bun)
  llm.ts              OpenAI-compatible LLM wrapper with Zod validation + retry
  config.ts           env config
  search.ts           SearXNG / Arxiv / Semantic Scholar adapters
  reader.ts           Jina Reader (URL → markdown)
  planner.ts          phase 1: topic → ResearchPlan
  harvester.ts        phase 2: plan → sources (recursive deep research)
  evidence.ts         phase 3: sources → claims with exact quotes
  critic.ts           phase 4: claims → per-hypothesis assessment
  synthesizer.ts      phase 5: everything → REPORT.md
  run.ts              CLI entry point
  schemas/            Zod schemas for all artifacts
apps/web/             Next.js UI
infra/searxng/        SearXNG docker compose
projects/             per-project folders (gitignored)
```

## Rules for agents

- **No new LLM abstractions.** Use `generateJson({schema, system, prompt, ...})` from `src/llm.ts`. Do not introduce Vercel AI SDK's `generateObject` / `generateText` etc. — they silently drop `response_format` for non-OpenAI providers.
- **All structured LLM outputs use Zod schemas** in `src/schemas/`. Add new schemas there.
- **Filesystem is source of truth.** Don't introduce a database. Each phase writes a JSON artifact to the project folder.
- **Phases must be resumable.** Check if the artifact exists and skip the phase unless a `--re<phase>` flag is passed.
- **Deep research, not metadata parsing.** Always fetch full page content (Jina Reader). Don't do LLM extraction on search snippets only.
- **Keep `src/` Bun-native.** `apps/web/` has its own dependencies and Next.js tsconfig.
- **When editing docs, keep them in sync**: README, ARCHITECTURE, ROADMAP.
