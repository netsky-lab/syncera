# Research Lab — REST API

External consumers read research artifacts and orchestrate runs through
this JSON API. The canonical machine-readable spec is
`/api/openapi.json` (OpenAPI 3.1) — this doc is a hand-written
overview for humans.

## Auth

Three accepted credentials:

```
X-API-Key: <raw_key>
Authorization: Bearer <raw_key>
Cookie: rl_session=<hmac-signed-session>   (browser UI, set by /api/auth/login)
```

Mint API keys at `/settings` → API keys once signed in as admin. Keys
are SHA-256 hashed on disk; the raw value is shown exactly once on
creation. `API_KEYS` in `deploy/.env` still works as a comma-separated
bootstrap set for the first admin to log in.

Rate limited to 60 req/min per identity (tunable via
`API_RATE_LIMIT_PER_MIN`). CORS is permissive by default — pin to your
consumer origin via `API_CORS_ORIGINS`.

## Auth endpoints (browser UI)

- `POST /api/auth/signup` — create account. First signup becomes admin;
  subsequent require `ALLOW_SIGNUP=1`.
- `POST /api/auth/login` — email + password → Set-Cookie `rl_session`.
- `POST /api/auth/logout` — clear the cookie.
- `GET  /api/auth/me` — current user or `{user: null}`.
- `POST /api/auth/password` — change own password (requires session).

## Admin endpoints (admin role required)

- `GET/POST /api/admin/users` — list / invite. Delete via
  `DELETE /api/admin/users/:id` (guarded against self-delete and
  removing the last admin).
- `GET/POST /api/admin/keys` — list / mint. Revoke via
  `DELETE /api/admin/keys/:id`.

These are session-only — API keys cannot mint more keys or add users,
to contain blast radius on a leaked key.

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

Returns a PDF binary. Accepts any of the three credentials (session
cookie / API key / Bearer). Playwright renders the
`/projects/:slug/print` page under the same auth context.

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
