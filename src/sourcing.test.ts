import { test, expect, describe } from "bun:test";
import { scoreSource, tierLabel, sortByTier } from "./sourcing";

describe("scoreSource", () => {
  test("primary hosts score 0", () => {
    expect(scoreSource("https://arxiv.org/abs/2402.02750")).toBe(0);
    expect(scoreSource("https://arxiv.org/html/2503.24358v2")).toBe(0);
    expect(scoreSource("https://openreview.net/forum?id=abc")).toBe(0);
    expect(scoreSource("https://www.aclanthology.org/2023.acl-long.1")).toBe(0);
    expect(scoreSource("https://proceedings.mlr.press/v139/foo.html")).toBe(0);
  });

  test("subdomains of primary hosts still score 0", () => {
    expect(scoreSource("https://proceedings.neurips.cc/paper/2023")).toBe(0);
    expect(scoreSource("https://api.semanticscholar.org/v1/paper/ABC")).toBe(0);
  });

  test("official vendor hosts score 1", () => {
    expect(scoreSource("https://ai.google.dev/gemma/docs")).toBe(1);
    expect(scoreSource("https://docs.vllm.ai/en/latest")).toBe(1);
    expect(scoreSource("https://developer.nvidia.com/cuda")).toBe(1);
    expect(scoreSource("https://huggingface.co/google/gemma-2")).toBe(1);
    expect(scoreSource("https://www.anthropic.com/news/claude")).toBe(1);
  });

  test("code hosts score 2", () => {
    expect(scoreSource("https://github.com/vllm-project/vllm")).toBe(2);
    expect(scoreSource("https://pypi.org/project/torch")).toBe(2);
    expect(scoreSource("https://hub.docker.com/r/oven/bun")).toBe(2);
  });

  test("community hosts score 4 (beats blog patterns)", () => {
    expect(scoreSource("https://www.reddit.com/r/LocalLLaMA/comments/abc")).toBe(4);
    expect(scoreSource("https://stackoverflow.com/questions/12345")).toBe(4);
    expect(scoreSource("https://news.ycombinator.com/item?id=1")).toBe(4);
  });

  test("blog patterns score 3", () => {
    expect(scoreSource("https://medium.com/@user/post")).toBe(3);
    expect(scoreSource("https://foo.substack.com/p/bar")).toBe(3);
    expect(scoreSource("https://blog.example.org/why-x")).toBe(3);
    expect(scoreSource("https://example.com/blog/post")).toBe(3);
  });

  test("unknown *.ai domains default to blog tier", () => {
    expect(scoreSource("https://cool-startup.ai/about")).toBe(3);
    expect(scoreSource("https://example.io/post")).toBe(3);
  });

  test("returns 5 for empty/invalid URL", () => {
    expect(scoreSource("")).toBe(5);
    expect(scoreSource("not-a-url")).toBe(5);
  });

  test("ignores scheme and strips www. prefix", () => {
    expect(scoreSource("http://www.arxiv.org/abs/x")).toBe(0);
  });
});

describe("tierLabel", () => {
  test("maps all tiers", () => {
    expect(tierLabel(0)).toBe("primary");
    expect(tierLabel(1)).toBe("official");
    expect(tierLabel(2)).toBe("code");
    expect(tierLabel(3)).toBe("blog");
    expect(tierLabel(4)).toBe("community");
    expect(tierLabel(5)).toBe("other");
  });
});

describe("sortByTier", () => {
  test("orders primary < official < code < blog < community", () => {
    const items = [
      { url: "https://reddit.com/r/x" },
      { url: "https://github.com/x/y" },
      { url: "https://arxiv.org/abs/1" },
      { url: "https://medium.com/@x" },
      { url: "https://docs.vllm.ai/" },
    ];
    const sorted = sortByTier(items, (i) => i.url);
    expect(sorted.map((i) => i.url)).toEqual([
      "https://arxiv.org/abs/1",
      "https://docs.vllm.ai/",
      "https://github.com/x/y",
      "https://medium.com/@x",
      "https://reddit.com/r/x",
    ]);
  });

  test("stable on ties within the same tier", () => {
    const items = [
      { url: "https://arxiv.org/abs/1", order: 1 },
      { url: "https://arxiv.org/abs/2", order: 2 },
      { url: "https://arxiv.org/abs/3", order: 3 },
    ];
    const sorted = sortByTier(items, (i) => i.url);
    expect(sorted.map((i) => i.order)).toEqual([1, 2, 3]);
  });

  test("does not mutate input", () => {
    const items = [
      { url: "https://reddit.com/r/x" },
      { url: "https://arxiv.org/abs/1" },
    ];
    const before = [...items];
    sortByTier(items, (i) => i.url);
    expect(items).toEqual(before);
  });
});
