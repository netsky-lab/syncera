// Per-user webhook config. Session-cookie only; API keys can't alter the
// user that minted them (small blast-radius principle).

import { verifySession, COOKIE_NAME } from "@/lib/sessions";
import { findUserById, setWebhook } from "@/lib/users";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function currentUser(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = verifySession(m?.[1]);
  if (!session) return null;
  return findUserById(session.uid);
}

// GET — returns the stored URL (or null) and whether a secret is set.
// Does NOT return the secret itself — treat it like an API key.
export async function GET(request: Request) {
  const u = currentUser(request);
  if (!u) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({
    url: u.webhook_url ?? null,
    has_secret: Boolean(u.webhook_secret),
  });
}

// POST { url, rotate_secret?: boolean } — set the URL, optionally mint a
// fresh secret that the caller sees ONCE in the response.
export async function POST(request: Request) {
  const u = currentUser(request);
  if (!u) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  if (!url) {
    return Response.json({ error: "url is required" }, { status: 400 });
  }
  const rotate = Boolean(body.rotate_secret) || !u.webhook_secret;
  const secret = rotate
    ? "whsec_" + randomBytes(24).toString("hex")
    : u.webhook_secret ?? null;
  const r = setWebhook(u.id, { url, secret });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({
    url,
    has_secret: true,
    secret: rotate ? secret : undefined,
    warning: rotate
      ? "Save this secret — the raw value is shown once. Consumer must verify HMAC-SHA256 of the request body matches X-Signature-256."
      : undefined,
  });
}

// DELETE — disable the webhook.
export async function DELETE(request: Request) {
  const u = currentUser(request);
  if (!u) return Response.json({ error: "Not signed in" }, { status: 401 });
  const r = setWebhook(u.id, { url: null, secret: null });
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true });
}
