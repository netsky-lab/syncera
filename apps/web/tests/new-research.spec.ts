import { test, expect } from "@playwright/test";

test.describe("New research form", () => {
  test("shows expandable prompt on dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText(/Start new research/i).first()
    ).toBeVisible();
  });

  test("expands to form when clicked", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Start new research/i).first().click();
    await expect(page.locator("textarea")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Start research/i })
    ).toBeVisible();
  });

  test("Start button disabled when topic too short", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Start new research/i).first().click();
    await page.locator("textarea").fill("short");
    const startBtn = page.getByRole("button", { name: /Start research/i });
    await expect(startBtn).toBeDisabled();
  });

  test("Start button enables with a valid topic", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Start new research/i).first().click();
    await page.locator("textarea").fill("valid topic for deep research testing");
    const startBtn = page.getByRole("button", { name: /Start research/i });
    await expect(startBtn).toBeEnabled();
  });
});
