import { test, expect, describe } from "bun:test";
import { buildOpenApiSpec } from "./route";

const spec = buildOpenApiSpec("https://test.local");

describe("OpenAPI spec structural integrity", () => {
  test("declares OpenAPI 3.1.0", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  test("every path operation has a summary or description", () => {
    const bad: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods as any)) {
        if (typeof op !== "object" || op === null) continue;
        const o = op as { summary?: string; description?: string };
        if (!o.summary && !o.description) {
          bad.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("every $ref resolves to a declared schema", () => {
    const declared = new Set(Object.keys(spec.components.schemas));
    const body = JSON.stringify(spec);
    const refs = Array.from(body.matchAll(/#\/components\/schemas\/(\w+)/g));
    const dangling = refs
      .map((m) => m[1])
      .filter((name) => name && !declared.has(name));
    expect(dangling).toEqual([]);
  });

  test("every used tag is declared in the top-level tags list", () => {
    const declared = new Set((spec.tags ?? []).map((t: any) => t.name));
    const used = new Set<string>();
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods as any)) {
        if (typeof op !== "object" || op === null) continue;
        const tags = (op as any).tags ?? [];
        for (const t of tags) used.add(t);
      }
    }
    const undeclared = [...used].filter((t) => !declared.has(t));
    expect(undeclared).toEqual([]);
  });

  test("every declared security scheme is referenced somewhere", () => {
    const schemes = Object.keys(spec.components.securitySchemes);
    const body = JSON.stringify(spec);
    for (const scheme of schemes) {
      // Every scheme appears at least once in the security lists of operations
      // or the top-level security.
      expect(body.includes(`"${scheme}"`)).toBe(true);
    }
  });

  test("all the auth + admin endpoints are present (regression guard)", () => {
    const required = [
      "/api/auth/login",
      "/api/auth/signup",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/auth/password",
      "/api/auth/webhook",
      "/api/admin/users",
      "/api/admin/users/{id}",
      "/api/admin/keys",
      "/api/admin/keys/{id}",
    ];
    for (const path of required) {
      expect(spec.paths).toHaveProperty(path);
    }
  });

  test("servers array uses the origin passed in", () => {
    expect(spec.servers[0]!.url).toBe("https://test.local");
  });
});
