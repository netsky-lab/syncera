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

  const origin = new URL(request.url).origin;
  const printUrl = `${origin}/projects/${slug}/print`;

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
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
