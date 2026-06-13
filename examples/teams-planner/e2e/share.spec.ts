import { test, expect } from "@playwright/test";

/**
 * The Share dialog: both link kinds side by side — the quick serverless
 * `#t=` link and the patron-gated server short link. No live minting against
 * the sync worker here; the unauthenticated path must route to the
 * entitlement gate.
 */
test("share dialog offers the quick link and the gated short link", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Share", exact: true }).click();

  const dialog = page.locator("dialog", { hasText: "Share plan" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Quick link")).toBeVisible();
  await expect(dialog.getByText("Short link · patron")).toBeVisible();

  // Quick link copies a #t= URL.
  await dialog.getByRole("button", { name: "Copy link" }).click();
  await expect(dialog.getByRole("button", { name: "Copied!" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("#t=");

  // Unauthenticated mint routes to the entitlement gate instead of the API.
  await dialog.getByRole("button", { name: /Mint short link/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Patron feature" })).toBeVisible();
});
