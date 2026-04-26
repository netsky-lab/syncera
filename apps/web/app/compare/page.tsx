// Client-side source diff viewer. /compare?a=<slug>&b=<slug> fetches
// /api/projects/compare and renders three columns:
//   - Only in A
//   - In both (overlap)
//   - Only in B
// Each row shows URL + title + provider + fact citations — so user can
// see not just WHICH sources differ but which ones carried weight.

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Row = {
  url: string;
  title: string;
  provider?: string;
  providerA?: string;
  providerB?: string;
  facts?: string[];
  factsA?: string[];
  factsB?: string[];
};

type Diff = {
  a: { slug: string; topic: string; total: number };
  b: { slug: string; topic: string; total: number };
  onlyA: Row[];
  overlap: Row[];
  onlyB: Row[];
};

export default function ComparePage() {
  const sp = useSearchParams();
  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [urlFilter, setUrlFilter] = useState("");

  useEffect(() => {
    if (!a || !b) {
      setError("Pass ?a=<slug>&b=<slug>");
      setLoading(false);
      return;
    }
    fetch(`/api/projects/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) setError(d.error ?? "Failed to load");
        else setDiff(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e?.message ?? e));
        setLoading(false);
      });
  }, [a, b]);

  if (loading) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-10 text-fg-muted text-[13px]">
        Loading comparison…
      </div>
    );
  }
  if (error || !diff) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-10">
        <div className="text-accent-red text-[14px]">{error || "No data"}</div>
      </div>
    );
  }

  const matchesFilter = (r: Row) => {
    if (!urlFilter.trim()) return true;
    const q = urlFilter.toLowerCase();
    return (
      r.url.toLowerCase().includes(q) ||
      (r.title ?? "").toLowerCase().includes(q)
    );
  };

  return (
    <div className="max-w-[1320px] mx-auto px-4 md:px-10 py-6 md:py-10 space-y-6">
      <header>
        <div className="micro text-accent-primary mb-3">Source diff</div>
        <h1 className="rl-dash-title">
          Where these two reports{" "}
          <em>disagree on evidence.</em>
        </h1>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProjectCard label="A" p={diff.a} />
          <ProjectCard label="B" p={diff.b} />
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={urlFilter}
          onChange={(e) => setUrlFilter(e.target.value)}
          placeholder="Filter by URL or title…"
          className="h-8 px-3 text-[12.5px] rounded-md bg-ink-800 border border-ink-600 text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 w-full max-w-xs"
        />
        <span className="text-[11px] text-fg-muted font-mono">
          overlap {diff.overlap.filter(matchesFilter).length} · only-A{" "}
          {diff.onlyA.filter(matchesFilter).length} · only-B{" "}
          {diff.onlyB.filter(matchesFilter).length}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Column
          title={`Only in A · ${diff.onlyA.length}`}
          tone="accent-rust"
          rows={diff.onlyA.filter(matchesFilter)}
          side="a"
          slugA={diff.a.slug}
          slugB={diff.b.slug}
        />
        <Column
          title={`In both · ${diff.overlap.length}`}
          tone="accent-sage"
          rows={diff.overlap.filter(matchesFilter)}
          side="both"
          slugA={diff.a.slug}
          slugB={diff.b.slug}
        />
        <Column
          title={`Only in B · ${diff.onlyB.length}`}
          tone="accent-primary"
          rows={diff.onlyB.filter(matchesFilter)}
          side="b"
          slugA={diff.a.slug}
          slugB={diff.b.slug}
        />
      </div>
    </div>
  );
}

function ProjectCard({
  label,
  p,
}: {
  label: string;
  p: { slug: string; topic: string; total: number };
}) {
  return (
    <Link
      href={`/projects/${p.slug}`}
      className="block rounded-xl border border-ink-600 bg-ink-800 p-4 hover:bg-ink-700 transition"
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-accent-primary">
          Project {label}
        </div>
        <div className="font-mono text-[11px] text-fg-muted tnum">
          {p.total} sources
        </div>
      </div>
      <div className="text-[14px] text-fg line-clamp-2">{p.topic}</div>
    </Link>
  );
}

function Column({
  title,
  tone,
  rows,
  side,
  slugA,
  slugB,
}: {
  title: string;
  tone: string;
  rows: Row[];
  side: "a" | "b" | "both";
  slugA: string;
  slugB: string;
}) {
  const color: Record<string, string> = {
    "accent-rust": "text-accent-rust border-accent-rust/30",
    "accent-sage": "text-accent-sage border-accent-sage/30",
    "accent-primary": "text-accent-primary border-accent-primary/30",
  };
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 overflow-hidden">
      <div
        className={`px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] border-b ${color[tone] ?? ""} ${color[tone] ?? ""}`}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-[12px] text-fg-muted text-center">
          (empty)
        </div>
      ) : (
        <div className="divide-y divide-ink-600">
          {rows.map((r) => (
            <SourceRow key={r.url} r={r} side={side} slugA={slugA} slugB={slugB} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({
  r,
  side,
  slugA,
  slugB,
}: {
  r: Row;
  side: "a" | "b" | "both";
  slugA: string;
  slugB: string;
}) {
  const factsA = r.factsA ?? (side === "a" ? r.facts ?? [] : []);
  const factsB = r.factsB ?? (side === "b" ? r.facts ?? [] : []);
  const providerA = r.providerA ?? (side === "a" ? r.provider : "");
  const providerB = r.providerB ?? (side === "b" ? r.provider : "");
  return (
    <div className="px-4 py-3 hover:bg-ink-700/50 transition">
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-[13px] text-fg hover:text-accent-primary transition line-clamp-2"
      >
        {r.title || r.url}
      </a>
      <div className="font-mono text-[10.5px] text-fg-muted mt-1 truncate">
        {r.url.replace(/^https?:\/\//, "").slice(0, 80)}
      </div>
      {(factsA.length > 0 || factsB.length > 0) && (
        <div className="mt-2 space-y-1">
          {factsA.length > 0 && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-[10.5px] text-accent-rust shrink-0">
                A · {providerA || "—"}
              </span>
              <div className="flex gap-1 flex-wrap">
                {factsA.map((id) => (
                  <Link
                    key={id}
                    href={`/projects/${slugA}#${id}`}
                    className="inline-flex items-center px-1.5 h-[18px] text-[10.5px] font-mono rounded border border-accent-rust/30 text-accent-rust bg-accent-rust/5 hover:bg-accent-rust/15 hover:border-accent-rust/60 transition no-underline"
                  >
                    {id}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {factsB.length > 0 && (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-[10.5px] text-accent-primary shrink-0">
                B · {providerB || "—"}
              </span>
              <div className="flex gap-1 flex-wrap">
                {factsB.map((id) => (
                  <Link
                    key={id}
                    href={`/projects/${slugB}#${id}`}
                    className="inline-flex items-center px-1.5 h-[18px] text-[10.5px] font-mono rounded border border-accent-primary/30 text-accent-primary bg-accent-primary/5 hover:bg-accent-primary/15 hover:border-accent-primary/60 transition no-underline"
                  >
                    {id}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {factsA.length === 0 && factsB.length === 0 && (
        <div className="mt-2 text-[11px] font-mono text-fg-muted">
          harvested but not cited · {providerA || providerB}
        </div>
      )}
    </div>
  );
}
