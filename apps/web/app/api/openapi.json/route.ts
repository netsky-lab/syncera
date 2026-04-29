// GET /api/openapi.json — OpenAPI 3.1 spec for the Syncera API.
// Consumers can pipe this into `openapi-generator-cli` / `openapi-typescript` /
// `oapi-codegen` etc to autogenerate a typed client.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Exported so unit tests can lint the spec without booting the HTTP server.
// `origin` defaults to a placeholder; the GET handler overrides it with the
// request's origin for the live response.
export function buildOpenApiSpec(origin = "https://example.local") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Syncera API",
      version: "0.3.0",
      description:
        "Question-first research engine. Decompose a topic into a question tree, harvest primary sources, extract facts with exact-quote binding, verify each fact against its cited URL through a three-layer check (URL liveness → keyword substring → LLM adversarial review), and synthesize a citation-backed report using only verified facts. Endpoints cover listing/reading research artifacts, starting new runs, and streaming live pipeline logs.",
      license: { name: "MIT" },
    },
    servers: [{ url: origin, description: "Current deployment" }],
    security: [{ ApiKeyHeader: [] }, { BearerKey: [] }, { BasicAuth: [] }, { SessionCookie: [] }],
    tags: [
      { name: "projects", description: "Research artifacts" },
      { name: "runs", description: "Pipeline orchestration" },
      { name: "auth", description: "Browser auth (session cookie)" },
      { name: "admin", description: "Admin-only user and API key management" },
      { name: "keys", description: "Per-user API key management" },
      { name: "chat", description: "Pre-research scope clarification chat" },
    ],
    components: {
      securitySchemes: {
        ApiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API key as configured in API_KEYS env var or minted via /api/admin/keys.",
        },
        BearerKey: {
          type: "http",
          scheme: "bearer",
          description: "Same API key value as ApiKeyHeader, carried in Authorization header.",
        },
        BasicAuth: {
          type: "http",
          scheme: "basic",
          description:
            "Migration-only — accepted when SESSION_SECRET is unset. Prefer session cookie or API key.",
        },
        SessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "rl_session",
          description:
            "HMAC-signed session cookie issued by /api/auth/login or /api/auth/signup. Used by the browser UI.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
        ProjectSummary: {
          type: "object",
          required: ["slug", "topic", "schema", "stats", "has_report"],
          properties: {
            slug: { type: "string" },
            topic: { type: "string" },
            schema: { type: "string", enum: ["question_first", "hypothesis_first", "empty"] },
            stats: {
              type: "object",
              properties: {
                questions: { type: "integer" },
                hypotheses: { type: "integer" },
                facts: { type: "integer" },
                claims: { type: "integer" },
                sources: { type: "integer" },
                learnings: { type: "integer" },
                source_quality: {
                  type: "integer",
                  description: "0-100 source quality score from relevance gate and source authority mix.",
                },
                accepted_sources: { type: "integer" },
                rejected_sources: { type: "integer" },
              },
            },
            has_report: { type: "boolean" },
            confidence: { type: "number", description: "0 for question-first; 0-1 for hypothesis-first" },
            generated_at: { type: "string" },
            owner_uid: {
              type: ["string", "null"],
              description: "UID of the user who started this project's first run. null on legacy projects that haven't been migrated yet.",
            },
            is_showcase: {
              type: "boolean",
              description: "True when the owner has admin role — visible to every authenticated user as a public example.",
            },
          },
        },
        Reference: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
            title: { type: "string" },
            exact_quote: { type: "string" },
          },
        },
        Fact: {
          type: "object",
          required: ["id", "statement", "references"],
          properties: {
            id: { type: "string", example: "F1" },
            question_id: { type: "string", example: "Q1" },
            subquestion_id: { type: "string", example: "SQ1.1" },
            statement: { type: "string" },
            factuality: {
              type: "string",
              enum: ["quantitative", "qualitative", "comparative", "background"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            references: {
              type: "array",
              items: { $ref: "#/components/schemas/Reference" },
            },
            verification: {
              oneOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    verdict: {
                      type: "string",
                      enum: [
                        "verified",
                        "url_dead",
                        "quote_fabricated",
                        "overreach",
                        "out_of_context",
                        "cherry_picked",
                        "misread",
                      ],
                    },
                    severity: { type: "string", enum: ["none", "minor", "major"] },
                    notes: { type: "string" },
                  },
                },
              ],
            },
          },
        },
        Subquestion: {
          type: "object",
          required: ["id", "text", "angle"],
          properties: {
            id: { type: "string", example: "SQ1.1" },
            text: { type: "string" },
            angle: {
              type: "string",
              enum: [
                "benchmark",
                "methodology",
                "comparison",
                "case_study",
                "feasibility",
                "trade_off",
              ],
            },
          },
        },
        ResearchQuestion: {
          type: "object",
          required: ["id", "question", "category", "subquestions"],
          properties: {
            id: { type: "string", example: "Q1" },
            question: { type: "string" },
            category: {
              type: "string",
              enum: [
                "factual",
                "comparative",
                "trade_off",
                "feasibility",
                "deployment",
                "mechanism",
              ],
            },
            subquestions: {
              type: "array",
              items: { $ref: "#/components/schemas/Subquestion" },
            },
          },
        },
        Plan: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string" },
            constraints: { type: "string" },
            scope_notes: { type: "string" },
            questions: {
              type: "array",
              items: { $ref: "#/components/schemas/ResearchQuestion" },
            },
            // Legacy fields for hypothesis_first projects:
            hypotheses: { type: "array", items: { type: "object" } },
            tasks: { type: "array", items: { type: "object" } },
            validation_needed: { type: "boolean" },
          },
        },
        QuestionAnswer: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            answer: { type: "string" },
            key_facts: { type: "array", items: { type: "string" } },
            conflicting_facts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fact_a: { type: "string" },
                  fact_b: { type: "string" },
                  nature: { type: "string" },
                },
              },
            },
            coverage: {
              type: "string",
              enum: ["complete", "partial", "gaps_critical", "insufficient"],
            },
            gaps: { type: "array", items: { type: "string" } },
            follow_ups: { type: "array", items: { type: "string" } },
          },
        },
        AnalysisReport: {
          type: "object",
          properties: {
            answers: {
              type: "array",
              items: { $ref: "#/components/schemas/QuestionAnswer" },
            },
            cross_question_tensions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  involved_questions: { type: "array", items: { type: "string" } },
                  involved_facts: { type: "array", items: { type: "string" } },
                },
              },
            },
            overall_summary: { type: "string" },
          },
        },
        User: {
          type: "object",
          required: ["id", "email", "role", "created_at"],
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["admin", "user"] },
            created_at: { type: "string", format: "date-time" },
          },
        },
        ApiKey: {
          type: "object",
          required: ["id", "name", "prefix", "created_at"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            prefix: { type: "string", description: "First characters of the raw key for identification." },
            created_at: { type: "string", format: "date-time" },
            last_used_at: { type: ["string", "null"], format: "date-time" },
            owner_uid: {
              type: ["string", "null"],
              description:
                "The user who minted the key. API calls with this key inherit the owner's project visibility.",
            },
          },
        },
        SectionVariant: {
          type: "object",
          required: ["id", "section", "hint", "content", "created_at"],
          properties: {
            id: { type: "string" },
            section: {
              type: "string",
              enum: [
                "introduction",
                "summary",
                "comparison",
                "deployment",
                "recommendation",
              ],
            },
            hint: {
              type: "string",
              description:
                "Natural-language instruction the user gave to regenerate this section.",
            },
            content: {
              type: "string",
              description: "Markdown content of the regenerated section.",
            },
            created_at: { type: "integer" },
            created_by: { type: "string" },
          },
        },
        Run: {
          type: "object",
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            slug: { type: "string" },
            status: { type: "string", enum: ["running", "completed", "failed"] },
            startedAt: { type: "integer", description: "Unix ms" },
            exitCode: { type: ["integer", "null"] },
            phase: { type: ["string", "null"], description: "Current phase name" },
            lastLine: { type: ["string", "null"] },
            progress: {
              type: "object",
              description: "Live artifact counters and aggregate LLM usage.",
            },
            health: {
              type: "object",
              description: "Idle/stalled detection derived from latest log or usage activity.",
            },
            quality: {
              type: "object",
              description: "Heuristic run-quality verdict with retry/watch/good labels.",
            },
            errors: {
              type: "object",
              description: "Recovered transient failures and unreadable-source counters.",
            },
            phaseUsage: {
              type: "array",
              description: "LLM calls, tokens, and estimated cost grouped by pipeline phase.",
              items: {
                type: "object",
                properties: {
                  phase: { type: "string" },
                  calls: { type: "integer" },
                  promptTokens: { type: "integer" },
                  completionTokens: { type: "integer" },
                  totalTokens: { type: "integer" },
                  estimatedCalls: { type: "integer" },
                  estimatedCostUsd: { type: "number" },
                },
              },
            },
            timeline: {
              type: "array",
              description: "Phase spans reconstructed from run event logs and usage telemetry.",
              items: {
                type: "object",
                properties: {
                  phase: { type: "string" },
                  startedAt: { type: ["integer", "null"] },
                  endedAt: { type: ["integer", "null"] },
                  durationSeconds: { type: ["integer", "null"] },
                  status: { type: "string", enum: ["done", "active", "pending"] },
                  calls: { type: "integer" },
                  tokens: { type: "integer" },
                  costUsd: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Liveness probe",
          security: [],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects": {
        get: {
          summary: "List projects",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      count: { type: "integer" },
                      projects: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ProjectSummary" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{slug}": {
        get: {
          summary: "Full project artifact bundle",
          parameters: [
            {
              name: "slug",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "include",
              in: "query",
              required: false,
              schema: {
                type: "string",
                example: "plan,facts,analysis,verification,sources,report",
              },
              description: "Comma-separated subset of sections to include. Default: all.",
            },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      schema: { type: "string" },
                      topic: { type: "string" },
                      plan: { $ref: "#/components/schemas/Plan" },
                      facts: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Fact" },
                      },
                      analysis_report: { $ref: "#/components/schemas/AnalysisReport" },
                      report_md: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": {
              description: "Project not found",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
      "/api/projects/{slug}/facts": {
        get: {
          summary: "Facts for a project",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            {
              name: "verified",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["1"] },
              description: "Filter to verifier-accepted facts only.",
            },
            {
              name: "question_id",
              in: "query",
              required: false,
              schema: { type: "string", example: "Q1" },
            },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      count: { type: "integer" },
                      facts: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Fact" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{slug}/analysis": {
        get: {
          summary: "Analysis (question-first) or critic (legacy) report",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      schema: { type: "string" },
                      analysis: { $ref: "#/components/schemas/AnalysisReport" },
                    },
                  },
                },
              },
            },
            "202": { description: "Accepted — phase not yet run" },
          },
        },
      },
      "/api/projects/{slug}/plan": {
        get: {
          summary: "Research plan",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      schema: { type: "string" },
                      plan: { $ref: "#/components/schemas/Plan" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{slug}/report": {
        get: {
          summary: "REPORT.md — markdown or wrapped JSON",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            {
              name: "format",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["md", "json"], default: "md" },
            },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "text/markdown": {},
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      report_md: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{slug}/pdf": {
        get: {
          summary: "Rendered PDF",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "PDF binary",
              content: { "application/pdf": {} },
            },
          },
        },
      },
      "/api/projects/{slug}/export": {
        get: {
          summary: "Download project audit bundle",
          description:
            "Returns a zip containing REPORT.md, PLAYBOOK.md, JSON artifacts, source indexes, and run logs. Pass include_content=1 to include raw scraped source markdown.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            {
              name: "include_content",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["1"] },
            },
          ],
          responses: {
            "200": {
              description: "ZIP archive",
              content: {
                "application/zip": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "404": { description: "Project not found" },
          },
        },
      },
      "/api/projects/{slug}/audit": {
        get: {
          summary: "Research audit trail",
          description:
            "Exports the project's cognitive audit state: question coverage, source mix, fact verification counts, gaps, follow-ups, and LLM usage.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            {
              name: "download",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["1"] },
            },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      slug: { type: "string" },
                      topic: { type: "string" },
                      cognitive_contract: { type: "object" },
                      metrics: { type: "object" },
                      source_mix: { type: "object" },
                      source_status: { type: "object" },
                      usage: { type: ["object", "null"] },
                      questions: { type: "array", items: { type: "object" } },
                      verification_summary: { type: ["object", "null"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{slug}/debt/{debtId}": {
        patch: {
          tags: ["projects"],
          summary: "Update research debt status",
          description:
            "Owner-or-admin only. Stores a sidecar status for an epistemic_graph research debt item without mutating the graph artifact.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "debtId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: {
                      type: "string",
                      enum: ["open", "running", "resolved", "dismissed"],
                    },
                    note: { type: ["string", "null"] },
                    branch_slug: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Debt status updated" },
            "400": { description: "Invalid status" },
            "403": { description: "Only owner or admin can update" },
          },
        },
      },
      "/api/projects/{slug}/sources/status": {
        patch: {
          tags: ["projects"],
          summary: "Update source trust status",
          description:
            "Owner-or-admin only. Stores a sidecar status for a cited source URL without mutating source or evidence artifacts.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "status"],
                  properties: {
                    url: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["trusted", "questionable", "ignored"],
                    },
                    note: { type: ["string", "null"] },
                    recheck_status: {
                      type: "string",
                      enum: ["none", "running", "replacement_found", "resolved"],
                    },
                    branch_slug: { type: ["string", "null"] },
                    source_claim_ids: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Source trust status updated" },
            "400": { description: "Invalid status or missing URL" },
            "403": { description: "Only owner or admin can update" },
          },
        },
      },
      "/api/projects/{slug}/sources/diff": {
        get: {
          tags: ["projects"],
          summary: "Compare source-linked claims against a recheck branch",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "url", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Claim-level source recheck diff",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      source_url: { type: "string" },
                      branch_slug: { type: ["string", "null"] },
                      branch_status: { type: "string" },
                      changes: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
            "400": { description: "Missing URL" },
            "404": { description: "Project not found" },
          },
        },
      },
      "/api/runs": {
        get: {
          summary: "List pipeline runs",
          description:
            "Combines live process state with persisted projects/<slug>/runs metadata. Sorted newest-first.",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      count: { type: "integer" },
                      active: { type: "integer" },
                      runs: {
                        type: "array",
                        items: { $ref: "#/components/schemas/Run" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/runs/start": {
        post: {
          summary: "Start a new research run",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["topic"],
                  properties: {
                    topic: { type: "string", minLength: 10 },
                    constraints: { type: "string" },
                    rerun: {
                      type: "boolean",
                      description: "When true, rerun the existing project slug instead of creating a new branch.",
                    },
                    rerun_from: {
                      type: "string",
                      enum: [
                        "scout",
                        "plan",
                        "harvest",
                        "evidence",
                        "verify",
                        "analyze",
                        "epistemic",
                        "contradictions",
                        "synth",
                        "playbook",
                      ],
                      description:
                        "First phase to recompute. Earlier artifacts are reused; downstream artifacts are regenerated.",
                    },
                    deep_settings: {
                      type: "object",
                      properties: {
                        depth: { type: "string", enum: ["balanced", "deep", "max"] },
                        target_sources: { type: "integer", minimum: 50, maximum: 500 },
                        min_questions: { type: "integer", minimum: 5, maximum: 20 },
                        parallelism: { type: "integer", minimum: 4, maximum: 64 },
                        provider: { type: "string", enum: ["qwen", "gemini"] },
                        preferred_source_types: {
                          type: "array",
                          items: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Run started",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      runId: { type: "string" },
                      slug: { type: "string" },
                      topic: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
      "/api/runs/stream": {
        get: {
          summary: "Server-Sent Events stream of a run's stdout/stderr",
          parameters: [
            { name: "id", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "SSE stream",
              content: { "text/event-stream": {} },
            },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["auth"],
          summary: "Sign in with email + password",
          description:
            "Returns the current user and sets an HMAC-signed `rl_session` cookie (HttpOnly, SameSite=Lax, 30-day max-age).",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Signed in",
              headers: {
                "Set-Cookie": { schema: { type: "string" }, description: "rl_session=…; HttpOnly; SameSite=Lax" },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { user: { $ref: "#/components/schemas/User" } },
                  },
                },
              },
            },
            "400": { description: "Missing email or password", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/signup": {
        post: {
          tags: ["auth"],
          summary: "Create an account",
          description:
            "Open when `ALLOW_SIGNUP=1`. When closed, only the first user (bootstrap admin) may sign up — all subsequent attempts return 403. Minimum password length is 8.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              headers: {
                "Set-Cookie": { schema: { type: "string" } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { user: { $ref: "#/components/schemas/User" } },
                  },
                },
              },
            },
            "400": { description: "Validation failure", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "403": { description: "Signup is closed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["auth"],
          summary: "Clear the session cookie",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": {
              description: "Cookie cleared",
              headers: {
                "Set-Cookie": { schema: { type: "string" }, description: "rl_session=; Max-Age=0" },
              },
              content: {
                "application/json": {
                  schema: { type: "object", properties: { ok: { type: "boolean" } } },
                },
              },
            },
          },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["auth"],
          summary: "Current user",
          description: "Returns `{ user: null }` when the session cookie is missing or invalid.",
          security: [{ SessionCookie: [] }, {}],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      user: {
                        oneOf: [{ $ref: "#/components/schemas/User" }, { type: "null" }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/auth/webhook": {
        get: {
          tags: ["auth"],
          summary: "Read your webhook config",
          description:
            "Returns `{url, has_secret}`. The raw secret is never returned — it's revealed ONCE when you POST to this endpoint. Webhooks fire `run.completed` or `run.failed` when a pipeline run you started finishes.",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      url: { type: ["string", "null"], format: "uri" },
                      has_secret: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "401": { description: "Not signed in" },
          },
        },
        post: {
          tags: ["auth"],
          summary: "Set webhook URL (and optionally rotate the secret)",
          description:
            "Sets the webhook target URL. On first save OR when `rotate_secret: true`, mints a fresh `whsec_<48hex>` secret and returns it in the response — **the raw value is shown exactly once**. The consumer verifies deliveries by computing `sha256=<hmac-sha256(body, secret)>` and comparing with the `X-Signature-256` request header.",
          security: [{ SessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    rotate_secret: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Saved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      url: { type: "string", format: "uri" },
                      has_secret: { type: "boolean" },
                      secret: {
                        type: "string",
                        description: "Present only when a new secret was minted.",
                      },
                      warning: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid URL" },
          },
        },
        delete: {
          tags: ["auth"],
          summary: "Disable webhook (clear URL + secret)",
          security: [{ SessionCookie: [] }],
          responses: {
            "200": {
              description: "Cleared",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { ok: { type: "boolean" } } },
                },
              },
            },
          },
        },
      },
      "/api/auth/password": {
        post: {
          tags: ["auth"],
          summary: "Change own password",
          security: [{ SessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["current", "next"],
                  properties: {
                    current: { type: "string" },
                    next: { type: "string", minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Password changed",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { ok: { type: "boolean" } } },
                },
              },
            },
            "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "401": { description: "Not signed in", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/admin/users": {
        get: {
          tags: ["admin"],
          summary: "List users (admin only)",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      users: {
                        type: "array",
                        items: { $ref: "#/components/schemas/User" },
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthenticated" },
            "403": { description: "Not an admin" },
          },
        },
        post: {
          tags: ["admin"],
          summary: "Invite a user (admin only)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string", minLength: 8 },
                    role: { type: "string", enum: ["admin", "user"], default: "user" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { user: { $ref: "#/components/schemas/User" } },
                  },
                },
              },
            },
            "400": { description: "Validation failure" },
          },
        },
      },
      "/api/admin/users/{id}": {
        delete: {
          tags: ["admin"],
          summary: "Delete a user (admin only)",
          description:
            "Guarded against self-delete and against removing the last admin. Returns 400 in both cases.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Deleted",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
            "400": { description: "Self-delete or last-admin guard", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/admin/keys": {
        get: {
          tags: ["admin"],
          summary: "List API keys (admin only)",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      keys: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ApiKey" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["admin"],
          summary: "Mint a new API key (admin only)",
          description:
            "The raw key is returned once in the response body and never again. Store it immediately; revoke and re-create if lost.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created — `key` field is shown ONCE",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      prefix: { type: "string" },
                      key: { type: "string", description: "Raw API key — save it now." },
                      warning: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/admin/keys/{id}": {
        delete: {
          tags: ["admin"],
          summary: "Revoke an API key (admin only)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Revoked",
              content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
            },
            "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },

      "/api/keys": {
        get: {
          tags: ["keys"],
          summary: "List YOUR API keys (any signed-in user)",
          description:
            "Session-gated. Returns only keys owned by the calling user. Admins see god-view at /api/admin/keys.",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      keys: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ApiKey" },
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Sign in required" },
          },
        },
        post: {
          tags: ["keys"],
          summary: "Mint a new API key scoped to you",
          description:
            "Consumers authed with the returned key inherit YOUR project visibility. Raw `key` field is returned once — save it immediately.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created — `key` field is shown ONCE",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      prefix: { type: "string" },
                      key: { type: "string" },
                      warning: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "Sign in required" },
          },
        },
      },
      "/api/keys/{id}": {
        delete: {
          tags: ["keys"],
          summary: "Revoke one of YOUR API keys",
          description:
            "You can only revoke keys you minted. Admins can also revoke via /api/admin/keys/{id}.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Revoked" },
            "401": { description: "Sign in required" },
            "403": { description: "You can only revoke keys you created" },
            "404": { description: "Not found" },
          },
        },
      },

      "/api/projects/{slug}/tweak": {
        get: {
          tags: ["projects"],
          summary: "List saved section variants",
          description:
            "Variants generated via the Tweak flow — alternative versions of a report section produced with a user hint.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      variants: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SectionVariant" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["projects"],
          summary: "Regenerate one section of a report with a user hint",
          description:
            "Section ∈ { introduction | summary | comparison | deployment | recommendation }. `hint` is a natural-language instruction like 'simplify', 'drop brand names'. Owner-or-admin only. Writes a new variant under projects/<slug>/variants/ — the canonical REPORT.md is not mutated.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["section", "hint"],
                  properties: {
                    section: {
                      type: "string",
                      enum: [
                        "introduction",
                        "summary",
                        "comparison",
                        "deployment",
                        "recommendation",
                      ],
                    },
                    hint: { type: "string", minLength: 4 },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      variant: { $ref: "#/components/schemas/SectionVariant" },
                    },
                  },
                },
              },
            },
            "401": { description: "Sign in required" },
            "403": { description: "Only owner or admin can tweak" },
            "400": { description: "Unknown section or hint too short" },
            "502": { description: "Generator failed or returned empty" },
          },
        },
      },

      "/api/projects/{slug}/extend": {
        post: {
          tags: ["projects"],
          summary: "Spawn a new research grounded in this one",
          description:
            "Copies the source project's harvested artifacts (plan/facts/sources/scout) into a new slug owned by the caller, then starts a pipeline run that regenerates plan → evidence → verify → analyze → synth against the extended topic. Typical runtime 8-15 min (saves the 20-30 min harvest cost of a fresh run).",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["angle"],
                  properties: {
                    angle: {
                      type: "string",
                      minLength: 8,
                      description:
                        "What to add / reframe / focus on. E.g. 'focus on pediatric safety', 'drop physics sources, reframe for skincare formulators'.",
                    },
                    name: {
                      type: "string",
                      description:
                        "Short branch name (optional) — becomes part of the new slug.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "New run started",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      slug: { type: "string" },
                      runId: { type: "string" },
                      source_slug: { type: "string" },
                    },
                  },
                },
              },
            },
            "401": { description: "Sign in required" },
            "404": { description: "Source project not found or not visible" },
            "400": { description: "Angle missing or too short" },
          },
        },
      },

      "/api/projects/{slug}/share": {
        get: {
          tags: ["projects"],
          summary: "List active share links for a project",
          description:
            "Owner-or-admin only. Returns the non-revoked share tokens with their creation timestamps.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK" },
            "403": { description: "Only owner or admin" },
          },
        },
        post: {
          tags: ["projects"],
          summary: "Mint a share link",
          description:
            "Creates (or reuses) a public read-only token for this project. URL shape: /shared/<token>. Reuses existing active token minted by the same user to avoid link-churn.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Token returned",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      token: {
                        type: "object",
                        properties: {
                          token: { type: "string" },
                          slug: { type: "string" },
                          created_at: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "403": { description: "Only owner or admin" },
          },
        },
        delete: {
          tags: ["projects"],
          summary: "Revoke a share link",
          description:
            "Owner-or-admin only. Pass `token` in the request body.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token"],
                  properties: { token: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Revoked" },
            "400": { description: "Token missing" },
            "403": { description: "Only owner or admin" },
          },
        },
      },

      "/api/chat/brief": {
        post: {
          tags: ["chat"],
          summary: "Scope-clarifying chat (pre-research + extend)",
          description:
            "Stateless turn-by-turn chat with an LLM. Client sends the full message history each turn. Assistant asks 1-3 clarifying questions, then emits a structured brief {topic_refined, domain_hints, constraints, question_preview} that the UI posts to /api/runs/start or /api/projects/{slug}/extend.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["messages"],
                  properties: {
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          role: {
                            type: "string",
                            enum: ["user", "assistant"],
                          },
                          content: { type: "string" },
                        },
                      },
                    },
                    mode: {
                      type: "string",
                      enum: ["new", "extend"],
                      default: "new",
                    },
                    source_topic: {
                      type: "string",
                      description:
                        "Required when mode=extend — the source research's topic.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      done: { type: "boolean" },
                      brief: {
                        type: "object",
                        nullable: true,
                        properties: {
                          topic_refined: { type: "string" },
                          domain_hints: {
                            type: "array",
                            items: { type: "string" },
                          },
                          constraints: {
                            type: "array",
                            items: { type: "string" },
                          },
                          question_preview: {
                            type: "array",
                            items: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "502": { description: "LLM call failed" },
          },
        },
      },
    },
  };
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json(buildOpenApiSpec(origin), {
    headers: { "Cache-Control": "no-cache" },
  });
}
