/**
 * V-ui (TEST_PLAN section 8): a screenshot of each page at 1440 by 900. Run by hand on the reference
 * laptop with `pnpm e2e:visual`, not in CI: fonts render differently on Linux, so one set of
 * baselines cannot serve both. `pnpm e2e:visual --update-snapshots` writes new baselines.
 */
import { defineConfig, devices } from '@playwright/test';
import { HOST, PREVIEW_PORT } from './config/security.ts';

export default defineConfig({
  testDir: 'e2e/visual',
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-visual',
  use: { baseURL: `http://${HOST}:${String(PREVIEW_PORT)}` },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `http://${HOST}:${String(PREVIEW_PORT)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
