import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const PROJECTS_DIR = join(process.cwd(), "..", "..", "projects");

export type Schema = "question_first" | "hypothesis_first" | "empty";

function detectSchema(plan: any): Schema {
  if (plan?.questions && Array.isArray(plan.questions)) return "question_first";
  if (plan?.hypotheses && Array.isArray(plan.hypotheses)) return "hypothesis_first";
  return "empty";
}

export interface ProjectSummary {
  slug: string;
  topic: string;
  schema: Schema;
  hypotheses: number; // 0 for question-first
  questions: number; // 0 for hypothesis-first
  facts: number; // new schema
  claims: number; // legacy schema
  sources: number;
  learnings: number;
  confidence: number; // hypothesis-first only
  hasReport: boolean;
  generatedAt: string;
}

export interface ProjectDetail {
  slug: string;
  schema: Schema;
  plan: any;
  // hypothesis-first fields
  claims: any[];
  criticReport: any | null;
  // question-first fields
  facts: any[];
  analysisReport: any | null;
  // shared
  report: string | null;
  sources: any | null;
  units: any[]; // per-task (old) or per-subquestion (new) source index files
  verification: any | null;
}

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function listProjects(): ProjectSummary[] {
  if (!existsSync(PROJECTS_DIR)) return [];

  const dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  return dirs
    .map((slug) => {
      const dir = join(PROJECTS_DIR, slug);
      const plan = readJson(join(dir, "plan.json"));
      if (!plan) return null;

      const schema = detectSchema(plan);
      const claims = readJson(join(dir, "claims.json")) ?? [];
      const facts = readJson(join(dir, "facts.json")) ?? [];
      const critic = readJson(join(dir, "critic_report.json"));
      const sourcesIdx = readJson(join(dir, "sources", "index.json"));

      return {
        slug,
        topic: plan.topic ?? slug,
        schema,
        hypotheses: plan.hypotheses?.length ?? 0,
        questions: plan.questions?.length ?? 0,
        claims: Array.isArray(claims) ? claims.length : 0,
        facts: Array.isArray(facts) ? facts.length : 0,
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
  const plan = readJson(join(dir, "plan.json"));
  if (!plan) return null;

  const schema = detectSchema(plan);

  const claims = readJson(join(dir, "claims.json")) ?? [];
  const facts = readJson(join(dir, "facts.json")) ?? [];
  const criticReport = readJson(join(dir, "critic_report.json"));
  const analysisReport = readJson(join(dir, "analysis_report.json"));
  const reportPath = join(dir, "REPORT.md");
  const report = existsSync(reportPath) ? readFileSync(reportPath, "utf-8") : null;
  const sources = readJson(join(dir, "sources", "index.json"));
  const verification = readJson(join(dir, "verification.json"));

  // Per-unit source files: old schema uses T<n>.json, new schema uses Q<n>[.<m>].json
  const sourcesDir = join(dir, "sources");
  const units: any[] = [];
  if (existsSync(sourcesDir)) {
    const files = readdirSync(sourcesDir).filter(
      (f) => /^(T\d+|Q\d+([-.]S?\d+)?)\.json$/.test(f)
    );
    files.sort();
    for (const f of files) {
      try {
        const t = JSON.parse(readFileSync(join(sourcesDir, f), "utf-8"));
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
        units.push(thin);
      } catch {}
    }
  }

  return {
    slug,
    schema,
    plan,
    claims: Array.isArray(claims) ? claims : [],
    criticReport,
    facts: Array.isArray(facts) ? facts : [],
    analysisReport,
    report,
    sources,
    units,
    verification,
  };
}
