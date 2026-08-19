import { expect, test } from "@playwright/test";

test.describe("Not found", () => {
  test("unknown route shows 404 and can return home", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");

    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    await page.getByRole("link", { name: "Go home" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: /Knowledge fades quietly/ })).toBeVisible();
  });
});
