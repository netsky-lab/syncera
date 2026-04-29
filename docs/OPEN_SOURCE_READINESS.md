# Open Source Readiness

This checklist tracks whether the repo can be evaluated by outside users without private context.

## Ready

- Product name is Syncera across public docs and runtime banners.
- Core pipeline runs with Bun, SearXNG, Playwright, and an OpenAI-compatible LLM endpoint.
- Structured LLM outputs go through function/tool calling plus Zod validation.
- Reports synthesize only verifier-accepted facts.
- Web UI exposes report, claims, evidence, debt, contradictions, cognition, runs, API keys, users, and webhooks.
- `projects/`, `data/`, screenshots, and test output are ignored.
- Docker deploy docs describe persistent state and the docker-out-of-docker runner.

## Needs Ongoing Care

- Keep README, `deploy/README.md`, `deploy/API.md`, and this checklist in sync when API or env contracts change.
- Avoid committing generated project artifacts.
- Keep Qwen/Gemini provider envs separate; `GEMMA_*` remains legacy compatibility only.
- Run `bun test` and the web build before publishing release tags.

## Pre-Release Checklist

```bash
bun test
bun run --cwd apps/web build
rg -n "Research Lab|research-lab" README.md docs deploy src apps/web .env.example
git status --short
```

The final `rg` should either return nothing or only deliberate backwards-compatibility notes.

