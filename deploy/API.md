# Research Lab — REST API

External consumers (other apps, agents, scripts) read research artifacts
from this instance through a JSON API. Human browsers still use Basic Auth;
programmatic clients use API keys.

## Auth

Send your key in either:

```
X-API-Key: <your_key>
```

or

```
Authorization: Bearer <your_key>
```

The server accepts Basic Auth on `/api/*` too (same credentials as the
browser UI) so a cookie-authed session works. For machine clients use
API keys — rotate by editing `deploy/.env` and re-starting the container.

Configure accepted keys via `API_KEYS` in `deploy/.env`
(comma-separated). If both `BASIC_AUTH_PASS` and `API_KEYS` are unset,
the auth gate is fully disabled (dev mode).

## Endpoints

### GET `/api/health`

Liveness probe. Bypasses auth.

```json
{ "status": "ok", "timestamp": "2026-04-19T06:00:00.000Z" }
```

### GET `/api/projects`

List all projects with summary metadata.

```json
{
  "count": 1,
  "projects": [
    {
      "slug": "how-to-compress-kv-cache-to-fit-...",
      "topic": "How to compress KV-cache to fit ...",
      "schema": "question_first",
      "stats": {
        "questions": 4,
        "hypotheses": 0,
        "facts": 208,
        "claims": 0,
        "sources": 293,
        "learnings": 228
      },
      "has_report": true,
      "confidence": 0,
      "generated_at": ""
    }
  ]
}
```

### GET `/api/projects/:slug`

Full artifact bundle for one project.

Query params:
- `include=plan,facts,analysis,verification,sources,report`  (default: all)
  Pass subset to reduce payload size. For hypothesis-first projects, also
  supports `include=claims` to pull the legacy claims + critic_report.

Response (question-first):

```json
{
  "slug": "...",
  "schema": "question_first",
  "topic": "...",
  "plan": { "topic": "...", "questions": [...] },
  "facts": [{ "id": "F1", "statement": "...", "references": [...] }, ...],
  "analysis_report": { "answers": [...], "overall_summary": "..." },
  "verification": { "verifications": [...], "summary": {...} },
  "sources": {
    "index": { "total_sources": 293, "by_provider": {...} },
    "units": [{ "question_id": "Q1", "subquestion_id": "SQ1.1", "results": [...] }]
  },
  "report_md": "# Research Report: ...\n\n..."
}
```

### GET `/api/projects/:slug/facts`

Facts only, with verification annotations.

Query params:
- `verified=1` — filter to facts that verifier accepted
- `question_id=Q1` — filter to one question

```json
{
  "slug": "...",
  "count": 208,
  "facts": [
    {
      "id": "F1",
      "question_id": "Q1",
      "subquestion_id": "SQ1.1",
      "statement": "...",
      "factuality": "quantitative",
      "confidence": 0.9,
      "references": [{ "url": "...", "title": "...", "exact_quote": "..." }],
      "verification": { "verdict": "verified", "severity": "none", "notes": "..." }
    }
  ]
}
```

### GET `/api/projects/:slug/analysis`

Just the analysis report (question-first) or critic report (legacy).

```json
{
  "slug": "...",
  "schema": "question_first",
  "analysis": {
    "answers": [
      {
        "question_id": "Q1",
        "answer": "...",
        "coverage": "partial",
        "gaps": ["..."],
        "follow_ups": ["..."],
        "conflicting_facts": [{ "fact_a": "F12", "fact_b": "F30", "nature": "..." }]
      }
    ],
    "cross_question_tensions": [...],
    "overall_summary": "..."
  }
}
```

Returns `202 Accepted` with `{"error": "Analysis not yet generated"}` when
the analyzer phase hasn't run.

### GET `/api/projects/:slug/plan`

Plan only — questions + subquestions for question-first, hypotheses +
tasks for legacy.

### GET `/api/projects/:slug/report`

Response format:
- Default: `text/markdown; charset=utf-8` — the full REPORT.md content
- `?format=json` — wraps it as `{ "slug": "...", "report_md": "..." }`

### GET `/api/projects/:slug/pdf`

Returns a PDF binary. Requires Basic Auth or API key. Playwright renders
the `/projects/:slug/print` page under auth.

### POST `/api/runs/start`

Kick off a new research run. Body:

```json
{ "topic": "your research topic", "constraints": "optional" }
```

Returns `{ "runId": "...", "slug": "...", "topic": "..." }`. Stream logs
via `GET /api/runs/stream?id=<runId>`.

## Error responses

`401 Unauthorized` — missing or invalid credentials.
`404 Not Found` — slug doesn't exist.
`202 Accepted` — artifact exists as a project, but this phase hasn't run yet.
`500 Internal Server Error` — pipeline or filesystem error.

## Typical consumer flow

```bash
# 1. List what's available
curl -H "X-API-Key: $KEY" https://research.example.com/api/projects

# 2. Pick a project, pull the narrative + verified facts
curl -H "X-API-Key: $KEY" \
  "https://research.example.com/api/projects/<slug>?include=analysis,facts,plan"

# 3. Or just the markdown report
curl -H "X-API-Key: $KEY" https://research.example.com/api/projects/<slug>/report

# 4. Kick off a new investigation
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"topic": "..."}' \
  https://research.example.com/api/runs/start
```
