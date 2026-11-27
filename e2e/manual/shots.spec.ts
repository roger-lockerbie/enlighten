/**
 * The manual's pictures (ADR 0024). Each test follows the steps of a guide chapter in the simulator
 * and takes the pictures that chapter shows, so a step that stops working fails here.
 * Run with `pnpm manual:shots`.
 */
import { expect, test, type Page } from '@playwright/test';
import { enter, goTo, openConsole, panicLatched, ready, typeLine } from '../app.ts';
import { shot } from './shot.ts';

/** The page's main region, without the rail and the inspector. */
const main = (page: Page) => page.getByRole('main');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await ready(page);
  // The top bar's bus figure is from the last snapshot, which was taken during the scan. A line
  // that sends nothing, a moment later, brings a snapshot of the bus at rest.
  await page.waitForTimeout(1500);
  await openConsole(page);
  await typeLine(page, 'devices');
  await expect(page.getByText(/^Bus [0-9]%$/)).toBeVisible({ timeout: 20_000 });
  await typeLine(page, 'clear');
  await page.keyboard.press('Control+Backquote');
});

test('the ceiling and panic', async ({ page }) => {
  const bar = page.getByRole('banner', { name: 'Top bar' });
  // A narrower window for this one, so the bar's text is large enough to read in a page.
  await page.setViewportSize({ width: 1100, height: 900 });
  await shot(page, 'topbar', {
    of: bar,
    margin: 14,
    callouts: [
      { at: bar.getByRole('button', { name: 'Simulator', exact: true }), corner: 'bottom-left' },
      { at: page.getByTestId('ceiling'), corner: 'bottom-left' },
      { at: page.getByTestId('verified'), corner: 'bottom-left' },
      { at: page.getByTestId('unlocks'), corner: 'bottom-left' },
      { at: bar.getByRole('button', { name: 'Panic' }), corner: 'bottom-left' },
    ],
  });

  await page.setViewportSize({ width: 1440, height: 900 });

  // Lower the ceiling to 20%.
  await page.getByTestId('ceiling').click();
  const dialog = page.getByTestId('ceiling-dialog');
  await expect(dialog).toBeVisible();
  await enter(page, 'ceiling-percent', '20');
  await shot(page, 'ceiling-dialog', {
    of: dialog,
    callouts: [
      { at: page.getByTestId('ceiling-percent'), corner: 'left' },
      { at: dialog.getByRole('button', { name: 'Lower now' }) },
      { at: dialog.getByRole('button', { name: 'Raise', exact: true }), corner: 'top-right' },
    ],
  });
  await dialog.getByRole('button', { name: 'Lower now' }).click();
  await expect(page.getByTestId('ceiling')).toContainText('arc 195', { timeout: 20_000 });
  // The dialog closes itself when the ceiling is lowered.
  await expect(dialog).toBeHidden();

  // A level above the ceiling is held to it.
  await openConsole(page);
  await typeLine(page, 'level 0 100%');
  await expect(page.getByTestId('console-log')).toContainText('clamped');
  await page.keyboard.press('Control+Backquote');
  await goTo(page, 'Playground');
  await shot(page, 'ceiling-held', { of: page.getByTestId('panel-0') });

  // Panic, and the latch.
  await bar.getByRole('button', { name: 'Panic' }).click();
  await panicLatched(page);
  await shot(page, 'panic-latched', {
    of: page.getByRole('alert').filter({ hasText: 'Panic is on' }),
    margin: 60,
    callouts: [
      { at: page.getByTestId('latched'), corner: 'bottom-left' },
      { at: page.getByRole('button', { name: 'Resume' }), corner: 'bottom-left' },
    ],
  });
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('latched')).toHaveCount(0);
});

