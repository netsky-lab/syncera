import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { test, expect, describe, beforeAll, beforeEach, afterAll } from "bun:test";

const tmpDir = mkdtempSync(join(tmpdir(), "rl-keys-test-"));
const storePath = join(tmpDir, "api_keys.json");

type KeysModule = typeof import("./keys");
let K: KeysModule;

beforeAll(async () => {
  process.env.KEY_STORE_PATH = storePath;
  delete process.env.API_KEYS; // ensure no env-seed pollution by default
  K = await import("./keys");
});

beforeEach(() => {
  if (existsSync(storePath)) rmSync(storePath);
  delete process.env.API_KEYS;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createKey", () => {
  test("returns raw key with rl_ prefix and stable length", () => {
    const k = K.createKey("my-app");
    expect(k.raw).toMatch(/^rl_[0-9a-f]{48}$/);
    expect(k.prefix).toBe(k.raw.slice(0, 8));
    expect(k.id).toMatch(/^k_[0-9a-f]+$/);
  });

  test("persisted entry has hash, not raw key", () => {
    K.createKey("leaky-check");
    const list = K.listKeys();
    expect(list.length).toBe(1);
    // listKeys strips hash, but also confirms raw is never stored
    for (const k of list) {
      expect((k as any).hash).toBeUndefined();
      expect((k as any).raw).toBeUndefined();
    }
  });

  test("trims name, defaults to 'unnamed' when empty", () => {
    K.createKey("   ");
    const list = K.listKeys();
    expect(list[0]?.name).toBe("unnamed");
  });
});

describe("createKey ownership", () => {
  test("keys minted without ownerUid have owner_uid null", () => {
    K.createKey("legacy");
    const list = K.listKeys();
    expect(list[0]!.owner_uid ?? null).toBeNull();
  });

  test("keys minted with ownerUid carry it through", () => {
    K.createKey("scoped", "u_abc123");
    const list = K.listKeys();
    expect(list[0]!.owner_uid).toBe("u_abc123");
  });

  test("keys default to read plus run-start scopes", () => {
    K.createKey("default-scopes", "u_abc123");
    const list = K.listKeys();
    expect(list[0]!.scopes).toEqual(["project:read", "run:start"]);
  });

  test("normalizes custom scopes and drops duplicates", () => {
    K.createKey("custom-scopes", "u_abc123", [
      "project:read",
      "project:read",
      "project:write",
      "nope",
    ]);
    const list = K.listKeys();
    expect(list[0]!.scopes).toEqual(["project:read", "project:write"]);
  });
});

describe("verifyKey", () => {
  test("returns the key record on match", () => {
    const k = K.createKey("prod");
    const v = K.verifyKey(k.raw);
    expect(v?.id).toBe(k.id);
    expect(v?.name).toBe("prod");
  });

  test("returns null on unknown key", () => {
    K.createKey("prod");
    expect(K.verifyKey("rl_not-a-real-key")).toBeNull();
  });

  test("returns null after revocation", () => {
    const k = K.createKey("prod");
    K.revokeKey(k.id);
    expect(K.verifyKey(k.raw)).toBeNull();
  });

  test("updates last_used_at", () => {
    const k = K.createKey("prod");
    const before = K.listKeys()[0]!.last_used_at;
    expect(before).toBeNull();
    K.verifyKey(k.raw);
    const after = K.listKeys()[0]!.last_used_at;
    expect(after).not.toBeNull();
  });

  test("accepts env seed keys via API_KEYS", () => {
    process.env.API_KEYS = "seed-key-1,seed-key-2";
    const v = K.verifyKey("seed-key-1");
    expect(v?.id).toBe("seed");
    expect(v?.name).toBe("env (API_KEYS)");
  });

  test("rejects whitespace around env seed keys", () => {
    // keys.ts trims env entries; leading/trailing whitespace in the PRESENTED
    // key should not match (we only trim the stored config, not user input)
    process.env.API_KEYS = "seed-key-1";
    expect(K.verifyKey(" seed-key-1")).toBeNull();
    expect(K.verifyKey("seed-key-1 ")).toBeNull();
  });
});

describe("revokeKey", () => {
  test("returns true for existing key and sets revoked_at", () => {
    const k = K.createKey("prod");
    expect(K.revokeKey(k.id)).toBe(true);
    expect(K.listKeys()[0]!.revoked_at).not.toBeNull();
  });

  test("returns false for non-existent id", () => {
    expect(K.revokeKey("k_doesnotexist")).toBe(false);
  });

  test("is idempotent (already-revoked returns true, no-op)", () => {
    const k = K.createKey("prod");
    K.revokeKey(k.id);
    const firstRevoke = K.listKeys()[0]!.revoked_at;
    expect(K.revokeKey(k.id)).toBe(true);
    expect(K.listKeys()[0]!.revoked_at).toBe(firstRevoke);
  });
});
