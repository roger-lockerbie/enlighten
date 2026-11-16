/**
 * E-panic, for the shell: the button and Escape twice from every page, with a dialog open, and the
 * latch holding until Resume. Mid-script, by the button and typed in the console (Stage 6).
 * Mid-sequence comes with Stage 9. Panic reaching the bus is in e2e/server/modes.spec.ts.
 */
import { expect, test } from '@playwright/test';
import {
  consoleLog,
  enter,
  goTo,
  noProblems,
  openApp,
  openConsole,
  panicLatched,
  typeLine,
  type PageName,
} from './app.ts';

const PAGES: PageName[] = ['Playground', 'Devices', 'Bus monitor', 'Settings', 'Scripts'];

test('the button and Escape twice latch panic from every page, until Resume', async ({ page }) => {
  const w = await openApp(page);
  for (const name of PAGES) {
    await goTo(page, name);
    await page.getByRole('button', { name: 'Panic' }).click();
    await panicLatched(page);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('latched')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await panicLatched(page);
    await page.getByRole('button', { name: 'Resume' }).click();
  }
  // One Escape alone is not panic.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('latched')).toHaveCount(0);
  await noProblems(w);
});

test('Escape twice works with a dialog open, and the latch holds until Resume', async ({
  page,
}) => {
  const w = await openApp(page);
  await enter(page, 'level-0-right', '150');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('5.8%');
  await page.getByTestId('ceiling').click();
  await expect(page.getByTestId('ceiling-dialog')).toBeVisible();
  await page.getByTestId('ceiling-percent').locator('input').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await panicLatched(page);
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  // Latched: a level is refused, and nothing reaches the bench.
  await enter(page, 'level-0-right', '100');
  await expect(page.getByTestId('level-0-feedback')).toContainText('Refused', { timeout: 5000 });
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await page.getByRole('button', { name: 'Resume' }).click();
  await enter(page, 'level-0-right', '120');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('2.6%', {
    timeout: 10_000,
  });
  await noProblems(w);
});

test('panic stops a script mid-wait, from the button and typed in the console', async ({
  page,
}) => {
  const w = await openApp(page);
  await openConsole(page);
  const log = consoleLog(page);
  await goTo(page, 'Scripts');
  await page.getByTestId('script-new').click();
  await page.getByTestId('script-name').fill('slow');
  await page.getByTestId('script-text').fill('level 0 150\nwait 1min\nlevel 0 200');
  await page.getByTestId('script-save').click();
  await page.getByTestId('script-run').click();
  await expect(page.getByTestId('script-status')).toContainText('line 2', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Panic' }).click();
  await panicLatched(page);
  await expect(log).toContainText('slow stopped: Panic.');
  await expect(page.getByTestId('script-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume' }).click();

  await typeLine(page, 'run slow');
  await expect(page.getByTestId('script-status')).toContainText('line 2', { timeout: 30_000 });
  await typeLine(page, 'panic');
  await panicLatched(page);
  await expect(log.getByText('slow stopped: Panic.')).toHaveCount(2);
  await expect(log).not.toContainText('A0 level 200');
  await noProblems(w);
});
