// GET /api/projects/:slug — full project artifact bundle.
//   ?include=plan,facts,analysis,verification,sources,report  (default: all)
//   ?raw=1                                                    (return raw JSON not wrapped response)

import { getProject, getOwner } from "@/lib/projects";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { findUserById } from "@/lib/users";
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
  const viewerUid = viewerUidFromRequest(request);
  const project = getProject(slug, viewerUid);
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

// Owner-or-admin: hard-delete a project directory. Users can delete their
// own projects; admins can delete any. Non-owners get 403.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;

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

  const viewerUid = viewerUidFromRequest(request);
  const viewerIsAdmin = viewerUid
    ? findUserById(viewerUid)?.role === "admin"
    : false;
  const owner = getOwner(slug);
  const isOwner = owner != null && viewerUid != null && owner === viewerUid;
  if (!isOwner && !viewerIsAdmin) {
    return Response.json(
      { error: "Only the project owner or an admin can delete" },
      { status: 403 }
    );
  }

  try {
    rmSync(projectDir, { recursive: true, force: true });
    // Cascade: revoke any live share tokens pointing at this slug so the
    // /shared/<token> URLs 404 instead of leaving dangling capabilities.
    try {
      const { listShareTokens, revokeShareToken } = require("@/lib/share-tokens") as typeof import("@/lib/share-tokens");
      for (const t of listShareTokens(slug)) revokeShareToken(t.token);
    } catch {}
    return Response.json({ ok: true, deleted: slug });
  } catch (err: any) {
    return Response.json(
      { error: `Delete failed: ${err.message}` },
      { status: 500 }
    );
  }
}
