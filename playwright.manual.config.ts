/**
 * The manual's screenshots (ADR 0024): `pnpm manual:shots` drives the app through the guide's steps
 * and writes the pictures to `docs/manual/img/`. Run by hand on the reference laptop, not in CI:
 * fonts render differently on Linux, so a CI run would rewrite every picture.
 */
import { defineConfig, devices } from '@playwright/test';
import { HOST, PREVIEW_PORT } from './config/security.ts';

export default defineConfig({
  testDir: 'e2e/manual',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results-manual',
  use: { baseURL: `http://${HOST}:${String(PREVIEW_PORT)}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
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
