/**
 * E-visualiser, the Stage 8 part (TEST_PLAN section 7): add, edit, mirror and remove mounts; an edit
 * that is refused says why; presets; a mount bound to an address with no driver says so; the camera
 * by preset, keys, wheel and fields; the probe against the pure core after the camera moves; and the
 * set-up and view kept across a reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraFor, downHall, ray } from '../src/light/camera.ts';
import { xyToXyz } from '../src/light/colour/xyz.ts';
import { buildGeometry, pick } from '../src/light/geometry.ts';
import { illuminanceAt } from '../src/light/probe.ts';
import { solveScene } from '../src/light/response.ts';
import { defaultScene } from '../src/light/scene.ts';
import { enter, field, goTo, noProblems, openApp, openConsole, typeLine } from './app.ts';

const READY = 'Bounced light ready';

async function openVisualiser(page: Page): Promise<void> {
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
}

/** The Visualiser is saved 0.4 s after the last change, and the app comes back on its page. */
async function reloaded(page: Page): Promise<void> {
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
}

/** Wait until a mount's output stops changing: its fade has ended. */
async function settled(page: Page, mount: number): Promise<void> {
  const flux = page.getByTestId(`mount-${String(mount)}-flux`);
  await expect(async () => {
    const a = await flux.innerText();
    await page.waitForTimeout(700);
    expect(await flux.innerText()).toBe(a);
  }).toPass({ timeout: 20_000 });
}

test('adds, edits, mirrors and removes mounts, says why an edit is refused, and keeps them', async ({
  page,
}) => {
  const w = await openApp(page);
  await openVisualiser(page);
  const rows = page.getByTestId('mount-list').locator('li');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('mount-row-m1')).toHaveText(
    /Left: skirting slot, facing down\. Tunable white, 120 LEDs\/m, address 0, Opal \(Linear Lux\) cover\./,
  );

  // A second skirting slot on the left wall would sit where the first is.
  await page.getByTestId('add-kind').selectOption('skirting');
  await page.getByTestId('add-side').selectOption('left');
  await page.getByTestId('add-mount').click();
  await expect(page.getByTestId('setup-message')).toHaveText(
    'Two mounts would take the same place on one wall.',
  );
  await expect(rows).toHaveCount(2);

  // A channel fits above it.
  await page.getByTestId('add-kind').selectOption('channel');
  await page.getByTestId('add-mount').click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('setup-message')).toHaveText('');
  const m3 = page.getByTestId('mount-row-m3');
  await expect(m3).toContainText('Left: flush channel at 600 mm, facing in.');
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });

  // Edit it in the inspector.
  await m3.click();
  await expect(m3).toHaveAttribute('aria-pressed', 'true');
  const editor = page.getByTestId('mount-editor');
  await expect(editor).toBeVisible();
  await enter(page, 'mount-height', '1000');
  await expect(m3).toContainText('at 1000 mm');
  await page.getByTestId('mount-diffuser').selectOption('none');
  await expect(m3).toContainText('no cover.');
  // A channel at the top of the wall would not fit there, and is refused with the reason.
  await enter(page, 'mount-height', '2700');
  await expect(page.getByTestId('mount-message')).toHaveText(
    'The mount would not fit on the wall.',
  );
  await expect(m3).toContainText('at 1000 mm');

  // An address with no driver draws unlit and says so.
  await enter(page, 'mount-address', '7');
  await expect(m3).toContainText('No driver at address 7.');
  await expect(page.getByTestId('mount-2')).toContainText('No driver at address 7.');
  // Tape B on the tunable-white driver: the tape's colour channels have nothing to feed them.
  await page.getByTestId('mount-tape').selectOption('B');
  await enter(page, 'mount-address', '0');
  await expect(m3).toContainText("Its driver does not feed the tape's");

  // Mirrored onto the right wall: the twin follows every edit.
  await page.getByTestId('mount-mirror').locator('input').check();
  await expect(rows).toHaveCount(4);
  await expect(m3).toContainText('Mirrored with m4.');
  const m4 = page.getByTestId('mount-row-m4');
  await expect(m4).toContainText('Right: flush channel at 1000 mm');
  await enter(page, 'mount-height', '1200');
  await expect(m4).toContainText('at 1200 mm');

  // Removing one leaves the other unlinked.
  await m4.click();
  await page.getByTestId('mount-remove').click();
  await expect(rows).toHaveCount(3);
  await expect(m3).not.toContainText('Mirrored');
  await m3.click();
  await page.getByTestId('mount-remove').click();
  await expect(rows).toHaveCount(2);

  // A preset replaces the mounts and keeps the hallway.
  await enter(page, 'hall-length', '4');
  await page.getByTestId('preset-reveal-up').click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('mount-row-m1')).toContainText(
    'Left: shadowline reveal at 2400 mm, facing up.',
  );
  await page.getByTestId('preset-mirrored').click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('mount-row-m1')).toContainText('Mirrored with m2.');
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });

  await reloaded(page);
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('mount-row-m2')).toContainText('Right: skirting slot');
  await expect(field(page, 'hall-length')).toHaveValue('4.00');
  await noProblems(w);
});

