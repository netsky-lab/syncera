import { test, expect, describe } from "bun:test";
import { extractPrimaryEntity, contentContainsEntity } from "./evidence";

describe("extractPrimaryEntity", () => {
  test("picks CamelCase method over model", () => {
    expect(
      extractPrimaryEntity(
        "SpindleKV reduces KV cache size by 50% on LLaMA-3-8b-instruct"
      )
    ).toBe("SpindleKV");
  });

  test("picks stem-pattern methods (KV/Quant/Attn)", () => {
    expect(
      extractPrimaryEntity(
        "MixKVQ applies query-aware mixed-precision quantization"
      )
    ).toBe("MixKVQ");
    expect(
      extractPrimaryEntity(
        "vLLM utilizes PagedAttention for block-based dynamic memory"
      )
    ).toBe("PagedAttention");
  });

  test("picks CamelCase multi-syllable methods", () => {
    expect(
      extractPrimaryEntity(
        "VecInfer applies smooth and Hadamard transformations"
      )
    ).toBe("VecInfer");
    expect(
      extractPrimaryEntity(
        "MiKV achieves minimal performance degradation at 80% compression"
      )
    ).toBe("MiKV");
  });

  test("picks ACRONYM methods when no CamelCase available", () => {
    expect(
      extractPrimaryEntity(
        "AWQ, GPTQ, SqueezeLLM address heavy-tailed weight distributions"
      )
    ).toBe("SqueezeLLM");
  });

  test("falls back to hyphenated model name when no method-pattern match", () => {
    expect(
      extractPrimaryEntity("Performance measured on Llama-3.1-8B-Instruct")
    ).toBe("Llama-3.1-8B-Instruct");
  });

  test("ignores blocklisted topical terms", () => {
    expect(extractPrimaryEntity("The GPU requires more VRAM")).toBeNull();
    expect(extractPrimaryEntity("An LLM outputs text")).toBeNull();
  });

  test("returns null on purely generic statement", () => {
    expect(
      extractPrimaryEntity("the method reduces memory usage and improves speed")
    ).toBeNull();
  });
});

describe("contentContainsEntity", () => {
  test("case-insensitive match", () => {
    expect(contentContainsEntity("The kivi method works", "KIVI")).toBe(true);
  });

  test("matches across hyphens and whitespace", () => {
    expect(
      contentContainsEntity("Tested on Llama-3 8B Instruct", "Llama 3")
    ).toBe(true);
    expect(
      contentContainsEntity("Tested on Llama38BInstruct", "Llama-3")
    ).toBe(true);
  });

  test("does not match missing entity", () => {
    expect(
      contentContainsEntity(
        "This paper introduces a new KV cache compression approach",
        "PagedAttention"
      )
    ).toBe(false);
  });
});
