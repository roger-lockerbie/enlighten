/**
 * E-a11y: every control on every page is reachable with Tab and has a role and a name; reduced motion
 * turns transitions off, from the system or from Settings; and nothing on the page animates (SPEC S6).
 */
import { expect, test, type Page } from '@playwright/test';
import { goTo, noProblems, openApp, type PageName } from './app.ts';

const PAGES: PageName[] = [
  'Playground',
  'Devices',
  'Bus monitor',
  'Settings',
  'Scripts',
  'Visualiser',
];
const CONTROLS = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/** Controls a person can reach: visible or visually hidden for screen readers, and enabled. */
async function reachable(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      if ((el as HTMLInputElement).disabled) return;
      if (el.closest('dialog:not([open])') !== null) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      el.dataset['a11y'] = String(i);
      out.push(String(i));
    });
    return out;
  }, CONTROLS);
}

test('every control on every page has a role and a name, and Tab reaches it', async ({ page }) => {
  const w = await openApp(page);
  for (const name of PAGES) {
    await goTo(page, name);
    const ids = await reachable(page);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      const el = page.locator(`[data-a11y="${id}"]`);
      await expect(el, `control ${id} on ${name}`).toHaveAccessibleName(/\S/);
    }
    // Tab through the page from the top bar and collect everything that took focus.
    await page.getByRole('button', { name: 'Panic' }).focus();
    const seen = new Set<string>();
    for (let i = 0; i < ids.length * 2 + 20; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset['a11y'],
      );
      if (id !== undefined) seen.add(id);
    }
    const missed = ids.filter((id) => !seen.has(id));
    expect(missed, `not reached by Tab on ${name}`).toEqual([]);
  }
  await noProblems(w);
});

test('transitions are off under reduced motion, from the system or from Settings', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const w = await openApp(page);
  const motion = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion').trim(),
    );
  // Chromium gives the computed value in seconds: .12s is 120 ms.
  expect(await motion()).toMatch(/^(120ms|\.12s|0\.12s)$/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await motion()).toMatch(/^0(ms|s)$/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await goTo(page, 'Settings');
  await page.getByTestId('reduced-motion').getByRole('button', { name: 'Always' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  expect(await motion()).toMatch(/^0(ms|s)$/);
  await noProblems(w);
});

test('nothing on any page animates or blinks', async ({ page }) => {
  const w = await openApp(page);
  for (const name of PAGES) {
    await goTo(page, name);
    const running = await page.evaluate(() =>
      document.getAnimations().map((a) => (a as CSSAnimation).animationName || 'transition'),
    );
    expect(running, name).toEqual([]);
    const declared = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((el) => getComputedStyle(el).animationName)
        .filter((n) => n !== 'none'),
    );
    expect(declared, name).toEqual([]);
  }
  await noProblems(w);
});
