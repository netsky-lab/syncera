// Admin endpoints for API key management. Session-gated (admin role),
// NOT API-key-gated — a compromised API key can't mint more keys.

import { listKeys, createKey, normalizeScopes } from "@/lib/keys";
import { requireBasicAuth, viewerUidFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  return Response.json({ keys: listKeys() });
}

export async function POST(request: Request) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const scopes = Array.isArray(body.scopes)
    ? normalizeScopes(body.scopes.map(String))
    : ["project:read", "run:start"];
  // Scope the minted key to the admin who created it — keys inherit the
  // owner's project visibility, so a consumer app auth'd with this key
  // reads the admin's research artifacts, not just showcase.
  const ownerUid = viewerUidFromRequest(request);
  const { id, raw, prefix } = createKey(name, ownerUid, scopes);
  return Response.json(
    {
      id,
      name: name || "unnamed",
      prefix,
      scopes,
      // raw is shown ONCE — caller must store it. Subsequent GETs won't return it.
      key: raw,
      warning:
        "Save this key now — it will never be shown again. If you lose it, revoke and create a new one.",
    },
    { status: 201 }
  );
}
