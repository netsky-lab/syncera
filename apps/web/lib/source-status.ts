import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type SourceTrustStatus = "unreviewed" | "trusted" | "questionable" | "ignored";

export interface SourceStatusRecord {
  status: Exclude<SourceTrustStatus, "unreviewed">;
  updated_at: number;
  updated_by: string | null;
  note?: string | null;
}

function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
}

function statusPath(slug: string): string {
  return join(projectsDir(), slug, "source_status.json");
}

export function readSourceStatus(slug: string): Record<string, SourceStatusRecord> {
  const path = statusPath(slug);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function setSourceStatus(
  slug: string,
  url: string,
  record: Partial<SourceStatusRecord> & {
    status: Exclude<SourceTrustStatus, "unreviewed">;
  },
  updatedBy: string | null
): Record<string, SourceStatusRecord> {
  const path = statusPath(slug);
  const current = readSourceStatus(slug);
  current[url] = {
    ...current[url],
    ...record,
    updated_at: Date.now(),
    updated_by: updatedBy,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(current, null, 2), { mode: 0o600 });
  return current;
}
