import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project || !project.report) {
    return new Response("Report not available", { status: 404 });
  }
  const url = new URL(request.url);
  // ?format=md (default) returns text/markdown; ?format=json returns { report_md }
  if (url.searchParams.get("format") === "json") {
    return Response.json({ slug, report_md: project.report });
  }
  return new Response(project.report, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
