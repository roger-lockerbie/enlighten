// Rules that ban the DOM and JS sinks listed in CLAUDE.md. Untyped and syntactic on purpose,
// so tests/lint/sinks.test.ts can run them against strings of code.
import globals from 'globals';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';

const HTML_SINKS = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'setHTMLUnsafe',
  'parseHTMLUnsafe',
  'createContextualFragment',
  'srcdoc',
];

const sinkProperty = `/^(${HTML_SINKS.join('|')})$/`;

export const bannedSinkRules = {
  'no-eval': ['error', { allowIndirect: false }],
  'no-new-func': 'error',
  'no-implied-eval': 'error',
  'svelte/no-at-html-tags': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: `MemberExpression[computed=false][property.name=${sinkProperty}]`,
      message: 'Banned HTML sink. Build DOM nodes with text content or Svelte markup instead.',
    },
    {
      selector: `MemberExpression[computed=true][property.value=${sinkProperty}]`,
      message: 'Banned HTML sink, even through a string key.',
    },
    {
      selector: `Property[key.name=${sinkProperty}]`,
      message: 'Banned HTML sink, even as an object key.',
    },
    {
      selector: 'MemberExpression[property.name=/^(write|writeln)$/][object.name="document"]',
      message: 'document.write is banned.',
    },
    {
      selector: 'CallExpression[callee.name="Function"]',
      message: 'Function() builds code from a string and is banned.',
    },
    {
      selector: 'NewExpression[callee.name="Function"]',
      message: 'new Function() builds code from a string and is banned.',
    },
    {
      selector: 'CallExpression[callee.name="importScripts"]',
      message: 'importScripts is banned.',
    },
    {
      selector:
        'CallExpression[callee.property.name="setAttribute"][arguments.0.value=/^(srcdoc|on.+)$/i]',
      message: 'Setting srcdoc or an inline event handler attribute is banned.',
    },
  ],
};

/** The sink rules for TypeScript, JavaScript and Svelte files. */
export const sinkConfig = [
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node } },
    rules: bannedSinkRules,
  },
  ...sveltePlugin.configs['flat/base'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
      globals: { ...globals.browser },
    },
    rules: bannedSinkRules,
  },
];
