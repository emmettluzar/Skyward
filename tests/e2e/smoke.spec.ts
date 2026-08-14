import { test, expect } from "@playwright/test";
import {
  conditionsResponse,
  timeBudgetResult,
  EXPECTED_DIRECTIONS_PREFIX,
} from "../fixtures/e2e";

/**
 * Playwright smoke path (.clinerules §6), updated for the two-tab home screen
 * (the verdict tab was removed; "Tonight" data now lives inside both tabs):
 *   grant location → Best Within Reach renders (<3s after data) → isochrone →
 *   open a site → directions link is well-formed → Closest Dark Site tab works.
 *
 * Every `/api/*` response is stubbed with `page.route()` so the route handlers
 * never run and ZERO external network calls occur (the upstream clients only
 * live inside route handlers).
 */
test.describe("Skyward smoke", () => {
  test("Best Within Reach → isochrone → site → directions link → Closest Dark Site", async ({
    page,
    context,
  }) => {
    // Stub the app's API boundary. `/api/conditions` uses query strings, so
    // match by pathname; the others use plain path + query.
    await page.route("**/api/conditions?**", async (route) => {
      await route.fulfill({ json: conditionsResponse });
    });
    await page.route("**/api/candidates", async (route) => {
      await route.fulfill({ json: timeBudgetResult });
    });

    // Grant geolocation with a reason string (prd.md §7): the app requests the
    // user's location for the search. Playwright grants it deterministically.
    await context.grantPermissions(["geolocation"], {
      origin: "http://localhost:3000",
    });
    await context.setGeolocation({ latitude: 40.7128, longitude: -74.006 });

    // 1. Load home; the tonight ribbon + results must render in the default
    //    "Best Within Reach" tab.
    const startedAt = Date.now();
    await page.goto("/");
    await expect(page.getByTestId("timebudget-results")).toBeVisible({
      timeout: 5000,
    });
    expect(Date.now() - startedAt).toBeLessThan(5000);

    // The tonight conditions ribbon is shared across tabs.
    await expect(page.getByText("New Moon")).toBeVisible();

    // 2. Results panel appears with ranked spots (drives shown in minutes,
    //    distances in miles).
    await expect(page.getByText("Stargazer Pull-off")).toBeVisible();
    await expect(page.getByText("40 min").first()).toBeVisible();
    await expect(page.getByText("30.2 mi").first()).toBeVisible();

    // 3. Select a site → directions link is well-formed.
    await page.getByRole("button", { name: /Stargazer Pull-off/ }).first().click();
    const directionsLink = page.getByTestId("directions-link").last();
    await expect(directionsLink).toBeVisible();
    const href = await directionsLink.getAttribute("href");
    expect(href).toMatch(new RegExp(`^${EXPECTED_DIRECTIONS_PREFIX}`));

    // 4. Switch to the Closest Dark Site tab and choose a darkness level.
    await page.getByRole("button", { name: /Closest Dark Site/ }).click();
    await expect(page.getByLabel("Minimum darkness level")).toBeVisible();
    await page.getByLabel("Minimum darkness level").selectOption("4");
  });

  test("custom drive time input accepts a typed value", async ({ page, context }) => {
    await page.route("**/api/conditions?**", async (route) => {
      await route.fulfill({ json: conditionsResponse });
    });
    await page.route("**/api/candidates", async (route) => {
      await route.fulfill({ json: timeBudgetResult });
    });

    await context.grantPermissions(["geolocation"], {
      origin: "http://localhost:3000",
    });
    await context.setGeolocation({ latitude: 40.7128, longitude: -74.006 });

    await page.goto("/");
    const custom = page.getByLabel("Custom drive time in minutes");
    await expect(custom).toBeVisible();
    await custom.fill("75");
    await expect(custom).toHaveValue("75");
  });

  test("red-light mode applies the data-theme attribute", async ({ page }) => {
    await page.route("**/api/conditions?**", async (route) => {
      await route.fulfill({ json: conditionsResponse });
    });
    await page.route("**/api/candidates", async (route) => {
      await route.fulfill({ json: timeBudgetResult });
    });

    await page.goto("/");

    const toggle = page.getByRole("button", { name: /red-light mode/i });
    await toggle.click();

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe("red");

    await toggle.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe("none");
  });
});