/** Shared steps for the app's e2e tests. */
import { expect, type Locator, type Page } from '@playwright/test';
import { watch, type Watch } from './harness.ts';

export type PageName =
  'Playground' | 'Devices' | 'Bus monitor' | 'Settings' | 'Scripts' | 'Visualiser';

/** Open the app and wait until the bench is scanned, verified and read. */
export async function openApp(page: Page, url = '/'): Promise<Watch> {
  const w = await watch(page);
  await page.goto(url);
  await ready(page);
  return w;
}

export async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('panel-1')).toContainText('Presents as', { timeout: 60_000 });
  await expect(page.getByTestId('panel-0')).toContainText('Presents as colour temperature');
}

export async function goTo(page: Page, name: PageName): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** The text field inside a labelled control. */
export function field(page: Page, testid: string): Locator {
  return page.getByTestId(testid).locator('input');
}

/** Type a value into a field and apply it, as a person does. */
export async function enter(page: Page, testid: string, value: string): Promise<void> {
  const f = field(page, testid);
  await f.fill(value);
  await f.press('Enter');
}

export async function noProblems(w: Watch): Promise<void> {
  expect(await w.problems()).toEqual([]);
}

export async function panicLatched(page: Page): Promise<void> {
  await expect(page.getByRole('alert').filter({ hasText: 'Panic is on' })).toBeVisible();
  await expect(page.getByTestId('latched')).toBeVisible();
}

/** Open the console drawer with Ctrl-`, which puts the caret in its input. */
export async function openConsole(page: Page): Promise<Locator> {
  const input = page.getByTestId('console-input');
  if ((await page.getByTestId('console').count()) === 0)
    await page.keyboard.press('Control+Backquote');
  else await input.focus();
  await expect(input).toBeFocused();
  return input;
}

/** Type a console line and press Enter, as a person does. */
export async function typeLine(page: Page, line: string): Promise<void> {
  const input = page.getByTestId('console-input');
  await input.focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

export function consoleLog(page: Page): Locator {
  return page.getByTestId('console-log');
}
