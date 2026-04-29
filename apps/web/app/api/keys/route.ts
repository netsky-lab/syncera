// Per-user API key management. Session-gated (any logged-in user can
// mint a key for their own account). Admin-wide view lives at
// /api/admin/keys — this route only exposes the caller's own keys.

import { listKeys, createKey, normalizeScopes } from "@/lib/keys";
import { cookies } from "next/headers";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUserUid(): Promise<string | Response> {
  const jar = await cookies();
  const uid = verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;
  if (!uid) {
    return Response.json(
      { error: "Sign in to manage API keys" },
      { status: 401 }
    );
  }
  return uid;
}

export async function GET() {
  const uid = await requireUserUid();
  if (typeof uid !== "string") return uid;
  const mine = listKeys().filter((k) => k.owner_uid === uid);
  return Response.json({ keys: mine });
}

export async function POST(request: Request) {
  const uid = await requireUserUid();
  if (typeof uid !== "string") return uid;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const scopes = Array.isArray(body.scopes)
    ? normalizeScopes(body.scopes.map(String))
    : ["project:read", "run:start"];
  const { id, raw, prefix } = createKey(name, uid, scopes);
  return Response.json(
    {
      id,
      name: name || "unnamed",
      prefix,
      scopes,
      key: raw,
      warning:
        "Save this key now — it will never be shown again. Revoke and mint a new one if lost.",
    },
    { status: 201 }
  );
}
