/**
 * E-keys: the console's binding table in Chromium. Each bound key is handled by the console, not the
 * browser, and Tab and Escape always let focus leave (ADR 0006, docs/research/console.md).
 */
import { expect, test, type Page } from '@playwright/test';
import { noProblems, openApp, openConsole } from './app.ts';

/** The line with a bar at the caret. */
async function shown(page: Page): Promise<string> {
  return page.getByTestId('console-input').evaluate((el) => {
    const i = el as HTMLInputElement;
    const at = i.selectionStart ?? 0;
    return `${i.value.slice(0, at)}|${i.value.slice(at)}`;
  });
}

const CASES: { keys: string[]; start: string; want: string }[] = [
  { start: 'level 0 50%', keys: ['Control+a'], want: '|level 0 50%' },
  { start: 'level 0 50%', keys: ['Control+a', 'Control+e'], want: 'level 0 50%|' },
  { start: 'level 0 50%', keys: ['Control+b', 'Control+b'], want: 'level 0 5|0%' },
  { start: 'level 0 50%', keys: ['Alt+b'], want: 'level 0 |50%' },
  { start: 'level 0 50%', keys: ['Control+a', 'Alt+f'], want: 'level |0 50%' },
  { start: 'level 0 50%', keys: ['Alt+Backspace'], want: 'level 0 |' },
  { start: 'level 0 50%', keys: ['Control+Backspace'], want: 'level 0 |' },
  { start: 'level 0 50%', keys: ['Control+a', 'Control+k'], want: '|' },
  { start: 'level 0 50%', keys: ['Control+u'], want: '|' },
  { start: 'level 0 50%', keys: ['Control+u', 'Control+y'], want: 'level 0 50%|' },
  { start: 'level 0 50%', keys: ['Control+a', 'Alt+d'], want: '| 0 50%' },
  { start: 'level 0 50%', keys: ['Control+a', 'Alt+u'], want: 'LEVEL| 0 50%' },
  { start: 'level 0 50%', keys: ['Control+a', 'Alt+c'], want: 'Level| 0 50%' },
  { start: 'ab', keys: ['Control+t'], want: 'ba|' },
  { start: 'off 0', keys: ['Control+h'], want: 'off |' },
  { start: 'off 0', keys: ['Alt+Backspace', 'Control+Shift+Minus'], want: 'off 0|' },
  { start: 'off 0', keys: ['Alt+Backspace', 'Control+z'], want: 'off 0|' },
];

test('each bound key is handled by the console', async ({ page }) => {
  const w = await openApp(page);
  const input = await openConsole(page);
  for (const c of CASES) {
    await input.fill('');
    await page.keyboard.type(c.start);
    for (const k of c.keys) await page.keyboard.press(k);
    expect(await shown(page), `${c.start} then ${c.keys.join(' ')}`).toBe(c.want);
  }
  await noProblems(w);
});

test('Escape cancels a search, the next Escape releases focus, and Tab then leaves', async ({
  page,
}) => {
  const w = await openApp(page);
  const input = await openConsole(page);
  await page.keyboard.type('echo one');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+r');
  await expect(page.getByTestId('console-status')).toContainText('bck-i-search');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('console-status')).not.toContainText('bck-i-search');
  await expect(input).toBeFocused();
  // Wait past the panic window: two Escapes within 500 ms are panic.
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  await expect(page.getByTestId('console')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('console')).not.toBeFocused();
  await expect(page.getByTestId('latched')).toHaveCount(0);
  await noProblems(w);
});

test('Ctrl-C with a selection copies, and with none abandons the line', async ({ page }) => {
  const w = await openApp(page);
  const input = await openConsole(page);
  await page.keyboard.type('level 0 50%');
  await input.evaluate((el) => {
    (el as HTMLInputElement).setSelectionRange(0, 5);
  });
  await page.keyboard.press('Control+c');
  await expect(input).toHaveValue('level 0 50%');
  await input.evaluate((el) => {
    const i = el as HTMLInputElement;
    i.setSelectionRange(i.value.length, i.value.length);
  });
  await page.keyboard.press('Control+c');
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('console-log')).toContainText('> level 0 50%^C');
  await noProblems(w);
});
