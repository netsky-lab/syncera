import { test, expect, describe, beforeAll } from "bun:test";
import { signSession, verifySession } from "./sessions";
import { createHmac } from "crypto";

beforeAll(() => {
  // Deterministic secret for reproducible assertions.
  process.env.SESSION_SECRET = "a".repeat(64);
});

function b64url(s: string | Buffer): string {
  const b = typeof s === "string" ? Buffer.from(s) : s;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("signSession + verifySession", () => {
  test("roundtrip returns the uid", () => {
    const token = signSession("u_abc123");
    const payload = verifySession(token);
    expect(payload?.uid).toBe("u_abc123");
  });

  test("exp is ~30 days in the future", () => {
    const token = signSession("u_xyz");
    const payload = verifySession(token);
    const now = Math.floor(Date.now() / 1000);
    const thirtyDays = 60 * 60 * 24 * 30;
    expect(payload!.exp).toBeGreaterThan(now + thirtyDays - 60);
    expect(payload!.exp).toBeLessThan(now + thirtyDays + 60);
  });

  test("returns null on tampered signature", () => {
    const token = signSession("u_abc");
    const [encoded, sig] = token.split(".");
    // Flip one char in the signature
    const badSig = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    expect(verifySession(`${encoded}.${badSig}`)).toBeNull();
  });

  test("returns null on tampered payload", () => {
    const token = signSession("u_abc");
    const [, sig] = token.split(".");
    // Re-encode payload with different uid, keep old signature — must fail.
    const evil = b64url(JSON.stringify({ uid: "u_EVIL", exp: 9999999999 }));
    expect(verifySession(`${evil}.${sig}`)).toBeNull();
  });

  test("returns null on expired token", () => {
    // Craft a token with a past exp, signed correctly.
    const payload = { uid: "u_old", exp: 100 }; // way in the past
    const encoded = b64url(JSON.stringify(payload));
    const sig = b64url(
      createHmac("sha256", Buffer.from(process.env.SESSION_SECRET!))
        .update(encoded)
        .digest()
    );
    expect(verifySession(`${encoded}.${sig}`)).toBeNull();
  });

  test("returns null on malformed token", () => {
    expect(verifySession("")).toBeNull();
    expect(verifySession("not-a-jwt")).toBeNull();
    expect(verifySession("only.one.dot.too.many")).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession(null)).toBeNull();
  });
});
