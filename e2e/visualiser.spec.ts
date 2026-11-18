/**
 * E-visualiser, the Stage 7 part (TEST_PLAN section 7): the page opens and solves in the light
 * worker, a DALI change shows in the probe, the shader's pixels match the pure core, the view
 * settings persist, a solved scene is kept and reused, and a bad cache record is replaced.
 */
import { expect, test, type Page } from '@playwright/test';
import { defaultCamera, ray } from '../src/light/camera.ts';
import { PRESET_EV } from '../src/light/colour/exposure.ts';
import { paletteAt, falsePosition } from '../src/light/colour/falsecolour.ts';
import { xyToXyz } from '../src/light/colour/xyz.ts';
import { shade } from '../src/light/frame.ts';
import { buildGeometry, pick } from '../src/light/geometry.ts';
import { illuminanceAt } from '../src/light/probe.ts';
import { solveScene } from '../src/light/response.ts';
import { defaultScene } from '../src/light/scene.ts';
import { goTo, noProblems, openApp, openConsole, typeLine } from './app.ts';
import { readPng } from './png.ts';

const READY = 'Bounced light ready';

/** After a reload the app comes back on the Visualiser, so wait on the top bar, not the Playground. */
async function reloaded(page: Page): Promise<void> {
  // Preferences are saved a quarter of a second after the last change.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
}

async function openVisualiser(page: Page): Promise<void> {
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText(READY, { timeout: 60_000 });
}

/** What mount 0 is giving out, as the page reports it: XYZ per metre with Y in lumens. */
async function mountLight(page: Page, index: number): Promise<[number, number, number]> {
  const id = `mount-${String(index)}`;
  const flux = Number(await page.getByTestId(`${id}-flux`).innerText());
  if (flux === 0) return [0, 0, 0];
  const x = Number(await page.getByTestId(`${id}-x`).innerText());
  const y = Number(await page.getByTestId(`${id}-y`).innerText());
  const [X, Y, Z] = xyToXyz({ x, y }, flux);
  return [X, Y, Z];
}

