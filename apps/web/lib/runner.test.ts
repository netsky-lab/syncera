import { test, expect, describe } from "bun:test";
import { slugify, phaseFromLine } from "./runner";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("strips non-alphanumerics including punctuation and quotes", () => {
    expect(slugify(`How to "compress" KV cache on RTX 5090?`)).toBe(
      "how-to-compress-kv-cache-on-rtx-5090"
    );
  });

  test("collapses runs of separators", () => {
    expect(slugify("a   b___c—d")).toBe("a-b-c-d");
  });

  test("trims leading and trailing separators", () => {
    expect(slugify("  ???hello!!!  ")).toBe("hello");
  });

  test("caps at 80 chars", () => {
    const long = "x".repeat(500);
    expect(slugify(long).length).toBe(80);
  });
});

describe("phaseFromLine", () => {
  test("extracts known phases", () => {
    expect(phaseFromLine("[phase:plan] Generating research plan...")).toBe("plan");
    expect(phaseFromLine("[phase:harvest] Collecting sources")).toBe("harvest");
    expect(phaseFromLine("[phase:evidence] Extracting facts")).toBe("evidence");
    expect(phaseFromLine("[phase:verify] Fact-checking")).toBe("verify");
    expect(phaseFromLine("[phase:analyze] Synthesizing answers")).toBe("analyze");
    expect(phaseFromLine("[phase:synth] Generating final report")).toBe("synth");
    expect(phaseFromLine("[phase:playbook] Compiling operational playbook")).toBe("playbook");
    expect(phaseFromLine("[phase:scout] Surveying literature")).toBe("scout");
    expect(phaseFromLine("[phase:refine] Targeting weak questions")).toBe("refine");
  });

  test("ignores lines without the tag", () => {
    expect(phaseFromLine("just a log line")).toBeNull();
    expect(phaseFromLine("")).toBeNull();
  });

  test("ignores malformed tags", () => {
    expect(phaseFromLine("[phase:] missing name")).toBeNull();
    expect(phaseFromLine("phase:harvest missing brackets")).toBeNull();
  });

  test("returns the first phase when multiple appear on one line", () => {
    expect(phaseFromLine("[phase:harvest] then [phase:evidence]")).toBe("harvest");
  });
});
