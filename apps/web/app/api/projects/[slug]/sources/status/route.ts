import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { getOwner } from "@/lib/projects";
import { setSourceStatus, type SourceTrustStatus } from "@/lib/source-status";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID = new Set<Exclude<SourceTrustStatus, "unreviewed">>([
  "trusted",
  "questionable",
  "ignored",
]);
const VALID_RECHECK = new Set([
  "none",
  "running",
  "replacement_found",
  "resolved",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;
  const { slug } = await params;
  const viewerUid = viewerUidFromRequest(request);
  const owner = getOwner(slug);
  const viewerIsAdmin = viewerUid
    ? findUserById(viewerUid)?.role === "admin"
    : false;
  const isOwner = owner != null && viewerUid != null && owner === viewerUid;
  if (!isOwner && !viewerIsAdmin) {
    return Response.json(
      { error: "Only the project owner or an admin can update source trust" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const status = String(body.status ?? "") as Exclude<
    SourceTrustStatus,
    "unreviewed"
  >;
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  if (!VALID.has(status)) {
    return Response.json(
      { error: "status must be one of: trusted, questionable, ignored" },
      { status: 400 }
    );
  }

  const statuses = setSourceStatus(
    slug,
    url,
    {
      status,
      note: body.note == null ? null : String(body.note),
      recheck_status:
        body.recheck_status == null ||
        !VALID_RECHECK.has(String(body.recheck_status))
          ? undefined
          : (String(body.recheck_status) as any),
      branch_slug:
        body.branch_slug === undefined
          ? undefined
          : body.branch_slug == null
            ? null
            : String(body.branch_slug),
      source_claim_ids: Array.isArray(body.source_claim_ids)
        ? body.source_claim_ids.map((x: any) => String(x)).filter(Boolean)
        : undefined,
    },
    viewerUid
  );
  return Response.json({ ok: true, url, record: statuses[url] });
}
