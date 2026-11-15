/**
 * E-panic, for the shell: the button and Escape twice from every page, with a dialog open, and the
 * latch holding until Resume. Mid-script and mid-sequence come with Stages 6 and 9. Panic reaching
 * the bus is in e2e/server/modes.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp, panicLatched, type PageName } from './app.ts';

const PAGES: PageName[] = ['Playground', 'Devices', 'Bus monitor', 'Settings'];

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
