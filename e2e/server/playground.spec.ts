/**
 * E-playground and E-ceiling against the server with its fake hasseb, in Hardware and Both: the
 * controls reach the bus, lowering the ceiling turns lit gear down before the profile work
 * (S4-D6), and a driver whose MAX LEVEL does not take is shown as a mismatch (SPEC R6.4).
 */
import { expect, test, type Page } from '@playwright/test';
import { watch } from '../harness.ts';
import { connect, goTo } from './connect.ts';
import { startServer, type Server } from './fixture.ts';

let server: Server | undefined;

test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function enter(page: Page, testid: string, value: string): Promise<void> {
  const f = page.getByTestId(testid).locator('input');
  await f.fill(value);
  await f.press('Enter');
}

async function playground(page: Page): Promise<void> {
  await goTo(page, 'Playground');
  await expect(page.getByTestId('panel-0')).toContainText('Presents as colour temperature');
  await expect(page.getByTestId('panel-1')).toContainText('Presents as RGBWAF');
}

test('in Hardware, level, colour temperature, colour and fade reach the bus', async ({ page }) => {
  server = await startServer();
  const s = server;
  const w = await watch(page);
  await page.goto(s.url);
  await connect(page, 'Hardware');
  await playground(page);
  await expect(page.getByTestId('bench-preview')).toContainText('prediction');

  let from = s.lines.length;
  await enter(page, 'level-0-right', '170');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 170.', {
    timeout: 15_000,
  });
  await s.waitFor(() => s.bus(from).includes('general.DAPC'));

  from = s.lines.length;
  await enter(page, 'tc-0-left', '3000');
  await expect(page.getByTestId('tc-0-feedback')).toContainText('Sent 333 mirek.', {
    timeout: 15_000,
  });
  await s.waitFor(() => s.bus(from).includes('colour.Activate'));
  expect(s.bus(from)).toContain('colour.SetTemporaryColourTemperature');

  from = s.lines.length;
  await page
    .getByTestId('fade-0')
    .getByRole('combobox')
    .selectOption({ label: '2 s (standard fade time 4)' });
  await s.waitFor(() => s.bus(from).includes('general.SetFadeTime'));

  from = s.lines.length;
  await page
    .getByTestId('colour-1')
    .getByRole('slider', { name: /Saturation/ })
    .fill('100');
  await expect(page.getByTestId('colour-1-feedback')).toContainText('Sent channels 254 0 0', {
    timeout: 15_000,
  });
  await s.waitFor(() => s.bus(from).includes('colour.SetTemporaryRGBDimLevel'));
  expect(await w.problems()).toEqual([]);
});

test('in Both, lowering the ceiling turns lit gear down before the profile work', async ({
  page,
}) => {
  server = await startServer();
  const s = server;
  const w = await watch(page);
  await page.goto(s.url);
  await connect(page, 'Both');
  await playground(page);
  await enter(page, 'level-0-right', '200');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Sent level 200.', {
    timeout: 15_000,
  });
  await page.waitForTimeout(2500);

  const from = s.lines.length;
  await page.getByTestId('ceiling').click();
  await page.getByTestId('ceiling-percent').locator('input').fill('20');
  await page.getByTestId('ceiling-percent').locator('input').press('Enter');
  await page.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 195', { timeout: 60_000 });
  // The hold reaches the bus before the slower profile work: its read-backs come after it.
  const bus = s.bus(from);
  const hold = bus.indexOf('general.DAPC');
  const readBack = bus.indexOf('general.QueryMaxLevel');
  expect(hold).toBeGreaterThanOrEqual(0);
  expect(readBack).toBeGreaterThan(hold);
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  expect(await w.problems()).toEqual([]);
});

test('a driver whose MAX LEVEL does not take is shown as a mismatch', async ({ page }) => {
  server = await startServer(['--demo-quirk', 'max-level']);
  const w = await watch(page);
  await page.goto(server.url);
  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveText(/Hardware: ready/);
  await page.getByRole('button', { name: 'Yes, I can see them' }).click();
  await goTo(page, 'Devices');
  await expect(page.getByTestId('device-0').getByTestId('profile-status')).toHaveText('verified', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('device-1').getByTestId('profile-status')).toHaveText('mismatch', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('device-1')).toContainText('254');
  await expect(page.getByText(/A1: the safety profile is not verified\./)).toBeVisible();
  await expect(page.getByTestId('unverified')).toContainText('Not verified: A1.', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('verified')).toHaveText('1/2 verified');
  expect(await w.problems()).toEqual([]);
});
