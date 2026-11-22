/**
 * E-hidden (SPEC S5): a long sequence with the page hidden ends within 2 seconds of its planned
 * time, with every change sent.
 *
 * What this proves, and what it does not. The page is hidden as the app sees it: `visibilityState`
 * reads "hidden" and `visibilitychange` fires, so the heartbeat tells the worker the page is hidden
 * and the watchdog stands down (S4.6), and the run goes on in the bus worker on its own clock
 * (S5.1). It does not prove what a browser does to a hidden tab's timers: Playwright keeps every page
 * focused and turns the browser's background throttling off, and neither can be undone from a test.
 * That part is checked by hand in a real browser (`docs/TEST_PLAN.md`, the hidden-tab check).
 *
 * `HIDDEN_MINUTES=30 pnpm e2e:hidden` runs the 30-minute sunrise of S5.3 the same way.
 */
import { expect, test, type Page } from '@playwright/test';
import { enter, goTo, noProblems, openApp } from './app.ts';

const MINUTES = Number(process.env['HIDDEN_MINUTES'] ?? 2);

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('a sequence keeps its time with the page hidden, and every change is sent', async ({
  page,
}) => {
  test.setTimeout((MINUTES + 4) * 60_000);
  const w = await openApp(page);
  await goTo(page, 'Sequences');
  if (MINUTES >= 20) {
    // The built-in sunrise: 30 minutes, as two chained fades on each driver.
    await page.getByTestId('preset-sunrise').click();
    await expect(page.getByTestId('plan-summary')).toContainText('ending at 30 min');
  } else {
    // Three steps on both drivers, two minutes in all, two of them chained.
    await page.getByTestId('sequence-new').click();
    await page.getByTestId('sequence-name').fill('Two minutes');
    for (const [i, [arc, seconds]] of (
      [
        [150, 50],
        [120, 45],
        [170, 25],
      ] as const
    ).entries()) {
      await page.getByTestId('step-add').click();
      await page.getByTestId(`step-${String(i)}-target`).selectOption('all');
      await enter(page, `step-${String(i)}-look-level-right`, String(arc));
      await enter(page, `step-${String(i)}-s`, String(seconds));
    }
    // 45 s and 25 s are each chained from two driver fades, so there are four changes a driver.
    await expect(page.getByTestId('plan-summary')).toContainText('12 changes');
    await expect(page.getByTestId('plan-summary')).toContainText('ending at 2 min');
  }
  const planned = (MINUTES >= 20 ? 30 : 2) * 60_000;

  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running', { timeout: 60_000 });
  const started = Date.now();
  await setVisibility(page, 'hidden');
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');

  const ended = page.getByTestId('run-ended');
  await expect(ended).toContainText('Finished after', { timeout: planned + 60_000 });
  const took = Date.now() - started;
  // The run's own account, from the worker's clock: how long after its planned end it finished,
  // and how late the latest change went out.
  const text = (await ended.textContent()) ?? '';
  const over = /, ([\d.]+) s after its planned end\./.exec(text);
  const latest = /The latest went out ([\d.]+) s after its time\./.exec(text);
  expect(text).toContain('Every change was sent.');
  // The run's clock and the wall clock agree: nothing paused the page.
  expect(text).not.toContain('wall clock');
  expect(Number(over?.[1] ?? NaN)).toBeLessThan(2);
  expect(Number(latest?.[1] ?? NaN)).toBeLessThan(2);
  // And by this test's clock, which the app has no part in. The run had started a moment before
  // the status showed, so this reads a little short, never long.
  expect(took).toBeGreaterThan(planned - 3000);
  expect(took).toBeLessThan(planned + 2000);

  await setVisibility(page, 'visible');
  if (MINUTES < 20)
    await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('10.1%');
  await noProblems(w);
});
