/** L-boundary (Stage 3 part): lint keeps DOM, network, timers and the system clock out of the pure core. */
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import tseslint from 'typescript-eslint';
import { boundaryConfig } from '../../eslint.boundary.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaryConfig,
  ],
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const banned: [name: string, code: string, rule: string][] = [
  ['setTimeout', 'setTimeout(() => {}, 1);', 'no-restricted-globals'],
  ['setInterval', 'setInterval(() => {}, 1);', 'no-restricted-globals'],
  ['requestAnimationFrame', 'requestAnimationFrame(() => {});', 'no-restricted-globals'],
  ['performance.now', 'const t = performance.now();', 'no-restricted-globals'],
  ['Date.now', 'const t = Date.now();', 'no-restricted-properties'],
  ['globalThis.setTimeout', 'globalThis.setTimeout(() => {}, 1);', 'no-restricted-properties'],
  ['window', 'const w = window;', 'no-restricted-globals'],
  ['document', 'document.title = "x";', 'no-restricted-globals'],
  ['fetch', 'void fetch("/x");', 'no-restricted-globals'],
  ['WebSocket', 'new WebSocket("ws://x");', 'no-restricted-globals'],
  ['localStorage', 'localStorage.getItem("x");', 'no-restricted-globals'],
  ['new Worker', 'new Worker("w.js");', 'no-restricted-globals'],
  ['a Svelte import', 'import { mount } from "svelte";', 'no-restricted-imports'],
  ['a UI import', 'import x from "../ui/thing.ts";', 'no-restricted-imports'],
  ['a transport import', 'import x from "../transport/server.ts";', 'no-restricted-imports'],
  ['a Node import', 'import { readFileSync } from "node:fs";', 'no-restricted-imports'],
];

describe('the pure core boundary', () => {
  for (const folder of ['dali', 'sim', 'bus', 'safety']) {
    it.each(banned)(`catches %s in src/${folder}`, async (_name, code, rule) => {
      expect(await ruleIds(code, `src/${folder}/fixture.ts`)).toContain(rule);
    });
  }
  it('lets ordinary pure code through', async () => {
    const code =
      'export const f = (clock: { now(): number }) => clock.now() + structuredClone({ a: 1 }).a;\n';
    expect(await ruleIds(code, 'src/safety/fixture.ts')).toEqual([]);
  });
  it('does not apply outside the pure folders', async () => {
    expect(await ruleIds('setTimeout(() => {}, 1);', 'src/workers/fixture.ts')).toEqual([]);
  });
});
