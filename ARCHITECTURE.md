# Architecture

Research Lab is a 5-phase pipeline that turns a research topic into a citation-backed report, with structured intermediate artifacts at every step.

## Design principles

1. **Filesystem is source of truth.** Every phase writes a structured JSON/Markdown artifact to the project folder. The pipeline can be resumed from any phase, artifacts can be inspected by hand, and projects are git-friendly.
2. **Each phase is just `prompt + Zod schema + LLM call + retry`.** No magic; the layer's value is in its schema, prompt, and post-processing — not in an opaque abstraction.
3. **Deep research, not metadata parsing.** Queries get paginated SearXNG results, every URL is scraped for full content via Jina Reader (not snippets), and the loop recurses on follow-up questions like a human researcher would.
4. **Provider-agnostic LLM.** Uses OpenAI-compatible HTTP. Works with Gemma 4 on vLLM/Ollama, Llama 3, GPT-4, Claude via compatibility layer, etc.

## Pipeline phases

### 1. Planner (`src/planner.ts`)

Turns a topic into a structured `ResearchPlan`:
- 3–10 falsifiable hypotheses, each with measurable `acceptance_criteria` (metric name + threshold)
- 5–15 tasks, each linked to a hypothesis, with `depends_on` edges between tasks
- Budget (max steps, max sources)

**LLM call**: one `generateJson` with `ResearchPlanSchema` + `PLANNER_SYSTEM_PROMPT`.

### 2. Harvester (`src/harvester.ts`)

Deep-research loop inspired by [`dzhng/deep-research`](https://github.com/dzhng/deep-research), adapted to our stack:

For each task in the plan:
1. **Breadth**: LLM generates N diverse search queries from the task goal.
2. **Search**: Each query hits SearXNG (paginated, multi-engine: Google / DuckDuckGo / Startpage) + Arxiv + Semantic Scholar in parallel. 20–100 results per query.
3. **Scrape**: Top-N unvisited URLs are fetched through [Jina Reader](https://r.jina.ai/) → full markdown content (not snippets).
4. **Extract learnings**: LLM reads the full content and emits concise factual learnings + follow-up questions via `LearningsSchema`.
5. **Recurse**: If `depth > 1`, breadth halves, the loop runs again with follow-up questions as the new goal.

Outputs:
- `sources/<task>.json` — search results with `raw_content` attached
- `sources/content/<hash>.md` — full scraped markdown per URL
- `sources/index.json` — summary (total, breakdown by provider & task)

### 3. Evidence (`src/evidence.ts`)

For each task/hypothesis:
- Pack up to 40k characters of full-content sources + harvester learnings into prompt
- LLM extracts `Claim[]` with `{id, hypothesis_id, statement, type: supports|contradicts|neutral, confidence 0–1, references[{url, title, exact_quote}]}`
- Deduplicate by statement similarity

Output: `claims.json`.

### 4. Critic (`src/critic.ts`)

Reads all claims + hypotheses, produces `CriticReport`:
- Per hypothesis: status (`well_supported` / `partially_supported` / `unsupported` / `contradicted`), confidence, supporting/contradicting claim IDs, gaps, recommendation
- Cross-claim contradiction detection
- Overall confidence + summary

Output: `critic_report.json`.

### 5. Synthesizer (`src/synthesizer.ts`)

Reads plan + claims + critic report, generates final markdown report:
- Executive summary
- One section per hypothesis with cited evidence (`[C1]` style)
- Gaps & next steps
- Methodology
- References (deduplicated URL list)

Output: `REPORT.md`.

## Data model

See `src/schemas/` for Zod source:

- `plan.ts` — `ResearchPlanSchema`, `HypothesisSchema`, `TaskSchema`
- `source.ts` — `SearchResultSchema`, `SourceIndexSchema`
- `learning.ts` — `SerpQueriesSchema`, `LearningsSchema`
- `claim.ts` — `ClaimSchema`, `ReferenceSchema`, `CriticReportSchema`

## LLM integration (`src/llm.ts`)

One function: `generateJson({schema, system, prompt, maxTokens, temperature, maxRetries})`.

- Sends `response_format: { type: "json_object" }` with the schema rendered as a human-readable hint in the prompt
- Parses JSON, validates with Zod
- On failure: retries up to `maxRetries` times with the validation errors appended as feedback
- Works around the fact that `@ai-sdk/openai-compatible` doesn't support `responseFormat` for most providers

## Search infrastructure

- **SearXNG** (`infra/searxng/`): self-hosted metasearch (Google, DuckDuckGo, Startpage, Wikipedia, …). Docker compose. No API keys, no rate limits.
- **Arxiv**: public XML API, free.
- **Semantic Scholar**: public JSON API, free, rate-limited (handled with backoff).

## Project folder layout

```
projects/<slug>/
├── plan.json
├── README.md
├── hypotheses/H*.md
├── sources/
│   ├── T*.json
│   ├── content/<hash>.md
│   └── index.json
├── claims.json
├── critic_report.json
└── REPORT.md
```

Multi-project: each topic gets its own folder. The Next.js app (`apps/web/`) reads from `projects/` directly — no database.
