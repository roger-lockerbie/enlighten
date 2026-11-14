// The pure core has no DOM, no network and no direct access to time (ADR 0010, docs/ARCHITECTURE.md
// section 6). Time comes from a Clock. Only the worker shell constructs transports, and it never sends:
// only src/engine/router.ts does (SPEC S2.1). Only src/workers/policy.ts makes a Trusted Types policy
// or a worker (ADR 0002). tests/lint/boundary.test.ts proves these rules catch each case.
import { bannedSinkRules } from './eslint.sinks.js';

export const PURE_FOLDERS = [
  'src/dali/**',
  'src/sim/**',
  'src/bus/**',
  'src/safety/**',
  'src/engine/**',
  'src/transport/**',
];

const timeMessage = 'The pure core takes time from a Clock (ADR 0010).';
const domMessage = 'The pure core has no DOM or network (docs/ARCHITECTURE.md section 6).';

const restrictedGlobals = [
  ...[
    'setTimeout',
    'setInterval',
    'setImmediate',
    'clearTimeout',
    'clearInterval',
    'clearImmediate',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'performance',
    'Date',
    'queueMicrotask',
  ].map((name) => ({ name, message: timeMessage })),
  ...[
    'window',
    'document',
    'navigator',
    'location',
    'self',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'HTMLElement',
    'Element',
    'Node',
    'MessageChannel',
    'BroadcastChannel',
    'crypto',
  ].map((name) => ({ name, message: domMessage })),
];

export const boundaryRules = {
  'no-restricted-globals': ['error', ...restrictedGlobals],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: timeMessage },
    { object: 'performance', property: 'now', message: timeMessage },
    { object: 'globalThis', property: 'setTimeout', message: timeMessage },
    { object: 'globalThis', property: 'setInterval', message: timeMessage },
    { object: 'globalThis', property: 'performance', message: timeMessage },
    { object: 'globalThis', property: 'document', message: domMessage },
    { object: 'globalThis', property: 'window', message: domMessage },
    { object: 'globalThis', property: 'fetch', message: domMessage },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['svelte', 'svelte/*', '*.svelte'], message: domMessage },
        { group: ['**/ui/**', '**/workers/**', '**/transport/**'], message: domMessage },
        {
          group: ['node:*', 'fs', 'path', 'child_process', 'http', 'https', 'net'],
          message: 'The pure core runs in a worker as well as in Node.',
        },
      ],
    },
  ],
};

/** The sink selectors, so a group that adds its own `no-restricted-syntax` keeps them (flat config replaces a rule's options). */
const sinkSyntax = bannedSinkRules['no-restricted-syntax'].slice(1);

const policyMessage =
  'Only src/workers/policy.ts makes a Trusted Types policy or a worker (ADR 0002).';

/** Bans for every file but the policy file. */
const workerSyntax = [
  { selector: 'MemberExpression[property.name="createPolicy"]', message: policyMessage },
  { selector: 'NewExpression[callee.name=/^(Worker|SharedWorker)$/]', message: policyMessage },
];

/** Bans for every source file, the policy file included: no blob or inline workers (ADR 0002). */
const blobSyntax = [
  {
    selector: 'MemberExpression[property.name="createObjectURL"]',
    message: 'Blob URLs are banned: a worker loads from a URL fixed at build time (ADR 0002).',
  },
  {
    selector: 'ImportDeclaration[source.value=/[?&](inline|sharedworker)|[?]worker$/]',
    message: 'Workers are imported with ?worker&url only (ADR 0002).',
  },
];

const sendMessage =
  'Only src/engine/router.ts sends frames (SPEC S2.1). The engine submits to a scheduler; the worker shell never sends.';

/** The worker shell and the engine never call a transport's send, by name, by key or by destructuring. */
const sendSyntax = [
  { selector: 'CallExpression[callee.property.name=/^(send|sendPanic)$/]', message: sendMessage },
  {
    selector: 'MemberExpression[computed=true][property.value=/^(send|sendPanic)$/]',
    message: sendMessage,
  },
  { selector: 'ObjectPattern > Property[key.name=/^(send|sendPanic)$/]', message: sendMessage },
];

/** The page never opens a socket: the token goes to the bus worker, which does (ADR 0003). */
const socketSyntax = [
  {
    selector: 'NewExpression[callee.name=/^(WebSocket|EventSource)$/]',
    message: 'Only the bus worker opens the server socket (ADR 0003).',
  },
];

const syntax = (...groups) => ['error', ...sinkSyntax, ...groups.flat()];

const transportImports = [
  'error',
  {
    patterns: [
      {
        group: ['**/transport/**'],
        message:
          'Only the worker shell constructs transports, and only the router sends (SPEC S2.1).',
      },
    ],
  },
];

const tests = ['**/*.test.ts'];

export const boundaryConfig = [
  {
    files: PURE_FOLDERS.map((f) => `${f}/*.ts`),
    ignores: tests,
    rules: { ...boundaryRules, 'no-restricted-syntax': syntax(workerSyntax, blobSyntax) },
  },
  {
    // The engine, but the router: it submits to schedulers and never reaches a transport itself.
    files: ['src/engine/*.ts'],
    ignores: ['src/engine/router.ts', ...tests],
    rules: { 'no-restricted-syntax': syntax(workerSyntax, blobSyntax, sendSyntax) },
  },
  {
    // The page: components, stores and the entry point.
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    ignores: [...PURE_FOLDERS, 'src/workers/**', ...tests],
    rules: {
      'no-restricted-imports': transportImports,
      'no-restricted-syntax': syntax(workerSyntax, blobSyntax, socketSyntax),
    },
  },
  {
    files: ['src/workers/**/*.ts'],
    ignores: ['src/workers/policy.ts', ...tests],
    rules: { 'no-restricted-syntax': syntax(workerSyntax, blobSyntax, sendSyntax) },
  },
  {
    files: ['src/workers/policy.ts'],
    rules: { 'no-restricted-syntax': syntax(blobSyntax, sendSyntax) },
  },
];
