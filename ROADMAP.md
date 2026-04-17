# Roadmap

## Current status — working

- [x] Planner: topic → `plan.json` with falsifiable hypotheses
- [x] Harvester: breadth × depth recursive search via SearXNG + full-page scraping via Jina Reader
- [x] Evidence: exact-quote claim extraction linked to sources
- [x] Critic: per-hypothesis assessment with gaps & contradictions
- [x] Synthesizer: citation-backed markdown report
- [x] Web UI: project dashboard + detail view (Next.js)
- [x] Self-hosted search (SearXNG via docker compose)
- [x] Playwright e2e tests

## Near-term

- [ ] Streaming progress in Web UI (SSE from run → live project updates)
- [ ] Run history — track multiple runs per project, diff over time
- [ ] Configurable breadth/depth per run (currently hardcoded)
- [ ] Better chunking for >100kB pages (current: hard truncate at 20k chars)

## Medium-term

- [ ] Embedding-based claim dedup (current: exact string match)
- [ ] Contradiction detection across claims via semantic similarity
- [ ] Arxiv / Semantic Scholar depth (follow citation graph)
- [ ] Per-phase model selection (cheap model for queries, stronger for synthesis)
- [ ] Scheduled runs (cron) — keep projects updated automatically

## Longer-term

- [ ] Multi-user auth (currently single-user/local)
- [ ] Credential vault for private corpora access
- [ ] Private-document ingestion (upload PDFs, drop into harvester)
- [ ] MCP tools — let external agents use the research engine
