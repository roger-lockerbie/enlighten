import { expect, test, type Page } from '@playwright/test';

interface Run {
  results: Record<string, unknown>;
  violations: string[];
  problems: string[];
}

async function run(page: Page, parts: string): Promise<Run> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes("Unrecognized feature: 'bluetooth'")) return;
    // The timing loop reads a pixel each frame on purpose, which the driver reports as a stall.
    if (msg.text().includes('GPU stall due to ReadPixels')) return;
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`console ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __cspViolations?: string[] };
      (w.__cspViolations ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sample}`);
    });
  });
  await page.goto(`/?parts=${parts}`);
  await expect(page.getByTestId('done')).toHaveText('done', { timeout: 30_000 });
  const results = await page.evaluate(
    () => (window as unknown as { __spike: Record<string, unknown> }).__spike,
  );
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
  );
  const out = { results, violations, problems };
  console.log(`SPIKE ${parts} ${JSON.stringify(out)}`);
  return out;
}

const tree = process.env['SPIKE_FRAGMENTS'] === 'tree';

test('1a. worker from a plain URL object', async ({ page }) => {
  await run(page, 'worker-plain');
});

test('1b. worker through the enlighten-worker policy', async ({ page }) => {
  const r = await run(page, 'worker-policy');
  expect(r.results['workerPolicy']).toMatchObject({ kind: 'pong', isolated: true });
  expect(r.results['policyOtherUrl']).toBe('refused');
  expect(r.violations).toEqual([]);
  expect(r.problems).toEqual([]);
});

test('2. Svelte mounts 400 rows with the configured fragments mode', async ({ page }) => {
  const r = await run(page, 'list');
  const csp = (await page.request.get('/')).headers()['content-security-policy'] ?? '';
  console.log(`SPIKE csp ${csp}`);
  expect(csp.includes('svelte-trusted-html')).toBe(!tree);
  await expect(page.locator('li')).toHaveCount(400);
  expect(r.violations).toEqual([]);
  expect(r.problems).toEqual([]);
});

test('3a. style: directive under style-src self', async ({ page }) => {
  const r = await run(page, 'style');
  const width = await page
    .getByTestId('style-directive')
    .evaluate((el) => (el as HTMLElement).style.width);
  console.log(`SPIKE style-directive width=${width}`);
  expect(width).toBe('70%');
  expect(r.violations).toEqual([]);
});

test('3b. custom property set from an action', async ({ page }) => {
  const r = await run(page, 'action');
  const w = await page
    .getByTestId('style-action')
    .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--w'));
  expect(w).toBe('70%');
  expect(r.violations).toEqual([]);
  expect(r.problems).toEqual([]);
});

test('4 and 6. three.js renders, raw shader output, P3, frame time', async ({ page }) => {
  const r = await run(page, 'gl');
  const gl = r.results['gl'] as { ok: boolean; rawPixel: number[]; error?: string };
  expect(gl.error).toBeUndefined();
  expect(gl.ok).toBe(true);
  expect(gl.rawPixel).toEqual([128, 64, 32, 255]);
  expect(r.violations).toEqual([]);
  expect(r.problems).toEqual([]);
});

test('5. meta fallback enforces Trusted Types with headers stripped', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      status: response.status(),
      body: await response.body(),
      headers: { 'content-type': response.headers()['content-type'] ?? 'text/plain' },
    });
  });
  const response = await page.goto('/?parts=list');
  expect(response?.headers()['content-security-policy']).toBeUndefined();
  await expect(page.getByTestId('done')).toHaveText('done');
  const result = await page.evaluate(() => {
    try {
      document.body.innerHTML = '<b>x</b>';
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });
  expect(result).toBe('blocked');
});

test('7. same-origin WebSocket under connect-src self', async ({ page }) => {
  const r = await run(page, 'ws');
  expect(r.results['ws']).toBe('echo: hello');
  expect(r.violations).toEqual([]);
  expect(r.problems).toEqual([]);
});

test('8. worker timer while another tab is in front', async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto('/?parts=none');
  await other.bringToFront();
  const r = await run(page, 'worker-policy,ticks');
  console.log(`SPIKE ticks ${JSON.stringify(r.results)}`);
  await other.close();
});
