import { type Page } from "@playwright/test";

/**
 * SSR HTML is interactive at the DOM level before React hydrates. Native
 * `fill`/`click` then get overwritten or ignored. Wait until a React fiber
 * is attached to a real control.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const el =
      document.querySelector("input") ??
      document.querySelector("button") ??
      document.querySelector("a") ??
      document.body;
    if (!el) return false;
    return Object.keys(el).some(
      (key) =>
        key.startsWith("__reactFiber") ||
        key.startsWith("__reactProps") ||
        key.startsWith("__reactInternalInstance"),
    );
  });
}
