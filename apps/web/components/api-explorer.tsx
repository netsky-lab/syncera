"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  params?: { name: string; required?: boolean; example: string; note: string }[];
  body?: string;
  try_able: boolean;
};

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/health",
    summary: "Liveness probe",
    description:
      "Bypasses auth. Returns { status, timestamp }. Use for uptime monitoring.",
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects",
    summary: "List all projects",
    description:
      "Returns summary metadata for every project on disk. Sort it client-side.",
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}",
    summary: "Full project bundle",
    description:
      "All artifacts for one project. Use `include` to slim the payload.",
    params: [
      {
        name: "include",
        required: false,
        example: "plan,facts,analysis,verification,sources,report",
        note: "Comma-separated subset. Default: all.",
      },
    ],
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}/facts",
    summary: "Facts with verification",
    description:
      "Each fact carries { id, question_id, subquestion_id, statement, factuality, confidence, references, verification }.",
    params: [
      {
        name: "verified",
        required: false,
        example: "1",
        note: "`1` filters to verifier-accepted facts only.",
      },
      {
        name: "question_id",
        required: false,
        example: "Q1",
        note: "Filter to one question.",
      },
    ],
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}/analysis",
    summary: "Analyzer / critic report",
    description:
      "For question-first: narrative per-question answers + cross-question tensions. For legacy: hypothesis assessments.",
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}/plan",
    summary: "Research plan",
    description:
      "Questions + subquestions (question-first) or hypotheses + tasks (legacy).",
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}/report",
    summary: "REPORT.md",
    description:
      "Default Content-Type is text/markdown. Pass `?format=json` to wrap as `{ slug, report_md }`.",
    params: [
      { name: "format", required: false, example: "json", note: "`md` (default) or `json`." },
    ],
    try_able: true,
  },
  {
    method: "GET",
    path: "/api/projects/{slug}/pdf",
    summary: "Rendered PDF",
    description:
      "Playwright renders /projects/{slug}/print into PDF. Binary response.",
    try_able: false,
  },
  {
    method: "POST",
    path: "/api/runs/start",
    summary: "Start a pipeline run",
    description:
      "Kicks off a new research run. Logs stream via /api/runs/stream?id=<runId>.",
    body: '{\n  "topic": "your research topic (≥10 chars)",\n  "constraints": "optional extra context"\n}',
    try_able: false,
  },
];

