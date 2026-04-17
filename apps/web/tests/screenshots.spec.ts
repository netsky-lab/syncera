import { test } from "@playwright/test";

test("dashboard screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/dashboard.png", fullPage: true });
});

test("dashboard with new-research expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.getByText(/Start new research/i).first().click();
  await page.locator("textarea").fill(
    "How does 4-bit KV-cache quantization affect Gemma 27B perplexity vs throughput on RTX 5090"
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: "screenshots/new-research-form.png", fullPage: true });
});

test("project detail — report tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "screenshots/project-report.png", fullPage: true });
});

test("project detail — hypotheses tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.locator('[role="tab"]').filter({ hasText: "Hypotheses" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/project-hypotheses.png", fullPage: true });
});

test("project detail — claims tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.locator('[role="tab"]').filter({ hasText: "Claims" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/project-claims.png", fullPage: true });
});

test("project detail — sources tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.locator('[role="tab"]').filter({ hasText: "Sources" }).click();
  await page.waitForTimeout(300);
  // Viewport only — 140 sources would make fullPage a giant column
  await page.screenshot({ path: "screenshots/project-sources.png", fullPage: false });
});

test("project detail — source content expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.locator('[role="tab"]').filter({ hasText: "Sources" }).click();
  await page.waitForTimeout(300);
  // Click first source to expand
  const firstSource = page.locator("button").filter({ hasText: /arxiv|search|google/i }).first();
  await firstSource.click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/project-source-expanded.png", fullPage: false });
});

test("project detail — critic tab", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t");
  await page.locator('[role="tab"]').filter({ hasText: "Critic" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/project-critic.png", fullPage: true });
});
