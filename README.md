# Syncera

Question-first research engine. Takes a topic, decomposes it into a literature-calibrated question tree, collects primary sources, extracts fact claims bound to exact quotes, **verifies each fact against its cited URL**, analyzes coverage and tensions across questions, then synthesizes a citation-backed report.

The design goal is an audit trail: every sentence in the final report traces back to a verified `Fact` with `{statement, confidence, references: [{url, exact_quote}]}`, and every fact traces back to a verifier verdict (`verified | url_dead | quote_fabricated | overreach | out_of_context | cherry_picked | misread`). Nothing reaches the report that the verifier rejected.

Runs on a local LLM via OpenAI-compatible endpoint (default: `qwen3.6-35b-a3b` on vLLM/Runpod) + self-hosted SearXNG + Playwright-driven page extraction. No paid API keys for the core pipeline.

## Cognitive Architecture

Syncera is not a chat wrapper around web search. It separates the research problem into explicit control layers:

- **Question structure before evidence**: the planner creates a question tree first, so search is driven by answerable subquestions instead of a broad prompt.
- **Source-bounded cognition**: harvesting is scoped per subquestion, tiered toward primary/official sources, and stores the full scraped page content, not snippets.
- **Facts before prose**: extraction creates structured `Fact` objects with confidence, factuality class, URL, title, and exact quote.
- **Verification before synthesis**: rejected facts never enter the final report. The model does not get to smooth uncertainty into confident prose.
- **Coverage as product surface**: each question gets a coverage verdict, gap list, follow-up investigations, and source/fact counts.
- **Audit export**: the web UI exposes a `Cognition` tab and `/api/projects/:slug/audit` so users can inspect the system's belief state, not just read the final answer.

The product bet is simple: serious research tools should expose epistemic control, not hide it behind a polished answer.

## Pipeline

```
Topic
  │
  ├─ scout        → scout_digest.json       lit-survey calibration for the planner
  │                 scout.json              stable audit alias
  │
  ├─ plan         → plan.json               ResearchQuestion[] × Subquestion[]
  │                                         (6 categories × 6 angles, Zod-validated)
  │
  ├─ harvest      → sources/<SQ>.json       per-subquestion: SearXNG + Arxiv +
  │                                         OpenAlex, Playwright full-page render
  │                                         (+ sources/index.json aggregate)
  │                 sources.json            stable aggregate audit alias
  │
  ├─ evidence     → facts.json              Fact extraction with exact-quote refs,
  │                                         one LLM call per subquestion with
  │                                         sources inlined as context
  │
  ├─ verify       → verification.json       for each fact, three layers:
  │                                         (1) HEAD on URL (dead-link)
  │                                         (2) substring match on exact_quote
  │                                         (3) LLM adversarial review — does
  │                                             the quote actually support the
  │                                             claim, or is it misread / cherry-
  │                                             picked / out-of-context?
  │
  ├─ analyze      → analysis_report.json    per-question narrative answers +
  │                                         coverage verdict (complete / partial
  │                                         / gaps_critical / insufficient) +
  │                                         cross-question tensions
  │                 analysis.json           stable audit alias
  │
  ├─ epistemic    → epistemic_graph.json    claim lifecycle graph:
  │                                         claim → evidence → verification →
  │                                         counterevidence → debt
  │                 research_debt.json      stable debt sidecar
  │                 contradictions.json     stable conflict-resolution sidecar
  │
  ├─ synth        → REPORT.md               final report — only verified facts,
  │                                         [F#] citations inline
  │
  └─ refine       (opt-in, --refine flag)   for questions flagged
                                            insufficient / gaps_critical,
                                            generate narrower targeted queries
                                            from the gap list, re-harvest,
                                            then re-run evidence → verify →
                                            analyze → synth with the new
                                            findings folded in
```

Every phase is resumable: if the artifact exists, that phase is skipped unless you pass `--rescout / --replan / --reharvest / --re-evidence / --re-verify / --re-analyze / --refine`. This matters — full runs take 30–60 min; iterating on the synthesizer prompt without re-harvesting is ~4 min instead of 2 hours (synth runs every invocation, so no flag needed to re-run it alone).

All structured artifacts go through Zod schemas (`src/schemas/*.ts`) and LLM outputs are requested through OpenAI-compatible function calling, then validated + retried on parse/schema failure. Retry strategy: up to 3 passes with the prior error fed back to the model, then fallback to a second LLM endpoint via `GEMMA_FALLBACK_URLS`.

## Requirements

