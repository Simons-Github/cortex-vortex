import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Study Room", () => {
  test("shows explanation chat and recommended resources", async ({ page }) => {
    await page.goto("/study/algorithms");
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();

    await expect(page.getByText(/Dynamic programming is memoized recursion/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recommended Resources" })).toBeVisible();
    await expect(page.getByText("Dynamic Programming, intuitively")).toBeVisible();
    await expect(page.getByRole("button", { name: "Simplify explanation" })).toBeVisible();
  });

  test("locks AI features behind sign-in", async ({ page }) => {
    await page.goto("/study/algorithms");
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();
    await waitForHydration(page);

    await expect(
      page.getByText("Sign in to unlock AI-powered explanations and quizzes"),
    ).toBeVisible();

    await page.getByRole("button", { name: "quiz", exact: true }).click();

    await expect(
      page.getByText("Sign in to unlock AI-powered explanations and quizzes"),
    ).toBeVisible();
    await expect(
      page.getByText("A quiz question tailored to your mastery level will appear here."),
    ).toBeVisible();
  });

  test("unknown topic shows a not-found state", async ({ page }) => {
    await page.goto("/study/does-not-exist");

    await expect(page.getByText("Couldn't find that topic.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Knowledge Matrix" })).toBeVisible();
  });
});
