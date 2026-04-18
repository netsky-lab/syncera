"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";

interface SourceItem {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  query: string;
  raw_content?: string;
}

interface TaskSources {
  // Legacy (hypothesis-first) fields
  task_id?: string;
  hypothesis_id?: string;
  // Question-first fields
  subquestion_id?: string;
  question_id?: string;
  results: SourceItem[];
  learnings?: string[];
}

// Normalize either legacy or question-first unit to a single id we can use
// for React keys, filtering, and display.
function unitId(t: TaskSources): string {
  return t.task_id ?? t.subquestion_id ?? "";
}
function parentId(t: TaskSources): string {
  return t.hypothesis_id ?? t.question_id ?? "";
}

export function SourcesList({
  slug,
  tasks,
}: {
  slug: string;
  tasks: TaskSources[];
}) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const allSources = useMemo(() => {
    const items: (SourceItem & { task_id: string })[] = [];
    for (const t of tasks) {
      const id = unitId(t);
      for (const r of t.results) {
        items.push({ ...r, task_id: id });
      }
    }
    return items;
  }, [tasks]);

  const providers = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of allSources) {
      const p = s.provider.split(":")[0] ?? "?";
      map.set(p, (map.get(p) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [allSources]);

  const filtered = useMemo(() => {
    return allSources.filter((s) => {
      if (providerFilter && !s.provider.startsWith(providerFilter)) return false;
      if (taskFilter && s.task_id !== taskFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          s.url.toLowerCase().includes(q) ||
          s.snippet.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allSources, providerFilter, taskFilter, query]);

  async function fetchContent(url: string) {
    if (content[url]) return;
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/sources/content?slug=${encodeURIComponent(slug)}&url=${encodeURIComponent(url)}`
      );
      if (resp.ok) {
        const data = await resp.json();
        setContent((prev) => ({ ...prev, [url]: data.content }));
      } else {
        setContent((prev) => ({ ...prev, [url]: "_content not available_" }));
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle(url: string) {
    if (openUrl === url) {
      setOpenUrl(null);
    } else {
      setOpenUrl(url);
      fetchContent(url);
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <Card>
        <CardContent className="py-3 px-4 space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sources by title, URL, or snippet…"
            className="w-full px-3 py-1.5 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-muted-foreground mr-1">Provider:</span>
            <button
              onClick={() => setProviderFilter(null)}
              className={
                "px-2 py-0.5 rounded border text-[10px] " +
                (!providerFilter
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "border-border hover:bg-muted")
              }
            >
              all ({allSources.length})
            </button>
            {providers.map(([p, count]) => (
              <button
                key={p}
                onClick={() => setProviderFilter(p === providerFilter ? null : p)}
                className={
                  "px-2 py-0.5 rounded border text-[10px] font-mono " +
                  (providerFilter === p
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "border-border hover:bg-muted")
                }
              >
                {p} ({count})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-muted-foreground mr-1">Task:</span>
            <button
              onClick={() => setTaskFilter(null)}
              className={
                "px-2 py-0.5 rounded border text-[10px] " +
                (!taskFilter
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "border-border hover:bg-muted")
              }
            >
              all
            </button>
            {tasks.map((t) => {
              const id = unitId(t);
              return (
                <button
                  key={id}
                  onClick={() => setTaskFilter(id === taskFilter ? null : id)}
                  className={
                    "px-2 py-0.5 rounded border text-[10px] font-mono " +
                    (taskFilter === id
                      ? "bg-primary/20 border-primary/40 text-primary"
                      : "border-border hover:bg-muted")
                  }
                >
                  {id} ({t.results.length})
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">
            showing {filtered.length} / {allSources.length}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div className="space-y-1.5">
        {filtered.map((s, i) => {
          const isOpen = openUrl === s.url;
          const providerShort = s.provider.split(":")[0];
          return (
            <Card key={`${s.url}-${i}`} className="py-0">
              <CardContent className="py-3 px-4">
                <button
                  onClick={() => toggle(s.url)}
                  className="w-full text-left space-y-1"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-snug group-hover:text-primary line-clamp-2">
                        {s.title || s.url}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                        {s.url}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0 items-start">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {providerShort}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {s.task_id}
                      </Badge>
                    </div>
                  </div>
                  {s.snippet && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2 pt-1">
                      {s.snippet.slice(0, 250)}
                    </div>
                  )}
                </button>
                {isOpen && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">query:</span>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                        {s.query}
                      </code>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-primary hover:underline"
                      >
                        open in new tab ↗
                      </a>
                    </div>
                    {content[s.url] ? (
                      <div className="max-h-96 overflow-y-auto bg-muted/40 rounded-md p-3 border">
                        <Markdown content={content[s.url].slice(0, 20000)} />
                      </div>
                    ) : loading ? (
                      <div className="text-[11px] text-muted-foreground italic">Loading content…</div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground italic">
                        No scraped content cached.
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No sources match the filters.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
