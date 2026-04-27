// Tests for the route-handler auth helpers. Covers the major branches of
// requireAuth (API key env-seed / file-backed / Basic Auth / dev mode) and
// requireBasicAuth (admin session / non-admin session / basic-auth fallback).

import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  test,
  expect,
  describe,
  beforeAll,
  beforeEach,
  afterAll,
} from "bun:test";

const tmpDir = mkdtempSync(join(tmpdir(), "rl-auth-test-"));
const keyStorePath = join(tmpDir, "keys.json");
const userStorePath = join(tmpDir, "users.json");

type AuthModule = typeof import("./auth");
type KeysModule = typeof import("./keys");
type UsersModule = typeof import("./users");
type SessionsModule = typeof import("./sessions");
let A: AuthModule;
let K: KeysModule;
let U: UsersModule;
let S: SessionsModule;

beforeAll(async () => {
  process.env.KEY_STORE_PATH = keyStorePath;
  process.env.USER_STORE_PATH = userStorePath;
  process.env.SESSION_SECRET = "b".repeat(64);
  process.env.BASIC_AUTH_USER = "research";
  process.env.BASIC_AUTH_PASS = "s3cret-pass";
  delete process.env.API_KEYS;
  // Import in order: side modules first so they initialize with test env,
  // then auth which lazy-loads them.
  K = await import("./keys");
  U = await import("./users");
  S = await import("./sessions");
  A = await import("./auth");
});

