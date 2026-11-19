/**
 * E-ab (TEST_PLAN section 7, SPEC R12.2): two set-ups side by side, with one camera, one exposure
 * and one white balance, both driven by the same addresses. A change to B leaves A alone.
 */
import { expect, test } from '@playwright/test';
import { goTo, noProblems, openApp, openConsole, typeLine } from './app.ts';
import { readPng } from './png.ts';

const READY = 'Bounced light ready';

test('shows A and B side by side, edits B alone, and both follow one command', async ({ page }) => {
  const w = await openApp(page);
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
  await expect(page.getByTestId('hallway-b')).toHaveCount(0);

  await page.getByTestId('ab-toggle').locator('input').check();
  await expect(page.getByTestId('hallway-b-canvas')).toBeVisible();
  await expect(page.getByTestId('solve-status')).toContainText(`A: ${READY}`);
  await expect(page.getByTestId('solve-status-b')).toContainText(`B: ${READY}`, {
    timeout: 60_000,
  });
  // One set of view controls for both pictures.
  await expect(page.getByTestId('exposure')).toHaveCount(1);
  await expect(page.getByTestId('balance')).toHaveCount(1);

  // B loses tape A's cover. A keeps it.
  await page.getByTestId('editing').getByRole('button', { name: 'Set-up B' }).click();
  await page.getByTestId('mount-row-m1').click();
  await expect(page.getByTestId('mount-editor')).toContainText('B:');
  await page.getByTestId('mount-diffuser').selectOption('none');
  await expect(page.getByTestId('mount-b-0')).toContainText('cover: No cover');
  await expect(page.getByTestId('mount-0')).toContainText('cover: Opal (Linear Lux)');

  // One command lights both, through the same address. The bare tape gives out more.
  await openConsole(page);
  await typeLine(page, 'tc 0 3000K 30%');
  await page.keyboard.press('Control+Backquote');
  const a = page.getByTestId('mount-0-flux');
  const b = page.getByTestId('mount-b-0-flux');
  await expect(a).not.toHaveText('0.00', { timeout: 15_000 });
  await expect(b).not.toHaveText('0.00');
  await expect(async () => {
    const fa = Number(await a.innerText());
    const fb = Number(await b.innerText());
    await page.waitForTimeout(700);
    expect(Number(await a.innerText())).toBe(fa);
    expect(fb).toBeGreaterThan(fa);
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('probe-b')).toContainText('lux');

  // Copy A to B makes them the same again; turning A/B off leaves one picture.
  await page.getByTestId('copy-a-to-b').click();
  await expect(page.getByTestId('mount-b-0')).toContainText('cover: Opal (Linear Lux)');
  await page.getByTestId('ab-toggle').locator('input').uncheck();
  await expect(page.getByTestId('hallway-b')).toHaveCount(0);
  await expect(page.getByTestId('solve-status')).not.toContainText('A:');

  // Turning B on and off releases its GL context each time, so picture A keeps its own (S8-L3).
  const toggle = page.getByTestId('ab-toggle').locator('input');
  for (let i = 0; i < 20; i++) {
    await toggle.check();
    await expect(page.getByTestId('solve-status-b')).toContainText(`B: ${READY}`, {
      timeout: 60_000,
    });
    await toggle.uncheck();
    await expect(page.getByTestId('hallway-b')).toHaveCount(0);
  }
  const shot = readPng(await page.getByTestId('hallway-canvas').screenshot());
  const middle = shot.at(Math.round(shot.width / 2), Math.round(shot.height * 0.8));
  expect(Math.max(...middle)).toBeGreaterThan(20);
  await noProblems(w);
});
