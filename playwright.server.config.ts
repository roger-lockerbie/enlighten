import { defineConfig, devices } from '@playwright/test';

/**
 * End to end against the hardware server with its fake hasseb (TEST_PLAN E-modes, E-server). Each test
 * starts `python -m server --demo` on the server's fixed port, so the tests run one at a time, after the
 * preview tests have finished with the same port. The app must be built first.
 */
export default defineConfig({
  testDir: 'e2e/server',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 120_000,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-server' }]]
    : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
