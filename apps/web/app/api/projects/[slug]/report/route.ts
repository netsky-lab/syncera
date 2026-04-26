import { getProject } from "@/lib/projects";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const project = getProject(slug, viewerUidFromRequest(request));
  if (!project || !project.report) {
    return new Response("Report not available", { status: 404 });
  }
  const url = new URL(request.url);
  // ?format=md (default) returns text/markdown; ?format=json returns { report_md }
  if (url.searchParams.get("format") === "json") {
    return Response.json({ slug, report_md: project.report });
  }
  // ?download=1 forces the browser to save instead of render inline.
  // The UI button uses this; curl/API consumers can omit it.
  const download = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
  };
  if (download) {
    const safe = slug.replace(/[^a-z0-9-_]/gi, "-").slice(0, 80);
    headers["Content-Disposition"] = `attachment; filename="${safe}.md"`;
  }
  return new Response(project.report, { headers });
}
