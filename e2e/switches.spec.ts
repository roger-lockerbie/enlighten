/**
 * E-switch: every part 301 event type by mouse, touch and keyboard, the plates' LEDs, a plate on an
 * address with no driver doing nothing, Panic stopping a hold, and plates kept across a reload
 * (SPEC R16, section 10). Events show in the console, so the tests read them there.
 */
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, enter, goTo, noProblems, openApp, openConsole } from './app.ts';

const pad = (page: Page, i: number) => page.getByTestId(`plate-p1-button-${String(i)}`);
const lines = async (page: Page, text: string) =>
  ((await consoleLog(page).innerText()).match(new RegExp(text, 'g')) ?? []).length;

async function addPlate(page: Page, address: string): Promise<void> {
  await goTo(page, 'Switches');
  await enter(page, 'plate-address', address);
  await page.getByTestId('plate-add').click();
  await expect(page.getByTestId('plate-p1')).toBeVisible();
}

test('every event type, by mouse, touch and keyboard', async ({ page }) => {
  test.setTimeout(150_000);
  const w = await openApp(page);
  await addPlate(page, '0');
  await page.getByTestId('plate-edit-p1').click();
  for (const e of ['pressed', 'released', 'double']) await page.getByTestId(`filter-${e}`).check();
  await enter(page, 'timer-double', '400');
  await enter(page, 'timer-stuck', '5');
  await openConsole(page);
  await page.getByTestId('plate-p1').scrollIntoViewIfNeeded();

  // Mouse: short press, with its pressed and released, then the double window runs out.
  await pad(page, 0).click({ delay: 100 });
  await expect(consoleLog(page)).toContainText('Plate 1 1: short press -> on A0', {
    timeout: 5000,
  });
  await expect(consoleLog(page)).toContainText('Plate 1 1: pressed');
  await expect(consoleLog(page)).toContainText('Plate 1 1: released');
  // The On button's LED follows the target, and the target is on.
  await expect(page.getByTestId('plate-p1-led-0')).toHaveAttribute('data-lit', 'true');

  // Mouse: double press.
  await pad(page, 0).click({ delay: 80 });
  await page.waitForTimeout(100);
  await pad(page, 0).click({ delay: 80 });
  await expect(consoleLog(page)).toContainText('Plate 1 1: double press', { timeout: 5000 });

  // Mouse: a hold starts, repeats and stops.
  await pad(page, 1).hover();
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await expect(consoleLog(page)).toContainText('Plate 1 2: long press start');
  await expect(consoleLog(page)).toContainText('Plate 1 2: long press stop');

  // Mouse: held past the stuck timer, then let go.
  await pad(page, 1).hover();
  await page.mouse.down();
  await expect(consoleLog(page)).toContainText('Plate 1 2: stuck', { timeout: 10_000 });
  await expect(page.getByTestId('plate-p1-last-1')).toContainText('(stuck)');
  await page.mouse.up();
  await expect(consoleLog(page)).toContainText('Plate 1 2: free');

  // Touch: pointer events of type touch.
  const before = await lines(page, 'Plate 1 1: short press');
  const touch = { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true };
  await pad(page, 0).dispatchEvent('pointerdown', touch);
  await page.waitForTimeout(120);
  await pad(page, 0).dispatchEvent('pointerup', touch);
  await expect
    .poll(() => lines(page, 'Plate 1 1: short press'), { timeout: 5000 })
    .toBe(before + 1);

  // Keyboard: Space held is a hold, and a Space tap is a short press.
  const starts = await lines(page, 'Plate 1 1: long press start');
  await pad(page, 0).focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  await page.keyboard.up('Space');
  await expect
    .poll(() => lines(page, 'Plate 1 1: long press start'), { timeout: 5000 })
    .toBe(starts + 1);
  await noProblems(w);
});

test('a plate on an address with no driver does nothing and says why, and Panic stops a hold', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const w = await openApp(page);
  await addPlate(page, '30');
  await openConsole(page);
  await pad(page, 0).click({ delay: 100 });
  await expect(consoleLog(page)).toContainText('A30 has no driver', { timeout: 5000 });
  await page.getByTestId('plate-remove-p1').click();

  // A plate on the bench: hold the bottom button, then Panic.
  await page.getByTestId('plate-address').locator('input').fill('0');
  await page.getByTestId('plate-address').locator('input').press('Enter');
  await page.getByTestId('plate-add').click();
  await pad(page, 1).hover();
  await page.mouse.down();
  await page.waitForTimeout(800);
  // The mouse is down on a pad, so its pointer is captured: Panic by the keyboard.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('latched')).toBeVisible();
  await expect(pad(page, 1)).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.up();
  // While latched a press sends nothing, and says so.
  await pad(page, 0).click({ delay: 100 });
  await expect(consoleLog(page)).toContainText('Panic is on', { timeout: 5000 });
  await noProblems(w);
});

test('Alt-0 opens Switches, and a plate and its mapping are kept across a reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const w = await openApp(page);
  await page.keyboard.press('Alt+Digit0');
  await expect(page.getByRole('heading', { level: 1, name: 'Switches' })).toBeVisible();
  await page.getByTestId('plate-layout').getByRole('button', { name: '4 buttons' }).click();
  await page.getByTestId('plate-add').click();
  await page.getByTestId('plate-edit-p1').click();
  await page.getByTestId('map-double-kind').selectOption('scene');
  await expect(page.getByTestId('map-double-slot')).toBeVisible();
  // The save is debounced.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await page.keyboard.press('Alt+Digit0');
  await expect(page.getByTestId('plate-p1-button-3')).toBeVisible();
  await page.getByTestId('plate-edit-p1').click();
  await expect(page.getByTestId('map-double-kind')).toHaveValue('scene');
  await noProblems(w);
});