function Method({ m }: { m: "GET" | "POST" }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
        m === "GET"
          ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
          : "bg-violet-500/15 text-violet-300 border border-violet-500/30"
      }`}
    >
      {m}
    </span>
  );
}

export function ApiExplorer() {
  const [apiKey, setApiKey] = useState("");
  const [slug, setSlug] = useState("");
  const [projects, setProjects] = useState<{ slug: string; topic: string }[]>(
    []
  );
  const [responses, setResponses] = useState<
    Record<string, { status: number; body: string; ms: number }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Persist key in localStorage for convenience
  useEffect(() => {
    const saved = localStorage.getItem("rl_api_key");
    if (saved) setApiKey(saved);
  }, []);
  useEffect(() => {
    if (apiKey) localStorage.setItem("rl_api_key", apiKey);
  }, [apiKey]);

  // Fetch projects list once key is set, for slug dropdown
  useEffect(() => {
    if (!apiKey) return;
    fetch("/api/projects", {
      headers: { "X-API-Key": apiKey },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.projects) {
          setProjects(
            data.projects.map((p: any) => ({ slug: p.slug, topic: p.topic }))
          );
          if (!slug && data.projects[0]) setSlug(data.projects[0].slug);
        }
      })
      .catch(() => {});
  }, [apiKey]);

  async function tryEndpoint(ep: Endpoint) {
    const realPath = ep.path.replace("{slug}", slug || "SLUG_REQUIRED");
    setLoading((s) => ({ ...s, [ep.path]: true }));
    const start = Date.now();
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers["X-API-Key"] = apiKey;
      const res = await fetch(realPath, { headers });
      const ms = Date.now() - start;
      let body: string;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const j = await res.json().catch(() => null);
        body = JSON.stringify(j, null, 2);
      } else {
        body = await res.text();
      }
      setResponses((s) => ({ ...s, [ep.path]: { status: res.status, body, ms } }));
    } catch (e: any) {
      setResponses((s) => ({
        ...s,
        [ep.path]: { status: 0, body: String(e?.message ?? e), ms: 0 },
      }));
    } finally {
      setLoading((s) => ({ ...s, [ep.path]: false }));
    }
  }

  function curlFor(ep: Endpoint): string {
    const realPath = ep.path.replace("{slug}", slug || "SLUG");
    const key = apiKey || "YOUR_KEY";
    if (ep.method === "POST" && ep.body) {
      return `curl -X POST ${realPath} \\
  -H "X-API-Key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${ep.body.replace(/\n/g, "").replace(/\s+/g, " ")}'`;
    }
    return `curl -H "X-API-Key: ${key}" '${realPath}'`;
  }

  return (
    <div className="space-y-6">
      {/* Config bar */}
      <Card className="border-border/60">
        <CardContent className="py-4 px-5 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Configure your session
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <div className="text-xs text-muted-foreground">API key</div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="X-API-Key value"
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
              />
              <div className="text-[11px] text-muted-foreground">
                Stored locally in your browser only. Find or rotate via{" "}
                <code className="font-mono">deploy/.env</code>.
              </div>
            </label>
            <label className="space-y-1.5">
              <div className="text-xs text-muted-foreground">
                Project slug <span className="text-muted-foreground">(for :slug routes)</span>
              </div>
              <select
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono focus:outline-none focus:border-primary/50"
              >
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.slug.slice(0, 60)}
                  </option>
                ))}
              </select>
              {apiKey && projects.length === 0 && (
                <div className="text-[11px] text-red-400">
                  Key rejected or no projects yet — check it's valid.
                </div>
              )}
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Endpoint list */}
      <div className="space-y-3">
        {ENDPOINTS.map((ep) => {
          const resp = responses[ep.path];
          const curl = curlFor(ep);
          return (
            <Card key={ep.path} className="border-border/60">
              <CardContent className="py-4 px-5 space-y-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <Method m={ep.method} />
                  <code className="text-[13px] font-mono font-medium break-all flex-1 min-w-0">
                    {ep.path}
                  </code>
                  {ep.try_able && (
                    <button
                      onClick={() => tryEndpoint(ep)}
                      disabled={!apiKey || loading[ep.path]}
                      className="text-[11px] px-2.5 py-1 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {loading[ep.path] ? "…" : "Try"}
                    </button>
                  )}
                </div>
                <div className="text-[13px] font-medium">{ep.summary}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {ep.description}
                </div>
                {ep.params && ep.params.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Query params
                    </div>
                    {ep.params.map((p) => (
                      <div key={p.name} className="flex items-start gap-2 text-xs">
                        <code className="font-mono text-primary/90 shrink-0">
                          {p.name}
                        </code>
                        <Badge
                          variant="outline"
                          className="text-[9px] shrink-0"
                        >
                          {p.required ? "required" : "optional"}
                        </Badge>
                        <span className="text-muted-foreground flex-1">
                          {p.note}{" "}
                          <code className="font-mono text-foreground/80">
                            e.g. {p.example}
                          </code>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {ep.body && (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      Body
                    </div>
                    <pre className="text-[12px] font-mono p-2.5 rounded-md bg-muted/40 border border-border/40 overflow-x-auto">
                      {ep.body}
                    </pre>
                  </div>
                )}
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                      cURL
                    </div>
                    <button
                      onClick={() => navigator.clipboard?.writeText(curl)}
                      className="text-[11px] text-primary/80 hover:text-primary"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="text-[12px] font-mono p-2.5 rounded-md bg-muted/40 border border-border/40 overflow-x-auto">
                    {curl}
                  </pre>
                </div>
                {resp && (
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                          resp.status >= 200 && resp.status < 300
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-red-500/15 text-red-300 border border-red-500/30"
                        }`}
                      >
                        {resp.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {resp.ms}ms
                      </span>
                    </div>
                    <pre className="text-[11px] font-mono p-2.5 rounded-md bg-muted/40 border border-border/40 overflow-auto max-h-80">
                      {resp.body.slice(0, 4000)}
                      {resp.body.length > 4000 && "\n… truncated …"}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
