// GET /api/projects/:slug — full project artifact bundle.
//   ?include=plan,facts,analysis,verification,sources,report  (default: all)
//   ?raw=1                                                    (return raw JSON not wrapped response)

import { getProject } from "@/lib/projects";
import { requireAuth, requireBasicAuth } from "@/lib/auth";
import { rmSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const include = (url.searchParams.get("include") ?? "plan,facts,analysis,verification,sources,report")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body: Record<string, any> = {
    slug: project.slug,
    schema: project.schema,
    topic: project.plan?.topic ?? slug,
  };

  if (include.includes("plan")) body.plan = project.plan;
  if (include.includes("facts")) body.facts = project.facts;
  if (include.includes("analysis")) body.analysis_report = project.analysisReport;
  if (include.includes("verification")) body.verification = project.verification;
  if (include.includes("sources")) {
    body.sources = {
      index: project.sources,
      units: project.units,
    };
  }
  if (include.includes("report")) body.report_md = project.report;
  if (include.includes("claims") && project.schema === "hypothesis_first") {
    body.claims = project.claims;
    body.critic_report = project.criticReport;
  }

  return Response.json(body);
}

// Admin-only: hard-delete a project directory.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;

  // Resolve projects dir same way lib/projects does
  const PROJECTS_DIR = (() => {
    if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
    const cwdProjects = join(process.cwd(), "projects");
    if (existsSync(cwdProjects)) return cwdProjects;
    return join(process.cwd(), "..", "..", "projects");
  })();

  const projectDir = join(PROJECTS_DIR, slug);
  if (!existsSync(join(projectDir, "plan.json"))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  try {
    rmSync(projectDir, { recursive: true, force: true });
    return Response.json({ ok: true, deleted: slug });
  } catch (err: any) {
    return Response.json(
      { error: `Delete failed: ${err.message}` },
      { status: 500 }
    );
  }
}