test('solves in the light worker, follows the bus, and matches the pure core', async ({ page }) => {
  const w = await openApp(page);
  await openVisualiser(page);
  await expect(page.getByTestId('solve-status')).toContainText('just solved');
  await expect(page.getByRole('main').locator('header').getByText('estimated')).toBeVisible();
  // Nothing is lit yet.
  await expect(page.getByTestId('probe-lux')).toHaveText('0.0');
  await expect(page.getByTestId('mount-0-flux')).toHaveText('0.00');

  // Tape A on, from the console, through the governor like everything else.
  await openConsole(page);
  await typeLine(page, 'tc 0 3000K 30%');
  await expect(page.getByTestId('mount-0-flux')).not.toHaveText('0.00', { timeout: 15_000 });
  await page.keyboard.press('Control+Backquote');
  await page.getByTestId('balance').getByRole('button', { name: 'Daylight' }).click();
  await expect(page.getByTestId('balance-white')).toContainText('daylight');
  await expect(page.getByTestId('probe-lux')).not.toHaveText('0.0');

  // Wait for the fade to finish, so the picture and the numbers are of the same moment.
  const flux = page.getByTestId('mount-0-flux');
  await expect(async () => {
    const a = await flux.innerText();
    await page.waitForTimeout(700);
    expect(await flux.innerText()).toBe(a);
  }).toPass({ timeout: 20_000 });

  // The pure core's answer for the same scene and light.
  const scene = defaultScene();
  const g = buildGeometry(scene);
  const response = solveScene(scene);
  const light = [await mountLight(page, 0), await mountLight(page, 1)];
  expect(light[0]?.[1]).toBeGreaterThan(10);
  expect(light[1]).toEqual([0, 0, 0]);

  const canvas = page.getByTestId('hallway-canvas');
  const png = readPng(await canvas.screenshot());
  const camera = defaultCamera(scene);
  const aspect = png.width / png.height;
  const worst = { diff: 0, where: '' };
  let checked = 0;
  // A grid of points, kept away from the picture's edge.
  for (let iy = 1; iy < 10; iy++) {
    for (let ix = 1; ix < 12; ix++) {
      const px = Math.round((ix / 12) * png.width);
      const py = Math.round((iy / 10) * png.height);
      const r = ray(
        camera,
        aspect,
        ((px + 0.5) / png.width) * 2 - 1,
        1 - ((py + 0.5) / png.height) * 2,
      );
      const hit = pick(g, r.origin, r.direction);
      if (hit === undefined) continue;
      const face = g.faces[hit.face];
      if (face?.cell !== 0) continue;
      // Skip points beside an edge of their face, or beside the tape, where one pixel across the
      // picture is a large step in light.
      const margin = 0.06;
      if (
        hit.s < margin ||
        hit.t < margin ||
        hit.s > face.su - margin ||
        hit.t > face.sv - margin
      ) {
        continue;
      }
      const e = illuminanceAt(g, response, light, hit.face, hit.s, hit.t);
      const want = shade(e.xyz, face.reflectance, PRESET_EV.evening, 'srgb').map((v) => v * 255);
      const got = png.at(px, py);
      checked++;
      for (let k = 0; k < 3; k++) {
        const diff = Math.abs((got[k] ?? 0) - (want[k] ?? 0));
        if (diff > worst.diff) {
          worst.diff = diff;
          worst.where = `${face.name} at pixel ${String(px)}, ${String(py)}: got ${got.join(' ')}, want ${want.map((v) => v.toFixed(1)).join(' ')}`;
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(40);
  expect(worst.diff, worst.where).toBeLessThanOrEqual(6);

  // The probe reads the same light as the core, at the place it marks.
  await page.getByTestId('hallway').focus();
  await page.keyboard.press('ArrowDown');
  const lux = Number(await page.getByTestId('probe-lux').innerText());
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  const pr = ray(camera, box.width / box.height, 0, 1 - 0.77 * 2);
  const ph = pick(g, pr.origin, pr.direction);
  if (ph === undefined) throw new Error('the probe is over nothing');
  const expected = illuminanceAt(g, response, light, ph.face, ph.s, ph.t).xyz[1];
  expect(Math.abs(lux / expected - 1)).toBeLessThan(0.03);
  await expect(page.getByTestId('probe')).toContainText('Floor');
  await expect(page.getByTestId('probe')).toContainText(/30\d0 K/);

  // False colour by lux: the same pixels through the palette.
  await page.getByTestId('false-colour').getByRole('button', { name: 'Lux' }).click();
  await expect(page.getByTestId('legend')).toContainText('lux');
  await expect(async () => {
    const shot = readPng(await canvas.screenshot());
    const px = Math.round(shot.width / 2);
    const py = Math.round(shot.height * 0.77);
    const want = paletteAt(
      falsePosition(expected, { quantity: 'illuminance', min: 0.1, decades: 4 }),
    ).map((v) => v * 255);
    const got = shot.at(px, py);
    for (let k = 0; k < 3; k++)
      expect(Math.abs((got[k] ?? 0) - (want[k] ?? 0))).toBeLessThanOrEqual(8);
  }).toPass({ timeout: 10_000 });
  await noProblems(w);
});

test('keeps the view settings and the solved light across a reload', async ({ page }) => {
  const w = await openApp(page);
  await openVisualiser(page);
  await page.getByTestId('exposure').getByRole('button', { name: 'Night-adapted' }).click();
  await expect(page.getByTestId('exposure-white')).toContainText('1.20 cd/m²');
  await page.getByTestId('exposure').getByRole('button', { name: 'Manual' }).click();
  await page.getByTestId('exposure-ev').locator('input').fill('2.5');
  await page.getByTestId('exposure-ev').locator('input').press('Enter');
  await expect(page.getByTestId('exposure-white')).toContainText('6.79 cd/m²');
  await page.getByTestId('balance').getByRole('button', { name: 'Chosen' }).click();
  await page.getByTestId('balance-kelvin').locator('input').fill('3000');
  await page.getByTestId('balance-kelvin').locator('input').press('Enter');
  await expect(page.getByTestId('balance-white')).toContainText('3000 K');
  await page.getByTestId('false-colour').getByRole('button', { name: 'cd/m²' }).click();
  await expect(page.getByTestId('legend')).toContainText('cd/m²');

  await reloaded(page);
  // The page itself is remembered too.
  await expect(page.getByRole('heading', { level: 1, name: 'Visualiser' })).toBeVisible();
  await expect(page.getByTestId('solve-status')).toContainText('kept from before', {
    timeout: 60_000,
  });
  const pressed = (group: string, name: string) =>
    page.getByTestId(group).getByRole('button', { name, exact: true });
  await expect(pressed('exposure', 'Manual')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('exposure-white')).toContainText('6.79 cd/m²');
  await expect(pressed('balance', 'Chosen')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('balance-white')).toContainText('3000 K');
  await expect(pressed('false-colour', 'cd/m²')).toHaveAttribute('aria-pressed', 'true');
  await noProblems(w);
});

test('replaces a kept record that fails its checks', async ({ page }) => {
  const w = await openApp(page);
  await openVisualiser(page);
  await expect(page.getByTestId('solve-status')).toContainText('just solved');
  // Spoil the kept record, as another program on this origin could.
  const spoiled = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('enlighten');
        open.onerror = () => {
          reject(new Error('open failed'));
        };
        open.onsuccess = () => {
          const store = open.result
            .transaction('preferences', 'readwrite')
            .objectStore('preferences');
          const keys = store.getAllKeys();
          keys.onsuccess = () => {
            const light = keys.result.filter(
              (k): k is string => typeof k === 'string' && /^light:[0-9a-f]{16}$/.test(k),
            );
            for (const k of light) {
              const got = store.get(k);
              got.onsuccess = () => {
                const record = got.result as { response: { layers: Float32Array[] } };
                const layer = record.response.layers[0];
                if (layer !== undefined) layer[10] = Number.NaN;
                store.put(record, k);
              };
            }
            store.transaction.oncomplete = () => {
              resolve(light.length);
            };
          };
        };
      }),
  );
  expect(spoiled).toBe(1);
  await reloaded(page);
  await expect(page.getByTestId('solve-status')).toContainText('just solved', { timeout: 60_000 });
  // And the fresh one is kept in its place.
  await reloaded(page);
  await expect(page.getByTestId('solve-status')).toContainText('kept from before', {
    timeout: 60_000,
  });
  await noProblems(w);
});

test('measuring the frame leaves the picture and the page alone', async ({ page }) => {
  const w = await openApp(page);
  await openVisualiser(page);
  const canvas = page.getByTestId('hallway-canvas');
  const before = await canvas.screenshot();
  await page.getByTestId('measure').click();
  // The page stays live while it measures: Panic is there to press.
  await expect(page.getByRole('button', { name: 'Panic' })).toBeEnabled();
  await expect(page.getByTestId('measured')).toContainText(/ms a frame|Too slow/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('measure')).toBeEnabled();
  // Nothing was drawn to the picture: it is the same unlit hallway.
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  await noProblems(w);
});
