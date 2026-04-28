"use client";

// Client-side filter + sort over the user's own research list. Server
// passes the full array; this trims to matches based on a free-text
// query against topic + slug and an optional status filter.

import Link from "next/link";
import { useMemo, useState } from "react";

type Project = {
  slug: string;
  topic: string;
  schema: string;
  questions: number;
  hypotheses: number;
  facts: number;
  claims: number;
  sources: number;
  source_quality?: number;
  accepted_sources?: number;
  rejected_sources?: number;
  hasReport: boolean;
  is_showcase: boolean;
  generatedAt?: string;
};

async function deleteProject(slug: string): Promise<string | null> {
  const r = await fetch(`/api/projects/${slug}`, { method: "DELETE" });
  if (r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return d.error ?? `HTTP ${r.status}`;
}

function splitTopic(topic: string): { title: string; subhead: string | null } {
  const t = topic.trim();
  const qIdx = t.indexOf("?");
  if (qIdx > 0 && qIdx < t.length - 1) {
    return {
      title: t.slice(0, qIdx + 1),
      subhead: t.slice(qIdx + 1).trim() || null,
    };
  }
  if (t.length > 90) {
    const dot = t.search(/[.:]\s/);
    if (dot > 20 && dot < 80) {
      return {
        title: t.slice(0, dot + 1),
        subhead: t.slice(dot + 1).trim(),
      };
    }
    return {
      title: t.slice(0, 70).trimEnd() + "…",
      subhead: t.slice(70).trim().slice(0, 120),
    };
  }
  return { title: t, subhead: null };
}

function statusOf(p: Project): "verified" | "running" | "pending" {
  return p.hasReport ? "verified" : ((p as any).status === "running" ? "running" : "pending");
}

function agoLabel(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Filter = "all" | "verified" | "running" | "pending";

export function ResearchTable({ projects }: { projects: Project[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [localProjects, setLocalProjects] = useState(projects);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // projects prop changes only on server re-render (page navigation);
  // inline delete mutates localProjects so the row vanishes instantly.

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return localProjects.filter((p) => {
      if (filter !== "all" && statusOf(p) !== filter) return false;
      if (!needle) return true;
      return (
        p.topic.toLowerCase().includes(needle) ||
        p.slug.toLowerCase().includes(needle)
      );
    });
  }, [localProjects, q, filter]);

  const counts = useMemo(() => {
    const r: Record<Filter, number> = {
      all: localProjects.length,
      verified: 0,
      running: 0,
      pending: 0,
    };
    for (const p of localProjects) r[statusOf(p)]++;
    return r;
  }, [localProjects]);

  async function handleDelete(slug: string) {
    const err = await deleteProject(slug);
    if (err) {
      alert(`Delete failed: ${err}`);
      setPendingDelete(null);
      return;
    }
    setLocalProjects((prev) => prev.filter((p) => p.slug !== slug));
    setPendingDelete(null);
  }

  if (localProjects.length === 0) {
    return (
      <div className="bg-ink-800 border border-ink-600 rounded-xl px-6 py-10 text-center space-y-2">
        <div className="text-[14px] text-fg">Nothing here yet</div>
        <div className="text-[12px] text-fg-muted max-w-sm mx-auto leading-relaxed">
          Drop a research topic into the form above to kick off a run.
          Full report lands here when the pipeline finishes.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search topic or slug…"
          className="h-8 px-3 text-[12.5px] rounded-md bg-ink-800 border border-ink-600 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 w-full max-w-xs"
        />
        <div className="flex gap-0.5 ml-auto">
          {(["all", "verified", "running", "pending"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] font-mono px-2 py-1 rounded transition ${
                filter === f
                  ? "bg-ink-700 text-fg"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {f} <span className="text-fg-faint">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-[12.5px] text-fg-muted text-center py-10 border border-ink-600 rounded-xl bg-ink-800">
          No projects match that filter.
        </div>
      ) : (
        <div className="rl-research-table">
          <div className="rl-research-row header">
            <div className="col-head">Investigation</div>
            <div className="col-head r-hide-mobile">Sources</div>
            <div className="col-head r-hide-mobile">Facts</div>
            <div className="col-head r-hide-mobile">Updated</div>
            <div className="col-head">Status</div>
            <div />
          </div>
          {filtered.map((p) => (
            <Row
              key={p.slug}
              project={p}
              onDelete={() => setPendingDelete(p.slug)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Row({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const q = project.questions || project.hypotheses;
  const f = project.facts || project.claims;
  const status = statusOf(project);
  const { title, subhead } = splitTopic(project.topic);
  return (
    <div className="relative group">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (
            confirm(
              `Delete "${title.slice(0, 60)}${title.length > 60 ? "…" : ""}"? This cannot be undone.`
            )
          ) {
            onDelete();
          }
        }}
        className="absolute top-1/2 -translate-y-1/2 right-1 z-10 w-6 h-6 rounded-full bg-ink-900 border border-ink-600 text-fg-muted hover:text-accent-red hover:border-accent-red/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[11px]"
        title="Delete project"
      >
        ×
      </button>
      <Link href={`/projects/${project.slug}`} className="rl-research-row">
      <div className="rl-r-title">
        <div className="rl-r-icon">
          {status === "verified" ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          ) : status === "running" ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
        </div>
        <div className="rl-r-title-text">
          <div className="q">{title}</div>
          {subhead && <div className="sub">{subhead}</div>}
        </div>
      </div>
      <div className="rl-r-stats r-hide-mobile">
        <span className="s">
          <strong>{project.sources}</strong>
        </span>
        {typeof project.source_quality === "number" && project.source_quality > 0 && (
          <span className="mt-1 block font-mono text-[10px] text-fg-muted">
            q{project.source_quality}% · {project.accepted_sources ?? 0} accepted
          </span>
        )}
      </div>
      <div className="r-hide-mobile">
        <div className="rl-r-claims tnum">
          {f} <span className="of">facts</span>
        </div>
        {f > 0 && (
          <div className="rl-r-verify-bar">
            <span
              style={{
                width: "100%",
                background:
                  status === "running" ? "var(--accent-amber)" : undefined,
              }}
            />
          </div>
        )}
      </div>
      <div className="rl-r-date r-hide-mobile">{agoLabel(project.generatedAt)}</div>
      <div>
        <span
          className={
            status === "running"
              ? "rl-r-status running"
              : status === "pending"
                ? "rl-r-status pending"
                : "rl-r-status"
          }
        >
          <span className="dot" />
          {status}
        </span>
      </div>
      <div className="rl-r-arrow">→</div>
      </Link>
    </div>
  );
}
