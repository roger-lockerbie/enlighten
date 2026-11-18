/**
 * The built page's chunks (ADR 0002): the entry chunk stays within a size budget and free of
 * three.js, which loads in a chunk of its own when the Visualiser is first opened, with the page
 * and the light core beside it. Each worker is one file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const DIST = resolve(import.meta.dirname, '..', 'dist');

test('the entry chunk stays within its budget, and three.js loads only with the Visualiser', () => {
  const html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const entry =
    /<script type="module" crossorigin src="\/assets\/(index-[\w-]+\.js)"><\/script>/.exec(
      html,
    )?.[1];
  expect(entry).toBeDefined();
  // The page names no other script, so nothing else loads before it is asked for.
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).not.toMatch(/modulepreload/);
  const read = (name: string): string => readFileSync(resolve(DIST, 'assets', name), 'utf8');
  const js = read(entry ?? '');
  expect(js.length).toBeLessThan(250 * 1024);
  const chunks = readdirSync(resolve(DIST, 'assets')).filter((f) => f.endsWith('.js'));
  const named = (pattern: RegExp): string[] => chunks.filter((c) => pattern.test(c));
  expect(named(/^bus\.worker-[\w-]+\.js$/)).toHaveLength(1);
  expect(named(/^light\.worker-[\w-]+\.js$/)).toHaveLength(1);
  const renderer = named(/^renderer-[\w-]+\.js$/);
  const visualiser = named(/^Visualiser-[\w-]+\.js$/);
  expect(renderer).toHaveLength(1);
  expect(visualiser).toHaveLength(1);
  expect(chunks).toHaveLength(5);
  // three.js is in the renderer's chunk and nowhere else.
  const marker = 'WebGLRenderer';
  expect(read(renderer[0] ?? '')).toContain(marker);
  for (const c of chunks.filter((c) => c !== renderer[0])) expect(read(c)).not.toContain(marker);
  // The entry reaches the Visualiser only by a dynamic import, and never names the renderer.
  expect(js).toContain(visualiser[0] ?? 'missing');
  expect(js).not.toContain(renderer[0] ?? 'missing');
  // No chunk asks for anything from another origin.
  for (const c of chunks)
    expect(read(c)).not.toMatch(
      /https?:\/\/(?!127\.0\.0\.1|localhost)[a-z0-9.-]+\.(?:com|net|org|io|dev)\/[^"'`\s]*\.(?:js|wasm)/i,
    );
});
