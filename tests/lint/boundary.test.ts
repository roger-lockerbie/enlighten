/**
 * L-boundary: lint keeps DOM, network, timers and the system clock out of the pure core, keeps
 * transports away from everything but the worker shell, keeps sending to the router, and keeps
 * Trusted Types policies and workers in one file (SPEC S2.1, ADR 0002, ADR 0010).
 */
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
  for (const folder of [
    'dali',
    'sim',
    'bus',
    'safety',
    'engine',
    'transport',
    'light',
    'store',
    'design',
  ]) {
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

describe('transports, sending and workers', () => {
  const syntax = 'no-restricted-syntax';
  it('keeps transport imports out of the page', async () => {
    const code = 'import { ServerTransport } from "../transport/server.ts";';
    expect(await ruleIds(code, 'src/ui/fixture.ts')).toContain('no-restricted-imports');
    expect(await ruleIds(code, 'src/main.ts')).toContain('no-restricted-imports');
    expect(await ruleIds(code, 'src/workers/bus.worker.ts')).toEqual([]);
  });
  it('stops the worker shell sending', async () => {
    for (const code of ['void router.send(f, a);', 'void t.sendPanic(f);', 'void t.send(f);']) {
      expect(await ruleIds(code, 'src/workers/bus.worker.ts')).toContain(syntax);
      expect(await ruleIds(code, 'src/workers/policy.ts')).toContain(syntax);
    }
    expect(await ruleIds('self.postMessage(m);', 'src/workers/bus.worker.ts')).toEqual([]);
  });
  it('stops the engine reaching a transport around the router (security review M2)', async () => {
    for (const code of [
      'void this.hardware.send(f);',
      'void t.sendPanic(f);',
      "void t['send'](f);",
      'const { send } = t;',
    ]) {
      expect([code, await ruleIds(code, 'src/engine/engine.ts')]).toEqual([code, [syntax]]);
      expect(await ruleIds(code, 'src/workers/bus.worker.ts')).toContain(syntax);
    }
    expect(await ruleIds('void this.transport.send(frame);', 'src/engine/router.ts')).toEqual([]);
    expect(await ruleIds('void scheduler.submit(tx);', 'src/engine/engine.ts')).toEqual([]);
  });
  it('keeps sockets out of the page', async () => {
    expect(await ruleIds('const s = new WebSocket(u);', 'src/ui/bus.ts')).toContain(syntax);
    expect(await ruleIds('const s = new WebSocket(u);', 'src/workers/bus.worker.ts')).toEqual([]);
  });
  it('keeps createPolicy and new Worker in the policy file', async () => {
    const policy = 'trustedTypes.createPolicy("enlighten-worker", {});';
    const worker = 'const w = new Worker(url, { type: "module" });';
    for (const file of [
      'src/ui/fixture.ts',
      'src/workers/bus.worker.ts',
      'src/engine/fixture.ts',
    ]) {
      expect(await ruleIds(policy, file)).toContain(syntax);
      expect(await ruleIds(worker, file)).toContain(syntax);
    }
    expect(await ruleIds(policy, 'src/workers/policy.ts')).toEqual([]);
    expect(await ruleIds(worker, 'src/workers/policy.ts')).toEqual([]);
    expect(await ruleIds('new SharedWorker(u);', 'src/ui/fixture.ts')).toContain(syntax);
  });
  it('bans blob and inline workers everywhere, the policy file included', async () => {
    for (const file of ['src/workers/policy.ts', 'src/ui/fixture.ts']) {
      expect(await ruleIds('URL.createObjectURL(b);', file)).toContain(syntax);
      expect(await ruleIds('import w from "./bus.worker.ts?worker&inline";', file)).toContain(
        syntax,
      );
      expect(await ruleIds('import w from "./bus.worker.ts?worker";', file)).toContain(syntax);
    }
    expect(
      await ruleIds('import u from "./bus.worker.ts?worker&url";', 'src/workers/policy.ts'),
    ).toEqual([]);
  });
  it('keeps the sink bans in every group that adds its own', async () => {
    for (const file of [
      'src/workers/policy.ts',
      'src/workers/bus.worker.ts',
      'src/ui/fixture.ts',
      'src/engine/fixture.ts',
    ]) {
      expect(await ruleIds('el.innerHTML = s;', file)).toContain(syntax);
    }
  });
});
