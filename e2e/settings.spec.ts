import { expect, test } from "@playwright/test";

test.describe("Settings", () => {
  test("shows Gemini status and coming-soon preference controls", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gemini API Key", exact: true })).toBeVisible();
    await expect(
      page.getByText(/Key configured on the server|No key configured on the server/),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "Your Gemini API key", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Sign in to add your own Gemini API key.")).toBeVisible();
    await expect(page.getByLabel("Your Gemini API key")).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByText("Coming soon")).toBeVisible();
    await expect(page.getByPlaceholder("Your name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Socratic" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Decay reminders" })).toBeDisabled();
  });
});
