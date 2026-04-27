// Users store tests. users.ts reads USER_STORE_PATH at module load, so we
// must set the env BEFORE importing. TS/ES hoists static imports above any
// top-level statements, so we use a dynamic import inside beforeAll to
// guarantee the env is set first.

import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { test, expect, describe, beforeAll, beforeEach, afterAll } from "bun:test";

const tmpDir = mkdtempSync(join(tmpdir(), "rl-users-test-"));
const storePath = join(tmpDir, "users.json");

type UsersModule = typeof import("./users");
let U: UsersModule;

beforeAll(async () => {
  process.env.USER_STORE_PATH = storePath;
  U = await import("./users");
});

beforeEach(() => {
  if (existsSync(storePath)) rmSync(storePath);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createUser", () => {
  test("creates a user and returns it without password_hash", () => {
    const r = U.createUser({ email: "a@b.com", password: "12345678", role: "user" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.email).toBe("a@b.com");
      expect(r.user.role).toBe("user");
      expect(r.user.session_version).toBe(0);
      expect((r.user as any).password_hash).toBeUndefined();
    }
  });

  test("rejects invalid email", () => {
    const r = U.createUser({ email: "not-an-email", password: "12345678" });
    expect(r.ok).toBe(false);
  });

  test("rejects short password", () => {
    const r = U.createUser({ email: "a@b.com", password: "short" });
    expect(r.ok).toBe(false);
  });

  test("rejects duplicate email (case-insensitive)", () => {
    U.createUser({ email: "a@b.com", password: "12345678" });
    const r = U.createUser({ email: "A@B.COM", password: "12345678" });
    expect(r.ok).toBe(false);
  });
});

describe("authenticate", () => {
  test("succeeds with correct password", () => {
    U.createUser({ email: "a@b.com", password: "correct-horse-battery" });
    const r = U.authenticate("a@b.com", "correct-horse-battery");
    expect(r.ok).toBe(true);
  });

  test("fails with wrong password", () => {
    U.createUser({ email: "a@b.com", password: "correct-horse-battery" });
    const r = U.authenticate("a@b.com", "wrong-password");
    expect(r.ok).toBe(false);
  });

  test("fails with non-existent email", () => {
    const r = U.authenticate("nobody@nowhere.com", "anything12");
    expect(r.ok).toBe(false);
  });

  test("is case-insensitive on email lookup", () => {
    U.createUser({ email: "Alice@Example.com", password: "password1234" });
    const r = U.authenticate("alice@example.com", "password1234");
    expect(r.ok).toBe(true);
  });

  test("updates last_login_at", () => {
    U.createUser({ email: "a@b.com", password: "password1234" });
    const before = U.findUserByEmail("a@b.com")?.last_login_at;
    expect(before).toBeNull();
    U.authenticate("a@b.com", "password1234");
    const after = U.findUserByEmail("a@b.com")?.last_login_at;
    expect(after).not.toBeNull();
  });
});

describe("updatePassword", () => {
  test("succeeds with correct current password, new login works with new password", () => {
    const r = U.createUser({ email: "a@b.com", password: "original12345" });
    if (!r.ok) throw new Error("setup failed");
    const u = U.updatePassword(r.user.id, "original12345", "fresh-pass-99");
    expect(u.ok).toBe(true);
    expect(U.authenticate("a@b.com", "original12345").ok).toBe(false);
    expect(U.authenticate("a@b.com", "fresh-pass-99").ok).toBe(true);
    expect(U.findUserById(r.user.id)?.session_version).toBe(1);
  });

  test("fails with wrong current password", () => {
    const r = U.createUser({ email: "a@b.com", password: "original12345" });
    if (!r.ok) throw new Error("setup failed");
    const u = U.updatePassword(r.user.id, "wrong-current", "fresh-pass-99");
    expect(u.ok).toBe(false);
  });

  test("rejects short new password", () => {
    const r = U.createUser({ email: "a@b.com", password: "original12345" });
    if (!r.ok) throw new Error("setup failed");
    const u = U.updatePassword(r.user.id, "original12345", "short");
    expect(u.ok).toBe(false);
  });
});

describe("deleteUser + listUsers", () => {
  test("deleteUser removes from store, listUsers reflects", () => {
    const a = U.createUser({ email: "a@b.com", password: "password1234" });
    const b = U.createUser({ email: "c@d.com", password: "password1234" });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    expect(U.listUsers().length).toBe(2);
    expect(U.deleteUser(a.user.id)).toBe(true);
    expect(U.listUsers().length).toBe(1);
    expect(U.findUserById(a.user.id)).toBeNull();
    expect(U.findUserById(b.user.id)?.email).toBe("c@d.com");
  });

  test("deleteUser returns false for non-existent id", () => {
    expect(U.deleteUser("u_doesnotexist")).toBe(false);
  });

  test("listUsers never leaks password_hash", () => {
    U.createUser({ email: "a@b.com", password: "password1234" });
    const users = U.listUsers();
    for (const u of users) {
      expect((u as any).password_hash).toBeUndefined();
    }
  });
});
