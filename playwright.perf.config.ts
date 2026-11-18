/**
 * Perf-frame (TEST_PLAN section 9): run by hand with `pnpm perf:frame`. A headed browser, because
 * the headless one draws in software and would say nothing about the GPU's frame time.
 */
import { defineConfig, devices } from '@playwright/test';
import { HOST, PREVIEW_PORT } from './config/security.ts';

export default defineConfig({
  testDir: 'e2e/perf',
  timeout: 120_000,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results-perf',
  use: {
    baseURL: `http://${HOST}:${String(PREVIEW_PORT)}`,
    headless: false,
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `http://${HOST}:${String(PREVIEW_PORT)}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
