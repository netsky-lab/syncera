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
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  // For question-first: returns analysisReport. For legacy: returns criticReport.
  if (project.schema === "question_first") {
    if (!project.analysisReport) {
      return Response.json({ error: "Analysis not yet generated" }, { status: 202 });
    }
    return Response.json({
      slug,
      schema: "question_first",
      analysis: project.analysisReport,
    });
  }

  if (!project.criticReport) {
    return Response.json({ error: "Critic report not yet generated" }, { status: 202 });
  }
  return Response.json({
    slug,
    schema: "hypothesis_first",
    critic: project.criticReport,
  });
}
