// POST /api/auth/webhook/test — fire a synthetic `run.test` event at the
// caller's configured webhook URL. Returns the downstream HTTP status so
// the UI can surface it immediately. Session-only (not API-key mintable).

import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";
import { findUserById, getWebhookTarget } from "@/lib/users";
import { createHmac } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = verifySessionUser(m?.[1]);
  if (!session)
    return Response.json({ error: "Not signed in" }, { status: 401 });
  const user = findUserById(session.uid);
  if (!user)
    return Response.json({ error: "User not found" }, { status: 401 });

  const target = getWebhookTarget(user.id);
  if (!target?.url) {
    return Response.json(
      { error: "Webhook not configured — save a URL first." },
      { status: 400 }
    );
  }

  const payload = {
    event: "run.test",
    message: "This is a test ping from Syncera. Your webhook is reachable.",
    sent_at: new Date().toISOString(),
    user_id: user.id,
  };
  const body = JSON.stringify(payload);
  const signature =
    "sha256=" +
    createHmac("sha256", target.secret ?? "")
      .update(body)
      .digest("hex");

  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": signature,
        "X-Event": "run.test",
        "User-Agent": "syncera-webhook/1",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json({
      ok: res.ok,
      status: res.status,
      headers_sent: {
        "X-Signature-256": signature,
        "X-Event": "run.test",
      },
    });
  } catch (err: any) {
    return Response.json(
      { error: `Request failed: ${err?.message ?? String(err)}` },
      { status: 502 }
    );
  }
}
