import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { requireAuth } from "@/lib/auth";

const PROJECTS_DIR = join(process.cwd(), "..", "..", "projects");

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  return (
    Math.abs(h).toString(36) +
    "-" +
    url.split("/").pop()?.slice(0, 30).replace(/[^a-z0-9]/gi, "-")
  );
}

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const sourceUrl = url.searchParams.get("url");
  if (!slug || !sourceUrl) {
    return Response.json({ error: "Missing slug or url" }, { status: 400 });
  }

  const hash = hashUrl(sourceUrl);
  const path = join(PROJECTS_DIR, slug, "sources", "content", `${hash}.md`);
  if (!existsSync(path)) {
    return Response.json({ error: "Content not found", hash }, { status: 404 });
  }

  const content = readFileSync(path, "utf-8");
  return Response.json({ content, hash });
}
