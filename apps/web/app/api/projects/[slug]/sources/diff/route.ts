import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { canView, getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClaimRow = {
  id: string;
  statement: string;
  question_id: string;
  subquestion_id: string;
  state: string;
  verdict: string;
  confidence: number | null;
  evidence_urls: string[];
};

function claimRows(project: any): ClaimRow[] {
  const graphClaims = project.epistemicGraph?.claims;
  if (Array.isArray(graphClaims) && graphClaims.length > 0) {
    return graphClaims.map((claim: any) => ({
      id: String(claim.id ?? ""),
      statement: String(claim.statement ?? ""),
      question_id: String(claim.question_id ?? ""),
      subquestion_id: String(claim.subquestion_id ?? ""),
      state: String(claim.lifecycle_state ?? "unverified"),
      verdict: String(claim.verdict ?? "unverified"),
      confidence:
        typeof claim.confidence === "number" ? Number(claim.confidence) : null,
      evidence_urls: (claim.evidence ?? []).map((e: any) => String(e.url ?? "")),
    }));
  }
  return (project.facts ?? []).map((fact: any) => ({
    id: String(fact.id ?? ""),
    statement: String(fact.statement ?? ""),
    question_id: String(fact.question_id ?? ""),
    subquestion_id: String(fact.subquestion_id ?? ""),
    state: "unverified",
    verdict: "unverified",
    confidence: typeof fact.confidence === "number" ? Number(fact.confidence) : null,
    evidence_urls: (fact.references ?? []).map((ref: any) => String(ref.url ?? "")),
  }));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const viewerUid = viewerUidFromRequest(request);
  if (!canView(slug, viewerUid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sourceUrl = String(url.searchParams.get("url") ?? "").trim();
  if (!sourceUrl) return Response.json({ error: "url is required" }, { status: 400 });

  const project = getProject(slug, viewerUid);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const statusRecord = project.sourceStatus?.[sourceUrl] ?? null;
  const branchSlug = statusRecord?.branch_slug ? String(statusRecord.branch_slug) : null;
  if (!branchSlug) {
    return Response.json({
      source_url: sourceUrl,
      branch_slug: null,
      changes: [],
    });
  }
  const branch = getProject(branchSlug, viewerUid);
  if (!branch) {
    return Response.json({
      source_url: sourceUrl,
      branch_slug: branchSlug,
      changes: [],
      branch_missing: true,
    });
  }

  const oldClaims = claimRows(project).filter((claim) =>
    claim.evidence_urls.includes(sourceUrl)
  );
  const sourceClaimIds = Array.isArray(statusRecord?.source_claim_ids)
    ? statusRecord.source_claim_ids.map(String)
    : oldClaims.map((claim) => claim.id);
  const branchClaims = claimRows(branch);
  const branchById = new Map(branchClaims.map((claim) => [claim.id, claim]));
  const branchByQuestion = new Map<string, any[]>();
  for (const claim of branchClaims) {
    const key = `${claim.question_id}:${claim.subquestion_id}`;
    const arr = branchByQuestion.get(key) ?? [];
    arr.push(claim);
    branchByQuestion.set(key, arr);
  }

  const changes = oldClaims
    .filter((claim) => sourceClaimIds.length === 0 || sourceClaimIds.includes(claim.id))
    .map((oldClaim) => {
      const sameId = branchById.get(oldClaim.id);
      const pool =
        branchByQuestion.get(`${oldClaim.question_id}:${oldClaim.subquestion_id}`) ?? [];
      const replacement =
        sameId ??
        pool.find((claim) =>
          claim.statement
            .toLowerCase()
            .includes(oldClaim.statement.toLowerCase().slice(0, 40))
        ) ??
        pool[0] ??
        null;
      return {
        claim_id: oldClaim.id,
        old: oldClaim,
        new: replacement,
        delta_confidence:
          replacement?.confidence != null && oldClaim.confidence != null
            ? Number((replacement.confidence - oldClaim.confidence).toFixed(4))
            : null,
        changed:
          !replacement ||
          replacement.state !== oldClaim.state ||
          replacement.verdict !== oldClaim.verdict ||
          replacement.confidence !== oldClaim.confidence,
      };
    });

  return Response.json({
    source_url: sourceUrl,
    branch_slug: branchSlug,
    branch_status: statusRecord?.recheck_status ?? "running",
    changes,
  });
}
