# Architecture

Syncera is a question-first research pipeline: a topic becomes a structured question tree, each subquestion is independently harvested and fact-extracted with exact-quote binding, every fact is verified against its cited URL through a three-layer check, and only verified facts reach the final report.

## Design principles

1. **Filesystem is the source of truth.** Every phase writes a structured JSON or Markdown artifact to the project folder. Phases are resumable — if the artifact exists, skip unless `--re-<phase>` is passed. Full runs are 30–60 min; iterating on the synthesizer prompt alone is ~4 min.
2. **Every phase is `schema + prompt + function call + post-check`.** No opaque abstractions. All structured LLM outputs go through OpenAI-compatible tool/function calling, then a Zod schema with retry on parse/validation failure; on schema mismatch the retry prompt includes the exact zod issue paths.
3. **Question-first, not hypothesis-first.** The planner decomposes a topic into questions the report must answer — not hypotheses the report must support. Fabricated numeric thresholds up front are the thing we don't do.
4. **Audit trail over narrative.** Every sentence in the report traces to a verified `Fact` with `{statement, confidence, references:[{url, exact_quote}]}`; every fact traces to a verdict from the verifier. The synthesizer is only fed verified facts.
5. **Provider-agnostic LLM.** OpenAI-compatible HTTP. Works with Qwen / Gemma / Llama on vLLM, llama.cpp, Ollama, Runpod, plus Gemini's OpenAI-compatible endpoint. Provider config is split by `LLM_PROVIDER=qwen|gemini`.
6. **Cognition is inspectable.** The web product exposes coverage, sources, fact verification, usage, versions, and `/api/projects/:slug/audit` as first-class surfaces instead of hiding them behind the final prose.

## Pipeline

```
Topic
  │
  ├─ scout        → scout_digest.json
  ├─ plan         → plan.json               (ResearchQuestion[] × Subquestion[])
  ├─ harvest      → sources/<SQ>.json       + sources/content/<hash>.md
  ├─ relevance    → sources/<SQ>.json       (domain/source-quality verdicts)
  ├─ evidence     → facts.json              (Fact[] with exact-quote refs)
  ├─ verify       → verification.json       (3-layer check per fact)
  ├─ analyze      → analysis_report.json    (per-question answers + tensions)
  ├─ epistemic    → epistemic_graph.json    (claims, debt, contradictions)
  ├─ synth        → REPORT.md               (only verified facts)
  ├─ playbook     → PLAYBOOK.md             (rules, checklists, evals)
  └─ refine       (opt-in: --refine)
```

### Scout (`src/scout.ts`)
Broad literature survey before planning. Feeds a digest into the planner so questions aren't invented in a vacuum.

### Planner (`src/planner.ts`)
Topic → `ResearchPlan` = 5–15 `ResearchQuestion` (category ∈ {factual, comparative, trade_off, feasibility, deployment, mechanism}), each with 2–5 `Subquestion` (angle ∈ {benchmark, methodology, comparison, case_study, feasibility, trade_off}). No thresholds, no hypotheses. Categories drive narrative tone; angles drive query phrasing. Planner post-processing repairs IDs, canonicalizes near-miss enum labels, and expands too-short plans to the minimum count.

### Harvester (`src/harvester.ts`)
For each subquestion:
1. **Breadth** — LLM generates diverse queries from the subquestion text and angle.
2. **Search** — SearXNG (paginated) + Arxiv + OpenAlex + Semantic Scholar in parallel.
3. **Scrape** — top-N URLs rendered to markdown via Playwright (system chromium). Scored by tier (primary > official > code > blog > community) so the extractor sees the best source first.
4. **Extract learnings** — one LLM pass per subquestion emitting concise factual learnings.
5. **Persist** — `sources/<SQ>.json` (search results + learnings), `sources/content/<hash>.md` (full markdown), `sources/index.json` (aggregate).

