// GET /api/openapi.json — OpenAPI 3.1 spec for the research-lab API.
// Consumers can pipe this into `openapi-generator-cli` / `openapi-typescript` /
// `oapi-codegen` etc to autogenerate a typed client.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Research Lab API",
      version: "0.2.0",
      description:
        "Read-only access to research artifacts (plans, facts, analysis, reports) plus run orchestration. Question-first pipeline with verified fact citations.",
      license: { name: "MIT" },
    },
    servers: [{ url: origin, description: "Current deployment" }],
    security: [{ ApiKeyHeader: [] }, { BearerKey: [] }, { BasicAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API key as configured in API_KEYS env var.",
        },
        BearerKey: {
          type: "http",
          scheme: "bearer",
          description: "Same API key value as ApiKeyHeader, carried in Authorization header.",
        },
        BasicAuth: {
          type: "http",
          scheme: "basic",
          description: "Same credentials as the browser UI (BASIC_AUTH_USER/PASS).",
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
              },
            },
            has_report: { type: "boolean" },
            confidence: { type: "number", description: "0 for question-first; 0-1 for hypothesis-first" },
            generated_at: { type: "string" },
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
      "/api/runs": {
        get: {
          summary: "List in-memory pipeline runs",
          description:
            "Runs are held in-memory per server process; restarts wipe. Sorted newest-first.",
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
    },
  };

  return Response.json(spec, {
    headers: { "Cache-Control": "no-cache" },
  });
}
