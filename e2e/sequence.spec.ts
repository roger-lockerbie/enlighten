/**
 * E-sequence: a sequence's preview, export, check, run and stop (SPEC R5.4 to R5.6), a plan the
 * rate guard would refuse, and panic part way through a run (E-panic).
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { enter, goTo, noProblems, openApp, panicLatched } from './app.ts';

test('a built-in sequence shows every change and frame, exports, and passes the check', async ({
  page,
}) => {
  const w = await openApp(page);
  await goTo(page, 'Sequences');
  await page.getByTestId('preset-night').click();
  await expect(page.getByTestId('sequence-name')).toHaveValue('Night fade-in');
  // Two drivers: 16 minutes and 9 minutes for each. Driver B's colour goes in first, while it is
  // off. Driver A is at 2700 K already, from its safety profile.
  await expect(page.getByTestId('plan-summary')).toContainText('5 changes');
  await expect(page.getByTestId('plan-summary')).toContainText('ending at 25 min');
  const rows = page.getByTestId('plan-rows');
  await expect(rows).toContainText('16 min (extended fade 0x4F)');
  await expect(rows).toContainText('9 min (extended fade 0x48)');
  await expect(rows).toContainText('arc 195 (20.0%)');
  await expect(rows).toContainText('arc 0 (off), R 0, G 0, B 0, W 254, A 0');
  await page.getByTestId('plan-frames-toggle').click();
  await expect(page.getByTestId('plan-frames')).toContainText('SET EXTENDED FADE TIME A0');
  await expect(page.getByTestId('plan-frames')).toContainText('DAPC A1 195');

  // The export is a table an integrator can read.
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ]);
  expect(csv.suggestedFilename()).toBe('night-fade-in.csv');
  const text = readFileSync(await csv.path(), 'utf8');
  expect(text.split('\r\n')[0]).toBe('time_ms,time,address,command,values,fade');
  expect(text).toContain('960000,16 min,A0,level,arc 195 (20.0%),9 min (extended fade 0x48)');
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json').click(),
  ]);
  expect(json.suggestedFilename()).toBe('night-fade-in.json');
  const parsed = JSON.parse(readFileSync(await json.path(), 'utf8')) as {
    format: string;
    rows: unknown[];
  };
  expect(parsed.format).toBe('enlighten-design');
  expect(parsed.rows).toHaveLength(5);

  // The check runs the plan on a copy of the bench and sends nothing to the bench itself.
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('run-message')).toContainText('nothing is refused', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await noProblems(w);
});

test('a sequence is built, saved, run to its end, and a flashing one is refused', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const w = await openApp(page);
  await goTo(page, 'Sequences');
  await page.getByTestId('sequence-new').click();
  await page.getByTestId('sequence-name').fill('Quick');
  await page.getByTestId('step-add').click();
  await enter(page, 'step-0-look-level-right', '170');
  await enter(page, 'step-0-s', '3');
  await page.getByTestId('step-add').click();
  await enter(page, 'step-1-look-level-right', '120');
  await enter(page, 'step-1-s', '2');
  await expect(page.getByTestId('step-1-text')).toContainText('to 2.6%');
  await expect(page.getByTestId('plan-summary')).toContainText('2 changes');
  await expect(page.getByTestId('plan-summary')).toContainText('ending at 5 s');
  await page.getByTestId('sequence-save').click();
  await expect(page.getByTestId('sequences-message')).toHaveText('Saved "Quick".');
  await expect(page.getByTestId('sequences')).toContainText('Quick');

  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running: "Quick"', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('run-ended')).toContainText('Finished after 5 s', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('run-ended')).toContainText('Every change was sent.');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('2.6%');

  // It is still there after a reload.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  await expect(page.getByTestId('sequences')).toContainText('Quick');

  // On, off, on, off with no time between: the check says which rule refuses it, and Run sends none.
  await page.getByTestId('sequence-new').click();
  await page.getByTestId('sequence-name').fill('Flash');
  for (const [i, arc] of [200, 0, 200, 0].entries()) {
    await page.getByTestId('step-add').click();
    await enter(page, `step-${String(i)}-look-level-right`, String(arc));
    await enter(page, `step-${String(i)}-s`, '0');
  }
  await page.getByTestId('run-check').click();
  await expect(page.getByTestId('run-message')).toContainText('The governor would refuse', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('run-message')).toContainText('Rate guard');
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-message')).toContainText('The governor would refuse', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await noProblems(w);
});

test('a run stops when a person stops it, and at panic', async ({ page }) => {
  test.setTimeout(180_000);
  const w = await openApp(page);
  await goTo(page, 'Sequences');
  await page.getByTestId('preset-wind-down').click();
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running: "Wind down"', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('run-status')).toContainText('of 10 min');
  await page.getByTestId('run-stop').click();
  await expect(page.getByTestId('run-ended')).toContainText('Stopped: Stopped by a person.');

  // Again, and this time Panic: the run ends and every light goes off.
  await page.waitForTimeout(2500);
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-status')).toContainText('Running: "Wind down"', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Panic', exact: true }).click();
  await panicLatched(page);
  await expect(page.getByTestId('run-ended')).toContainText('Stopped');
  await expect(page.getByTestId('tape-0').getByTestId('tape-text')).toContainText('off');
  await expect(page.getByTestId('tape-1').getByTestId('tape-text')).toContainText('off');
  // Nothing starts while panic is on.
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-message')).toContainText('Panic is on. Resume first.');
  await noProblems(w);
});
