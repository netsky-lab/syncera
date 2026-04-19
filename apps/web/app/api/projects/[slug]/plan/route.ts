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
  return Response.json({ slug, schema: project.schema, plan: project.plan });
}
