/**
 * E-script: scripts run in the worker with the source script. A pause waits for Enter, Ctrl-C stops a
 * script, a refused step stops it at its line, and a bad import is refused or shown with its errors
 * and never runs (SPEC section 7, ADR 0007, ADR 0014).
 */
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, goTo, noProblems, openApp, openConsole, typeLine } from './app.ts';

async function importScript(page: Page, text: string, name = 'my script.txt'): Promise<void> {
  await page.getByTestId('script-import').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
  });
}

test('first-light pauses for Enter, holds to the ceiling, and Ctrl-C stops it', async ({
  page,
}) => {
  const w = await openApp(page);
  await openConsole(page);
  const log = consoleLog(page);
  await typeLine(page, 'run first-light');
  await expect(log).toContainText('Running first-light');
  await expect(page.getByTestId('console-status')).toContainText(
    '1. Both DALI tapes should be on, at the ceiling.',
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('script-status')).toContainText('(paused)');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('39.5%');
  await expect(page.getByTestId('tape-1').getByTestId('tape-text')).toContainText('39.5%');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('console-status')).toContainText('2. Both should be off.', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await page.keyboard.press('Control+c');
  await expect(log).toContainText('first-light stopped: Ctrl-C.');
  await expect(page.getByTestId('script-status')).toHaveCount(0);
  // Every frame the script sent is tagged with its source in the bus monitor.
  await goTo(page, 'Bus monitor');
  await expect(page.getByTestId('monitor')).toContainText('script');
  await noProblems(w);
});

test('a refused step stops the script and names its line', async ({ page }) => {
  const w = await openApp(page);
  await goTo(page, 'Scripts');
  await page.getByTestId('script-new').click();
  await page.getByTestId('script-name').fill('bad colour');
  await page.getByTestId('script-text').fill('level 1 100\ntc 1 2700K\noff 1');
  await expect(page.getByTestId('script-parse')).toContainText('It parses: 3 steps');
  await page.getByTestId('script-save').click();
  await expect(page.getByTestId('script-message')).toContainText('Saved bad colour.');
  await page.getByTestId('script-run').click();
  const log = consoleLog(page);
  await expect(log).toContainText('bad colour stopped at line 2.', { timeout: 30_000 });
  await expect(log).not.toContainText('+ 3: off 1');
  await noProblems(w);
});

test('an import is shown with its errors and never runs, and an oversized one is refused', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Scripts');
  await importScript(page, 'level 0 50%\nunlock rate\nrepeat 2\noff 0');
  await expect(page.getByTestId('script-message')).toContainText('Nothing has run.');
  await expect(page.getByTestId('script-name')).toHaveValue('my script');
  const parse = page.getByTestId('script-parse');
  await expect(parse).toContainText('line 2: unlock cannot be used in a script.');
  await expect(parse).toContainText('line 3: repeat without an end.');
  await expect(page.getByTestId('script-run')).toBeDisabled();
  await importScript(page, 'x'.repeat(64 * 1024 + 1), 'big.txt');
  await expect(page.getByTestId('script-problem')).toContainText('at most 64 kB');
  // The console refuses a script with errors before anything is sent.
  await page.getByTestId('script-text').fill('off 0\nfrob');
  await page.getByTestId('script-save').click();
  await expect(page.getByTestId('script-message')).toContainText('It has errors');
  await openConsole(page);
  await typeLine(page, 'run "my script"');
  await expect(consoleLog(page)).toContainText('line 2: Unknown command "frob".');
  await expect(consoleLog(page)).not.toContainText('Running my script');
  await noProblems(w);
});
