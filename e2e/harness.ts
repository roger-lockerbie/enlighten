/**
 * The e2e harness (TEST_PLAN section 7): every test fails on a CSP violation, a console error or
 * warning, a page error, a failed request or a cross-origin request.
 */
import type { Page } from '@playwright/test';

export interface Watch {
  /** Everything that went wrong, as text. A test asserts this is empty. */
  problems(): Promise<string[]>;
}

export async function watch(
  page: Page,
  allow: (text: string) => boolean = () => false,
): Promise<Watch> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    // Chromium on Linux does not know the 'bluetooth' Permissions-Policy feature. The header still
    // names it for platforms that do, so this one warning is allowed.
    if (text.includes("Unrecognized feature: 'bluetooth'") || allow(text)) return;
    if (msg.type() === 'error' || msg.type() === 'warning')
      problems.push(`console ${msg.type()}: ${text}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:') return;
    const here = page.url() === 'about:blank' ? url.origin : new URL(page.url()).origin;
    if (url.origin !== here) problems.push(`cross-origin request: ${req.url()}`);
  });
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __cspViolations?: string[] };
      (w.__cspViolations ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return {
    async problems() {
      const csp = page.isClosed()
        ? []
        : await page.evaluate(
            () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
          );
      return [...problems, ...csp.map((c) => `CSP violation: ${c}`)];
    },
  };
}
