import { readFileSync, readdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { findUserById, listUsers } from "@/lib/users";
import { readDebtStatus } from "@/lib/debt";
import { readSourceStatus } from "@/lib/source-status";

// Resolve projects directory per-call so env changes and test setup take
// effect without a module reload.
//   1. PROJECTS_DIR env var wins (explicit override).
//   2. If cwd/projects exists, use that (production standalone container).
//   3. Otherwise walk up to monorepo root (dev mode where cwd=apps/web).
function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwd = process.cwd();
  const cwdProjects = join(cwd, "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(cwd, "..", "..", "projects");
}

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
  owner_uid: string | null;
  is_showcase: boolean; // owner is an admin → visible to everyone
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
  playbook: any | null;
  playbookMarkdown: string | null;
  sources: any | null;
  units: any[]; // per-task (old) or per-subquestion (new) source index files
  verification: any | null;
  usageSummary: any | null;
  epistemicGraph: any | null;
  debtStatus: Record<string, any>;
  sourceStatus: Record<string, any>;
  owner_uid: string | null;
  is_showcase: boolean;
  forkMeta: {
    source_slug: string;
    source_topic: string;
    forked_at: number;
    suffix: string | null;
    source_debt_id?: string | null;
    source_claim_ids?: string[];
    source_url?: string | null;
    resolution_axis?: string | null;
  } | null;
}

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function sourceUnitsFromDir(dir: string): any[] {
  const sourcesDir = join(dir, "sources");
  if (!existsSync(sourcesDir)) return [];
  const units: any[] = [];
  for (const f of readdirSync(sourcesDir).filter((name) =>
    /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(name)
  )) {
    const unit = readJson(join(sourcesDir, f));
    if (unit) units.push(unit);
  }
  return units;
}

function sourceSummaryFromUnits(units: any[]): {
  total_sources: number;
  total_learnings: number;
  by_provider: Record<string, number>;
} {
  const byProvider: Record<string, number> = {};
  let totalSources = 0;
  let totalLearnings = 0;
  for (const unit of units) {
    const results = Array.isArray(unit.results) ? unit.results : [];
    totalSources += results.length;
    totalLearnings += Array.isArray(unit.learnings) ? unit.learnings.length : 0;
    for (const row of results) {
      const provider = String(row.provider ?? "unknown");
      byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    }
  }
  return {
    total_sources: totalSources,
    total_learnings: totalLearnings,
    by_provider: byProvider,
  };
}

function readSourceSummary(dir: string): any {
  const units = sourceUnitsFromDir(dir);
  const computed = sourceSummaryFromUnits(units);
  return (
    readJson(join(dir, "sources", "index.json")) ??
    readJson(join(dir, "sources.json")) ??
    computed
  );
}

// ─── Ownership ────────────────────────────────────────────────────────────

function ownerPath(slug: string): string {
  return join(projectsDir(), slug, ".owner");
}

export function getOwner(slug: string): string | null {
  const p = ownerPath(slug);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function setOwner(slug: string, uid: string): void {
  writeFileSync(ownerPath(slug), uid, { mode: 0o600 });
}

// Visibility rule, in order:
//   1. Viewer owns the project
//   2. Viewer has role=admin (admins see everything)
//   3. Project's owner has role=admin → treated as showcase for everyone
function isShowcase(ownerUid: string | null): boolean {
  if (!ownerUid) return false;
  const owner = findUserById(ownerUid);
  return owner?.role === "admin";
}

function isAdmin(viewerUid: string | null): boolean {
  if (!viewerUid) return false;
  return findUserById(viewerUid)?.role === "admin";
}

export function canView(slug: string, viewerUid: string | null): boolean {
  const owner = getOwner(slug);
  if (owner && viewerUid && owner === viewerUid) return true;
  if (isAdmin(viewerUid)) return true;
  return isShowcase(owner);
}

// NOTE: auto-migration of unowned projects was removed 2026-04-20. It
// blanket-assigned every orphan to the first admin → admin-role →
// is_showcase=true → visible to every signed-in user. When the runner
// ownership race caused new user runs to land as root-owned (no .owner
// written), those private projects silently became public. Privacy leak.
// Unowned projects now stay invisible (except to admin god-viewer) until
// operator manually assigns. Legacy qwen3 project was backfilled by hand.

// ─── Queries ──────────────────────────────────────────────────────────────

export function listProjects(viewerUid: string | null = null): ProjectSummary[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];

  const viewerIsAdmin = isAdmin(viewerUid);

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  return dirs
    .map((slug) => {
      const dir = join(root, slug);
      const plan = readJson(join(dir, "plan.json"));
      if (!plan) return null;

      const owner_uid = getOwner(slug);
      const is_showcase = isShowcase(owner_uid);
      // Visibility: own, admin viewer, or showcase.
      const canSee =
        is_showcase ||
        viewerIsAdmin ||
        (viewerUid && owner_uid === viewerUid);
      if (!canSee) return null;

      const schema = detectSchema(plan);
      const claims = readJson(join(dir, "claims.json")) ?? [];
      const facts = readJson(join(dir, "facts.json")) ?? [];
      const critic = readJson(join(dir, "critic_report.json"));
      const sourcesIdx = readSourceSummary(dir);

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
        owner_uid,
        is_showcase,
      } satisfies ProjectSummary;
    })
    .filter(Boolean) as ProjectSummary[];
}

