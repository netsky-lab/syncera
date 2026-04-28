import { startRun } from "@/lib/runner";
import { requireAuth } from "@/lib/auth";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import { assertPublicHttpUrl } from "@/lib/request-security";

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  // Extract owner uid from the session cookie (if any) so completion
  // webhooks fire to the right user. API-key callers don't have a uid —
  // webhooks only fire for UI-initiated runs.
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const ownerUid = verifySessionUser(m?.[1])?.uid ?? null;

  const body = await request.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  const constraints = body.constraints ? String(body.constraints).trim() : undefined;
  const settings = body.deep_settings && typeof body.deep_settings === "object"
    ? body.deep_settings
    : {};
  const rerun = body.rerun === true;
  // Optional user-curated source URLs. When present the pipeline skips
  // scout+harvest and uses only these URLs for evidence extraction.
  const rawSources = Array.isArray(body.user_sources) ? body.user_sources : [];
  const sourceCandidates = rawSources
    .map((u: any) => String(u).trim())
    .filter((u: string) => /^https?:\/\/.+/.test(u))
    .slice(0, 100); // cap to prevent abuse
  const userSources: string[] = [];
  for (const candidate of sourceCandidates) {
    try {
      const safe = await assertPublicHttpUrl(candidate);
      userSources.push(safe.toString());
    } catch (err: any) {
      return Response.json(
        { error: `Unsafe source URL rejected: ${err?.message ?? String(err)}` },
        { status: 400 }
      );
    }
  }

  if (!topic || topic.length < 4) {
    return Response.json(
      { error: "Topic is required (at least 4 characters)" },
      { status: 400 }
    );
  }

  const depth = ["balanced", "deep", "max"].includes(String(settings.depth))
    ? String(settings.depth)
    : "deep";
  const targetSources = Math.max(
    50,
    Math.min(500, Number(settings.target_sources ?? (depth === "max" ? 400 : depth === "deep" ? 250 : 120)))
  );
  const minQuestions = Math.max(5, Math.min(20, Number(settings.min_questions ?? 8)));
  const parallelism = Math.max(4, Math.min(64, Number(settings.parallelism ?? 16)));
  const provider = ["qwen", "gemini"].includes(String(settings.provider))
    ? String(settings.provider)
    : undefined;
  const effectiveProvider = provider ?? process.env.LLM_PROVIDER ?? "qwen";
  const preferredTypes = Array.isArray(settings.preferred_source_types)
    ? settings.preferred_source_types.map((x: any) => String(x)).filter(Boolean).slice(0, 8)
    : [];
  const settingsConstraint = [
    `Deep research settings: depth=${depth}`,
    `minimum research questions=${minQuestions}`,
    `target sources=${targetSources}`,
    `preferred source types=${preferredTypes.length ? preferredTypes.join(", ") : "primary papers, official docs, benchmarks"}`,
  ].join("; ");
  const mergedConstraints = [constraints, settingsConstraint].filter(Boolean).join("\n");

  const envOverrides: Record<string, string> = {
    MAX_HARVEST_SOURCES: String(targetSources),
    HARVEST_BREADTH: depth === "max" ? "12" : depth === "deep" ? "8" : "5",
    HARVEST_DEPTH: depth === "max" ? "8" : depth === "deep" ? "5" : "3",
    HARVEST_PAGES_PER_QUERY: depth === "balanced" ? "2" : "3",
    HARVEST_URLS_PER_QUERY: depth === "balanced" ? "8" : "12",
    SEARCH_TIMEOUT_MS: "12000",
    SEARXNG_TIMEOUT_MS: "10000",
    SEARXNG_RETRIES: "1",
    CONCURRENCY_HARVEST: String(parallelism),
    CONCURRENCY_EVIDENCE: String(Math.min(parallelism, 32)),
    CONCURRENCY_ANALYZER: String(Math.min(parallelism, 24)),
    CONCURRENCY_VERIFIER: String(Math.min(parallelism, 32)),
    LLM_MAX_CONCURRENCY:
      effectiveProvider === "gemini"
        ? String(Math.min(parallelism, 32))
        : String(Math.min(parallelism, 6)),
  };
  if (provider) envOverrides.LLM_PROVIDER = provider;

  const { runId, slug } = startRun(topic, mergedConstraints || undefined, ownerUid, {
    userSources: userSources.length > 0 ? userSources : undefined,
    clearArtifacts: rerun,
    env: envOverrides,
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
    deep_settings: {
      depth,
      target_sources: targetSources,
      min_questions: minQuestions,
      parallelism,
      provider: provider ?? "default",
      preferred_source_types: preferredTypes,
    },
    mode: rerun ? "rerun" : userSources.length > 0 ? "user-curated" : "harvest",
  });
}
