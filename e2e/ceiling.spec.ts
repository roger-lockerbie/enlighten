/**
 * E-ceiling: lowering takes effect at once, raising needs the new value typed, and a saved ceiling
 * above the default is offered back rather than applied at start (SPEC R6, ADR 0013). A script that
 * tries to raise it is Stage 6's (the console), and a mismatch is in e2e/server/playground.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { enter, field, noProblems, openApp, ready } from './app.ts';

test('lowering takes effect at once, and pulls a lit driver down with it', async ({ page }) => {
  const w = await openApp(page);
  await enter(page, 'level-0-right', '200');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('22.9%');
  await page.getByTestId('ceiling').click();
  await enter(page, 'ceiling-percent', '10');
  await expect(page.getByTestId('ceiling-arc')).toHaveText('arc 169 (9.8%)');
  await page.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling-dialog')).toBeHidden();
  await expect(page.getByTestId('ceiling')).toContainText('Ceiling 9.8%  arc 169');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('9.8%', {
    timeout: 5000,
  });
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 30_000 });
  // The level control's ceiling marker moved with it.
  await expect(page.getByTestId('level-0')).toContainText('ceiling 9.8%');
  await noProblems(w);
});

test('raising needs the new value typed, and Panic stays clickable over the dialog', async ({
  page,
}) => {
  const w = await openApp(page);
  await page.getByTestId('ceiling').click();
  await enter(page, 'ceiling-percent', '60');
  await page.getByRole('button', { name: 'Raise' }).click();
  const confirm = page.getByTestId('raise-dialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('From 39.5% (arc 220) to 59.5% (arc 235).');
  const raise = confirm.getByRole('button', { name: 'Raise' });
  await expect(raise).toBeDisabled();
  await confirm.getByRole('textbox').fill('60');
  await expect(raise).toBeDisabled();
  await confirm.getByRole('textbox').fill('59.5');
  await expect(raise).toBeEnabled();
  // Panic is never covered: it is clickable while the confirmation is open.
  await page.getByRole('button', { name: 'Panic' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toBeVisible();
  // The banner sits under the dialog's scrim, so it is clicked as a person would after closing it.
  await page.getByRole('button', { name: 'Resume' }).dispatchEvent('click');
  await raise.click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('ceiling')).toContainText('Ceiling 59.5%  arc 235', {
    timeout: 30_000,
  });
  await noProblems(w);
});

test('a refused ceiling says why', async ({ page }) => {
  const w = await openApp(page);
  await page.getByTestId('ceiling').click();
  // Below the drivers' physical minimum (arc 85, about 1%).
  await enter(page, 'ceiling-percent', '0.5');
  await page.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling-message')).toContainText(
    'That is the lowest ceiling it can hold.',
  );
  await expect(page.getByTestId('ceiling')).toContainText('arc 220');
  await noProblems(w);
});

test('a saved ceiling above the default is offered back, not applied at start', async ({
  page,
}) => {
  const w = await openApp(page);
  await page.getByTestId('ceiling').click();
  await enter(page, 'ceiling-percent', '60');
  await page.getByRole('button', { name: 'Raise' }).click();
  await page.getByTestId('raise-dialog').getByRole('textbox').fill('59.5');
  await page.getByTestId('raise-dialog').getByRole('button', { name: 'Raise' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 235', { timeout: 30_000 });
  await page.waitForTimeout(600);

  await page.reload();
  await ready(page);
  await expect(page.getByTestId('ceiling')).toContainText('arc 220');
  const offer = page.getByTestId('saved-ceiling');
  await expect(offer).toContainText('Your saved ceiling is 59.5% (arc 235)');
  await offer.getByRole('button', { name: 'Restore 59.5%' }).click();
  const confirm = page.getByTestId('raise-dialog');
  await confirm.getByRole('textbox').fill('59.5');
  await confirm.getByRole('button', { name: 'Raise' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 235', { timeout: 30_000 });
  await expect(offer).toHaveCount(0);
  expect(await field(page, 'level-0-right').count()).toBe(1);
  await noProblems(w);
});
