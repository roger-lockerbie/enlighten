/**
 * E-manual: the manual inside the app (ADR 0024). It opens from the rail, F1 and the console; a page
 * shows its table, callout, picture and console lines; links, the contents and the search move
 * between pages; and "Put in console" fills the input without sending anything.
 */
import { expect, test } from '@playwright/test';
import { consoleLog, noProblems, openApp, openConsole, typeLine } from './app.ts';

test('the manual opens three ways, reads as pages, and sends nothing', async ({ page }) => {
  const w = await openApp(page);
  const manual = page.getByTestId('manual');
  const article = page.getByTestId('manual-page');
  const contents = page.getByRole('navigation', { name: 'Manual contents' });

  // From the rail.
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name: 'Manual' })
    .click();
  await expect(manual).toBeVisible({ timeout: 20_000 });
  await expect(article.getByRole('heading', { level: 1, name: 'Enlighten manual' })).toBeVisible();
  await expect(page).toHaveTitle('Manual: Enlighten');

  // A link in the text goes to its page.
  await article.getByRole('button', { name: 'The ceiling and panic', exact: true }).click();
  await expect(
    article.getByRole('heading', { level: 1, name: 'The ceiling and panic' }),
  ).toBeVisible();
  // A picture from the build, loaded, with its caption.
  const picture = article.getByRole('img', { name: /^The top bar/ });
  await picture.scrollIntoViewIfNeeded();
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(100);
  expect(await picture.getAttribute('src')).toMatch(/^\/assets\/topbar-[\w-]+\.png$/);
  // A table, and a marked statement about hardware.
  await expect(
    article.getByRole('columnheader', { name: 'When it is the one to use' }),
  ).toBeVisible();
  await expect(article.getByText('Untried on hardware (HW-01)')).toBeVisible();

  // "Put in console" fills the input and sends nothing.
  await page.keyboard.press('Alt+Digit3');
  const kept = page.getByText(/\d+ frames kept/);
  await expect(kept).toBeVisible();
  const before = await kept.textContent();
  await page.keyboard.press('F1');
  await expect(
    article.getByRole('heading', { level: 1, name: 'The ceiling and panic' }),
  ).toBeVisible();
  await article.getByRole('button', { name: 'Put in console: level 0 100%' }).click();
  const input = page.getByTestId('console-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('level 0 100%');
  await expect(consoleLog(page)).not.toContainText('level 0 100%');
  await input.fill('');

  // With the keyboard: Enter held down on the button fills the input, and does not then send it.
  await page.keyboard.press('Control+Backquote');
  const put = article.getByRole('button', { name: 'Put in console: cap 20%' });
  await put.focus();
  await page.keyboard.down('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(input).toHaveValue('cap 20%');
  await expect(consoleLog(page)).not.toContainText('cap 20%');
  await expect(page.getByTestId('ceiling')).toContainText('arc 220');
  await input.fill('');

  // An ask is answered once: after `manual safety`, coming back returns to the page last read.
  await typeLine(page, 'manual safety');
  await expect(article.getByRole('heading', { level: 1, name: 'Safety' })).toBeVisible();
  await contents.getByRole('button', { name: 'Keys', exact: true }).click();
  await expect(article.getByRole('heading', { level: 1, name: 'Keys' })).toBeVisible();
  await page.keyboard.press('Alt+Digit1');
  await page.keyboard.press('F1');
  await expect(article.getByRole('heading', { level: 1, name: 'Keys' })).toBeVisible();
  // The row for the console's own key keeps its two cells (SH2-3).
  await expect(article.getByRole('row', { name: /Ctrl `/ }).getByRole('cell')).toHaveCount(2);

  // From the console, by part of a title, and the search.
  await typeLine(page, 'manual safety');
  await expect(article.getByRole('heading', { level: 1, name: 'Safety' })).toBeVisible();
  await typeLine(page, 'manual dali');
  await expect(article.getByRole('heading', { level: 1, name: 'DALI commands' })).toBeVisible();
  await expect(article.getByText('QUERY ACTUAL LEVEL', { exact: false }).first()).toBeAttached();
  await page.keyboard.press('Control+Backquote');
  await page.getByTestId('manual-find').fill('seizures');
  await expect(
    page.getByTestId('manual-hits').getByRole('button', { name: 'Safety' }),
  ).toBeVisible();
  await page.getByTestId('manual-find').fill('zebra crossing');
  await expect(page.getByTestId('manual-hits')).toContainText('Nothing in the manual has that.');
  await page.getByTestId('manual-find').fill('');
  await contents.getByRole('button', { name: 'Keys', exact: true }).click();
  await expect(article.getByRole('cell', { name: 'Escape, twice within 500 ms' })).toBeVisible();
  await article.getByRole('button', { name: /^Next: / }).click();
  await expect(article.getByRole('heading', { level: 1, name: 'Console commands' })).toBeVisible();

  // Nothing went to the bus through any of it.
  await page.keyboard.press('Alt+Digit3');
  await expect(kept).toHaveText(before ?? '');
  // Panic still works with the manual open.
  await page.keyboard.press('F1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('latched')).toBeVisible();
  await openConsole(page);
  await typeLine(page, 'resume');
  await expect(page.getByTestId('latched')).toHaveCount(0);
  await noProblems(w);
});
