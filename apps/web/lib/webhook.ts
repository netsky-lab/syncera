// Fire-and-forget webhook delivery on run.completed / run.failed.
//
// Webhooks are per-user: User.webhook_url + User.webhook_secret. The run's
// owner (set when they hit POST /api/runs/start) receives the callback.
// PUBLIC_URL (global, in deploy/.env) is the base for artifact links.
//
// Delivery: 3 attempts, exponential backoff (1s / 5s / 30s). Terminal
// failures appended to /app/data/webhook-failures.jsonl for manual replay.

import { createHmac } from "crypto";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname, join } from "path";

export interface WebhookRunPayload {
  event: "run.completed" | "run.failed";
  runId: string;
  slug: string;
  topic: string;
  status: "completed" | "failed";
  exitCode: number | null;
  startedAt: number;
  finishedAt: number;
}

export interface WebhookTarget {
  url: string;
  secret: string;
}

const BACKOFF_MS = [1_000, 5_000, 30_000];

function failuresPath(): string {
  if (process.env.WEBHOOK_FAILURE_LOG) return process.env.WEBHOOK_FAILURE_LOG;
  // Co-locate with the user store so persistence rules stay consistent:
  // both files live in the volume-mounted /app/data in prod (survives
  // rebuilds), and in <cwd>/data in dev. USER_STORE_PATH is the source
  // of truth for that directory.
  if (process.env.USER_STORE_PATH) {
    return join(dirname(process.env.USER_STORE_PATH), "webhook-failures.jsonl");
  }
  return join(process.cwd(), "data", "webhook-failures.jsonl");
}

function publicUrl(): string {
  const p = process.env.PUBLIC_URL ?? "http://localhost:3000";
  return p.replace(/\/+$/, "");
}

function buildPayload(run: WebhookRunPayload) {
  const base = publicUrl();
  return {
    ...run,
    artifacts: {
      report: `${base}/api/projects/${run.slug}/report`,
      facts: `${base}/api/projects/${run.slug}/facts?verified=1`,
      analysis: `${base}/api/projects/${run.slug}/analysis`,
      pdf: `${base}/api/projects/${run.slug}/pdf`,
    },
  };
}

export function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function deliver(
  url: string,
  body: string,
  signature: string,
  eventName: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": signature,
        "X-Event": eventName,
        "User-Agent": "research-lab-webhook/1",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logFailure(payload: any, lastError: string) {
  try {
    const p = failuresPath();
    if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    appendFileSync(
      p,
      JSON.stringify({ ts: Date.now(), lastError, payload }) + "\n",
      { mode: 0o600 }
    );
  } catch {
    // Failures-log itself failing isn't worth crashing the run exit handler.
  }
}

/**
 * Fire a webhook asynchronously against a specific user's configured target.
 * Never throws; resolves after all retries complete. Callers should NOT
 * await in the hot path — use `void fireWebhook(...)`.
 *
 * If target is null or target.url empty, the call is a no-op — the user
 * hasn't configured a webhook.
 */
export async function fireWebhook(
  target: WebhookTarget | null,
  run: WebhookRunPayload
): Promise<void> {
  if (!target?.url) return;
  const payload = buildPayload(run);
  const body = JSON.stringify(payload);
  const signature = signBody(body, target.secret ?? "");

  let lastError = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]!);
    const r = await deliver(target.url, body, signature, run.event);
    if (r.ok) return;
    lastError = r.error ? r.error : `HTTP ${r.status}`;
    console.warn(
      `[webhook] attempt ${attempt + 1} failed (${lastError}) for ${run.slug}`
    );
  }
  console.error(`[webhook] giving up on ${run.slug} after 3 attempts: ${lastError}`);
  logFailure({ url: target.url, payload }, lastError);
}
