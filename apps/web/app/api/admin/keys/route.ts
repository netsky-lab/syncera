// Admin endpoints for API key management. Protected by Basic Auth in
// middleware — middleware skips the API-key check on /api/admin/* paths,
// forcing Basic Auth only, so a compromised API key can't mint more keys.

import { listKeys, createKey } from "@/lib/keys";
import { requireBasicAuth } from "@/lib/auth";

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
  const { id, raw, prefix } = createKey(name);
  return Response.json(
    {
      id,
      name: name || "unnamed",
      prefix,
      // raw is shown ONCE — caller must store it. Subsequent GETs won't return it.
      key: raw,
      warning:
        "Save this key now — it will never be shown again. If you lose it, revoke and create a new one.",
    },
    { status: 201 }
  );
}