- [Bun](https://bun.sh/) ≥ 1.2
- Docker (for SearXNG + deploy)
- An OpenAI-compatible LLM endpoint (vLLM / Ollama / Runpod)
- ~4 GB for SearXNG image + Playwright Chromium

## Setup

```bash
bun install

# Qwen/self-hosted OpenAI-compatible provider
export LLM_PROVIDER=qwen
export QWEN_BASE_URL=https://your-endpoint/v1
export QWEN_MODEL=qwen3.6-35b-a3b

# Or Gemini 3 Flash: OpenAI-compatible chat + optional native search grounding
export LLM_PROVIDER=gemini
export GEMINI_API_KEY=your_google_ai_studio_key
export GEMINI_MODEL=gemini-3-flash-preview
export GEMINI_REASONING_EFFORT=low
export GEMINI_SEARCH_GROUNDING=1

# Start SearXNG
cd infra/searxng && docker compose up -d && cd ../..

# Run
bun run src/run.ts "your research topic"

# If your shell cannot reach localhost:8888 (sandbox, docker-in-docker),
# run the pipeline inside a container on the searxng docker network:
./scripts/run.sh "your research topic"
```

Artifacts land in `projects/<slug>/`:

```
projects/<slug>/
├── scout_digest.json     broad lit-survey summary fed into planner
├── plan.json             ResearchQuestion[] { id, question, category, subquestions[] }
├── sources/
│   ├── <SQ>.json         per-subquestion scraped sources (Playwright markdown)
│   ├── index.json        aggregate by provider / subquestion
│   └── content/          raw page markdown, one file per URL
├── sources.json          stable aggregate source audit
├── facts.json            Fact[] with {statement, factuality, confidence, references}
├── verification.json     per-fact verdict + notes + corrected_statement
├── analysis_report.json  per-question answers + cross-question tensions
├── analysis.json         stable alias for consumers
├── epistemic_graph.json  claim lifecycle, counterevidence, debt, contradictions
├── research_debt.json    debt items + severity summary
├── contradictions.json   contradiction pass + conflict pairs
├── llm_usage_summary.json token/cost telemetry by phase and model
├── playbook.json         structured operational rules/checklists/evals
├── PLAYBOOK.md           human-readable knowledge-to-playbook compiler output
├── README.md             auto-generated overview + coverage tally
└── REPORT.md             final citation-backed report
```

## Results

Measured against ChatGPT Deep Research on a shared seed topic ("KV-cache compression to fit a 35B MoE model into 4 GPU slots on RTX 5090"). Reproduce with `bun run scripts/eval.ts <slug>`:

| Metric                           | ChatGPT Deep Research | Research Lab |
|----------------------------------|----------------------:|-------------:|
| Primary-source share             | 85 %                  | **92.5 %**   |
| URL validity (malformed=0)       | 100 %                 | 100 %        |
| Verified facts / total           | —                     | **149 / 208 (71.6 %)** |
| Key-concept coverage (18 seeded) | 15 / 18               | 14 / 18      |
| Cross-question tensions surfaced | 3                     | 1            |
| Sources collected                | —                     | 293          |

Verdict breakdown from the 3-layer verifier on the same run:

| Verdict           | Count | Layer                        |
|-------------------|------:|------------------------------|
| `verified`        | 149   | all three pass               |
| `url_dead`        | 17    | L1 — HEAD on URL             |
| `quote_fabricated`| 5     | L2 — keyword substring match |
| `overreach`       | 9     | L3 — LLM adversarial review  |
| `out_of_context`  | 15    | L3                           |
| `misread`         | 13    | L3                           |

The rejected 28 % (59 facts) never reach the final report. The synthesizer takes only `verified` facts as input. Per-question coverage on this run: 3 `gaps_critical`, 1 `insufficient` — the analyzer does not paper over holes it didn't fill.

## Web UI + API

```bash
cd apps/web
bun install
bun run dev           # localhost:3000
```

- **Browser UI**: project dashboard, reading-mode document layout with scroll-spy TOC, citation chips, PDF export. Email/password auth (scrypt, HMAC-signed session cookies).
- **Per-user isolation**: each user sees only their own runs. Admin-owned projects are treated as a public showcase visible to every signed-in user; admins see everything for moderation.
- **REST API**: full OpenAPI 3.1 spec at `/api/openapi.json`. Authenticate via `X-API-Key`, `Authorization: Bearer`, or session cookie. API keys are scoped to the user who minted them — a consumer app with your key sees your projects, not showcase-only. Endpoints for listing projects, fetching the full artifact bundle, pulling individual facts with verification verdicts, streaming run logs via SSE.
- **Webhooks**: configure a URL in `/settings` → webhook card; when a run you started finishes, the server POSTs a signed `run.completed` / `run.failed` event to that URL with `report`/`facts`/`analysis`/`pdf` links. Signature in `X-Signature-256: sha256=<hmac(body, secret)>` — consumer verifies; secret is minted server-side and shown once on save. 3 retries with 1s/5s/30s backoff; terminal failures appended to `data/webhook-failures.jsonl`.
- **PDF export**: `/api/projects/{slug}/pdf` — Playwright renders `/projects/{slug}/print` into a print-mode document.

Deploy to a server via `deploy/docker-compose.yml` (SearXNG + web + docker-out-of-docker so the web container can spawn pipeline containers on the shared network). See `deploy/README.md`.

## Architecture

- `src/run.ts`       — orchestrator, resumable phase runner
- `src/scout.ts`     — lit survey → calibration digest
- `src/planner.ts`   — topic → question tree, 6 categories × 6 angles
- `src/refine.ts`    — gap-closing pass: narrow queries for weak questions, re-harvest, re-extract
- `src/harvester.ts` — SearXNG + Arxiv + OpenAlex adapters, Playwright extraction
- `src/evidence.ts`  — fact extraction with exact-quote binding
- `src/verifier.ts`  — 3-layer verification (URL → quote → adversarial LLM)
- `src/analyzer.ts`  — per-question synthesis, cross-question tension detection
- `src/synthesizer.ts` — final report, only verified facts cited
- `src/llm.ts`       — OpenAI-compatible client + JSON schema validation + retry + failover
- `src/schemas/`     — Zod schemas: `plan.ts`, `fact.ts`, `verification.ts`, `source.ts`, `learning.ts`
- `apps/web/`        — Next.js 16 App Router (Edge middleware auth, Node route handlers)
- `infra/searxng/`   — SearXNG docker-compose

## License

MIT
