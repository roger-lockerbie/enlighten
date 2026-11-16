/**
 * The Devices page: the inventory, names, and the simulator's settings (SPEC R1.6). Changing the
 * presentation rebuilds the simulated unit, off, and the Playground follows what it now reports.
 */
import { expect, test } from '@playwright/test';
import { goTo, noProblems, openApp } from './app.ts';

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
