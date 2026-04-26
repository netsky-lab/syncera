import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { zodToJsonHint } from "./llm";

describe("zodToJsonHint", () => {
  test("maps primitive types", () => {
    expect(zodToJsonHint(z.string())).toBe("string");
    expect(zodToJsonHint(z.number())).toBe("number");
    expect(zodToJsonHint(z.boolean())).toBe("boolean");
  });

  test("flattens a flat object to its field types", () => {
    const hint = zodToJsonHint(
      z.object({ name: z.string(), age: z.number(), active: z.boolean() })
    );
    expect(hint).toEqual({ name: "string", age: "number", active: "boolean" });
  });

  test("wraps array types in a single-element list", () => {
    expect(zodToJsonHint(z.array(z.string()))).toEqual(["string"]);
    expect(zodToJsonHint(z.array(z.number()))).toEqual(["number"]);
  });

  test("enum becomes pipe-separated literal", () => {
    const hint = zodToJsonHint(z.enum(["a", "b", "c"]));
    expect(hint).toBe("a|b|c");
  });

  test("optional appends '(optional)'", () => {
    const hint = zodToJsonHint(z.string().optional());
    expect(hint).toBe("string (optional)");
  });

  test("nullable appends '(nullable)'", () => {
    const hint = zodToJsonHint(z.number().nullable());
    expect(hint).toBe("number (nullable)");
  });

  test("nullish combines both wrappers", () => {
    const hint = zodToJsonHint(z.string().nullish());
    // nullish = optional(nullable(x))
    expect(hint).toBe("string (nullable) (optional)");
  });

  test("default unwraps to its inner hint (default is silent in the prompt)", () => {
    expect(zodToJsonHint(z.string().default("x"))).toBe("string");
  });

  test("field descriptions annotate with // comment", () => {
    const hint = zodToJsonHint(
      z.object({
        verdict: z.enum(["ok", "bad"]).describe("outcome label"),
      })
    );
    // shape is { verdict: '"ok|bad" // outcome label' }
    expect(typeof hint.verdict).toBe("string");
    expect(hint.verdict).toContain("ok|bad");
    expect(hint.verdict).toContain("// outcome label");
  });

  test("nested object recurses", () => {
    const hint = zodToJsonHint(
      z.object({
        user: z.object({ id: z.string(), age: z.number() }),
      })
    );
    expect(hint).toEqual({ user: { id: "string", age: "number" } });
  });

  test("array of objects preserves nested shape", () => {
    const hint = zodToJsonHint(
      z.array(z.object({ id: z.string(), n: z.number() }))
    );
    expect(hint).toEqual([{ id: "string", n: "number" }]);
  });

  test("unknown type falls back to 'any'", () => {
    expect(zodToJsonHint(z.any())).toBe("any");
    expect(zodToJsonHint(z.unknown())).toBe("any");
  });
});