// List projects that are forks/extends of `slug` or siblings to `slug`
// under a common parent. Visibility-gated so private branches from other
// users don't leak. Used by the "Branches" rail card on the project
// detail page.
export function listBranches(
  slug: string,
  viewerUid: string | null = null
): {
  children: ProjectSummary[];
  parent: ProjectSummary | null;
  siblings: ProjectSummary[];
} {
  const root = projectsDir();
  if (!existsSync(root)) return { children: [], parent: null, siblings: [] };

  const viewerIsAdmin = isAdmin(viewerUid);
  const selfFork = readJson(join(root, slug, "fork.meta.json"));
  const parentSlug: string | null = selfFork?.source_slug ?? null;

  const canSee = (ownerUid: string | null) =>
    isShowcase(ownerUid) ||
    viewerIsAdmin ||
    (viewerUid && ownerUid === viewerUid);

  const summaries = new Map<string, ProjectSummary & { forkMeta: any }>();
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    if (d.name === slug) continue;
    const dir = join(root, d.name);
    const plan = readJson(join(dir, "plan.json"));
    if (!plan) continue;
    const owner_uid = getOwner(d.name);
    if (!canSee(owner_uid)) continue;
    const forkMeta = readJson(join(dir, "fork.meta.json"));
    const facts = readJson(join(dir, "facts.json")) ?? [];
    const sourcesIdx = readSourceSummary(dir);
    summaries.set(d.name, {
      slug: d.name,
      topic: plan.topic ?? d.name,
      schema: detectSchema(plan),
      hypotheses: plan.hypotheses?.length ?? 0,
      questions: plan.questions?.length ?? 0,
      claims: 0,
      facts: Array.isArray(facts) ? facts.length : 0,
      sources: sourcesIdx?.total_sources ?? 0,
      learnings: sourcesIdx?.total_learnings ?? 0,
      confidence: 0,
      hasReport: existsSync(join(dir, "REPORT.md")),
      generatedAt: plan.generated_at ?? "",
      owner_uid,
      is_showcase: isShowcase(owner_uid),
      forkMeta,
    } as any);
  }

  const children = [...summaries.values()].filter(
    (p) => p.forkMeta?.source_slug === slug
  );
  const siblings = parentSlug
    ? [...summaries.values()].filter(
        (p) => p.forkMeta?.source_slug === parentSlug
      )
    : [];
  const parent = parentSlug
    ? (() => {
        const dir = join(root, parentSlug);
        const plan = readJson(join(dir, "plan.json"));
        if (!plan) return null;
        const owner_uid = getOwner(parentSlug);
        if (!canSee(owner_uid)) return null;
        const facts = readJson(join(dir, "facts.json")) ?? [];
        const sourcesIdx = readSourceSummary(dir);
        return {
          slug: parentSlug,
          topic: plan.topic ?? parentSlug,
          schema: detectSchema(plan),
          hypotheses: plan.hypotheses?.length ?? 0,
          questions: plan.questions?.length ?? 0,
          claims: 0,
          facts: Array.isArray(facts) ? facts.length : 0,
          sources: sourcesIdx?.total_sources ?? 0,
          learnings: sourcesIdx?.total_learnings ?? 0,
          confidence: 0,
          hasReport: existsSync(join(dir, "REPORT.md")),
          generatedAt: plan.generated_at ?? "",
          owner_uid,
          is_showcase: isShowcase(owner_uid),
        } satisfies ProjectSummary;
      })()
    : null;

  return { children, parent, siblings };
}

