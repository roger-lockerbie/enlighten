/**
 * E-shell: navigation by the rail, Alt with a digit, and F6 between regions; preferences persist
 * across a reload; unlocks and the panic latch do not (ADR 0009).
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp, panicLatched, ready } from './app.ts';

test('navigates by the rail, by Alt with a digit, and between regions with F6', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Devices');
  await goTo(page, 'Playground');
  for (const [key, name] of [
    ['Alt+3', 'Bus monitor'],
    ['Alt+4', 'Settings'],
    ['Alt+2', 'Devices'],
    ['Alt+1', 'Playground'],
  ] as const) {
    await page.keyboard.press(key);
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Playground' }),
  ).toHaveAttribute('aria-current', 'page');

  const region = () =>
    page.evaluate(() =>
      document.activeElement?.closest('[data-region]')?.getAttribute('data-region'),
    );
  await page.getByTestId('ceiling').focus();
  const seen: (string | null | undefined)[] = [await region()];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('F6');
    seen.push(await region());
  }
  expect(seen).toEqual(['topbar', 'rail', 'main', 'inspector', 'topbar']);
  await page.keyboard.press('Shift+F6');
  expect(await region()).toBe('inspector');
  await noProblems(w);
});

test('the console drawer opens with Ctrl-` and takes focus, and resizes from the keyboard', async ({
  page,
}) => {
  const w = await openApp(page);
  await expect(page.getByTestId('console')).toHaveCount(0);
  await page.keyboard.press('Control+Backquote');
  const drawer = page.getByTestId('console');
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeFocused();
  await expect(drawer).toContainText('The console arrives in Stage 6.');
  const before = (await drawer.boundingBox())?.height ?? 0;
  expect(Math.round(before)).toBe(220);
  const grip = page.getByRole('button', { name: /Console height/ });
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => Math.round((await drawer.boundingBox())?.height ?? 0)).toBe(252);
  await page.keyboard.press('Control+Backquote');
  await expect(drawer).toHaveCount(0);
  await noProblems(w);
});

test('preferences persist across a reload, and unlocks and the panic latch do not', async ({
  page,
}) => {
  const w = await openApp(page);
  // Preferences: the page, the inspector, the console drawer and its height, the send mode, a name.
  await page.getByTestId('send-mode').getByRole('button', { name: 'Commit' }).click();
  await page.getByRole('button', { name: 'Hide' }).click();
  await page.keyboard.press('Control+Backquote');
  await page.getByRole('button', { name: /Console height/ }).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await goTo(page, 'Devices');
  await page.getByRole('textbox', { name: 'Name for A0' }).fill('Hall left');
  await page.getByRole('textbox', { name: 'Name for A0' }).press('Enter');
  // A lower ceiling is kept.
  await page.getByTestId('ceiling').click();
  await enter(page, 'ceiling-percent', '20');
  await page.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 195');
  // Session state: an unlock and the panic latch.
  await page.getByTestId('unlock-name').selectOption('expert');
  await page.getByTestId('unlock-typed').fill('expert');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByTestId('unlocks')).toHaveText('Unlocks: expert');
  await page.getByRole('button', { name: 'Panic' }).click();
  await panicLatched(page);
  // Give the preferences time to save.
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Devices' })).toBeVisible();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('ceiling')).toContainText('arc 195');
  await expect(page.getByTestId('unlocks')).toHaveText('Unlocks: none');
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Inspector' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show inspector' })).toBeVisible();
  await expect(page.getByTestId('console')).toBeVisible();
  expect(Math.round((await page.getByTestId('console').boundingBox())?.height ?? 0)).toBe(284);
  await expect(page.getByRole('textbox', { name: 'Name for A0' })).toHaveValue('Hall left');
  await goTo(page, 'Playground');
  await ready(page);
  await expect(
    page.getByTestId('send-mode').getByRole('button', { name: 'Commit' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('panel-0').getByRole('heading')).toHaveText('A0 Hall left');
  await noProblems(w);
});
