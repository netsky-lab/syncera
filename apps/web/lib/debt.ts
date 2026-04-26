import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type DebtStatus = "open" | "running" | "resolved" | "dismissed";

export interface DebtStatusRecord {
  status: DebtStatus;
  updated_at: number;
  updated_by: string | null;
  branch_slug?: string | null;
  note?: string | null;
}

function projectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  const cwdProjects = join(process.cwd(), "projects");
  if (existsSync(cwdProjects)) return cwdProjects;
  return join(process.cwd(), "..", "..", "projects");
}

function statusPath(slug: string): string {
  return join(projectsDir(), slug, "debt_status.json");
}

export function readDebtStatus(slug: string): Record<string, DebtStatusRecord> {
  const path = statusPath(slug);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function setDebtStatus(
  slug: string,
  debtId: string,
  record: Partial<DebtStatusRecord> & { status: DebtStatus },
  updatedBy: string | null
): Record<string, DebtStatusRecord> {
  const path = statusPath(slug);
  const current = readDebtStatus(slug);
  current[debtId] = {
    ...current[debtId],
    ...record,
    updated_at: Date.now(),
    updated_by: updatedBy,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(current, null, 2), { mode: 0o600 });
  return current;
}