test('the bench and simulated drivers', async ({ page }) => {
  await goTo(page, 'Devices');
  const inventory = page.getByRole('heading', { name: 'Inventory' }).locator('..');
  await shot(page, 'devices-inventory', {
    of: inventory,
    callouts: [
      { at: page.getByRole('button', { name: 'Scan again' }) },
      { at: page.getByTestId('device-0').getByTestId('profile-status'), corner: 'left' },
      { at: page.getByTestId('device-1').getByText('RGBWAF channels'), corner: 'left' },
    ],
  });
  // Add a third, simulated driver at address 2.
  await enter(page, 'extra-address', '2');
  await page.getByTestId('extra-type').selectOption('C2');
  await page.getByTestId('extra-add').click();
  await expect(page.getByTestId('verified')).toHaveText('3/3 verified', { timeout: 60_000 });
  await expect(page.getByTestId('extras-message')).toHaveText('Added a driver at address 2.');
  await page.getByTestId('extra-add').scrollIntoViewIfNeeded();
  await shot(page, 'devices-simulated', {
    of: page.getByRole('heading', { name: 'Simulated drivers' }).locator('..'),
    callouts: [
      { at: page.getByTestId('extra-address'), corner: 'left' },
      { at: page.getByTestId('extra-type') },
      { at: page.getByTestId('extra-add'), corner: 'top-right' },
    ],
  });
  const sim = page.getByTestId('sim-settings');
  await sim.getByTestId('setting-maxLowerPullsDown').scrollIntoViewIfNeeded();
  await shot(page, 'devices-sim-settings', {
    of: sim.getByTestId('setting-maxLowerPullsDown').locator('xpath=ancestor::table'),
    callouts: [{ at: sim.getByTestId('setting-maxLowerPullsDown').getByRole('combobox') }],
  });
  await page.getByTestId('extra-remove-2').click();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
});

test('levels, colour and fades in the playground', async ({ page }) => {
  await goTo(page, 'Playground');
  await enter(page, 'level-0-left', '10');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('%');
  await enter(page, 'tc-0-left', '3000');
  await expect(page.getByTestId('tc-0-feedback')).toContainText('Sent 333 mirek.');
  const a0 = page.getByTestId('panel-0');
  await shot(page, 'playground-level', {
    of: a0,
    callouts: [
      { at: page.getByTestId('level-0-left'), corner: 'left' },
      { at: a0.getByRole('switch', { name: 'Power' }), corner: 'left' },
      { at: a0.getByRole('button', { name: 'Dim up' }), corner: 'top-right' },
      { at: page.getByTestId('tc-0-left'), corner: 'left' },
      { at: page.getByTestId('fade-0').getByRole('combobox'), corner: 'left' },
    ],
  });
  // Colour on the RGB driver.
  await page.waitForTimeout(2200);
  await enter(page, 'level-1-left', '10');
  const colour = page.getByTestId('colour-1');
  await page.waitForTimeout(2200);
  await colour.getByRole('slider', { name: /Hue/ }).fill('200');
  await colour.getByRole('slider', { name: /Saturation/ }).fill('70');
  await expect(page.getByTestId('colour-1-feedback')).toContainText('Sent channels', {
    timeout: 20_000,
  });
  await shot(page, 'playground-colour', {
    of: page.getByTestId('panel-1'),
    callouts: [
      { at: colour.getByRole('button', { name: 'Colour', exact: true }) },
      { at: colour.getByRole('slider', { name: /Hue/ }), corner: 'left' },
      { at: colour.getByRole('slider', { name: 'White' }), corner: 'left' },
    ],
  });
  await shot(page, 'bench-preview', {
    of: page.getByRole('heading', { name: /Bench preview/ }).locator('..'),
  });

  // A fade: choose 2 s, then move the level and catch it on the way.
  const fade = page.getByTestId('fade-0');
  await fade.getByRole('combobox').selectOption({ label: '8 s (standard fade time 8)' });
  await expect(page.getByTestId('fade-0-why')).toContainText('A level change takes 8 s.');
  await page.waitForTimeout(2200);
  await enter(page, 'level-0-left', '35');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('fading');
  await shot(page, 'playground-fade', {
    of: a0,
    callouts: [
      { at: fade.getByRole('combobox'), corner: 'left' },
      { at: page.getByTestId('fade-0-why'), corner: 'left' },
    ],
  });
  await shot(page, 'bench-preview-fading', {
    of: page.getByRole('heading', { name: /Bench preview/ }).locator('..'),
  });
});

