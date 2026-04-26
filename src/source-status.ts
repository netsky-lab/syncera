import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Fact } from "./schemas/fact";

export type SourceTrustStatus =
  | "unreviewed"
  | "trusted"
  | "questionable"
  | "ignored";

export interface SourceStatusRecord {
  status: Exclude<SourceTrustStatus, "unreviewed">;
  updated_at?: number;
  updated_by?: string | null;
  note?: string | null;
}

export type SourceStatusMap = Record<string, SourceStatusRecord>;

export function readSourceStatus(projectDir: string): SourceStatusMap {
  const path = join(projectDir, "source_status.json");
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function sourceTrustForUrl(
  statuses: SourceStatusMap,
  url: string | undefined | null
): SourceTrustStatus {
  if (!url) return "unreviewed";
  return statuses[url]?.status ?? "unreviewed";
}

export function sourceTrustForFact(
  statuses: SourceStatusMap,
  fact: Fact
): SourceTrustStatus {
  const refs = fact.references ?? [];
  if (refs.some((ref) => sourceTrustForUrl(statuses, ref.url) === "ignored")) {
    return "ignored";
  }
  if (
    refs.some((ref) => sourceTrustForUrl(statuses, ref.url) === "questionable")
  ) {
    return "questionable";
  }
  if (refs.some((ref) => sourceTrustForUrl(statuses, ref.url) === "trusted")) {
    return "trusted";
  }
  return "unreviewed";
}

export function adjustedConfidenceForTrust(
  confidence: number,
  trust: SourceTrustStatus
): number {
  if (!Number.isFinite(confidence)) confidence = 0.5;
  if (trust === "questionable") return Math.min(confidence * 0.65, 0.55);
  if (trust === "trusted") return Math.min(confidence + 0.05, 1);
  return confidence;
}

export function applySourceTrustToFact(
  statuses: SourceStatusMap,
  fact: Fact
): Fact {
  const trust = sourceTrustForFact(statuses, fact);
  if (trust === "unreviewed" || trust === "ignored") return fact;
  return {
    ...fact,
    confidence: adjustedConfidenceForTrust(fact.confidence, trust),
  };
}
