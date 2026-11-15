import { defineConfig, devices } from '@playwright/test';
import { HOST, PREVIEW_PORT } from './config/security.ts';

export default defineConfig({
  testDir: 'e2e',
  // The server tests have their own config: they need the port the preview uses.
  testIgnore: 'server/**',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://${HOST}:${String(PREVIEW_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start',
    url: `http://${HOST}:${String(PREVIEW_PORT)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