test('looks and slots', async ({ page }) => {
  await goTo(page, 'Looks');
  await page.getByTestId('look-new').click();
  await page.getByTestId('look-name').fill('Warm low');
  await enter(page, 'look-level-left', '10');
  await page.getByTestId('look-kind').getByRole('button', { name: 'Colour temperature' }).click();
  await enter(page, 'look-tc-left', '2700');
  await page.getByTestId('look-save').scrollIntoViewIfNeeded();
  await shot(page, 'looks-editor', {
    of: page
      .getByTestId('look-name')
      .locator('xpath=ancestor::*[self::form or self::section or self::div][2]'),
    callouts: [
      { at: page.getByTestId('look-name'), corner: 'left' },
      { at: page.getByTestId('look-kind') },
      { at: page.getByTestId('look-save') },
    ],
  });
  await page.getByTestId('look-save').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Saved "Warm low".');
  await page.getByTestId('slot-0-look').selectOption('Warm low');
  await page.getByTestId('slot-0-write').click();
  await expect(page.getByTestId('slot-0-state')).toContainText('read back', { timeout: 30_000 });
  await page.getByTestId('slot-0-recall').click();
  await expect(page.getByTestId('looks-message')).toHaveText('Recalled slot 0 on A0.');
  await page.getByTestId('slot-0-state').scrollIntoViewIfNeeded();
  await shot(page, 'looks-slots', {
    of: page.getByTestId('slot-2-state').locator('xpath=ancestor::table'),
    callouts: [
      { at: page.getByTestId('slot-0-state'), corner: 'left' },
      { at: page.getByTestId('slot-0-write') },
      { at: page.getByTestId('slot-0-recall') },
    ],
  });
});

test('a sequence, planned before it runs', async ({ page }) => {
  await goTo(page, 'Sequences');
  await page.getByTestId('preset-night').click();
  await expect(page.getByTestId('plan-summary')).toContainText('5 changes');
  await page.getByTestId('run-start').scrollIntoViewIfNeeded();
  await shot(page, 'sequence-plan', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('plan-summary'), corner: 'left' },
      { at: page.getByTestId('plan-rows'), corner: 'left' },
      { at: page.getByTestId('run-check') },
      { at: page.getByTestId('run-start'), corner: 'top-right' },
    ],
  });
});

test('an effect, with its cost', async ({ page }) => {
  await enter(page, 'level-0-right', '150');
  await page.waitForTimeout(2200);
  await enter(page, 'level-1-right', '150');
  await goTo(page, 'Effects');
  await page.getByTestId('effect-breathe').click();
  await enter(page, 'param-depth', '10');
  await enter(page, 'param-period', '8');
  await expect(page.getByTestId('effect-cost')).toContainText('% of the bus');
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('run-message')).toContainText('nothing is refused', {
    timeout: 60_000,
  });
  await page.getByTestId('effect-breathe').scrollIntoViewIfNeeded();
  await shot(page, 'effect-breathe', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('effect-breathe') },
      { at: page.getByTestId('param-depth'), corner: 'left' },
      { at: page.getByTestId('effect-cost'), corner: 'left' },
      { at: page.getByTestId('run-check') },
    ],
  });
});

test('a switch plate', async ({ page }) => {
  await goTo(page, 'Switches');
  await enter(page, 'plate-address', '0');
  await page.getByTestId('plate-add').click();
  await expect(page.getByTestId('plate-p1')).toBeVisible();
  await page.getByTestId('plate-edit-p1').click();
  await page.getByTestId('plate-p1').scrollIntoViewIfNeeded();
  await shot(page, 'switch-plate', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('plate-p1-button-0') },
      { at: page.getByTestId('plate-edit-p1') },
    ],
  });
});

