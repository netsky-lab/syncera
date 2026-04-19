import { listUsers, createUser } from "@/lib/users";
import { requireBasicAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  return Response.json({ users: listUsers() });
}

export async function POST(request: Request) {
  const auth = requireBasicAuth(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const role = body.role === "admin" ? "admin" : "user";
  if (!email || !password) {
    return Response.json({ error: "email and password required" }, { status: 400 });
  }
  const result = createUser({ email, password, role });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ user: result.user }, { status: 201 });
}
