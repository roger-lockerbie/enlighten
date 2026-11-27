/**
 * Write the manual's generated pages to `docs/manual/generated/` (ADR 0024). Run with
 * `pnpm manual:gen`. Plain Node: it needs no build and no package beyond the repo's own code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatedPages } from '../../src/manual/generate.ts';

const root = resolve(import.meta.dirname, '..', '..', 'docs', 'manual');
for (const [path, text] of Object.entries(generatedPages())) {
  const file = resolve(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  console.log(`wrote docs/manual/${path}`);
}
