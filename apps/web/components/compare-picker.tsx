"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Cross-project source comparison entry point. Button in the project
// header opens a picker listing the user's OTHER projects. Selecting one
// navigates to /compare?a=<current>&b=<picked>.
export function ComparePicker({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<
    { slug: string; topic: string }[] | null
  >(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || projects !== null) return;
    // Fetch /api/auth/me first so we know the caller's uid, then filter
    // /api/projects to projects this user actually owns (not showcase,
    // not admin god-view of others'). Casual users were confused when
    // the picker offered projects they hadn't launched themselves.
    Promise.all([
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, list]) => {
        const uid = me?.user?.id ?? null;
        const rows = (list?.projects ?? [])
          .filter((p: any) => p.slug !== slug)
          .filter((p: any) => uid && p.owner_uid === uid)
          .map((p: any) => ({ slug: p.slug, topic: p.topic ?? p.slug }));
        setProjects(rows);
      })
      .catch(() => setProjects([]));
  }, [open, projects, slug]);

  const filtered = (projects ?? []).filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      p.topic.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-9 px-3 rounded-md bg-ink-800 border border-fg/[0.06] hover:bg-ink-700 text-[12px] font-medium inline-flex items-center gap-1.5 transition"
        title="Compare harvested sources with another project"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="18" />
          <rect x="14" y="3" width="7" height="18" />
        </svg>
        Compare
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-lg rounded-xl border border-accent-primary/30 bg-ink-800 p-5 space-y-3 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-primary mb-1">
                  Compare sources
                </div>
                <div className="text-[12.5px] text-fg-muted">
                  Pick another project to diff harvested URLs. See overlap
                  vs divergence side-by-side.
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-fg-muted hover:text-fg text-xl leading-none"
              >
                ×
              </button>
            </div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter projects…"
              className="w-full h-9 px-3 text-[13px] rounded-md bg-ink-900 border border-ink-500 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60"
            />
            <div className="flex-1 overflow-y-auto -mx-2">
              {projects === null ? (
                <div className="text-[12px] text-fg-muted px-2 py-3">
                  loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-[12px] text-fg-muted px-2 py-3">
                  {projects.length === 0
                    ? "You need at least one other project to compare."
                    : "No matches."}
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((p) => (
                    <button
                      key={p.slug}
                      onClick={() => {
                        router.push(
                          `/compare?a=${encodeURIComponent(slug)}&b=${encodeURIComponent(p.slug)}`
                        );
                      }}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-ink-700 transition"
                    >
                      <div className="text-[13px] text-fg line-clamp-1">
                        {p.topic.split("\n")[0]?.slice(0, 90)}
                      </div>
                      <div className="font-mono text-[10.5px] text-fg-muted mt-0.5 truncate">
                        {p.slug}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
