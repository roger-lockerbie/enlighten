/**
 * The Devices page: the inventory, names, and the simulator's settings (SPEC R1.6). Changing the
 * presentation rebuilds the simulated unit, off, and the Playground follows what it now reports.
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp } from './app.ts';

test('the inventory shows each driver, and a simulator setting rebuilds its unit', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Devices');
  await expect(page.getByTestId('device-0')).toContainText('Colour temperature');
  await expect(page.getByTestId('device-1')).toContainText('RGBWAF channels');
  await expect(page.getByTestId('device-0').getByTestId('profile-status')).toHaveText('verified');

  const sim = page.getByTestId('sim-settings');
  await expect(sim.getByTestId('setting-maxLowerPullsDown')).toContainText('dali.md section 16');
  await sim.getByTestId('sim-unit').selectOption('A');
  await sim.getByTestId('sim-presentation').selectOption('rgbwaf');
  await expect(sim.getByTestId('sim-message')).toContainText(
    'Unit A rebuilt, off, and scanned again.',
  );
  await sim
    .getByTestId('setting-maxLowerPullsDown')
    .getByRole('combobox')
    .selectOption({ label: 'no' });
  await expect(sim.getByTestId('setting-maxLowerPullsDown')).toContainText('changed');
  await expect(page.getByTestId('device-0')).toContainText('RGBWAF channels', { timeout: 60_000 });
  await expect(page.getByTestId('device-0').getByTestId('profile-status')).toHaveText('verified', {
    timeout: 60_000,
  });
  await goTo(page, 'Playground');
  await expect(page.getByTestId('panel-0')).toContainText('Presents as RGBWAF', {
    timeout: 60_000,
  });

  // Back to the defaults, and the unit presents colour temperature again.
  await goTo(page, 'Devices');
  await sim.getByRole('button', { name: 'Back to the defaults' }).click();
  await expect(page.getByTestId('device-0')).toContainText('Colour temperature', {
    timeout: 60_000,
  });
  await noProblems(w);
});

test('a simulated driver is added at another address, kept across a reload, and taken away (R14.2)', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Devices');
  await enter(page, 'extra-address', '7');
  await page.getByTestId('extra-type').selectOption('C2');
  await page.getByTestId('extra-add').click();
  await expect(page.getByTestId('extras-message')).toHaveText('Added a driver at address 7.');
  await expect(page.getByTestId('verified')).toHaveText('3/3 verified', { timeout: 60_000 });
  await expect(page.getByTestId('device-7')).toContainText('Colour temperature', {
    timeout: 60_000,
  });
  // The same address again is turned away on the page.
  await page.getByTestId('extra-add').click();
  await expect(page.getByTestId('extras-message')).toHaveText(
    'A simulated driver is at address 7 already.',
  );
  // It has a panel of its own in the playground, and stays after a reload.
  await goTo(page, 'Playground');
  await expect(page.getByTestId('panel-7')).toContainText('Presents as colour temperature', {
    timeout: 60_000,
  });
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('3/3 verified', { timeout: 60_000 });

  await goTo(page, 'Devices');
  await page.getByTestId('extra-remove-7').click();
  await expect(page.getByTestId('extras-message')).toHaveText('Removed the driver at address 7.');
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await noProblems(w);
});
