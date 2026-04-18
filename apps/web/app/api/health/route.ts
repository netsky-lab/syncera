// Simple liveness probe. Bypasses BASIC_AUTH middleware via EXCLUDED_PREFIXES.
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
    { headers: { "content-type": "application/json" } }
  );
}