export function getProject(
  slug: string,
  viewerUid: string | null = null
): ProjectDetail | null {
  const dir = join(projectsDir(), slug);
  const plan = readJson(join(dir, "plan.json"));
  if (!plan) return null;

  const owner_uid = getOwner(slug);
  const is_showcase = isShowcase(owner_uid);
  const canSee =
    is_showcase ||
    isAdmin(viewerUid) ||
    (viewerUid && owner_uid === viewerUid);
  if (!canSee) return null;

  const schema = detectSchema(plan);

  const claims = readJson(join(dir, "claims.json")) ?? [];
  const facts = readJson(join(dir, "facts.json")) ?? [];
  const criticReport = readJson(join(dir, "critic_report.json"));
  const analysisReport = readJson(join(dir, "analysis_report.json"));
  const reportPath = join(dir, "REPORT.md");
  const report = existsSync(reportPath) ? readFileSync(reportPath, "utf-8") : null;
  const playbook = readJson(join(dir, "playbook.json"));
  const playbookPath = join(dir, "PLAYBOOK.md");
  const playbookMarkdown = existsSync(playbookPath)
    ? readFileSync(playbookPath, "utf-8")
    : null;
  const units = sourceUnitsFromDir(dir);
  const sources = readSourceSummary(dir);
  const verification = readJson(join(dir, "verification.json"));
  const usageSummary = readJson(join(dir, "llm_usage_summary.json"));
  const epistemicGraph = readJson(join(dir, "epistemic_graph.json"));
  const debtStatus = readDebtStatus(slug);
  const sourceStatus = readSourceStatus(slug);

  // Per-unit source files: old schema uses T<n>.json, new schema uses Q<n>[.<m>].json
  const sourcesDir = join(dir, "sources");
  const thinUnits: any[] = [];
  if (existsSync(sourcesDir)) {
    const files = readdirSync(sourcesDir).filter(
      (f) => /^(T|S?Q)\d+([-.]S?\d+)?\.json$/i.test(f)
    );
    files.sort();
    for (const f of files) {
      try {
        const t = JSON.parse(readFileSync(join(sourcesDir, f), "utf-8"));
        const thin = {
          ...t,
          results: (t.results ?? []).map((r: any) => {
            const row: any = {
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              provider: r.provider,
              query: r.query,
            };
            if (r.relevance) row.relevance = r.relevance;
            return row;
          }),
        };
        thinUnits.push(thin);
      } catch {}
    }
  }

  const forkMeta = readJson(join(dir, "fork.meta.json"));

  return {
    slug,
    schema,
    plan,
    claims: Array.isArray(claims) ? claims : [],
    criticReport,
    facts: Array.isArray(facts) ? facts : [],
    analysisReport,
    report,
    playbook,
    playbookMarkdown,
    sources,
    units: thinUnits.length ? thinUnits : units,
    verification,
    usageSummary,
    epistemicGraph,
    debtStatus,
    sourceStatus,
    owner_uid,
    is_showcase,
    forkMeta: forkMeta
      ? {
          source_slug: String(forkMeta.source_slug ?? ""),
          source_topic: String(forkMeta.source_topic ?? ""),
          forked_at: Number(forkMeta.forked_at ?? 0),
          suffix: forkMeta.suffix ?? null,
          source_debt_id: forkMeta.source_debt_id ?? null,
          source_claim_ids: Array.isArray(forkMeta.source_claim_ids)
            ? forkMeta.source_claim_ids.map(String)
            : [],
          source_url: forkMeta.source_url ?? null,
          resolution_axis: forkMeta.resolution_axis ?? null,
        }
      : null,
  };
}
