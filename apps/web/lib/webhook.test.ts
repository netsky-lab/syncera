import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHmac } from "crypto";
import { signBody, fireWebhook, type WebhookRunPayload } from "./webhook";

describe("signBody", () => {
  test("produces sha256= prefix + hex HMAC a consumer can verify", () => {
    const body = '{"hello":"world"}';
    const secret = "whsec_abc";
    const sig = signBody(body, secret);
    expect(sig.startsWith("sha256=")).toBe(true);
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    expect(sig).toBe("sha256=" + expected);
  });

  test("different secrets produce different signatures", () => {
    expect(signBody("x", "a")).not.toBe(signBody("x", "b"));
  });

  test("tampering with the body changes the signature", () => {
    const secret = "s";
    const a = signBody('{"a":1}', secret);
    const b = signBody('{"a":2}', secret);
    expect(a).not.toBe(b);
  });
});

describe("fireWebhook", () => {
  const samplePayload: WebhookRunPayload = {
    event: "run.completed",
    runId: "test-run-1",
    slug: "test-slug",
    topic: "test topic",
    status: "completed",
    exitCode: 0,
    startedAt: 1,
    finishedAt: 2,
  };

  test("is a no-op when target is null", async () => {
    // Should not throw, not hang, resolve quickly.
    const t0 = Date.now();
    await fireWebhook(null, samplePayload);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  test("is a no-op when target.url is empty", async () => {
    const t0 = Date.now();
    await fireWebhook({ url: "", secret: "s" }, samplePayload);
    expect(Date.now() - t0).toBeLessThan(100);
  });

  test("POSTs to configured URL with correct headers and body shape", async () => {
    const received: {
      headers?: Record<string, string>;
      body?: string;
      url?: string;
    } = {};

    // Minimal in-process HTTP capture via Bun.serve
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        received.url = req.url;
        received.headers = Object.fromEntries(req.headers.entries());
        received.body = await req.text();
        return new Response("ok");
      },
    });
    try {
      const url = `http://127.0.0.1:${server.port}/hooks/x`;
      await fireWebhook({ url, secret: "test-secret" }, samplePayload);

      expect(received.url).toBe(url);
      expect(received.headers?.["x-event"]).toBe("run.completed");
      const sig = received.headers?.["x-signature-256"];
      expect(sig?.startsWith("sha256=")).toBe(true);

      const payload = JSON.parse(received.body!);
      expect(payload.event).toBe("run.completed");
      expect(payload.slug).toBe("test-slug");
      expect(payload.artifacts.report).toContain("/api/projects/test-slug/report");
      expect(payload.artifacts.facts).toContain("?verified=1");
      // Signature matches the actual body we received
      const expectedSig =
        "sha256=" +
        createHmac("sha256", "test-secret").update(received.body!).digest("hex");
      expect(sig).toBe(expectedSig);
    } finally {
      server.stop();
    }
  });
});
