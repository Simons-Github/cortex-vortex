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
    await expect(page.getByRole("button", { name: "Quiz me on the weak spots" })).toBeVisible();
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
    await expect(page.getByText("Question 1 of 5")).toBeVisible();
    await expect(page.getByText("+0% Mastery this round")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry missed" })).toHaveCount(0);
    await expect(page.getByText("Round complete")).toHaveCount(0);
  });

  test("tab=quiz search opens the quiz panel", async ({ page }) => {
    await page.goto("/study/algorithms?tab=quiz");
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();
    await waitForHydration(page);

    await expect(
      page.getByText("A quiz question tailored to your mastery level will appear here."),
    ).toBeVisible();
    await expect(page.getByText("Question 1 of 5")).toBeVisible();
    await expect(
      page.getByText("Sign in to unlock AI-powered explanations and quizzes"),
    ).toBeVisible();
  });

  test("does not keep a first-question answer in the study URL", async ({ page }) => {
    await page.goto("/matrix");
    await waitForHydration(page);
    await page.evaluate(() => {
      sessionStorage.setItem(
        "cortex-vortex:first-question:algorithms",
        JSON.stringify({
          question: {
            question: "Secret stem that must not leak",
            options: ["A", "B", "C", "D"],
            correctOptionIndex: 2,
            explanation: "The answer is C.",
          },
        }),
      );
    });

    await page.goto("/study/algorithms?tab=quiz&firstQuestionFallback=true");
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();
    await waitForHydration(page);

    await expect(page).toHaveURL(/\/study\/algorithms\?tab=quiz$/);
    const leftover = await page.evaluate(() =>
      sessionStorage.getItem("cortex-vortex:first-question:algorithms"),
    );
    expect(leftover).toBeNull();
  });

  test("unknown topic shows a not-found state", async ({ page }) => {
    await page.goto("/study/does-not-exist");

    await expect(page.getByText("Couldn't find that topic.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Knowledge Matrix" })).toBeVisible();
  });

  test("daily quota lock does not break the signed-out study or matrix path", async ({ page }) => {
    await page.goto("/matrix");
    await waitForHydration(page);
    await page.evaluate(() => {
      localStorage.setItem(
        "cortex-vortex:quota-reset-at:daily",
        String(Date.now() + 60 * 60 * 1000),
      );
    });

    await page.goto("/study/algorithms?tab=quiz");
    await expect(page.getByRole("heading", { name: "Algorithms & Data Structures" })).toBeVisible();
    await waitForHydration(page);
    await expect(
      page.getByText("Sign in to unlock AI-powered explanations and quizzes"),
    ).toBeVisible();
    await expect(page.getByText("You've used up today's AI quota.")).toHaveCount(0);

    await page.goto("/matrix");
    await expect(page.getByRole("heading", { name: "Knowledge Matrix" })).toBeVisible();
    await waitForHydration(page);
    await expect(page.getByText("Sign in to create your own custom topics")).toBeVisible();
  });
});
