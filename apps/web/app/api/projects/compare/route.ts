// GET /api/projects/compare?a=<slug>&b=<slug> — diff the source URLs
// two projects harvested, so users can see overlap / divergence at a
// glance ("why did these two reports on the same topic disagree?").
//
// Returns:
//   { a: { slug, topic }, b: { slug, topic },
//     onlyA: [{url, title, provider}],
//     overlap: [{url, title, providerA, providerB}],
//     onlyB: [{url, title, provider}],
//     factsCitingA: { url → [factId] }, factsCitingB: ... }
//
// Visibility gate: caller must be able to view BOTH projects.

import { canView, getProject } from "@/lib/projects";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function projectsDir(): string {
  return process.env.PROJECTS_DIR ?? "/app/projects";
}

type SourceSummary = {
  url: string;
  title: string;
  provider: string;
};

// Collect all unique source URLs across all subquestion indices in a
// project. Each URL is reported once with its title + provider. Also
// returns a map url → fact IDs citing it (from facts.json references).
function collectSources(slug: string): {
  sources: Map<string, SourceSummary>;
  factsByUrl: Map<string, string[]>;
  topic: string;
} {
  const dir = join(projectsDir(), slug);
  const plan = readJson(join(dir, "plan.json")) ?? {};
  const sourcesDir = join(dir, "sources");
  const sources = new Map<string, SourceSummary>();
  if (existsSync(sourcesDir)) {
    for (const f of readdirSync(sourcesDir)) {
      if (!/^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)) continue;
      try {
        const data = JSON.parse(readFileSync(join(sourcesDir, f), "utf-8"));
        for (const r of data.results ?? []) {
          if (!r?.url || sources.has(r.url)) continue;
          sources.set(r.url, {
            url: r.url,
            title: String(r.title ?? "").slice(0, 200),
            provider: String(r.provider ?? "unknown"),
          });
        }
      } catch {}
    }
  }

  const factsByUrl = new Map<string, string[]>();
  const facts = readJson(join(dir, "facts.json")) ?? [];
  if (Array.isArray(facts)) {
    for (const f of facts) {
      for (const r of f.references ?? []) {
        if (!r?.url) continue;
        const arr = factsByUrl.get(r.url) ?? [];
        arr.push(String(f.id));
        factsByUrl.set(r.url, arr);
      }
    }
  }

  return {
    sources,
    factsByUrl,
    topic: String(plan.topic ?? slug),
  };
}

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const jar = await cookies();
  const uid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  const url = new URL(request.url);
  const a = url.searchParams.get("a") ?? "";
  const b = url.searchParams.get("b") ?? "";
  if (!a || !b) {
    return Response.json(
      { error: "a and b query params required (project slugs)" },
      { status: 400 }
    );
  }
  if (a === b) {
    return Response.json(
      { error: "Pick two different projects to compare" },
      { status: 400 }
    );
  }
  if (!canView(a, uid) || !canView(b, uid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const A = collectSources(a);
  const B = collectSources(b);

  const onlyA: any[] = [];
  const onlyB: any[] = [];
  const overlap: any[] = [];

  for (const [url, src] of A.sources) {
    if (B.sources.has(url)) {
      const bs = B.sources.get(url)!;
      overlap.push({
        url,
        title: src.title || bs.title,
        providerA: src.provider,
        providerB: bs.provider,
        factsA: A.factsByUrl.get(url) ?? [],
        factsB: B.factsByUrl.get(url) ?? [],
      });
    } else {
      onlyA.push({
        ...src,
        facts: A.factsByUrl.get(url) ?? [],
      });
    }
  }
  for (const [url, src] of B.sources) {
    if (A.sources.has(url)) continue;
    onlyB.push({
      ...src,
      facts: B.factsByUrl.get(url) ?? [],
    });
  }

  // Sort: items with more facts citing them first — those are the
  // load-bearing sources whose inclusion/exclusion explains divergence.
  const byFactCount = (l: any, r: any) =>
    (r.facts?.length ?? r.factsA?.length ?? 0) -
    (l.facts?.length ?? l.factsA?.length ?? 0);
  onlyA.sort(byFactCount);
  onlyB.sort(byFactCount);
  overlap.sort(byFactCount);

  return Response.json({
    a: { slug: a, topic: A.topic, total: A.sources.size },
    b: { slug: b, topic: B.topic, total: B.sources.size },
    onlyA,
    overlap,
    onlyB,
  });
}
