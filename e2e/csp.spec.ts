import { expect, test } from '@playwright/test';
import { cspDirectives } from '../config/security.ts';
import { GL_READBACK } from './harness.ts';

test('every page loads with no CSP violation, console error or page error', async ({ page }) => {
  const problems: string[] = [];

  page.on('console', (msg) => {
    // Chromium on Linux doesn't know the 'bluetooth' Permissions-Policy feature. The header
    // still names it for platforms that do, so this one warning is allowed.
    if (msg.text().includes("Unrecognized feature: 'bluetooth'")) return;
    // Headless Chromium draws WebGL in software and warns when it reads a frame back to show it.
    if (msg.type() === 'warning' && GL_READBACK.test(msg.text())) return;
    if (msg.type() === 'error' || msg.type() === 'warning') {
      problems.push(`console ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('request', (req) => {
    if (
      new URL(req.url()).origin !==
      new URL(page.url() === 'about:blank' ? req.url() : page.url()).origin
    ) {
      problems.push(`cross-origin request: ${req.url()}`);
    }
  });
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // Collected on window so the test can read it back.
      const w = window as unknown as { __cspViolations?: string[] };
      (w.__cspViolations ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  const response = await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
  // E-csp: every page of the app, and both workers, under the production policy.
  await expect(page.getByTestId('verified')).toHaveText('2/2 verified', { timeout: 60_000 });
  for (const name of [
    'Devices',
    'Bus monitor',
    'Settings',
    'Scripts',
    'Visualiser',
    'Looks',
    'Playground',
  ]) {
    await page
      .getByRole('navigation', { name: 'Pages' })
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    // The Visualiser loads three.js in its own chunk and starts the light worker, both under the
    // same policy.
    if (name === 'Visualiser') {
      await expect(page.getByTestId('solve-status')).toContainText('Bounced light ready', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('hallway-canvas')).toBeVisible();
    }
  }
  // Open a dialog and the console drawer too.
  await page.getByTestId('ceiling').click();
  await expect(page.getByTestId('ceiling-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Control+Backquote');
  await expect(page.getByTestId('console')).toBeVisible();

  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("require-trusted-types-for 'script'");
  expect(headers['content-security-policy']).not.toContain('unsafe-inline');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toMatch(/trusted-types enlighten-worker(;|$)/);
  expect(headers['permissions-policy']).toContain('hid=()');
  expect(headers['permissions-policy']).toContain('fullscreen=()');

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
  );
  expect(violations).toEqual([]);
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test('Trusted Types refuses plain strings in script and HTML sinks', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    let scriptResult = 'allowed';
    let htmlResult = 'allowed';
    try {
      document.createElement('script').textContent = 'window.pwned = true';
    } catch {
      scriptResult = 'blocked';
    }
    try {
      // Deliberate: proves Trusted Types refuses a plain string sink.
      document.body.innerHTML = '<b>x</b>';
    } catch {
      htmlResult = 'blocked';
    }
    return { scriptResult, htmlResult };
  });
  expect(result).toEqual({ scriptResult: 'blocked', htmlResult: 'blocked' });
});

test('the built page carries the meta fallback', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain(
    `http-equiv="Content-Security-Policy" content="${cspDirectives('strict', { forMeta: true })}"`,
  );
  expect(html).toContain('name="referrer" content="no-referrer"');
});
