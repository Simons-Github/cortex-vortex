import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Landing", () => {
  test("shows the hero and demo CTA", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Knowledge fades quietly/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore demo" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("opens the sign-in dialog and can switch to sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Knowledge fades quietly/ })).toBeVisible();
    await waitForHydration(page);
    await page.getByRole("main").getByRole("button", { name: "Sign in" }).click();

    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(dialog.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(dialog.getByPlaceholder("Password")).toBeVisible();

    await dialog.getByRole("button", { name: "Need an account? Sign up" }).click();
    await expect(page.getByRole("dialog", { name: "Create an account" })).toBeVisible();
  });

  test("Explore demo opens the dashboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Explore demo" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Knowledge Decay")).toBeVisible();
  });
});
