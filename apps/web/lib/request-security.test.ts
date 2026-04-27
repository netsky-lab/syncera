import { describe, expect, test } from "bun:test";
import { assertPublicHttpUrl } from "./request-security";

describe("assertPublicHttpUrl", () => {
  test("rejects localhost hostnames", async () => {
    await expect(assertPublicHttpUrl("http://localhost:3000/hook")).rejects.toThrow(
      /local\/private/
    );
  });

  test("rejects private IPv4 literals", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/hook")).rejects.toThrow(
      /private IPv4/
    );
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest")).rejects.toThrow(
      /private IPv4/
    );
  });

  test("requires https when requested", async () => {
    await expect(
      assertPublicHttpUrl("http://example.com/hook", { requireHttps: true })
    ).rejects.toThrow(/https/);
  });
});
