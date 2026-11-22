/**
 * E-import: workspace export and import, oversized and malformed files refused, and a file with a
 * higher ceiling does not raise it (SPEC section 8, ADR 0009).
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { goTo, noProblems, openApp } from './app.ts';

async function importText(page: Page, text: string, name = 'workspace.json'): Promise<void> {
  await page.getByTestId('import').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  });
}

async function exported(page: Page): Promise<Record<string, unknown>> {
  const download = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('enlighten-workspace.json');
  const path = await d.path();
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

test('exports the workspace, and imports it back after listing the changes', async ({ page }) => {
  const w = await openApp(page);
  await goTo(page, 'Devices');
  await page.getByRole('textbox', { name: 'Name for A1' }).fill('Hall right');
  await page.getByRole('textbox', { name: 'Name for A1' }).press('Enter');
  await goTo(page, 'Settings');
  const file = await exported(page);
  expect(file).toMatchObject({
    format: 'enlighten-workspace',
    version: 4,
    ceiling: 220,
    preferences: {
      playgroundMode: 'live',
      reducedMotion: 'system',
      historyLength: 1000,
      historyIgnoreSpace: false,
      verifyMode: true,
    },
  });
  expect(file['devices']).toContainEqual({
    address: 1,
    alias: 'Hall right',
    presentation: 'rgbwaf',
    settings: {},
  });

  // A lower ceiling, a name, Commit mode, and a simulator setting.
  const changed = {
    ...file,
    ceiling: 195,
    preferences: { playgroundMode: 'commit', reducedMotion: 'always' },
    devices: [
      { address: 0, alias: 'Hall left' },
      { address: 1, alias: 'Hall right', presentation: 'tc', settings: {} },
    ],
  };
  await importText(page, JSON.stringify(changed));
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  const changes = page.getByTestId('import-changes');
  await expect(changes).toContainText('Ceiling: lowered from 39.5% (arc 220) to 20% (arc 195).');
  await expect(changes).toContainText('Playground mode: Commit.');
  await expect(changes).toContainText('Reduced motion: always on.');
  await expect(changes).toContainText('A0: name "Hall left".');
  await expect(changes).toContainText('A1: name "Hall right", simulated as Tc');
  await dialog.getByRole('button', { name: 'Import' }).click();
  // Lowering the ceiling rewrites and reads back every driver's profile first.
  await expect(page.getByTestId('import-done')).toContainText('Imported.', { timeout: 30_000 });
  await expect(page.getByTestId('ceiling')).toContainText('arc 195');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await goTo(page, 'Playground');
  await expect(page.getByTestId('panel-1')).toContainText('Presents as colour temperature', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('panel-0').getByRole('heading')).toHaveText('A0 Hall left');
  await noProblems(w);
});

test('a file with a higher ceiling does not raise it', async ({ page }) => {
  const w = await openApp(page);
  await goTo(page, 'Settings');
  await importText(
    page,
    JSON.stringify({ format: 'enlighten-workspace', version: 1, ceiling: 254 }),
  );
  await expect(page.getByTestId('import-changes')).toContainText(
    "Ceiling: the file's 100% is higher than the present 39.5%, so it is not applied.",
  );
  await page.getByTestId('import-dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('ceiling')).toContainText('arc 220');
  await noProblems(w);
});

test('refuses oversized, malformed, foreign, newer and hostile files, and changes nothing', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Settings');
  const cases: [string, string][] = [
    [
      `{"format":"enlighten-workspace","version":1,"x":"${'a'.repeat(2 * 1024 * 1024)}"}`,
      'larger than 2 MB',
    ],
    ['{', 'not valid JSON'],
    ['{"format":"other"}', 'not an Enlighten workspace file'],
    ['{"format":"enlighten-workspace","version":5}', 'newer version of the app'],
    ['{"format":"enlighten-workspace","version":1,"__proto__":{"ceiling":1}}', 'not allowed'],
    ['{"format":"enlighten-workspace","version":1,"plates":[]}', 'unknown key "plates"'],
    [
      '{"format":"enlighten-workspace","version":1,"devices":[{"address":64}]}',
      'devices[0].address',
    ],
    [
      '{"format":"enlighten-workspace","version":1,"devices":[{"address":0,"alias":"x"},{"address":0,"alias":"x"}]}',
      'address 0 appears twice',
    ],
  ];
  for (const [text, why] of cases) {
    await importText(page, text);
    await expect(page.getByTestId('import-error')).toContainText(why);
    await expect(page.getByTestId('import-dialog')).toBeHidden();
  }
  await expect(page.getByTestId('ceiling')).toContainText('arc 220');
  await noProblems(w);
});

test("carries the Visualiser's set-ups and view settings, and checks them before import", async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
    timeout: 60_000,
  });
  await page.getByTestId('preset-mirrored').click();
  await page.getByTestId('exposure').getByRole('button', { name: 'Night-adapted' }).click();
  await goTo(page, 'Settings');
  const file = await exported(page);
  expect(file['preferences']).toMatchObject({ exposure: 'night', falseColour: 'off' });
  expect(file['hallway']).toMatchObject({ length: 5, width: 1.2, height: 2.7 });
  expect(file['mounts']).toHaveLength(2);
  expect(file['links']).toEqual([{ kind: 'mirror', a: 'm1', b: 'm2' }]);
  // Set-up B is still the default, so it is written beside A.
  expect(file['compare']).toMatchObject({ links: [] });

  // A set-up that fails the light core's check is refused, with where.
  await importText(page, JSON.stringify({ ...file, mounts: [{ id: 'm1' }] }));
  await expect(page.getByTestId('import-error')).toContainText('Set-up A:');
  await expect(page.getByTestId('import-dialog')).toBeHidden();

  // Change the set-up, then bring the file back.
  await goTo(page, 'Visualiser');
  await page.getByTestId('preset-channel').click();
  await page.getByTestId('exposure').getByRole('button', { name: 'Day', exact: true }).click();
  await page.waitForTimeout(900);
  await goTo(page, 'Settings');
  await importText(page, JSON.stringify(file));
  const changes = page.getByTestId('import-changes');
  await expect(changes).toContainText('Visualiser exposure: night.');
  await expect(changes).toContainText('Set-up A: 2 mounts, replacing 1.');
  await page.getByTestId('import-dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-done')).toContainText('Imported.');
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('mount-row-m1')).toContainText('Mirrored with m2.');
  await expect(
    page.getByTestId('exposure').getByRole('button', { name: 'Night-adapted' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await noProblems(w);
});

test('looks, sequences, effects and a simulated driver come in with a version 4 file', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const w = await openApp(page);
  await goTo(page, 'Settings');
  const file = {
    format: 'enlighten-workspace',
    version: 4,
    devices: [{ address: 6, simulated: 'C2', alias: 'Far end' }],
    looks: [{ name: 'Warm low', arc: 120, colour: { kind: 'tc', mirek: 370 } }],
    slots: [{ address: 0, slot: 2, look: 'Warm low', arc: 120 }],
    sequences: [
      {
        name: 'Up slowly',
        steps: [
          { target: { kind: 'broadcast' }, arc: 150, colour: { kind: 'none' }, durationMs: 4000 },
        ],
      },
    ],
    effects: [
      { name: 'Slow breath', type: 'breathe', params: { depth: 8, period: 12 }, targets: [0, 6] },
    ],
  };
  await importText(page, JSON.stringify(file));
  const changes = page.getByTestId('import-changes');
  await expect(changes).toContainText('Simulated driver: a C2 is added at A6.');
  await expect(changes).toContainText("Looks: the file's 1 look takes the place of the 0 stored.");
  await expect(changes).toContainText('Nothing is written to any driver.');
  await expect(changes).toContainText('None runs until you run it.');
  await page.getByTestId('import-dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('import-done')).toContainText('Imported.', { timeout: 30_000 });
  // The import ran nothing: no run, and the lights are off.
  await expect(page.getByTestId('verified')).toHaveText('3/3 verified', { timeout: 60_000 });
  await goTo(page, 'Looks');
  await expect(page.getByTestId('looks')).toContainText('Warm low');
  // The map says slot 2 holds the look. The driver holds nothing there, so it is marked.
  await expect(page.getByTestId('slot-2-state')).toContainText(
    'The driver holds nothing here now.',
  );
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await goTo(page, 'Sequences');
  await expect(page.getByTestId('sequences')).toContainText('Up slowly');
  await goTo(page, 'Effects');
  await expect(page.getByTestId('saved-effects')).toContainText('Slow breath');
  await expect(page.getByTestId('saved-effects')).toContainText('A0, A6');

  // The export carries it all back out.
  await goTo(page, 'Settings');
  const out = await exported(page);
  expect(out['looks']).toEqual(file.looks);
  expect(out['slots']).toEqual(file.slots);
  expect(out['sequences']).toEqual(file.sequences);
  expect(out['effects']).toEqual(file.effects);
  expect(out['devices']).toContainEqual({ address: 6, simulated: 'C2', alias: 'Far end' });

  // A file whose look is out of range is refused whole, with the reason.
  await importText(
    page,
    JSON.stringify({ ...file, looks: [{ name: 'Bad', arc: 999, colour: { kind: 'none' } }] }),
  );
  await expect(page.getByTestId('import-error')).toContainText(
    "The file's looks, sequences or effects:",
  );
  await noProblems(w);
});
