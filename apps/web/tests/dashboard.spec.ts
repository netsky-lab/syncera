import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("sidebar shows Research Lab brand", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Research Lab").first()).toBeVisible();
    await expect(page.getByText("hypothesis-driven").first()).toBeVisible();
  });

  test("dashboard shows Projects heading and stats row", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText("Hypotheses", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Claims extracted").first()).toBeVisible();
    await expect(page.getByText("Avg confidence").first()).toBeVisible();
  });

  test("project card is visible and clickable", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("a").filter({ hasText: "KV-cache" }).first();
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/projects\//);
    await expect(page.url()).toContain("/projects/");
  });
});

test.describe("Project Detail", () => {
  const projectUrl = "/projects/how-to-compress-kv-cache-to-fit-gemma-model-into-4-gpu-slots-on-rtx-5090-using-t";

  test("header shows topic and badges", async ({ page }) => {
    await page.goto(projectUrl);
    await expect(page.locator("h1").first()).toContainText("KV-cache");
    await expect(page.getByText("hypotheses", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("claims", { exact: false }).first()).toBeVisible();
  });

  test("all 6 tabs visible", async ({ page }) => {
    await page.goto(projectUrl);
    for (const tab of ["Report", "Hypotheses", "Claims", "Sources", "Plan", "Critic"]) {
      await expect(page.locator('[role="tab"]').filter({ hasText: tab }).first()).toBeVisible();
    }
  });

  test("Report tab renders markdown content", async ({ page }) => {
    await page.goto(projectUrl);
    await expect(page.getByRole("heading", { name: /Research Report/i }).first()).toBeVisible();
  });

  test("Hypotheses tab shows hypothesis cards with criteria", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator('[role="tab"]').filter({ hasText: "Hypotheses" }).click();
    await expect(page.getByText("H1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("H2", { exact: true }).first()).toBeVisible();
  });

  test("Claims tab shows extracted claims", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator('[role="tab"]').filter({ hasText: "Claims" }).click();
    await expect(page.getByText("C1", { exact: true }).first()).toBeVisible();
  });

  test("Sources tab shows search + filters + list", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator('[role="tab"]').filter({ hasText: "Sources" }).click();
    await expect(
      page.getByPlaceholder(/Search sources/i)
    ).toBeVisible();
    await expect(page.getByText(/Provider:/i).first()).toBeVisible();
    await expect(page.getByText(/Task:/i).first()).toBeVisible();
  });

  test("Plan tab shows tasks and budget", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator('[role="tab"]').filter({ hasText: "Plan" }).click();
    await expect(page.getByText("T1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Budget", { exact: false }).first()).toBeVisible();
  });

  test("Critic tab shows overall confidence", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator('[role="tab"]').filter({ hasText: "Critic" }).click();
    await expect(page.getByText(/Overall confidence/i).first()).toBeVisible();
  });

  test("breadcrumb navigation back to projects", async ({ page }) => {
    await page.goto(projectUrl);
    await page.locator("nav a").filter({ hasText: "Projects" }).first().click();
    await page.waitForURL("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });
});
