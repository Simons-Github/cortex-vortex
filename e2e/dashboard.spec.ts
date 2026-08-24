import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Knowledge Decay")).toBeVisible();
  });

  test("shows decay readout, stats, and local-storage badge", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /\d+%/ })).toBeVisible();
    await expect(page.getByText("Active Topics")).toBeVisible();
    await expect(page.getByText("Mastery Retained")).toBeVisible();
    await expect(page.getByText("Next Review")).toBeVisible();
    await expect(page.getByText("Using local storage")).toBeVisible();
    await expect(page.getByText(/Day Streak/)).toBeVisible();
  });

  test("Start Quiz opens the quiz tab", async ({ page }) => {
    await page.getByRole("link", { name: "Start Quiz" }).click();

    await expect(page).toHaveURL(/\/study\//);
    await expect(page).toHaveURL(/tab=quiz/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await waitForHydration(page);
    await expect(
      page.getByText("Sign in to unlock AI-powered explanations and quizzes"),
    ).toBeVisible();
    await expect(
      page.getByText("A quiz question tailored to your mastery level will appear here."),
    ).toBeVisible();
    await expect(page.getByText("Question 1 of 5")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry missed" })).toHaveCount(0);
  });

  test("Knowledge Matrix link opens the matrix", async ({ page }) => {
    await page.getByRole("main").getByRole("link", { name: "Knowledge Matrix" }).click();

    await expect(page).toHaveURL(/\/matrix/);
    await expect(page.getByRole("heading", { name: "Knowledge Matrix" })).toBeVisible();
  });

  test("Exit demo returns to landing", async ({ page }) => {
    await page.getByRole("link", { name: "Exit demo" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: /Knowledge fades quietly/ })).toBeVisible();
  });

  test("settings icon in the nav opens settings", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
