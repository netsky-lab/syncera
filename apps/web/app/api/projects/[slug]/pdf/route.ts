import { chromium } from "playwright";
import { existsSync } from "fs";
import { join } from "path";
import { requireAuth, viewerUidFromRequest } from "@/lib/auth";
import { signSession, COOKIE_NAME } from "@/lib/sessions";
import { canView } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const PROJECTS_DIR = join(process.cwd(), "..", "..", "projects");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // The caller needs to have been auth'd (via session cookie OR API key OR
  // Basic Auth) to get here — requireAuth covers all three for /api/* paths.
  const auth = requireAuth(request);
  if (!auth.ok) return auth.response;

  // Verify project exists AND caller can see it (own it or it's showcase).
  if (!existsSync(join(PROJECTS_DIR, slug, "plan.json"))) {
    return new Response("Project not found", { status: 404 });
  }
  if (!canView(slug, viewerUidFromRequest(request))) {
    return new Response("Project not found", { status: 404 });
  }

  // The print page we render lives at /projects/<slug>/print and sits behind
  // the session-cookie gate in middleware. Hit localhost directly (bypass
  // any reverse proxy) and carry a session cookie so middleware lets
  // chromium through.
  const origin = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const printUrl = `${origin}/projects/${slug}/print`;

  // Prefer forwarding the caller's own session cookie if they have one
  // (browser UI path). For API-key callers, mint a short-lived internal
  // session — middleware only checks signature + expiry, not uid existence,
  // so the "_pdf_internal_" uid passes without touching the user store.
  const incomingCookie = request.headers.get("cookie") ?? "";
  const cookieMatch = incomingCookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
  );
  const sessionToken = cookieMatch?.[1] ?? signSession("_pdf_internal_");

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
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: sessionToken,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    await page.goto(printUrl, { waitUntil: "networkidle", timeout: 30000 });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 8pt; color: #888; width: 100%; padding: 0 16mm;">
          <span>Syncera</span>
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
