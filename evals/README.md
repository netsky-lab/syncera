# Eval Harness

Scoring framework for 10 research topics that span LLM inference infra, alignment, interpretability, and domain-science topics. Each topic has an `expected_concepts` list (canonical terms that should appear in the report if the pipeline actually understood the field) and `expected_contradictions` (known disagreements in the literature the pipeline should surface).

## Metrics

- **Coverage %** — fraction of `expected_concepts` that appear in `REPORT.md` (case-insensitive substring match). Low coverage = the pipeline either missed core terminology or wandered off-domain.
- **Verified / Total** — facts that passed all three verifier layers (URL liveness → quote substring → LLM adversarial review) over all facts extracted. Reported verbatim from `verification.json`.
- **Hallucination %** — `(total - verified) / total`. The fraction of extracted facts the verifier rejected. These never reach the final report; this number is an honest measure of how aggressive the verifier is relative to the extractor's output.
- **Contradictions surfaced / expected** — cross-question tensions emitted by the analyzer vs the count of `expected_contradictions` actually detected (by distinctive phrase probe) in the report. Measures whether the pipeline is just listing facts or actually reasoning over them.
- **Sources** — total distinct URLs harvested across all subquestions.

## Running

```sh
# Score all topics (reads projects/<slug>/ for each topic's slugified URL)
bun run evals/score.ts

# One topic
bun run evals/score.ts --topic eval-01-kv-cache

# README-friendly markdown table
bun run evals/score.ts --md
```

The scorer is read-only. To generate fresh data, kick off the topic via `POST /api/runs/start` or `bun run src/run.ts "<topic>"` first.

## Topic selection rationale

Ten topics chosen to stress-test three failure modes:

1. **Technical depth / specialized terminology** — KV-cache quantization, sparse autoencoders, speculative decoding. Most likely to fail via coverage-gap (pipeline misses jargon).
2. **Contested literature** — RLHF vs DPO stability, LoRA vs DoRA universality, needle-in-haystack vs downstream tasks. Stress-tests the `contradictions_surfaced` metric.
3. **Domain drift risk** — cosmetic sunscreen photostability in a product historically exposed to cosmetics data; battery aging. Validates that domain-keyword matches don't drift to unrelated fields.

## Why these metrics, not citation-accuracy LLM-judge

The hallucination rate already captures claim-quality at the verifier layer — any fact that made it through means its quote *actually appears* in the scraped source. An LLM-judge adds subjectivity and cost without adding signal the verifier doesn't already provide. Coverage + hallucination + contradiction-surfacing covers completeness, correctness, and reasoning depth respectively.

## Current results

Populated incrementally as pipeline runs finish. See `bun run evals/score.ts --md`.
