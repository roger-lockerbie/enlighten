/**
 * The built page's entry chunk: no lazily loaded code yet, and within a size budget. Stage 7 adds
 * three.js as its own lazily loaded chunk (ADR 0002), and this test says where that starts from.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const DIST = resolve(import.meta.dirname, '..', 'dist');

test('the entry chunk has no dynamic import and stays within its budget', () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const entry =
    /<script type="module" crossorigin src="\/assets\/(index-[\w-]+\.js)"><\/script>/.exec(
      html,
    )?.[1];
  expect(entry).toBeDefined();
  const js = readFileSync(resolve(DIST, 'assets', entry ?? ''), 'utf8');
  expect(js.length).toBeLessThan(250 * 1024);
  expect(js).not.toMatch(/\bimport\(/);
  const chunks = readdirSync(resolve(DIST, 'assets')).filter((f) => f.endsWith('.js'));
  expect(chunks).toHaveLength(2);
  expect(chunks).toContain(entry);
  expect(chunks.some((c) => /^bus\.worker-[\w-]+\.js$/.test(c))).toBe(true);
});