### Relevance (`src/relevance.ts`)
Runs after harvest and before evidence extraction. Each source gets a domain verdict (`on | partial | off`), usefulness score (`0..3`), and source type (`peer_reviewed | preprint | clinical | technical_report | reference_work | blog | marketing | other`). Evidence extraction filters usefulness `0`; project summaries compute accepted/rejected counts and a 0–100 source quality score from these verdicts plus source authority.

### Evidence (`src/evidence.ts`)
Per subquestion, packs the learnings + tier-sorted source catalog into a prompt. LLM emits `Fact[]` with `{id, question_id, subquestion_id, statement, factuality ∈ {quantitative|qualitative|comparative|background}, confidence 0–1, references:[{url, title, exact_quote}]}`. Post-processing:

- **Attribution check** — extract the fact's primary named entity (CamelCase/KV-stem/ACRONYM/hyphenated regexes), require it to appear in the cited source's scraped content. Swap URL to a source that does contain it, or downgrade confidence to 0.3.
- **Dedup** by first 120 chars of statement.

Output: `facts.json`.

### Verifier (`src/verifier.ts`)
Three layers per fact, cheapest-first:

1. **URL liveness** — GET with `Range: bytes=0-0`. Verdict: `url_dead` if unreachable.
2. **Keyword substring** — normalize the exact quote to lowercase + stripped whitespace, check keyword overlap against the scraped content. Verdict: `quote_fabricated` if ≥3 keywords extracted and <2 match.
3. **LLM adversarial review** — pass fact + 15k-char source excerpt to a skeptical fact-checker prompt. Verdicts: `verified | overreach | out_of_context | cherry_picked | misread`, with notes and a `corrected_statement` for non-verified.

Output: `verification.json` with per-fact verdicts + summary.

### Analyzer (`src/analyzer.ts`)
Filters to verified facts, produces per-question narrative answers with `{coverage ∈ {complete|partial|gaps_critical|insufficient}, key_facts, conflicting_facts, gaps, follow_ups}`. Also surfaces `cross_question_tensions`.

Output: `analysis_report.json`.

### Epistemic graph (`src/epistemic.ts`, `src/contradictions.ts`)
Turns facts into claim lifecycle objects: claim → evidence → verification → counterevidence → confidence → freshness → dependencies → open questions. The deterministic graph is then enriched by the contradiction resolver and written to `epistemic_graph.json`, `research_debt.json`, and `contradictions.json`.

### Synthesizer (`src/synthesizer.ts`)
Assembles the final markdown report using **only verified facts**, with inline citations `[F#]`. Coverage tally + per-question status in the auto-generated `README.md`.

Output: `REPORT.md`.

### Playbook (`src/playbook.ts`)
Compiles verified research into operational knowledge: rules, checklists, decision trees, evals, failure modes, interventions, and templates. Thin evidence stays as eval triggers or research debt instead of becoming policy.

Output: `playbook.json` and `PLAYBOOK.md`.

### Refine (`src/refine.ts`, opt-in via `--refine`)
For questions flagged `insufficient`/`gaps_critical`, generates narrower targeted queries from the gap list ("TurboQuant CUDA kernel RTX 5090 implementation" vs broad survey queries), harvests, re-runs evidence → verify → analyze → synth with the new findings folded in.

## LLM integration (`src/llm.ts`)

Single entry point for structured outputs: `generateJson({schema, system, prompt, temperature, maxRetries, endpoint})`.

- Sends an OpenAI-compatible function/tool call (`submit_structured_output` for generic calls, phase-specific tool names where helpful).
- Parses + validates against the schema.
- On parse failure: retries with the error message in the retry prompt.
- On zod validation failure: retries with the specific issue paths (`facts.0.confidence: Expected number, received string`) so the model can self-correct.
- Endpoint failover: on fatal error, try the next URL in `QWEN_FALLBACK_URLS` / `GEMINI_FALLBACK_URLS` / legacy `GEMMA_FALLBACK_URLS`.

Also: `generateText` (plain prose), `countTokens`, `getContextWindow`, `inputTokenBudget`.

## Data model

See `src/schemas/`:

