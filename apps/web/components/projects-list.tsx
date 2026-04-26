"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Project = {
  slug: string;
  topic: string;
  schema: "question_first" | "hypothesis_first" | "empty";
  hypotheses: number;
  questions: number;
  facts: number;
  claims: number;
  sources: number;
  learnings: number;
  confidence: number;
  hasReport: boolean;
  generatedAt: string;
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7
      ? "bg-emerald-500"
      : value >= 0.4
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-2 w-24">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
        {pct}%
      </span>
    </div>
  );
}

function SchemaBadge({ schema }: { schema: Project["schema"] }) {
  if (schema === "question_first") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] bg-sky-500/10 text-sky-300 border-sky-500/30"
      >
        question-first
      </Badge>
    );
  }
  if (schema === "hypothesis_first") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] bg-violet-500/10 text-violet-300 border-violet-500/30"
      >
        hypothesis-first
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      empty
    </Badge>
  );
}

export function ProjectsList({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.topic.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    );
  }, [query, projects]);

  if (projects.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 sm:py-16 text-center space-y-3">
          <div className="text-sm font-medium">Nothing here yet</div>
          <div className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Drop a research topic into the form above to kick off a run —
            typically 30–60 min end-to-end. Full report lands here when it
            finishes.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-4.35-4.35M11 19a8 8 0 110-16 8 8 0 010 16z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects by topic…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
        />
        {query && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums">
            {filtered.length} / {projects.length}
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map((p) => {
          const isQf = p.schema === "question_first";
          const topicCount = isQf ? p.questions : p.hypotheses;
          const findingCount = isQf ? p.facts : p.claims;
          return (
            <Link key={p.slug} href={`/projects/${p.slug}`}>
              <Card className="group border-border/60 hover:border-primary/60 hover:shadow-lg md:hover:-translate-y-[1px] transition-all cursor-pointer py-0 bg-card/50">
                <CardContent className="py-4 px-4 sm:px-5">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start gap-2">
                        <h2 className="flex-1 text-[13px] sm:text-sm font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-3 sm:line-clamp-2">
                          {p.topic}
                        </h2>
                        <SchemaBadge schema={p.schema} />
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono tabular-nums text-foreground/80">
                            {topicCount}
                          </span>{" "}
                          {isQf ? "questions" : "hypotheses"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono tabular-nums text-foreground/80">
                            {findingCount}
                          </span>{" "}
                          {isQf ? "facts" : "claims"}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono tabular-nums text-foreground/80">
                            {p.sources}
                          </span>{" "}
                          sources
                        </span>
                        {p.learnings > 0 && (
                          <span className="hidden sm:flex items-center gap-1.5">
                            <span className="font-mono tabular-nums text-foreground/80">
                              {p.learnings}
                            </span>{" "}
                            learnings
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0 sm:pt-0.5 self-start">
                      {!isQf && p.confidence > 0 && (
                        <ConfidenceBar value={p.confidence} />
                      )}
                      {p.hasReport ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20 text-[10px] gap-1">
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Report
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          pending
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {filtered.length === 0 && query && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No projects match "<span className="font-mono">{query}</span>"
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
