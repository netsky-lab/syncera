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

  const url = new URL(request.url);
  const onlyVerified = url.searchParams.get("verified") === "1";
  const questionFilter = url.searchParams.get("question_id");

  const verMap = new Map<string, any>();
  for (const v of project.verification?.verifications ?? []) {
    verMap.set(v.fact_id ?? v.claim_id, v);
  }

  let facts = project.facts;
  if (onlyVerified) {
    facts = facts.filter((f: any) => {
      const v = verMap.get(f.id);
      return !v || v.verdict === "verified";
    });
  }
  if (questionFilter) {
    facts = facts.filter((f: any) => f.question_id === questionFilter);
  }

  return Response.json({
    slug,
    count: facts.length,
    facts: facts.map((f: any) => ({
      ...f,
      verification: verMap.get(f.id) ?? null,
    })),
  });
}
