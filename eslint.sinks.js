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

const sinkName = `/^(${[...HTML_SINKS, 'write', 'writeln'].join('|')})$/`;

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
      selector: `Literal[value=${sinkName}]`,
      message: 'A string that names a banned sink is banned, so the sink cannot be reached by key.',
    },
    {
      selector: `TemplateElement[value.raw=${sinkName}]`,
      message: 'A string that names a banned sink is banned.',
    },
    {
      selector:
        'MemberExpression[property.name=/^(write|writeln)$/][object.property.name="document"]',
      message: 'document.write is banned.',
    },
    {
      selector:
        'MemberExpression[computed=true][property.value=/^(write|writeln)$/][object.name="document"]',
      message: 'document.write is banned.',
    },
    {
      selector: 'CallExpression[callee.property.name=/^(Function|constructor)$/]',
      message: 'Calling a Function constructor builds code from a string and is banned.',
    },
    {
      selector: 'CallExpression[callee.property.name="setAttributeNS"]',
      message: 'setAttributeNS is banned. Use setAttribute with a literal name.',
    },
    {
      selector: 'CallExpression[callee.property.name="setAttribute"][arguments.0.type!="Literal"]',
      message:
        'setAttribute needs a literal attribute name, so srcdoc and on* handlers stay greppable.',
    },
    {
      selector: 'ImportSpecifier[imported.name="createRawSnippet"]',
      message:
        'createRawSnippet renders HTML through the pass-through Trusted Types policy and is banned.',
    },
    {
      selector:
        'SvelteDirective[kind="Binding"][key.name.name=/^(innerHTML|outerHTML|textContent)$/]',
      message: 'Binding to innerHTML, outerHTML or textContent is banned.',
    },
    {
      selector: 'SvelteAttribute[key.name="srcdoc"]',
      message: 'srcdoc is banned.',
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
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
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