beforeEach(() => {
  if (existsSync(keyStorePath)) rmSync(keyStorePath);
  if (existsSync(userStorePath)) rmSync(userStorePath);
  delete process.env.API_KEYS;
  process.env.BASIC_AUTH_PASS = "s3cret-pass";
  process.env.SESSION_SECRET = "b".repeat(64);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function req(headers: Record<string, string>): Request {
  return new Request("http://test.local/", { headers });
}

// ─── requireAuth ──────────────────────────────────────────────────────────

describe("requireAuth", () => {
  test("accepts valid X-API-Key against file-backed store", () => {
    const k = K.createKey("test");
    const r = A.requireAuth(req({ "x-api-key": k.raw }));
    expect(r.ok).toBe(true);
  });

  test("accepts Authorization: Bearer <key>", () => {
    const k = K.createKey("test");
    const r = A.requireAuth(req({ authorization: `Bearer ${k.raw}` }));
    expect(r.ok).toBe(true);
  });

  test("accepts env-seed API_KEYS", () => {
    process.env.API_KEYS = "env-seed-abc,env-seed-xyz";
    const r = A.requireAuth(req({ "x-api-key": "env-seed-abc" }));
    expect(r.ok).toBe(true);
  });

  test("accepts Basic Auth with configured user/pass", () => {
    delete process.env.SESSION_SECRET;
    const basic = "Basic " + Buffer.from("research:s3cret-pass").toString("base64");
    const r = A.requireAuth(req({ authorization: basic }));
    expect(r.ok).toBe(true);
  });

  test("rejects Basic Auth fallback when session cookies are configured", () => {
    process.env.SESSION_SECRET = "b".repeat(64);
    const basic = "Basic " + Buffer.from("research:s3cret-pass").toString("base64");
    const r = A.requireAuth(req({ authorization: basic }));
    expect(r.ok).toBe(false);
  });

  test("rejects wrong Basic Auth password", () => {
    const basic = "Basic " + Buffer.from("research:wrong-pass").toString("base64");
    const r = A.requireAuth(req({ authorization: basic }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  test("rejects unknown API key", () => {
    const r = A.requireAuth(req({ "x-api-key": "rl_nope" }));
    expect(r.ok).toBe(false);
  });

  test("rejects revoked API key", () => {
    const k = K.createKey("test");
    K.revokeKey(k.id);
    const r = A.requireAuth(req({ "x-api-key": k.raw }));
    expect(r.ok).toBe(false);
  });

  test("rejects missing credentials", () => {
    const r = A.requireAuth(req({}));
    expect(r.ok).toBe(false);
  });

  test("does not enter dev-open mode when SESSION_SECRET is set", () => {
    delete process.env.BASIC_AUTH_PASS;
    delete process.env.API_KEYS;
    process.env.SESSION_SECRET = "b".repeat(64);
    const r = A.requireAuth(req({}));
    expect(r.ok).toBe(false);
  });

  test("accepts a valid session cookie (browser-UI path)", () => {
    const admin = U.createUser({
      email: "keys-api-user@test.com",
      password: "pass-pass-1234",
      role: "user",
    });
    if (!admin.ok) throw new Error("setup failed");
    const token = S.signSession(admin.user.id);
    const r = A.requireAuth(req({ cookie: `rl_session=${token}` }));
    expect(r.ok).toBe(true);
  });

  test("rejects a session cookie issued before password change", () => {
    const user = U.createUser({
      email: "rotated@test.com",
      password: "pass-pass-1234",
      role: "user",
    });
    if (!user.ok) throw new Error("setup failed");
    const token = S.signSession(user.user.id, user.user.session_version ?? 0);
    U.setPasswordByUid(user.user.id, "new-pass-pass-1234");
    const r = A.requireAuth(req({ cookie: `rl_session=${token}` }));
    expect(r.ok).toBe(false);
  });

  test("rejects a tampered session cookie", () => {
    const token = S.signSession("u_some");
    const tampered = token.slice(0, -5) + "aaaaa";
    const r = A.requireAuth(req({ cookie: `rl_session=${tampered}` }));
    expect(r.ok).toBe(false);
  });
});

describe("viewerUidFromRequest", () => {
  test("returns session uid when cookie is valid", () => {
    const admin = U.createUser({
      email: "viewer-sess@test.com",
      password: "pass-pass-1234",
      role: "admin",
    });
    if (!admin.ok) throw new Error("setup");
    const token = S.signSession(admin.user.id);
    const uid = A.viewerUidFromRequest(
      req({ cookie: `rl_session=${token}` })
    );
    expect(uid).toBe(admin.user.id);
  });

  test("returns key.owner_uid when only API key is present", () => {
    const k = K.createKey("scoped-key", "u_scoped_owner");
    const uid = A.viewerUidFromRequest(req({ "x-api-key": k.raw }));
    expect(uid).toBe("u_scoped_owner");
  });

  test("returns null for env-seed key (no owner)", () => {
    process.env.API_KEYS = "seed-anon-key";
    const uid = A.viewerUidFromRequest(req({ "x-api-key": "seed-anon-key" }));
    expect(uid).toBeNull();
  });

  test("returns null when no credentials", () => {
    expect(A.viewerUidFromRequest(req({}))).toBeNull();
  });

  test("session cookie wins over API key (cookie priority)", () => {
    const u = U.createUser({
      email: "both-creds@test.com",
      password: "pass-pass-1234",
      role: "user",
    });
    if (!u.ok) throw new Error("setup");
    const token = S.signSession(u.user.id);
    const k = K.createKey("other-key", "u_someone_else");
    const uid = A.viewerUidFromRequest(
      req({ cookie: `rl_session=${token}`, "x-api-key": k.raw })
    );
    expect(uid).toBe(u.user.id);
  });
});

// ─── requireBasicAuth (admin gate) ────────────────────────────────────────

describe("requireBasicAuth", () => {
  test("accepts admin session cookie", () => {
    const admin = U.createUser({
      email: "admin@test.com",
      password: "admin-password",
      role: "admin",
    });
    if (!admin.ok) throw new Error("setup failed");
    const token = S.signSession(admin.user.id);
    const r = A.requireBasicAuth(
      req({ cookie: `rl_session=${token}` })
    );
    expect(r.ok).toBe(true);
  });

  test("rejects non-admin session cookie with 403", () => {
    const user = U.createUser({
      email: "user@test.com",
      password: "user-password",
      role: "user",
    });
    if (!user.ok) throw new Error("setup failed");
    const token = S.signSession(user.user.id);
    const r = A.requireBasicAuth(
      req({ cookie: `rl_session=${token}` })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  test("rejects tampered session cookie", () => {
    const admin = U.createUser({
      email: "admin@test.com",
      password: "admin-password",
      role: "admin",
    });
    if (!admin.ok) throw new Error("setup failed");
    const token = S.signSession(admin.user.id);
    const tampered = token.slice(0, -5) + "xxxxx";
    const r = A.requireBasicAuth(
      req({ cookie: `rl_session=${tampered}` })
    );
    expect(r.ok).toBe(false);
  });

  test("accepts Basic Auth fallback when no session present", () => {
    delete process.env.SESSION_SECRET;
    const basic = "Basic " + Buffer.from("research:s3cret-pass").toString("base64");
    const r = A.requireBasicAuth(req({ authorization: basic }));
    expect(r.ok).toBe(true);
  });

  test("rejects missing credentials with 401", () => {
    const r = A.requireBasicAuth(req({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});