test('the visualiser', async ({ page }) => {
  await enter(page, 'level-0-left', '30');
  await page.waitForTimeout(2200);
  await enter(page, 'level-1-left', '20');
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  await page.getByRole('main').evaluate((el) => {
    el.scrollTop = 0;
  });
  await shot(page, 'visualiser-picture', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('camera-mode') },
      { at: page.getByTestId('hallway-canvas') },
      { at: page.getByTestId('solve-status'), corner: 'bottom-left' },
    ],
  });
  await page.getByTestId('false-colour').scrollIntoViewIfNeeded();
  await shot(page, 'visualiser-view', {
    of: [page.getByTestId('probe'), page.getByTestId('false-colour')],
    margin: 24,
    callouts: [
      { at: page.getByTestId('probe'), corner: 'left' },
      { at: page.getByTestId('exposure'), corner: 'left' },
      { at: page.getByTestId('balance'), corner: 'left' },
      { at: page.getByTestId('false-colour'), corner: 'left' },
    ],
  });
  await page.getByTestId('false-colour').getByRole('button', { name: 'Lux' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('main').evaluate((el) => {
    el.scrollTop = 0;
  });
  await shot(page, 'visualiser-lux', {
    of: [page.getByTestId('hallway-canvas'), page.getByTestId('legend')],
  });
  await page.getByTestId('false-colour').getByRole('button', { name: 'Picture' }).click();
  await page.getByTestId('mount-row-m1').click();
  await page.getByTestId('add-mount').scrollIntoViewIfNeeded();
  await shot(page, 'visualiser-mounts', {
    of: [main(page), page.getByTestId('mount-editor')],
    margin: 0,
    callouts: [
      { at: page.getByTestId('mount-row-m1'), corner: 'left' },
      { at: page.getByTestId('add-mount') },
      { at: page.getByTestId('mount-editor'), corner: 'top-left' },
    ],
  });
});

test('the console, scripts and the bus monitor', async ({ page }) => {
  await openConsole(page);
  await typeLine(page, 'trace on');
  await typeLine(page, 'explain tc 0 3000K 30%');
  await expect(page.getByTestId('console-log')).toContainText('Nothing was sent.');
  await typeLine(page, 'tc 0 3000K 30%');
  await expect(page.getByTestId('console-log')).toContainText('A0 3003K');
  await shot(page, 'console-explain', { of: page.getByTestId('console'), margin: 0 });
  await typeLine(page, 'trace off');
  await typeLine(page, 'clear');
  await typeLine(page, 'help set-max-level');
  await expect(page.getByTestId('console-log')).toContainText('SET MAX LEVEL, IEC 62386-102');
  await shot(page, 'console-help', { of: page.getByTestId('console'), margin: 0 });
  await page.keyboard.press('Control+Backquote');

  await goTo(page, 'Scripts');
  await page.getByTestId('script-list').getByText('first-light').first().click();
  await shot(page, 'scripts-page', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('script-list'), corner: 'left' },
      { at: page.getByTestId('script-text'), corner: 'left' },
      { at: page.getByTestId('script-parse'), corner: 'left' },
    ],
  });

  await goTo(page, 'Bus monitor');
  await shot(page, 'bus-monitor', {
    of: main(page),
    margin: 0,
    callouts: [
      { at: page.getByTestId('filter-source'), corner: 'bottom-left' },
      { at: page.getByTestId('monitor'), corner: 'left' },
    ],
  });

  await goTo(page, 'Settings');
  await page.getByTestId('export').scrollIntoViewIfNeeded();
  await shot(page, 'settings-workspace', {
    of: page.getByRole('heading', { name: 'Workspace' }).locator('..'),
    callouts: [
      { at: page.getByTestId('export') },
      { at: page.getByText('Import a workspace'), corner: 'top-right' },
    ],
  });
});
