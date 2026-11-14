// The pure core has no DOM, no network and no direct access to time (ADR 0010, docs/ARCHITECTURE.md
// section 6). Time comes from a Clock. tests/lint/boundary.test.ts proves these rules catch each case.

export const PURE_FOLDERS = ['src/dali/**', 'src/sim/**', 'src/bus/**', 'src/safety/**'];

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

export const boundaryConfig = [
  {
    files: PURE_FOLDERS.map((f) => `${f}/*.ts`),
    ignores: ['**/*.test.ts'],
    rules: boundaryRules,
  },
];
