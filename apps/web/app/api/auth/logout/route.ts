import { clearCookieHeader } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const isSecure = request.url.startsWith("https://");
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearCookieHeader(isSecure) } }
  );
}
