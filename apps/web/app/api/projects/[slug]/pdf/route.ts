import { chromium } from "playwright";
import { existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const PROJECTS_DIR = join(process.cwd(), "..", "..", "projects");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Verify project exists
  if (!existsSync(join(PROJECTS_DIR, slug, "plan.json"))) {
    return new Response("Project not found", { status: 404 });
  }

  // When the pipeline is behind BASIC_AUTH, the print page we're about
  // to screenshot lives behind the same gate. Hit localhost (bypasses
  // reverse-proxy if any) and forward the Authorization header so the
  // middleware lets the internal chromium request through.
  const origin = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const printUrl = `${origin}/projects/${slug}/print`;
  const authHeader = request.headers.get("authorization");
  const pass = process.env.BASIC_AUTH_PASS;
  const user = process.env.BASIC_AUTH_USER ?? "research";

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      // In production containers we install system chromium via apk instead
      // of downloading Playwright's bundled build. Fall back to Playwright's
      // default when this env is unset (dev).
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    const context = await browser.newContext({
      // Forward the caller's Authorization if present, otherwise synthesize
      // one from the server-side env (for cron-style re-generation).
      extraHTTPHeaders:
        authHeader || pass
          ? {
              authorization:
                authHeader ??
                "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
            }
          : {},
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    await page.goto(printUrl, { waitUntil: "networkidle", timeout: 30000 });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 8pt; color: #888; width: 100%; padding: 0 16mm;">
          <span>Research Lab</span>
        </div>
      `,
      footerTemplate: `
        <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 8pt; color: #888; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;">
          <span>${slug.slice(0, 60)}</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `,
      margin: {
        top: "22mm",
        bottom: "22mm",
        left: "16mm",
        right: "16mm",
      },
    });

    await browser.close();

    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}.pdf"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    console.error("[pdf] Error:", err);
    return new Response(
      `PDF generation failed: ${err?.message ?? String(err)}`,
      { status: 500 }
    );
  }
}
