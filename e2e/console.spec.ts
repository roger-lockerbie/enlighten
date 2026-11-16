/**
 * E-console: typing sessions in the console drawer. Commands go through the governor in the worker
 * and print decoded replies; refusals print as refusals; history comes back with verify mode and
 * survives a reload; Tab completes; unlocks need a typed confirmation (SPEC section 6, ADR 0014).
 */
import { expect, test } from '@playwright/test';
import { consoleLog, noProblems, openApp, openConsole, ready, typeLine } from './app.ts';

test('sends commands through the governor and prints what happened', async ({ page }) => {
  const w = await openApp(page);
  await openConsole(page);
  const log = consoleLog(page);
  await typeLine(page, 'level 0 254');
  await expect(log).toContainText('> level 0 254');
  await expect(log).toContainText(
    'A0 level 254 (100%), clamped: DAPC 254 clamped to the ceiling, 220.',
  );
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('39.5%', {
    timeout: 5000,
  });
  await typeLine(page, 'query-actual-level 0');
  await expect(log).toContainText('actual level 220 (39.5%) [0xDC]');
  await typeLine(page, 'query 0,1 level');
  await expect(log).toContainText('A1: actual level 0 (off) [0x00]');
  // A colour the driver does not report is refused, and the refusal is announced.
  await typeLine(page, 'tc 1 2700K');
  await expect(log).toContainText('refused:');
  await expect(page.getByTestId('console-alert')).toContainText('refused:');
  await typeLine(page, 'frob');
  await expect(log).toContainText('Unknown command "frob".');
  await typeLine(page, 'off all');
  await expect(log).toContainText('off all');
  await noProblems(w);
});

test('history comes back with verify mode, and survives a reload', async ({ page }) => {
  const w = await openApp(page);
  const input = await openConsole(page);
  await typeLine(page, 'query 0 level');
  await expect(consoleLog(page)).toContainText('actual level');
  await typeLine(page, '!!');
  // Verify mode: the expanded line comes back, and Enter runs it.
  await expect(input).toHaveValue('query 0 level');
  await expect(page.getByTestId('console-status')).toContainText('History expanded.');
  await page.keyboard.press('Enter');
  await expect(consoleLog(page).getByText('> query 0 level')).toHaveCount(2);
  await typeLine(page, 'echo hello there');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('echo hello there');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('query 0 level');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('');
  // Search history backward from the new line.
  await page.keyboard.press('Control+r');
  await page.keyboard.type('hel');
  await expect(page.getByTestId('console-status')).toHaveText('bck-i-search: hel_');
  await expect(input).toHaveValue('echo hello there');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await page.reload();
  await ready(page);
  await openConsole(page);
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('echo hello there');
  await page.keyboard.press('Control+u');
  await typeLine(page, 'history');
  await expect(consoleLog(page)).toContainText('echo hello there');
  await noProblems(w);
});

test('Tab completes, and leaves the console when there is nothing to complete', async ({
  page,
}) => {
  const w = await openApp(page);
  const input = await openConsole(page);
  await page.keyboard.type('query-actual-l');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('query-actual-level ');
  await page.keyboard.press('Control+u');
  await page.keyboard.type('run first');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('run first-light ');
  await page.keyboard.press('Control+u');
  await page.keyboard.type('level 0 50%');
  await page.keyboard.press('Tab');
  await expect(input).not.toBeFocused();
  await noProblems(w);
});

test('an unlock needs its name typed, and a raise of the ceiling its value', async ({ page }) => {
  const w = await openApp(page);
  await openConsole(page);
  const log = consoleLog(page);
  await typeLine(page, 'unlock rate');
  await expect(page.getByTestId('console-status')).toContainText('Type rate');
  await typeLine(page, 'no');
  await expect(log).toContainText('Not confirmed. Nothing changed.');
  await expect(page.getByTestId('unlocks')).toContainText('none');
  await typeLine(page, 'unlock rate');
  await typeLine(page, 'rate');
  await expect(log).toContainText('Unlocked rate until the page reloads.');
  await typeLine(page, 'lock');
  await expect(log).toContainText('Every unlock dropped.');
  // Lowering is at once; raising asks for the value.
  await typeLine(page, 'cap 200');
  await expect(page.getByTestId('ceiling')).toContainText('arc 200', { timeout: 30_000 });
  await typeLine(page, 'cap 210');
  await expect(log).toContainText('Type 210 to confirm.');
  await page.keyboard.press('Escape');
  await expect(log).toContainText('Not confirmed.');
  await expect(page.getByTestId('ceiling')).toContainText('arc 200');
  await typeLine(page, 'cap 210');
  await typeLine(page, '210');
  await expect(page.getByTestId('ceiling')).toContainText('arc 210', { timeout: 30_000 });
  await noProblems(w);
});
