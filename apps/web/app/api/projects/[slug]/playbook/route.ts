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
  if (!project || !project.playbookMarkdown) {
    return new Response("Playbook not available", { status: 404 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    return Response.json({
      slug,
      playbook: project.playbook,
      playbook_md: project.playbookMarkdown,
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
  };
  if (url.searchParams.get("download") === "1") {
    const safe = slug.replace(/[^a-z0-9-_]/gi, "-").slice(0, 80);
    headers["Content-Disposition"] = `attachment; filename="${safe}-playbook.md"`;
  }
  return new Response(project.playbookMarkdown, { headers });
}
