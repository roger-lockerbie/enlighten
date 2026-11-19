/**
 * V-hallway, the Stage 7 part (TEST_PLAN section 8): pictures of the default hallway in a few
 * states, against saved ones, with a small tolerance. Headless Chromium draws in software, so the
 * same baselines serve a laptop and CI. The numbers carry the accuracy (`e2e/visualiser.spec.ts`
 * and the unit tests): these catch a change in the shader or the layout that the numbers miss.
 *
 * `pnpm exec playwright test e2e/hallway.spec.ts --update-snapshots` writes new baselines.
 */
import { expect, test, type Page } from '@playwright/test';
import { consoleLog, goTo, noProblems, openApp, openConsole, typeLine } from './app.ts';

/** Wait until a mount's output stops changing: its fade has ended. */
async function settled(page: Page, mount: number): Promise<void> {
  const flux = page.getByTestId(`mount-${String(mount)}-flux`);
  await expect(async () => {
    const a = await flux.innerText();
    await page.waitForTimeout(700);
    expect(await flux.innerText()).toBe(a);
  }).toPass({ timeout: 20_000 });
}

/**
 * Run a console line and wait for the answer it should give. The rate guard holds a hard step that
 * follows another too soon, so the lines are spaced as a person would space them.
 */
async function run(page: Page, line: string, answer: string | RegExp): Promise<void> {
  await page.waitForTimeout(2200);
  await typeLine(page, line);
  await expect(consoleLog(page)).toContainText(answer, { timeout: 15_000 });
}

test('the hallway looks as it did', async ({ page }) => {
  const w = await openApp(page);
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
    timeout: 60_000,
  });
  const canvas = page.getByTestId('hallway-canvas');
  const shot = { maxDiffPixelRatio: 0.01, threshold: 0.06 };

  // Tape A, warm, in the skirting slot.
  await openConsole(page);
  await run(page, 'tc 0 2700K 30%', 'level 210 (30.1%)');
  await expect(page.getByTestId('mount-0-flux')).not.toHaveText('0.00', { timeout: 15_000 });
  await settled(page, 0);
  await expect(canvas).toHaveScreenshot('tape-a-warm.png', shot);

  // False colour of the same light.
  await page.getByTestId('false-colour').getByRole('button', { name: 'Lux' }).click();
  await expect(canvas).toHaveScreenshot('tape-a-warm-lux.png', shot);
  await page.getByTestId('false-colour').getByRole('button', { name: 'Picture' }).click();

  // Tape B, a saturated blue, in the wall channel, with tape A off.
  await run(page, 'off 0', 'off A0');
  await run(page, 'rgb 1 0 0 254', 'A1 channels 0 0 254 0 0');
  await run(page, 'level 1 30%', 'A1 level 210 (30.1%)');
  await expect(page.getByTestId('mount-1-flux')).not.toHaveText('0.00', { timeout: 15_000 });
  await settled(page, 1);
  await settled(page, 0);
  await expect(page.getByTestId('mount-0-flux')).toHaveText('0.00');
  await expect(page.getByRole('main')).toContainText(
    'A screen cannot show LED colours at full saturation',
  );
  await expect(canvas).toHaveScreenshot('tape-b-blue.png', shot);

  // Both, at the night exposure.
  await run(page, 'tc 0 2700K 5%', 'level 144 (5%)');
  await settled(page, 0);
  await page.getByTestId('exposure').getByRole('button', { name: 'Night-adapted' }).click();
  await expect(canvas).toHaveScreenshot('both-night.png', shot);
  await noProblems(w);
});
