// GET /api/projects/:slug — full project artifact bundle.
//   ?include=plan,facts,analysis,verification,sources,report  (default: all)
//   ?raw=1                                                    (return raw JSON not wrapped response)

import { getProject } from "@/lib/projects";
import { requireAuth } from "@/lib/auth";

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
