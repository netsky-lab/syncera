import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { test, expect, describe, beforeAll, beforeEach, afterAll } from "bun:test";

const tmpDir = mkdtempSync(join(tmpdir(), "rl-signup-route-test-"));
const storePath = join(tmpDir, "users.json");

type UsersModule = typeof import("@/lib/users");
type SignupRoute = typeof import("./route");
let U: UsersModule;
let R: SignupRoute;
let originalNodeEnv: string | undefined;

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.USER_STORE_PATH = storePath;
  process.env.SESSION_SECRET = "c".repeat(64);
  U = await import("@/lib/users");
  R = await import("./route");
});

beforeEach(() => {
  if (existsSync(storePath)) rmSync(storePath);
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_SIGNUP;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.BOOTSTRAP_TOKEN;
  delete process.env.RESEND_API_KEY;
});

afterAll(() => {
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  rmSync(tmpDir, { recursive: true, force: true });
});

function signupRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("https://syncera.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/signup bootstrap gate", () => {
  test("rejects first production admin signup without bootstrap protection", async () => {
    const res = await R.POST(
      signupRequest({ email: "owner@example.com", password: "strong-pass-123" })
    );

    expect(res.status).toBe(403);
    expect(U.listUsers()).toHaveLength(0);
  });

  test("requires the configured bootstrap token for first production admin signup", async () => {
    process.env.BOOTSTRAP_TOKEN = "open-sesame";

    const denied = await R.POST(
      signupRequest({ email: "owner@example.com", password: "strong-pass-123" })
    );
    expect(denied.status).toBe(403);

    const allowed = await R.POST(
      signupRequest(
        { email: "owner@example.com", password: "strong-pass-123" },
        { "x-bootstrap-token": "open-sesame" }
      )
    );

    expect(allowed.status).toBe(201);
    const users = U.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]!.role).toBe("admin");
  });
});
