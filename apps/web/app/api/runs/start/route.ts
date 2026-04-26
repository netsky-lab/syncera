import { startRun } from "@/lib/runner";
import { requireAuth } from "@/lib/auth";
import { verifySession, COOKIE_NAME } from "@/lib/sessions";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  // Extract owner uid from the session cookie (if any) so completion
  // webhooks fire to the right user. API-key callers don't have a uid —
  // webhooks only fire for UI-initiated runs.
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const ownerUid = verifySession(m?.[1])?.uid ?? null;

  const body = await request.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  const constraints = body.constraints ? String(body.constraints).trim() : undefined;
  const rerun = body.rerun === true;
  // Optional user-curated source URLs. When present the pipeline skips
  // scout+harvest and uses only these URLs for evidence extraction.
  const rawSources = Array.isArray(body.user_sources) ? body.user_sources : [];
  const userSources = rawSources
    .map((u: any) => String(u).trim())
    .filter((u: string) => /^https?:\/\/.+/.test(u))
    .slice(0, 100); // cap to prevent abuse

  if (!topic || topic.length < 4) {
    return Response.json(
      { error: "Topic is required (at least 4 characters)" },
      { status: 400 }
    );
  }

  const { runId, slug } = startRun(topic, constraints, ownerUid, {
    userSources: userSources.length > 0 ? userSources : undefined,
    extraArgs: rerun
      ? [
          "--rescout",
          "--replan",
          "--reharvest",
          "--re-relevance",
          "--re-evidence",
          "--re-verify",
          "--re-analyze",
        ]
      : undefined,
  });
  return Response.json({
    runId,
    slug,
    topic,
    mode: rerun ? "rerun" : userSources.length > 0 ? "user-curated" : "harvest",
  });
}
