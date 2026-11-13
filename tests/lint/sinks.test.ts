import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { sinkConfig } from '../../eslint.sinks.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: sinkConfig,
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const bannedTs: [name: string, code: string, rule: string][] = [
  ['eval', 'eval("1+1");', 'no-eval'],
  ['indirect eval', 'globalThis.eval("1+1");', 'no-eval'],
  ['new Function', 'new Function("return 1");', 'no-new-func'],
  ['Function()', 'Function("return 1")();', 'no-new-func'],
  ['string setTimeout', 'setTimeout("alert(1)", 10);', 'no-implied-eval'],
  ['string setInterval', 'setInterval("alert(1)", 10);', 'no-implied-eval'],
  ['innerHTML', 'document.body.innerHTML = x;', 'no-restricted-syntax'],
  ['outerHTML', 'el.outerHTML = x;', 'no-restricted-syntax'],
  ['insertAdjacentHTML', 'el.insertAdjacentHTML("beforeend", x);', 'no-restricted-syntax'],
  ['computed innerHTML', 'el["innerHTML"] = x;', 'no-restricted-syntax'],
  ['document.write', 'document.write(x);', 'no-restricted-syntax'],
  ['document.writeln', 'document.writeln(x);', 'no-restricted-syntax'],
  ['createContextualFragment', 'range.createContextualFragment(x);', 'no-restricted-syntax'],
  ['setHTMLUnsafe', 'el.setHTMLUnsafe(x);', 'no-restricted-syntax'],
  ['srcdoc property', 'iframe.srcdoc = x;', 'no-restricted-syntax'],
  ['srcdoc attribute', 'iframe.setAttribute("srcdoc", x);', 'no-restricted-syntax'],
  ['inline handler attribute', 'el.setAttribute("onclick", x);', 'no-restricted-syntax'],
  ['importScripts', 'importScripts("x.js");', 'no-restricted-syntax'],
  ['innerHTML as object key', 'const o = { innerHTML: x };', 'no-restricted-syntax'],
];

describe('banned sinks in TypeScript', () => {
  it.each(bannedTs)('catches %s', async (_name, code, rule) => {
    expect(await ruleIds(code, 'src/fixture.ts')).toContain(rule);
  });

  it('lets ordinary code through', async () => {
    const code =
      'const el = document.createElement("p");\nel.textContent = "hi";\nsetTimeout(() => {}, 10);\n';
    expect(await ruleIds(code, 'src/fixture.ts')).toEqual([]);
  });
});

describe('banned sinks in Svelte', () => {
  it('catches {@html}', async () => {
    const ids = await ruleIds(
      '<script lang="ts">let x = "";</script>\n{@html x}\n',
      'src/Fixture.svelte',
    );
    expect(ids).toContain('svelte/no-at-html-tags');
  });

  it('catches innerHTML in a script block', async () => {
    const ids = await ruleIds(
      '<script lang="ts">document.body.innerHTML = "x";</script>\n<p>hi</p>\n',
      'src/Fixture.svelte',
    );
    expect(ids).toContain('no-restricted-syntax');
  });

  it('lets ordinary markup through', async () => {
    const ids = await ruleIds(
      '<script lang="ts">let x = "a";</script>\n<p>{x}</p>\n',
      'src/Fixture.svelte',
    );
    expect(ids).toEqual([]);
  });
});

describe('the project config', () => {
  it('applies the sink rules to TypeScript and Svelte files', async () => {
    const project = new ESLint();
    for (const file of ['src/main.ts', 'src/App.svelte']) {
      const config = (await project.calculateConfigForFile(file)) as {
        rules: Record<string, unknown>;
      };
      for (const rule of [
        'no-eval',
        'no-new-func',
        'no-implied-eval',
        'no-restricted-syntax',
        'svelte/no-at-html-tags',
      ]) {
        expect(config.rules[rule], `${rule} on ${file}`).toBeDefined();
      }
    }
  });
});
