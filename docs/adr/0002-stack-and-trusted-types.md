# ADR 0002: Stack, and the Trusted Types policy after the spike

Status: accepted

Date: 2026-11-14

## Context

The brief's default stack is TypeScript, Vite, Svelte 5, three.js used directly, and Web Workers. It has to run under the strict CSP and enforced Trusted Types from Stage 0. Stage 1 left five things unproven (`docs/research/security.md`, "For the Stage 2 spike") and `docs/research/rendering.md` added a frame-time question.

The spike is on the branch `spike/stage-2-stack`, commit `9730a32`. It is not merged. It ran in Playwright's Chromium against `vite preview` with the production headers, and the GPU timing was repeated in desktop Chromium on an Apple M1 Pro.

## Results

| Check                                                                                                                | Result                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Worker(new URL('./w.ts', import.meta.url), { type: 'module' })`                                                 | Throws: "This document requires 'TrustedScriptURL' assignment". A `URL` object is treated as a string.                                                          |
| Worker URL from `import url from './w.ts?worker&url'`, passed through a policy                                       | Loads. The worker reports `crossOriginIsolated` as true. No violation.                                                                                          |
| The policy given any other URL                                                                                       | Throws, as written.                                                                                                                                             |
| Svelte `fragments: 'tree'` with `svelte-trusted-html` removed from the CSP                                           | Works. The built bundle contains no `svelte-trusted-html` string and makes no policy of Svelte's.                                                               |
| Cost of `fragments: 'tree'`                                                                                          | Mounting 400 rows: median 3.1 ms, against 3.6 ms for the default. No measurable cost. The bundle grows by 541 bytes.                                            |
| A `style:` directive under `style-src 'self'`                                                                        | No violation. The value is applied.                                                                                                                             |
| A CSS custom property set with `style.setProperty()` from an action                                                  | No violation.                                                                                                                                                   |
| three.js 0.187.0, `WebGLRenderer` on our own canvas, `setSize(w, h, false)`                                          | Renders. No CSP or Trusted Types violation and no console error.                                                                                                |
| A `ShaderMaterial` writing (0.5, 0.25, 0.125)                                                                        | Reads back as (128, 64, 32). The renderer adds no colour conversion to a custom shader.                                                                         |
| `drawingBufferColorSpace = 'display-p3'`                                                                             | Accepted and read back.                                                                                                                                         |
| The built page with every response header stripped                                                                   | The meta tag still enforces Trusted Types: a plain string to an HTML sink throws.                                                                               |
| A same-origin WebSocket under `connect-src 'self'`                                                                   | Connects and echoes. No violation.                                                                                                                              |
| Frame time: six rectangle emitters (edge integral) and six layers of an RGBA16F array texture per pixel, 1440 by 900 | 1.5 ms a frame on an Apple M1 Pro (ANGLE on Metal). 40 ms under SwiftShader, the software renderer CI uses.                                                     |
| A 50 ms worker timer with another tab in front (desktop Chromium)                                                    | 26 of 60 ticks arrived in 3 s, while `performance.now()` in the worker stayed correct. The page still reported itself visible, so the cause is not established. |

Bundle size with three.js imported by name: 568 kB, 147 kB gzipped, in one chunk.

## Decision

1. Keep the default stack: Svelte 5 (runes), Vite 8, three.js core, TypeScript strict.
2. Compile Svelte with `fragments: 'tree'`. Remove `svelte-trusted-html` from the CSP. This replaces the Trusted Types part of ADR 0001.
3. The production policy line becomes `trusted-types enlighten-worker`. One policy exists, in one file. Its `createScriptURL` returns its input only when it equals one of the worker URLs fixed at build time, and throws otherwise. It has no `createHTML` and no `createScript`.
4. Workers are imported with `?worker&url` and constructed only in that file. Lint bans `createPolicy` and `new Worker` everywhere else. The `?worker&inline` form and blob workers stay banned.
5. `style:` directives are allowed. `style="..."` and `style={...}` stay banned by lint (`svelte/no-inline-styles`), because they reach the page as attributes.
6. three.js is the one runtime dependency of the app. Only named imports from `three` are used. No addons. The visualiser is loaded with a dynamic `import()`, so the simulator and playground do not pay for it.
7. Colour is the app's own work in its own shaders (ADR 0008). three.js tone mapping and colour management are not used for the hallway.
8. Performance is not gated in CI, because CI renders in software. `docs/TEST_PLAN.md` sets the budget and how it is measured.

Stage 5 applies items 2 to 5 to `svelte.config.js`, `config/security.ts`, the lint rules and the header tests, since it is the first stage to add components.

## Consequences

- No pass-through HTML policy exists in the page. An attacker who finds a string-to-HTML path has no policy to borrow.
- Every new worker is a deliberate edit to the policy file's list.
- Clocks must read time and never count ticks. The background-tab result is not conclusive, and Stage 9's hidden-tab test settles it.
- The 4 ms frame budget has a lot of room on this laptop. The M1 Pro is faster than a typical integrated GPU, so the budget is measured again on the client's machine.
- `docs/research/security.md` guessed that a `style:` directive might violate `style-src`. In Chromium it does not.

## Alternatives considered

- Keep `svelte-trusted-html`: works, but leaves an identity policy in the page for no gain.
- `trusted-types 'none'`: cannot load a worker.
- A `default` policy: defeats enforcement, as the specification warns.
- Another framework: not needed, since the default passed every check.
