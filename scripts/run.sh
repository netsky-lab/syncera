#!/usr/bin/env bash
# Runs the research pipeline in a docker container on the searxng network.
# Use when your shell or Next.js process cannot reach localhost:8888 directly
# (e.g. some sandboxed environments, or if you prefer isolation).
#
# Usage: ./scripts/run.sh "your research topic" [constraints]

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <topic> [constraints]"
  exit 1
fi

TOPIC="$1"
CONSTRAINTS="${2:-}"

# Load .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs -d '\n' -I{} echo {})
fi

docker run --rm -it \
  --network searxng_default \
  -v "$REPO_ROOT:/app" \
  -w /app \
  -e SEARXNG_URL="${SEARXNG_URL:-http://searxng-core:8080}" \
  -e GEMMA_BASE_URL="${GEMMA_BASE_URL:-}" \
  -e GEMMA_MODEL="${GEMMA_MODEL:-gemma-4-26b-a4b-public-safe}" \
  -e GEMMA_API_KEY="${GEMMA_API_KEY:-test}" \
  --name "rl-run-$(date +%s)" \
  oven/bun:1 \
  bun run src/run.ts "$TOPIC" ${CONSTRAINTS:+"$CONSTRAINTS"}
