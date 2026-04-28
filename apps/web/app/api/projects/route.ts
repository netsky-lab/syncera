// GET /api/projects — list all projects with summary metadata.
// Consumed by external apps to enumerate available research artifacts.

import { listProjects } from "@/lib/projects";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const viewerUid = viewerUidFromRequest(request);
  const projects = listProjects(viewerUid);
  return Response.json({
    count: projects.length,
    projects: projects.map((p) => ({
      slug: p.slug,
      topic: p.topic,
      schema: p.schema,
      stats: {
        questions: p.questions,
        hypotheses: p.hypotheses,
        facts: p.facts,
        claims: p.claims,
        sources: p.sources,
        learnings: p.learnings,
        source_quality: p.source_quality,
        accepted_sources: p.accepted_sources,
        rejected_sources: p.rejected_sources,
      },
      has_report: p.hasReport,
      confidence: p.confidence, // 0 for question-first, valid for hypothesis-first
      generated_at: p.generatedAt,
      owner_uid: p.owner_uid,
      is_showcase: p.is_showcase,
    })),
  });
}
