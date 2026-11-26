/**
 * The manual's pictures (ADR 0024). Each test follows the steps of a guide chapter in the simulator
 * and takes the pictures that chapter shows, so a step that stops working fails here.
 * Run with `pnpm manual:shots`.
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, openConsole, panicLatched, ready, typeLine } from '../app.ts';
import { shot } from './shot.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await ready(page);
  // The top bar's bus figure is from the last snapshot, which was taken during the scan. A line
  // that sends nothing, a moment later, brings a snapshot of the bus at rest.
  await page.waitForTimeout(1500);
  await openConsole(page);
  await typeLine(page, 'devices');
  await expect(page.getByText(/^Bus [0-9]%$/)).toBeVisible({ timeout: 20_000 });
  await typeLine(page, 'clear');
  await page.keyboard.press('Control+Backquote');
});

test('the ceiling and panic', async ({ page }) => {
  const bar = page.getByRole('banner', { name: 'Top bar' });
  // A narrower window for this one, so the bar's text is large enough to read in a page.
  await page.setViewportSize({ width: 1100, height: 900 });
  await shot(page, 'topbar', {
    of: bar,
    margin: 14,
    callouts: [
      { at: bar.getByRole('button', { name: 'Simulator', exact: true }), corner: 'bottom-left' },
      { at: page.getByTestId('ceiling'), corner: 'bottom-left' },
      { at: page.getByTestId('verified'), corner: 'bottom-left' },
      { at: page.getByTestId('unlocks'), corner: 'bottom-left' },
      { at: bar.getByRole('button', { name: 'Panic' }), corner: 'bottom-left' },
    ],
  });

  await page.setViewportSize({ width: 1440, height: 900 });

  // Lower the ceiling to 20%.
  await page.getByTestId('ceiling').click();
  const dialog = page.getByTestId('ceiling-dialog');
  await expect(dialog).toBeVisible();
  await enter(page, 'ceiling-percent', '20');
  await shot(page, 'ceiling-dialog', {
    of: dialog,
    callouts: [
      { at: page.getByTestId('ceiling-percent'), corner: 'left' },
      { at: dialog.getByRole('button', { name: 'Lower now' }) },
      { at: dialog.getByRole('button', { name: 'Raise', exact: true }), corner: 'top-right' },
    ],
  });
  await dialog.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 195', { timeout: 20_000 });
  // The dialog closes itself when the ceiling is lowered.
  await expect(dialog).toBeHidden();

  // A level above the ceiling is held to it.
  await openConsole(page);
  await typeLine(page, 'level 0 100%');
  await expect(page.getByTestId('console-log')).toContainText('clamped');
  await page.keyboard.press('Control+Backquote');
  await goTo(page, 'Playground');
  await shot(page, 'ceiling-held', { of: page.getByTestId('panel-0') });

  // Panic, and the latch.
  await bar.getByRole('button', { name: 'Panic' }).click();
  await panicLatched(page);
  await shot(page, 'panic-latched', {
    of: page.getByRole('alert').filter({ hasText: 'Panic is on' }),
    margin: 60,
    callouts: [
      { at: page.getByTestId('latched'), corner: 'bottom-left' },
      { at: page.getByRole('button', { name: 'Resume' }), corner: 'bottom-left' },
    ],
  });
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('latched')).toHaveCount(0);
});
