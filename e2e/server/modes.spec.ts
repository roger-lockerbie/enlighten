/**
 * E-modes: Simulator, Hardware and Both against the server with its fake hasseb. Connect, the operator
 * question, inventory, the safety profile, a divergence when the fake differs, the fallback when the
 * hasseb or the server goes away, commissioning, the hardware check, and panic reaching the bus.
 */
import { expect, test } from '@playwright/test';
import { watch } from '../harness.ts';
import { connect, goTo } from './connect.ts';
import { startServer, type Server } from './fixture.ts';

let server: Server | undefined;

test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

test('connects, scans, writes the safety profile and shows what each driver reports', async ({
  page,
}) => {
  server = await startServer();
  const w = await watch(page);
  const response = await page.goto(server.url);
  // The token leaves the address bar at once.
  await expect(page).toHaveURL('http://127.0.0.1:47821/');
  // The server sends the full header set, and the worker loads under the one Trusted Types policy.
  const h = response?.headers() ?? {};
  expect(h['content-security-policy']).toMatch(/trusted-types enlighten-worker(;|$)/);
  expect(h['cross-origin-embedder-policy']).toBe('require-corp');
  expect(h['x-frame-options']).toBe('DENY');
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Playground', level: 1 })).toBeVisible();
  await expect(page.getByTestId('connection')).toHaveText('Simulator');

  await connect(page, 'Hardware');
  const row0 = page.getByTestId('device-0');
  await expect(row0).toContainText('Colour temperature');
  await expect(page.getByTestId('device-1')).toContainText('RGBWAF channels');
  await expect(page.getByTestId('device-1')).toContainText(
    '0: red, 1: green, 2: blue, 3: white, 4: amber',
  );
  // The profile went to the real bus: MAX LEVEL, POWER ON LEVEL and SYSTEM FAILURE LEVEL, read back.
  const bus = server.bus();
  for (const c of [
    'general.SetMaxLevel',
    'general.SetPowerOnLevel',
    'general.SetSystemFailureLevel',
    'general.QueryMaxLevel',
  ])
    expect(bus).toContain(c);
  // The scan and the profile send no level.
  expect(bus.filter((c) => c === 'general.DAPC' || c === 'colour.Activate')).toEqual([]);
  expect(await w.problems()).toEqual([]);
});

test('logs a divergence in Both when the fake differs from the simulator', async ({ page }) => {
  server = await startServer(['--demo-quirk', 'level-offset']);
  const w = await watch(page);
  await page.goto(server.url);
  await connect(page, 'Both');
  await goTo(page, 'Bus monitor');
  await page.getByRole('button', { name: 'Divergence log' }).click();
  await expect(page.getByTestId('divergence-empty')).toBeVisible();
  // This hardware check step sets a level, so the fake's offset answer shows.
  await goTo(page, 'Devices');
  const step = page.getByTestId('check-p4-max-below-level');
  await step.getByRole('checkbox').check();
  await step.getByRole('button', { name: 'Run' }).click();
  await expect(step.getByTestId('check-status')).toHaveText('done', { timeout: 60_000 });
  await goTo(page, 'Bus monitor');
  await page.getByRole('button', { name: 'Divergence log' }).click();
  const log = page.getByTestId('divergences');
  await expect(log).toContainText('QUERY_ACTUAL_LEVEL');
  await expect(log.locator('tbody tr').first()).toContainText('A0');
  expect(await w.problems()).toEqual([]);
});

test('falls back to disconnected when the hasseb or the server goes away', async ({ page }) => {
  server = await startServer();
  const w = await watch(page);
  await page.goto(server.url);
  await connect(page, 'Hardware');
  server.type('unplug');
  await expect(page.getByTestId('connection')).toHaveText('Hardware: no hasseb', {
    timeout: 10_000,
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Nothing is sent to the simulator in its place' }),
  ).toBeVisible();
  server.type('plug');
  await expect(page.getByTestId('connection')).toHaveText(/Hardware: ready/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Yes, I can see them' }).click();
  await server.stop();
  server = undefined;
  await expect(page.getByTestId('connection')).toHaveText('Hardware: disconnected', {
    timeout: 10_000,
  });
  // The target stays on Hardware: nothing moves to the simulator by itself.
  await expect(page.getByRole('button', { name: 'Hardware', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await w.problems()).toEqual([]);
});

test('commissions a driver without a short address and verifies it', async ({ page }) => {
  server = await startServer(['--demo-unaddressed']);
  const w = await watch(page);
  await page.goto(server.url);
  await connect(page, 'Hardware');
  await page.getByRole('button', { name: 'Commission' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'reset unlock' })).toBeVisible();
  await page.getByTestId('unlock-name').selectOption('reset');
  await page.getByTestId('unlock-typed').fill('reset');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByTestId('unlocks')).toHaveText('Unlocks: reset');
  await page.getByTestId('commission-typed').fill('commission');
  await page.getByRole('button', { name: 'Commission' }).click();
  await expect(page.getByTestId('commission-result')).toHaveText(/Assigned A2\./, {
    timeout: 90_000,
  });
  await expect(page.getByTestId('device-2').getByTestId('profile-status')).toHaveText('verified', {
    timeout: 60_000,
  });
  expect(server.bus()).toContain('general.ProgramShortAddress');
  expect(await w.problems()).toEqual([]);
});

test('runs and records hardware check steps, and shows the results as JSON', async ({ page }) => {
  server = await startServer();
  const w = await watch(page);
  await page.goto(server.url);
  await connect(page, 'Hardware');
  const limits = page.getByTestId('check-p2-limits');
  await limits.getByRole('button', { name: 'Run' }).click();
  await expect(limits.getByTestId('check-status')).toHaveText('done', { timeout: 30_000 });
  const unplug = page.getByTestId('check-p3-unplug');
  await unplug.getByRole('textbox').fill('The app showed the fault.');
  await unplug.getByRole('button', { name: 'Record' }).click();
  await expect(unplug.getByTestId('check-status')).toHaveText('recorded');
  await page.getByRole('button', { name: 'Show results' }).click();
  const report = page.getByTestId('check-report');
  await expect(report).toHaveValue(/"id": "p2-limits"/);
  await expect(report).toHaveValue(/"max": 220/);
  await expect(report).toHaveValue(/The app showed the fault\./);
  await expect(page.getByRole('link', { name: 'Save as a file' })).toHaveAttribute(
    'download',
    'hardware-check.json',
  );
  expect(await w.problems()).toEqual([]);
});

test('panic by button and by Escape twice reaches the bus as TERMINATE then OFF, and latches', async ({
  page,
}) => {
  server = await startServer();
  const w = await watch(page);
  await page.goto(server.url);
  await connect(page, 'Hardware');
  const before = server.lines.length;
  await page.getByRole('button', { name: 'Panic' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toBeVisible();
  await server.waitFor(() => server?.bus(before).includes('general.Off') ?? false);
  const after = server.bus(before);
  expect(after.slice(0, 2)).toEqual(['general.Terminate', 'general.Off']);
  // Latched: a scan is refused until Resume.
  await page.getByRole('button', { name: 'Scan again' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toHaveCount(0);
  const again = server.lines.length;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toBeVisible();
  await server.waitFor(() => server?.bus(again).includes('general.Off') ?? false);
  expect(await w.problems()).toEqual([]);
});
