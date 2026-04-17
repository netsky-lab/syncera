import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const PROJECTS_DIR = join(process.cwd(), "..", "..", "projects");

export interface ProjectSummary {
  slug: string;
  topic: string;
  hypotheses: number;
  claims: number;
  sources: number;
  learnings: number;
  confidence: number;
  hasReport: boolean;
  generatedAt: string;
}

export interface ProjectDetail {
  slug: string;
  plan: any;
  claims: any[];
  criticReport: any | null;
  report: string | null;
  sources: any | null;
  tasks: any[];
  verification: any | null;
}

export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  return dirs
    .map((slug) => {
      const dir = join(PROJECTS_DIR, slug);
      const planPath = join(dir, "plan.json");
      if (!existsSync(planPath)) return null;

      const plan = JSON.parse(readFileSync(planPath, "utf-8"));
      const claimsPath = join(dir, "claims.json");
      const claims = existsSync(claimsPath)
        ? JSON.parse(readFileSync(claimsPath, "utf-8"))
        : [];
      const criticPath = join(dir, "critic_report.json");
      const critic = existsSync(criticPath)
        ? JSON.parse(readFileSync(criticPath, "utf-8"))
        : null;

      const sourcesIdxPath = join(dir, "sources", "index.json");
      const sourcesIdx = existsSync(sourcesIdxPath)
        ? JSON.parse(readFileSync(sourcesIdxPath, "utf-8"))
        : null;

      return {
        slug,
        topic: plan.topic ?? slug,
        hypotheses: plan.hypotheses?.length ?? 0,
        claims: claims.length,
        sources: sourcesIdx?.total_sources ?? 0,
        learnings: sourcesIdx?.total_learnings ?? 0,
        confidence: critic?.overall_confidence ?? 0,
        hasReport: existsSync(join(dir, "REPORT.md")),
        generatedAt: plan.generated_at ?? "",
      } satisfies ProjectSummary;
    })
    .filter(Boolean) as ProjectSummary[];
}

export function getProject(slug: string): ProjectDetail | null {
  const dir = join(PROJECTS_DIR, slug);
  const planPath = join(dir, "plan.json");
  if (!existsSync(planPath)) return null;

  const plan = JSON.parse(readFileSync(planPath, "utf-8"));
  const claimsPath = join(dir, "claims.json");
  const claims = existsSync(claimsPath)
    ? JSON.parse(readFileSync(claimsPath, "utf-8"))
    : [];
  const criticPath = join(dir, "critic_report.json");
  const criticReport = existsSync(criticPath)
    ? JSON.parse(readFileSync(criticPath, "utf-8"))
    : null;
  const reportPath = join(dir, "REPORT.md");
  const report = existsSync(reportPath)
    ? readFileSync(reportPath, "utf-8")
    : null;
  const sourcesIndexPath = join(dir, "sources", "index.json");
  const sources = existsSync(sourcesIndexPath)
    ? JSON.parse(readFileSync(sourcesIndexPath, "utf-8"))
    : null;

  // Load per-task source files
  const sourcesDir = join(dir, "sources");
  const tasks: any[] = [];
  if (existsSync(sourcesDir)) {
    const files = readdirSync(sourcesDir).filter(
      (f) => f.startsWith("T") && f.endsWith(".json")
    );
    files.sort();
    for (const f of files) {
      try {
        const t = JSON.parse(readFileSync(join(sourcesDir, f), "utf-8"));
        // Strip raw_content from sources list to keep payload small; load on demand
        const thin = {
          ...t,
          results: (t.results ?? []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            provider: r.provider,
            query: r.query,
          })),
        };
        tasks.push(thin);
      } catch {}
    }
  }

  const verificationPath = join(dir, "verification.json");
  const verification = existsSync(verificationPath)
    ? JSON.parse(readFileSync(verificationPath, "utf-8"))
    : null;

  return { slug, plan, claims, criticReport, report, sources, tasks, verification };
}
