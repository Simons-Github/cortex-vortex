import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Knowledge Matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/matrix");
    await expect(page.getByRole("heading", { name: "Knowledge Matrix" })).toBeVisible();
    await waitForHydration(page);
  });

  test("lists demo topics and the locked create-topic card", async ({ page }) => {
    await expect(page.getByText(/\d+ of \d+ topics/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "React 19 & TypeScript" })).toBeVisible();
    await expect(page.getByText("Sign in to create your own custom topics")).toBeVisible();
  });

  test("search filters topics", async ({ page }) => {
    await page.getByPlaceholder("Search topics").fill("React");

    await expect(page.getByRole("heading", { name: "React 19 & TypeScript" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toHaveCount(
      0,
    );
    await expect(page.getByText(/1 of \d+ topics/)).toBeVisible();
  });

  test("shows empty state when nothing matches", async ({ page }) => {
    await page.getByPlaceholder("Search topics").fill("zzzz-no-such-topic");

    await expect(page.getByText("No topics match those filters.")).toBeVisible();
  });

  test("difficulty filter narrows the grid", async ({ page }) => {
    await page.getByRole("combobox").nth(1).selectOption("Beginner");

    await expect(page.getByRole("heading", { name: "Applied Cryptography" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toHaveCount(
      0,
    );
  });

  test("opens a topic in the study room", async ({ page }) => {
    await page.getByRole("heading", { name: "Linear Algebra for ML" }).click();

    await expect(page).toHaveURL(/\/study\/linear-algebra/);
    await expect(page.getByRole("heading", { name: "Linear Algebra for ML" })).toBeVisible();
  });
});
