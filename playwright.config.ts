import { defineConfig, devices } from '@playwright/test';
import { HOST, PREVIEW_PORT } from './config/security.ts';

export default defineConfig({
  testDir: 'e2e',
  // The server tests have their own config: they need the port the preview uses.
  testIgnore: 'server/**',
  fullyParallel: true,
  // The simulated bus runs at DALI speed, so the scan at start takes about 15 s.
  timeout: 90_000,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://${HOST}:${String(PREVIEW_PORT)}`,
    trace: 'retain-on-failure',
  },
  // The app is laid out for a laptop at 1440 by 900 and up (docs/UI.md section 2).
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: `http://${HOST}:${String(PREVIEW_PORT)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
