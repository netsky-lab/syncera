import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ slug, schema: project.schema, plan: project.plan });
}
