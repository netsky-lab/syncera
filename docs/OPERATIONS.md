# Syncera Operations

This document is the short runbook for a single-host Syncera deployment.

## Runtime Shape

- `web` serves the Next.js UI and REST API.
- `searxng` provides internal search over the compose network.
- Each research run is an ephemeral `oven/bun:1` container spawned by the web process through the host Docker socket.
- `projects/` is the source of truth for research artifacts.
- `data/` is the source of truth for users, API keys, share tokens, and webhook state.

## Required Production Settings

- `SESSION_SECRET`: 32+ random bytes, stable across deploys.
- `QWEN_BASE_URL`, `QWEN_MODEL`, `QWEN_API_KEY`: OpenAI-compatible LLM endpoint.
- `PIPELINE_HOST_REPO_ROOT`: host path mounted into spawned pipeline containers.
- `PIPELINE_NETWORK`: compose network where spawned containers can reach `searxng`.
- `DOCKER_GID`: group id for `/var/run/docker.sock`.
- `APP_BASE_URL` and `PUBLIC_URL`: external HTTPS origin for links and webhook payloads.

## Recommended Qwen Start Profile

For a 16-slot, 64k-context self-hosted Qwen profile, start conservative and raise only after observing `llm_usage_summary.json` and recovered retries:

```env
LLM_PROVIDER=qwen
LLM_STREAM=0
LLM_MAX_CONCURRENCY=8
CONCURRENCY_HARVEST=6
CONCURRENCY_EVIDENCE=2
CONCURRENCY_ANALYZER=1
CONCURRENCY_RELEVANCE=6
CONCURRENCY_VERIFIER=6
EVIDENCE_LEARNINGS_PER_BATCH=2
EVIDENCE_MAX_TOKENS=4096
```

## Deploy Loop

```bash
rsync -az --delete \
  --exclude='/projects/' \
  --exclude='/data/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='/deploy/.env' \
  --exclude='/.git/' \
  ./ root@host:/opt/syncera/

ssh root@host 'cd /opt/syncera/deploy && docker compose up -d --build web'
```

Never rsync over `deploy/.env`, `data/`, or `projects/` from a dev machine.

## Health Checks

- `GET /api/health` returns liveness without auth.
- `/api/runs` shows active runs, last log line, recovered retries, token totals, and weak-run signals.
- `projects/<slug>/runs/*.events.jsonl` is the raw run timeline.
- `projects/<slug>/llm_usage_summary.json` is the provider/model/token/cost ledger.

## Common Failures

- Docker spawn fails: check `DOCKER_GID`, docker socket mount, and `PIPELINE_NETWORK`.
- Harvest stalls: inspect the active run events and the spawned `rl-run-<id>` container logs.
- Empty reports: check `verification.json`; synthesis only consumes `verified` facts.
- Qwen schema failures: lower `CONCURRENCY_EVIDENCE`, `EVIDENCE_LEARNINGS_PER_BATCH`, and `LLM_MAX_CONCURRENCY`.

