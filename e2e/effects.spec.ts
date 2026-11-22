/**
 * E-effects: each built-in effect is offered with its settings and its bus cost (SPEC R4.1, R4.2),
 * an effect starts and stops, a setting the governor would refuse is refused with its reason, and an
 * effect runs across a simulated driver beyond the bench's two (R4.3).
 */
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp } from './app.ts';

const EFFECTS = [
  'breathe',
  'swell',
  'tc-drift',
  'hue-drift',
  'warm-shift',
  'accent-tint',
  'two-tone',
  'notification',
  'presence',
  'sunrise',
];

test('every effect is offered, and says what it needs when the lights are off', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Effects');
  for (const id of EFFECTS) {
    await page.getByTestId(`effect-${id}`).click();
    await expect(page.getByTestId(`effect-${id}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('effect-about')).not.toBeEmpty();
    // Sunrise starts from off, so it plans at once. The rest move around a level that is not set yet.
    if (id === 'sunrise') await expect(page.getByTestId('effect-cost')).toBeVisible();
    else await expect(page.getByTestId('effect-problem')).toBeVisible();
  }
  await page.getByTestId('effect-breathe').click();
  await expect(page.getByTestId('effect-problem')).toContainText('A0 is off. Set a level first');
  await expect(page.getByTestId('run-start')).toBeDisabled();
  await noProblems(w);
});

test('breathe shows its cost, starts, runs and stops, and its settings are kept', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const w = await openApp(page);
  // Levels first: an effect moves around where the light is.
  await enter(page, 'level-0-right', '150');
  await page.waitForTimeout(2200);
  await enter(page, 'level-1-right', '150');
  await page.waitForTimeout(2200);
  await goTo(page, 'Effects');
  await page.getByTestId('effect-breathe').click();
  await enter(page, 'param-depth', '10');
  await enter(page, 'param-period', '8');
  await expect(page.getByTestId('effect-cost')).toContainText('% of the bus');
  await expect(page.getByTestId('cost-0')).toContainText('frames a second');
  await expect(page.getByTestId('plan-summary')).toContainText('starting again every 8 s');
  await expect(page.getByTestId('plan-rows')).toContainText('arc 160');

  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('run-message')).toContainText('nothing is refused', {
    timeout: 60_000,
  });
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running: "Breathe"', {
    timeout: 60_000,
  });
  // It comes round again: a second pass starts.
  await expect(page.getByTestId('run-status')).toContainText('pass 2', { timeout: 30_000 });
  await page.getByTestId('run-stop').click();
  await expect(page.getByTestId('run-ended')).toContainText('Stopped: Stopped by a person.');

  await page.getByTestId('effect-name').fill('Slow breath');
  await page.getByTestId('effect-save').click();
  await expect(page.getByTestId('effects-message')).toHaveText('Saved "Slow breath".');
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('saved-effects')).toContainText('Slow breath');
  await page.getByRole('button', { name: 'Open Slow breath' }).click();
  await expect(page.getByTestId('param-depth').locator('input')).toHaveValue('10');
  await noProblems(w);
});

test('two-tone runs across a simulated driver beyond the bench', async ({ page }) => {
  test.setTimeout(240_000);
  const w = await openApp(page);
  await goTo(page, 'Devices');
  await enter(page, 'extra-address', '5');
  await page.getByTestId('extra-type').selectOption('C2');
  await page.getByTestId('extra-add').click();
  await expect(page.getByTestId('verified')).toHaveText('3/3 verified', { timeout: 60_000 });
  await goTo(page, 'Playground');
  await expect(page.getByTestId('panel-5')).toContainText('Presents as', { timeout: 60_000 });
  await page.waitForTimeout(2500);
  for (const n of [0, 1, 5]) {
    await enter(page, `level-${String(n)}-right`, '150');
    await page.waitForTimeout(2200);
  }
  await goTo(page, 'Effects');
  await page.getByTestId('effect-two-tone').click();
  // All three drivers are aimed at to begin with, and two-tone works on pairs.
  await expect(page.getByTestId('target-5')).toBeChecked();
  await expect(page.getByTestId('effect-problem')).toHaveText(
    'Two-tone works on pairs of drivers. Choose an even number.',
  );
  await page.getByTestId('target-1').uncheck();
  await expect(page.getByTestId('cost-5')).toContainText('frames a second');
  // One goes up eight levels. The other gives up the same light, which is ten levels down.
  const rows = page.getByTestId('plan-rows');
  await expect(rows).toContainText('arc 158');
  await expect(rows).toContainText('arc 140');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running: "Two-tone"', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('tape-5').getByTestId('tape-text')).toContainText('fading', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Panic', exact: true }).click();
  await expect(page.getByTestId('run-ended')).toContainText('Stopped');
  await expect(page.getByTestId('tape-5').getByTestId('tape-text')).toContainText('off');
  await noProblems(w);
});
