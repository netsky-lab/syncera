import { clearCookieHeader, isSecureRequest } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearCookieHeader(isSecureRequest(request)) } }
  );
}
