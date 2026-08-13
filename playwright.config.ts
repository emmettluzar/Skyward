import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke config (.clinerules §6). The smoke test stubs every `/api/*`
 * boundary with `page.route()`, so it needs a running Next.js server and zero
 * external network access. CI should run `pnpm build && pnpm exec playwright test`
 * after `pnpm dev`/`pnpm start` is up, or use Playwright's `webServer`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Desktop Chrome: geolocation is controlled via `permissions` + `geolocation`
        // in the spec, so most device defaults are left intact.
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});