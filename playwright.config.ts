// ─────────────────────────────────────────────────────────────────────────────
// playwright.config.ts  –  Updated to include FlakyReporter
// ─────────────────────────────────────────────────────────────────────────────
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only – retries are required for flaky detection to work! */
  retries: process.env.CI ? 2 : 1,

  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,

  /**
   * Reporters:
   *  - 'html'          – the default visual report
   *  - FlakyReporter   – writes flaky-results/flaky-store.json after each run
   *
   * FlakyReporter options:
   *   storeDir       – where to persist flaky-store.json (default: ./flaky-results)
   *   pruneAfterDays – discard records older than N days (default: 90)
   *   printSummary   – print a flaky summary to stdout at the end (default: true)
   */
  reporter: [
    ['html'],
    [
      './src/flaky/FlakyReporter',
      {
        storeDir: './flaky-results',
        pruneAfterDays: 90,
        printSummary: true,
      },
    ],
  ],

  /* Shared settings for all projects. */
  use: {
    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});