- `plan.ts` — `ResearchPlanSchema`, `ResearchQuestionSchema`, `SubquestionSchema`
- `source.ts` — `SearchResultSchema`, `SourceIndexSchema`
- `learning.ts` — `SerpQueriesSchema`, `LearningsSchema`
- `fact.ts` — `FactSchema`, `ReferenceSchema`, `QuestionAnswerSchema`, `AnalysisReportSchema`
- `verification.ts` — `VerdictSchema` (7 verdicts), `VerificationSchema`

## Project folder layout

```
projects/<slug>/
├── scout_digest.json
├── scout.json
├── plan.json
├── sources/
│   ├── <SQ>.json            per-subquestion results + learnings + relevance
│   ├── content/<hash>.md    raw scraped markdown
│   └── index.json           by-provider / by-subquestion aggregate
├── sources.json             stable source audit + source quality summary
├── facts.json
├── verification.json
├── analysis_report.json
├── analysis.json
├── epistemic_graph.json
├── research_debt.json
├── contradictions.json
├── llm_usage_summary.json
├── playbook.json
├── PLAYBOOK.md
├── README.md                auto-generated overview + coverage tally
└── REPORT.md
```

Multi-project: each topic is an independent folder. The Next.js app (`apps/web/`) reads from `projects/` directly — no database. Web container writes via a bind mount; pipeline containers are spawned via docker-out-of-docker on the same compose network.

## Web (`apps/web/`)

Next.js 16 App Router. Edge middleware handles auth, CORS, and token-bucket rate limiting; route handlers run on Node for filesystem + scrypt access.

- **Auth**: email/password accounts (scrypt N=16384), HMAC-SHA256 signed session cookies (30-day Max-Age, HttpOnly, SameSite=Lax). Middleware verifies via Web Crypto so it runs on Edge.
- **API keys**: file-backed store (`lib/keys.ts`), SHA-256 hashed, raw shown once, revocation idempotent.
- **Admin surface**: `/api/admin/users`, `/api/admin/keys` — session-gated, admin-role only. Self-delete and last-admin guards.
- **OpenAPI 3.1**: `/api/openapi.json` documents every endpoint including auth + admin.
- **Project view**: reading-mode layout with `Report`, `Playbook`, `Claims`, `Evidence`, `Debt`, `Cognition`, `Sources`, `Coverage`, and `Versions`.
- **Run health**: `/api/runs` merges in-memory and disk-persisted run metadata, including phase, last line, artifact counters, token usage, source quality, and stale-log warnings.
- **Compare**: `/compare?a=<slug>&b=<slug>` shows source overlap plus verified facts, source quality, research debt, and contradictions.
- **PDF export**: `/api/projects/{slug}/pdf` — Playwright renders `/projects/{slug}/print` to PDF with print.css overrides.

## Deployment

`deploy/docker-compose.yml` on the host:

- **searxng** — the metasearch instance.
- **web** — the Next.js app, with `/var/run/docker.sock` bind-mounted and `group_add: <docker GID>` so it can spawn sibling pipeline containers on the same compose network.
- Volumes: `../projects:/app/projects:rw`, `../data:/app/data:rw` (persistent users/keys store).
- Env: `SESSION_SECRET`, `ADMIN_EMAIL/PASSWORD`, `GEMMA_BASE_URL`, `API_CORS_ORIGINS`, `API_RATE_LIMIT_PER_MIN`, `PIPELINE_HOST_REPO_ROOT`, `PIPELINE_NETWORK`.

## Product surfaces

- `Report`: narrative answer from verified facts only.
- `Claims`: claim lifecycle objects with evidence, confidence, verification, dependencies, counterevidence, and open questions.
- `Evidence`: source trust workbench with claim impact and recheck branches.
- `Debt`: unresolved checks that should survive the report.
- `Cognition`: evidence control loop, trust budget, contradiction resolver, and question audit.
- `Versions`: branches, reruns, and compare links.

## Operational notes

Run health is derived from `projects/<slug>/runs/*.jsonl` and meta sidecars.
Source quality is derived from relevance verdicts plus source authority. Both
are intentionally computed from disk artifacts so UI, API, and CLI runs stay in
sync after process restarts.
