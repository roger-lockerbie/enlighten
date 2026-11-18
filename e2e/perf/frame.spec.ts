/**
 * Perf-frame (TEST_PLAN section 9): the frame time with six mounts at 1440 by 900 on a real GPU,
 * against the 4 ms budget. Run by hand on the reference laptop with `pnpm perf:frame`, not in CI,
 * which draws in software. It opens a browser window for a few seconds.
 */
import { expect, test } from '@playwright/test';
import { goTo, openApp } from '../app.ts';

test('the frame with six mounts is within its budget', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) missing.push(new URL(r.url()).pathname);
  });
  const w = await openApp(page);
  await goTo(page, 'Visualiser');
  await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
    timeout: 60_000,
  });
  const times: number[] = [];
  let gpu = '';
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('measure').click();
    await expect(page.getByTestId('measure')).toBeEnabled({ timeout: 10_000 });
    const text = await page.getByTestId('measured').innerText();
    expect(text).not.toContain('stopped early');
    const ms = /^([\d.]+) ms a frame/.exec(text)?.[1];
    expect(ms).toBeDefined();
    times.push(Number(ms));
    gpu = /, on (.*)\.$/s.exec(text)?.[1] ?? '';
    await page.waitForTimeout(300);
  }
  times.sort((a, b) => a - b);
  const median = times[2] ?? Infinity;
  console.log(
    `Perf-frame: ${times.map((t) => t.toFixed(2)).join(', ')} ms (median ${median.toFixed(2)}) on ${gpu}`,
  );
  // A software renderer would say nothing about the budget.
  expect(gpu).not.toMatch(/SwiftShader|llvmpipe/i);
  expect(median).toBeLessThan(4);
  // A headed browser asks for a favicon, which the app does not have. Nothing else may be missing.
  expect(missing.filter((p) => p !== '/favicon.ico')).toEqual([]);
  expect((await w.problems()).filter((p) => !p.includes('404 (Not Found)'))).toEqual([]);
});
