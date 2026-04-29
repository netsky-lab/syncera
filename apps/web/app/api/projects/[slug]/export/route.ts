import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { zipSync, strToU8 } from "fflate";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { canView } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const TEXT_EXT = new Set([".json", ".jsonl", ".md", ".txt", ".csv", ".yml", ".yaml"]);

function projectsDir(): string {
  return join(/*turbopackIgnore: true*/ process.cwd(), "..", "..", "projects");
}

function safeName(slug: string): string {
  return slug.replace(/[^a-z0-9-_]/gi, "-").slice(0, 80) || "syncera-export";
}

function extension(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx).toLowerCase() : "";
}

function shouldInclude(rel: string, includeRawContent: boolean): boolean {
  if (rel === ".owner") return false;
  if (rel.includes("/.private/")) return false;
  if (!includeRawContent && rel.startsWith("sources/content/")) return false;
  return true;
}

function walkProject(root: string, includeRawContent: boolean): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).replaceAll("\\", "/");
      if (!shouldInclude(rel, includeRawContent)) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = statSync(abs).size;
      if (size > 25 * 1024 * 1024) continue;
      const ext = extension(rel);
      files[rel] = TEXT_EXT.has(ext) ? strToU8(readFileSync(abs, "utf-8")) : readFileSync(abs);
    }
  }
  return files;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  const { slug } = await params;
  if (!canView(slug, viewerUidFromRequest(request))) {
    return new Response("Project not found", { status: 404 });
  }

  const root = join(/*turbopackIgnore: true*/ projectsDir(), slug);
  if (!existsSync(join(root, "plan.json"))) {
    return new Response("Project not found", { status: 404 });
  }

  const url = new URL(request.url);
  const includeRawContent = url.searchParams.get("include_content") === "1";
  const files = walkProject(root, includeRawContent);
  files["EXPORT_MANIFEST.json"] = strToU8(
    JSON.stringify(
      {
        product: "Syncera",
        slug,
        exported_at: new Date().toISOString(),
        include_raw_content: includeRawContent,
        file_count: Object.keys(files).length,
      },
      null,
      2
    )
  );

  const zip = zipSync(files, { level: 6 });
  const name = `${safeName(slug)}-syncera-audit.zip`;
  return new Response(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-cache",
    },
  });
}
