# Contributing

Syncera is a Bun-first monorepo. Use `bun`, `bun run`, `bun test`, and `bun add`; do not introduce npm/yarn/pnpm lockfiles.

## Development

```bash
bun install
bun test apps/web/lib src apps/web/app
cd apps/web && bun run dev
```

Before sending a patch:

- keep pipeline artifacts resumable;
- add or update Zod schemas in `src/schemas/` for structured LLM outputs;
- use `generateJson` / `generateToolJson` from `src/llm.ts` for LLM JSON;
- preserve verified-only synthesis;
- add deterministic tests for auth, attribution, source trust, URL handling, and artifact loaders.

## Pull Request Checklist

- Tests pass with `bun test apps/web/lib src apps/web/app`.
- `bun run --cwd apps/web build` passes.
- Docs are updated when env vars, artifacts, routes, or pipeline phases change.
- No secrets, local `data/`, or private `projects/` artifacts are committed.

