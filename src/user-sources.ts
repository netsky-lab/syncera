// User-curated source ingestion. When `USER_SOURCES_FILE` env is set,
// skip scout+harvest and seed the evidence pool from URLs the user
// pasted in the UI. Each URL goes through:
//   1. readUrl (Jina Reader) → clean markdown content
//   2. LLM learning-extraction (identical shape to harvester's SearchResult)
//   3. sources/content/<hash>.md on disk
//   4. For each plan subquestion, a sources/<subqId>.json entry duplicating
//      the user corpus. Relevance gate then filters per-subq based on
//      domain match — so a URL that's off-topic for Q2 but on-topic for
//      Q1 gets dropped from Q2 naturally.
//
// The user effectively overrides harvest with their own curated set.
// Scout is skipped entirely (no calibration needed — user picked the
// corpus). Planner still runs normally to generate the question tree.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { readUrls } from "./reader";
import type { ResearchPlan } from "./schemas/plan";
import type { SearchResult } from "./schemas/source";

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export async function ingestUserSources(opts: {
  urls: string[];
  plan: ResearchPlan;
  projectDir: string;
}): Promise<{ ingested: number; failed: number }> {
  const { urls, plan, projectDir } = opts;
  const sourcesDir = join(projectDir, "sources");
  const contentDir = join(sourcesDir, "content");
  if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
  if (!existsSync(contentDir)) mkdirSync(contentDir, { recursive: true });

  console.log(`[user-sources] Ingesting ${urls.length} user-provided URLs via Jina Reader...`);
  const results = await readUrls(urls, 4, 30_000);

  const entries: SearchResult[] = [];
  let failed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (!r.success || !r.content) {
      failed++;
      console.warn(`[user-sources] skip ${r.url}: ${r.error ?? "empty"}`);
      continue;
    }
    // Persist content for the verifier (L2 quote-substring check needs it).
    const contentPath = join(contentDir, `${hashUrl(r.url)}.md`);
    writeFileSync(contentPath, r.content);

    entries.push({
      title: r.title || r.url,
      url: r.url,
      snippet: r.content.slice(0, 300).replace(/\s+/g, " "),
      provider: "user",
      query: "user-provided",
    });
  }

  // Duplicate the corpus across every subquestion's source file.
  // Relevance phase will test each URL against the subq's specific
  // angle and prune off-topic hits naturally. Without this duplication
  // the evidence extractor (which iterates subqs) wouldn't see the
  // corpus at all.
  const questions = plan.questions ?? [];
  let unitCount = 0;
  for (const q of questions) {
    for (const sq of q.subquestions ?? []) {
      const unitFile = join(sourcesDir, `${sq.id}.json`);
      const unit = {
        question_id: q.id,
        subquestion_id: sq.id,
        queries: ["user-provided corpus"],
        results: entries.map((e) => ({ ...e })),
        collected_at: new Date().toISOString(),
      };
      writeFileSync(unitFile, JSON.stringify(unit, null, 2));
      unitCount++;
    }
  }

  // Also write the top-level sources/index.json so evidence + UI read
  // consistent totals.
  const index = {
    total_sources: entries.length,
    total_learnings: 0,
    by_provider: { user: entries.length },
    by_subquestion: questions.flatMap((q) =>
      (q.subquestions ?? []).map((sq) => ({
        question_id: q.id,
        subquestion_id: sq.id,
        sources: entries.length,
        learnings: 0,
      }))
    ),
    collected_at: new Date().toISOString(),
    mode: "user-curated",
  };
  writeFileSync(
    join(sourcesDir, "index.json"),
    JSON.stringify(index, null, 2)
  );

  console.log(
    `[user-sources] ingested ${entries.length}/${urls.length} URLs → ${unitCount} subquestion files`
  );
  return { ingested: entries.length, failed };
}

export function loadUserSourcesFromEnv(): string[] | null {
  const p = process.env.USER_SOURCES_FILE;
  if (!p || !existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const urls = Array.isArray(data?.urls) ? data.urls : data;
    if (!Array.isArray(urls)) return null;
    const clean = urls
      .map((u: any) => String(u).trim())
      .filter((u) => /^https?:\/\//.test(u));
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}