test('moves the camera by preset, keys, wheel and fields, and the probe still matches the core', async ({
  page,
}) => {
  const w = await openApp(page);
  await openVisualiser(page);
  await openConsole(page);
  await typeLine(page, 'tc 0 3000K 30%');
  await expect(page.getByTestId('mount-0-flux')).not.toHaveText('0.00', { timeout: 15_000 });
  await page.keyboard.press('Control+Backquote');
  await settled(page, 0);

  // Walk: Shift W is a metre, W a quarter. Then turn by the field.
  const picture = page.getByTestId('hallway');
  await picture.focus();
  await page.keyboard.press('Shift+W');
  await page.keyboard.press('w');
  await expect(field(page, 'camera-x')).toHaveValue('1.60');
  await page.keyboard.press('a');
  await expect(field(page, 'camera-z')).toHaveValue('0.35');
  await page.keyboard.press('d');
  await expect(field(page, 'camera-z')).toHaveValue('0.60');
  await enter(page, 'camera-yaw', '10');

  // The probe reads the same light as the core, at the place it marks, from the new place.
  const scene = defaultScene();
  const view = { ...downHall(scene), x: 1.6, yaw: 10 };
  const camera = cameraFor(scene, view);
  const g = buildGeometry(scene);
  const response = solveScene(scene);
  const flux = Number(await page.getByTestId('mount-0-flux').innerText());
  const x = Number(await page.getByTestId('mount-0-x').innerText());
  const y = Number(await page.getByTestId('mount-0-y').innerText());
  const light = [xyToXyz({ x, y }, flux), [0, 0, 0] as const];
  await picture.focus();
  await page.keyboard.press('ArrowDown');
  const box = await page.getByTestId('hallway-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  const pr = ray(camera, box.width / box.height, 0, 1 - 0.77 * 2);
  const ph = pick(g, pr.origin, pr.direction);
  if (ph === undefined) throw new Error('the probe is over nothing');
  const expected = illuminanceAt(g, response, light, ph.face, ph.s, ph.t).xyz[1];
  expect(expected).toBeGreaterThan(0.1);
  const lux = Number(await page.getByTestId('probe-lux').innerText());
  expect(Math.abs(lux / expected - 1)).toBeLessThan(0.03);

  // Orbit, and the wheel moves in.
  const mode = page.getByTestId('camera-mode');
  await mode.getByRole('button', { name: 'Orbit' }).click();
  await expect(field(page, 'camera-distance')).toHaveValue('2.50');
  await picture.hover();
  await page.mouse.wheel(0, -200);
  await expect(field(page, 'camera-distance')).not.toHaveValue('2.50');

  // Close on the selected mount, then at its wall.
  await mode.getByRole('button', { name: 'Close up' }).click();
  await expect(page.getByTestId('camera-mount')).toHaveValue('m1');
  await page.getByTestId('camera-wall').click();
  await expect(mode.getByRole('button', { name: 'Walk' })).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page, 'camera-yaw')).toHaveValue('-90');

  // The view is kept.
  await reloaded(page);
  await expect(field(page, 'camera-yaw')).toHaveValue('-90');
  await page.getByTestId('camera-down').click();
  await expect(field(page, 'camera-x')).toHaveValue('0.35');
  await noProblems(w);
});

test('edits change the picture at most once a second (S6.1)', async ({ page }) => {
  const w = await openApp(page);
  await openVisualiser(page);
  await openConsole(page);
  await typeLine(page, 'tc 0 3000K 30%');
  await page.keyboard.press('Control+Backquote');
  await settled(page, 0);
  // Solve both places once, so each later edit's light comes back from the cache at once.
  await page.getByTestId('mount-row-m1').click();
  const wall = page.getByTestId('mount-side');
  await wall.getByRole('button', { name: 'Right' }).click();
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
  await wall.getByRole('button', { name: 'Left' }).click();
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });

  // Note the time of every change of surfaces while the wall is clicked back and forth fast.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="hallway"]');
    const log: number[] = [];
    (globalThis as unknown as { swaps: number[] }).swaps = log;
    if (el !== null) {
      new MutationObserver(() => log.push(performance.now())).observe(el, {
        attributes: true,
        attributeFilter: ['data-swaps'],
      });
    }
  });
  const start = await page.evaluate(() => performance.now());
  for (let i = 0; i < 6; i++) {
    await wall.getByRole('button', { name: i % 2 === 0 ? 'Right' : 'Left' }).click();
    await page.waitForTimeout(330);
  }
  const end = await page.evaluate(() => performance.now());
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const times = await page.evaluate(() => (globalThis as unknown as { swaps: number[] }).swaps);
  // Clicks take a while in software GL, so the count is held to the time they took.
  expect(times.length).toBeGreaterThan(0);
  expect(times.length).toBeLessThanOrEqual(Math.floor((end - start) / 1000) + 2);
  for (let i = 1; i < times.length; i++) {
    expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(990);
  }
  // It ends on the last edit: the slot is on the left wall.
  await expect(page.getByTestId('mount-row-m1')).toContainText('Left: skirting slot');
  await noProblems(w);
});
