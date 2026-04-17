# Research Lab

Hypothesis-driven research engine. Takes a topic, generates structured research plan, collects web sources, extracts evidence with citations, validates against hypotheses, produces a final report.

Built on a local LLM (Gemma 4 via OpenAI-compatible endpoint), self-hosted search (SearXNG), and free content extraction (Jina Reader). No paid API keys required for the core engine.

## Pipeline

```
Topic
  ↓
Planner       → plan.json            (hypotheses + falsifiable criteria + tasks)
  ↓
Harvester     → sources/*.json        (breadth × depth SearXNG + Arxiv + Semantic Scholar,
                                       full-page scraping via Jina Reader)
  ↓
Evidence      → claims.json           (exact-quote claims linked to sources)
  ↓
Verifier      → verification.json     (3 layers: URL liveness, quote substring match,
                                       LLM adversarial semantic review per claim)
  ↓
Critic        → critic_report.json    (per-hypothesis assessment on verified claims,
                                       gaps, contradictions)
  ↓
Synthesizer   → REPORT.md              (citation-backed report using only verified claims)
```

Each phase writes a structured artifact to the project folder. Phases are resumable — if an artifact exists, that phase is skipped unless you pass `--replan`, `--reharvest`, `--re-evidence`, `--re-verify`, `--re-critic`.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.2
- Docker (for SearXNG)
- An OpenAI-compatible LLM endpoint (default: Gemma 4 via Runpod / vLLM / Ollama)

## Setup

```bash
# Clone and install
git clone <repo> && cd research-lab
bun install

# Configure
cp .env.example .env
# edit .env: point GEMMA_BASE_URL to your LLM endpoint

# Start self-hosted search
cd infra/searxng && docker compose up -d
cd ../..

# Run a research project
bun run src/run.ts "your research topic here"

# Or, if your shell cannot reach localhost:8888 (sandbox, docker-in-docker, etc.),
# run the pipeline inside a container on the searxng docker network:
./scripts/run.sh "your research topic here"
```

The result lands in `projects/<slug>/`:

```
projects/<slug>/
├── plan.json             Structured research plan
├── README.md             Live status overview
├── hypotheses/           Individual hypothesis files
├── sources/
│   ├── T1.json          Per-task sources with full scraped content
│   ├── content/         Raw page markdown (one file per URL)
│   └── index.json       Provider / task breakdown
├── claims.json           Extracted claims with exact quotes + refs
├── critic_report.json    Per-hypothesis assessment
└── REPORT.md             Final synthesized report with citations
```

## Web UI

```bash
cd apps/web
bun install
bun run dev
```

Open http://localhost:3000 for the project dashboard.

## Architecture

- `src/llm.ts`    — LLM wrapper (OpenAI-compatible HTTP + JSON schema validation + retry)
- `src/search.ts` — SearXNG + Arxiv + Semantic Scholar adapters
- `src/reader.ts` — Jina Reader (URL → clean markdown)
- `src/planner.ts`, `harvester.ts`, `evidence.ts`, `critic.ts`, `synthesizer.ts` — pipeline phases
- `src/schemas/` — Zod schemas for all structured artifacts
- `apps/web/`    — Next.js dashboard
- `infra/searxng/` — self-hosted search engine (docker compose)

## License

MIT
