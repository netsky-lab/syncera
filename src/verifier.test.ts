import { test, expect, describe } from "bun:test";
import {
  hashUrl,
  normalize,
  extractKeywords,
  normalizeVerdict,
} from "./verifier";

describe("hashUrl", () => {
  test("is deterministic for the same URL", () => {
    expect(hashUrl("https://arxiv.org/abs/2402.02750")).toBe(
      hashUrl("https://arxiv.org/abs/2402.02750")
    );
  });

  test("differs across URLs", () => {
    expect(hashUrl("https://arxiv.org/abs/2402.02750")).not.toBe(
      hashUrl("https://arxiv.org/abs/2503.24358")
    );
  });

  test("produces filesystem-safe ids (no slashes, colons)", () => {
    const h = hashUrl("https://arxiv.org/html/2503.24358v2");
    expect(h).not.toContain("/");
    expect(h).not.toContain(":");
    expect(h).not.toContain("?");
  });
});

describe("normalize", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalize("  Hello   WORLD\n\t!  ")).toBe("hello world !");
  });
});

describe("extractKeywords", () => {
  test("keeps identifiers with digits", () => {
    const kws = extractKeywords(
      "KIVI reduces perplexity to 2.17x on Llama-2-7B"
    );
    expect(kws.some((k) => k.includes("2.17"))).toBe(true);
    expect(kws.some((k) => k.includes("llama-2-7b"))).toBe(true);
  });

  test("drops tokens shorter than 3 chars (known limitation)", () => {
    // Naked short numerics like "80%" → "80" get dropped before the
    // numeric filter can keep them. Acceptable for L2 quote matching
    // because the quote is expected to contain longer context tokens.
    const kws = extractKeywords("by 80 percent");
    expect(kws).not.toContain("80");
  });

  test("drops stopwords", () => {
    const kws = extractKeywords("The method is on the model");
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("is");
    expect(kws).not.toContain("on");
  });

  test("keeps hyphenated identifiers", () => {
    const kws = extractKeywords("Llama-3.1-8B-Instruct tested on WikiText-2");
    expect(kws.some((k) => k.includes("-"))).toBe(true);
  });

  test("deduplicates", () => {
    const kws = extractKeywords("kivi kivi KIVI");
    expect(kws.filter((k) => k === "kivi").length).toBeLessThanOrEqual(1);
  });
});

describe("normalizeVerdict", () => {
  test("recognizes verified variants", () => {
    expect(normalizeVerdict("verified")).toBe("verified");
    expect(normalizeVerdict("Verified.")).toBe("verified");
    expect(normalizeVerdict("VERIFIABLE")).toBe("verified");
  });

  test("recognizes failure verdicts", () => {
    expect(normalizeVerdict("overreach")).toBe("overreach");
    expect(normalizeVerdict("overstated")).toBe("overreach");
    expect(normalizeVerdict("out_of_context")).toBe("out_of_context");
    expect(normalizeVerdict("cherry_picked")).toBe("cherry_picked");
    expect(normalizeVerdict("misread")).toBe("misread");
    expect(normalizeVerdict("misunderstood")).toBe("misread");
    expect(normalizeVerdict("url_dead")).toBe("url_dead");
    expect(normalizeVerdict("quote_fabricated")).toBe("quote_fabricated");
  });

  test("defaults to verified on unrecognized input (safer than false-rejecting)", () => {
    expect(normalizeVerdict("???")).toBe("verified");
  });
});
