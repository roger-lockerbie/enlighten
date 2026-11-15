# Dependencies

Each dependency is justified here with its licence. Add a runtime dependency only with the owner's approval. There are no runtime dependencies installed yet: the app ships only its own code and Svelte's compiled output. The ones approved for later stages are listed below.

## Approved, not yet installed

| Package     | Version           | Licence                                                        | Where            | Why                                                                                                                      | Approved                              |
| ----------- | ----------------- | -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| three       | 0.187.0           | MIT                                                            | The app, Stage 7 | WebGL renderer for the visualiser. Core only, named imports, no addons. No dependencies of its own.                      | The brief's default stack, ADR 0002   |
| websockets  | pinned in Stage 4 | BSD-3-Clause                                                   | The server       | HTTP and WebSocket serving for the hardware server. No dependencies of its own. Its wheels carry an optional C speed-up. | The owner, 14 November 2026, ADR 0003 |
| python-dali | 0.16              | LGPL-3.0                                                       | The server       | Frame decoding at run time. Used as a dependency, never copied.                                                          | The owner, 14 November 2026           |
| hidapi      | 0.15.0            | BSD-3-Clause (offered beside GPL-3.0 and its original licence) | The server       | USB HID access to the hasseb.                                                                                            | The owner, with python-dali           |

Fonts are assets, not packages: Inter and JetBrains Mono, both SIL Open Font License 1.1, added as WOFF2 files with their licence texts in Stage 5 (`docs/UI.md`).

## Development dependencies

| Package                        | Version | Licence    | Why                                                                                   |
| ------------------------------ | ------- | ---------- | ------------------------------------------------------------------------------------- |
| typescript                     | 6.0.3   | Apache-2.0 | Strict typing. Held at 6.0.x, see ADR 0001.                                           |
| vite                           | 8.3.6   | MIT        | Build, dev server and preview server (the preview server sets the security headers).  |
| svelte                         | 5.57.3  | MIT        | UI framework. Compiles away, and runs under strict CSP and Trusted Types.             |
| @sveltejs/vite-plugin-svelte   | 7.3.1   | MIT        | Compiles Svelte in Vite.                                                              |
| vitest                         | 5.1.0   | MIT        | Unit and property test runner.                                                        |
| fast-check                     | 4.10.2  | MIT        | Property tests.                                                                       |
| @playwright/test               | 1.65.0  | Apache-2.0 | e2e tests in Chromium.                                                                |
| eslint                         | 10.14.0 | MIT        | Linting, including the banned-sink rules.                                             |
| @eslint/js                     | 10.0.1  | MIT        | ESLint's recommended rules.                                                           |
| typescript-eslint              | 8.72.1  | MIT        | Strict, type-checked lint rules.                                                      |
| eslint-plugin-svelte           | 3.24.0  | MIT        | Svelte lint rules, including `no-at-html-tags`.                                       |
| svelte-eslint-parser           | 1.10.1  | MIT        | Lets ESLint read Svelte files.                                                        |
| prettier                       | 3.9.10  | MIT        | Formatting.                                                                           |
| prettier-plugin-svelte         | 4.1.1   | MIT        | Formats Svelte files.                                                                 |
| svelte-check                   | 4.7.8   | MIT        | Type checks Svelte files.                                                             |
| globals                        | 17.14.0 | MIT        | Global names for ESLint.                                                              |
| @types/node                    | 26.6.6  | MIT        | Node types for config and tests.                                                      |
| @vitest/coverage-v8            | 5.1.0   | MIT        | Line and branch coverage for `pnpm coverage`, against the targets in the test plan.   |
| @stryker-mutator/core          | 10.1.1  | Apache-2.0 | Mutation testing on `src/safety` and the codec (`pnpm mutate`). On demand, not in CI. |
| @stryker-mutator/vitest-runner | 10.1.1  | Apache-2.0 | Runs Stryker's mutants through Vitest.                                                |

Versions are pinned exactly in `package.json`, and `pnpm-lock.yaml` is committed.

## Python (dev time only)

`tools/golden/requirements.txt` locks python-dali 0.16 (LGPL-3.0, used as a reference and test oracle, never copied into this repo or shipped) and hidapi 0.15.0 (python-dali's hasseb driver imports it). Every file is pinned by hash. `pnpm golden` runs `tools/golden/generate.py`, which calls python-dali and writes the JSON in `tests/golden/`. CI reads only that JSON.

The Stryker packages bring about 160 transitive packages, all for development. None runs an install script, and each passed the release-age and trust policies below when added.

## pnpm settings

All live in `pnpm-workspace.yaml`.

| Setting                   | Value          | What it does                                                                                                                                      |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimumReleaseAge`       | 10080          | Refuses any version published in the last seven days (the value is in minutes). Most malicious releases are pulled within days.                   |
| `minimumReleaseAgeStrict` | true           | Fails the install when no mature version fits a range, instead of falling back to a young one.                                                    |
| `trustPolicy`             | no-downgrade   | Fails when a package version has weaker publish evidence (provenance or trusted publishing) than an earlier one. This catches package takeovers.  |
| `trustPolicyExclude`      | chokidar@4.0.3 | One accepted exception. chokidar 4.0.3 is flagged, and it is a transitive dependency of svelte-check. Review it again when svelte-check moves on. |
| `strictDepBuilds`         | true           | Fails the install if a dependency has an install script that nobody approved.                                                                     |
| `allowBuilds`             | `{}`           | The allowlist for dependency install scripts. It is empty: no dependency may run an install script.                                               |
| `savePrefix`              | `''`           | Saves exact versions, never `^` or `~`.                                                                                                           |
| `overrides`               | `qs: 6.16.2`   | Replaces a vulnerable transitive version. See the next section.                                                                                   |

## Advisories on transitive packages

All three are in development tools. None of the affected code is in `dist/` or the hardware server.

- **qs, overridden to 6.16.2.** typed-rest-client 2.3.1, which Stryker uses for its dashboard reporter, pins qs 6.15.1 exactly. That version has four moderate advisories, all fixed by 6.16.2, a patch release in the same line. We don't use the dashboard reporter, so the risk was low, but the fix was cheap. Remove the override when typed-rest-client moves past 6.15.
- **minimatch 10.2.6, open.** It has one moderate advisory, GHSA-g3hv-75wg-m249 (a slow glob), fixed only in 11.0.1. ESLint, typescript-eslint and Stryker all ask for 10.x, and forcing a major version under them could break linting or mutation runs. Its patterns come from our own config files, never from outside input. It will be picked up when those tools move to 11.
- **deepmerge 4.3.1, open.** It has one low advisory, GHSA-gcqx-w48m-w2h4 (prototype poisoning in the merged object), and no fixed release yet. vite-plugin-svelte uses it at build time to merge our own Svelte config. It will be updated when a fix is released.

CI and the setup steps in the README use `pnpm install --frozen-lockfile`, which fails if `package.json` and the lockfile disagree.
