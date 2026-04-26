import { describe, expect, test } from "bun:test";
import { detectDomainProfile } from "./domain-profile";

describe("detectDomainProfile", () => {
  test("detects LLM infrastructure topics", () => {
    expect(
      detectDomainProfile("KV-cache compression for Qwen on vLLM").id
    ).toBe("llm_infra");
  });

  test("detects cosmetics and chemistry formulation topics", () => {
    expect(
      detectDomainProfile(
        "Photostability of Ethylhexyl Methoxycinnamate in sunscreen SPF formulations"
      ).id
    ).toBe("chemistry_cosmetics");
  });

  test("detects battery and materials topics", () => {
    expect(
      detectDomainProfile("Lithium-ion battery calendar aging at 80% SOC").id
    ).toBe("battery_materials");
  });

  test("detects biomedical and clinical topics", () => {
    expect(
      detectDomainProfile("Randomized clinical trial of dose and adverse events").id
    ).toBe("biomedical_clinical");
  });

  test("falls back to generic research", () => {
    expect(detectDomainProfile("Market structure for specialty adhesives").id).toBe(
      "generic"
    );
  });

  test("uses scope-chat constraints as domain context", () => {
    expect(
      detectDomainProfile("Titanium dioxide", "Domain: cosmetic skincare").id
    ).toBe("chemistry_cosmetics");
  });
});
