// Transactional email sender via Resend. Used by signup-confirm and
// password-reset flows. No queue / no retry — if Resend 5xx's, the
// caller handles it (the user re-submits the form).
//
// Env: RESEND_API_KEY, RESEND_FROM (e.g. "Syncera <no-reply@syncera.tech>"),
// RESEND_REPLY_TO (optional).

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: EmailOptions): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const from = process.env.RESEND_FROM ?? "Syncera <no-reply@syncera.tech>";
  const body: Record<string, any> = {
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.text) body.text = opts.text;
  if (process.env.RESEND_REPLY_TO) {
    body.reply_to = process.env.RESEND_REPLY_TO;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        error: `Resend ${r.status}: ${data?.message ?? data?.error ?? "unknown"}`,
      };
    }
    return { ok: true, id: data.id };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// Base URL for email links. Prefers APP_BASE_URL (set in deploy/.env
// once we have a custom domain). Falls back to http://<host>:3000 for
// dev/IP deployments.
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://156.67.28.41:3000").replace(
    /\/+$/,
    ""
  );
}

// Minimal HTML email template — no external CSS, inline-safe colors,
// renders cleanly in Gmail/Apple Mail/Outlook.
export function emailShell(opts: {
  heading: string;
  body: string; // HTML
  cta?: { label: string; href: string };
  footer?: string;
}): string {
  const { heading, body, cta, footer } = opts;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:#0c0c0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#ededf0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 20px;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#111113;border:1px solid #1f1f24;border-radius:14px;overflow:hidden;">
          <tr><td style="padding:28px 32px;">
            <div style="font-family:monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#e8a584;margin-bottom:16px;">Syncera</div>
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:500;letter-spacing:-0.02em;color:#ededf0;line-height:1.25;">${heading}</h1>
            <div style="font-size:14px;line-height:1.65;color:#a1a1aa;">${body}</div>
            ${
              cta
                ? `<div style="margin:24px 0 8px;"><a href="${cta.href}" style="display:inline-block;padding:11px 20px;background:#e8a584;color:#0c0c0d;font-weight:600;font-size:14px;border-radius:9px;text-decoration:none;">${cta.label}</a></div>
                   <div style="margin-top:16px;font-size:11px;color:#6b6b75;">Or paste this link into your browser:<br><span style="font-family:monospace;color:#a1a1aa;word-break:break-all;">${cta.href}</span></div>`
                : ""
            }
          </td></tr>
        </table>
        ${
          footer
            ? `<div style="margin-top:20px;font-size:11px;color:#6b6b75;font-family:monospace;">${footer}</div>`
            : ""
        }
      </td></tr>
    </table>
  </body>
</html>`;
}
