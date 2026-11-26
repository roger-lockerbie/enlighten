# Dependencies

Each dependency is justified here with its licence. Add a runtime dependency only with the owner's approval. The app has one runtime dependency, three.js, installed in Stage 7. Beyond that it ships only its own code and Svelte's compiled output. The hardware server has three, installed since Stage 4.

## Installed: the app's run-time dependency

| Package | Version | Licence | Where                                        | Why                                                                                                 | Approved                            |
| ------- | ------- | ------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| three   | 0.187.0 | MIT     | The app, in a lazily loaded chunk of its own | WebGL renderer for the visualiser. Core only, named imports, no addons. No dependencies of its own. | The brief's default stack, ADR 0002 |

## Installed: the hardware server's run-time dependencies

In `server/.venv`, from `server/requirements.txt`. See "Python: the hardware server" below.

| Package     | Version | Licence                                                        | Where      | Why                                                                                                                      | Approved                              |
| ----------- | ------- | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| websockets  | 17.4    | BSD-3-Clause                                                   | The server | HTTP and WebSocket serving for the hardware server. No dependencies of its own. Its wheels carry an optional C speed-up. | The owner, 14 November 2026, ADR 0003 |
| python-dali | 0.16    | LGPL-3.0                                                       | The server | Frame decoding at run time. Used as a dependency, never copied.                                                          | The owner, 14 November 2026           |
| hidapi      | 0.15.0  | BSD-3-Clause (offered beside GPL-3.0 and its original licence) | The server | USB HID access to the hasseb.                                                                                            | The owner, with python-dali           |

## Fonts

Assets, not packages, in `src/assets/fonts/` with their licence texts and SHA-256 sums. `tests/fonts.test.ts` checks the sums. Each file matched its git blob hash in the tagged repository when it was added (Stage 5, the owner's approval in planning).

| File                          | Version | Licence                   | From                                                       |
| ----------------------------- | ------- | ------------------------- | ---------------------------------------------------------- |
| `Inter-Regular.woff2`         | 4.1     | SIL Open Font License 1.1 | `rsms/inter`, tag `v4.1`, `docs/font-files/`               |
| `Inter-Medium.woff2`          | 4.1     | SIL Open Font License 1.1 | `rsms/inter`, tag `v4.1`, `docs/font-files/`               |
| `JetBrainsMono-Regular.woff2` | 2.304   | SIL Open Font License 1.1 | `JetBrains/JetBrainsMono`, tag `v2.304`, `fonts/webfonts/` |

## Development dependencies

| Package                        | Version | Licence    | Why                                                                                   |
| ------------------------------ | ------- | ---------- | ------------------------------------------------------------------------------------- |
| typescript                     | 6.0.3   | Apache-2.0 | Strict typing. Held at 6.0.x, see ADR 0001.                                           |
| vite                           | 8.3.8   | MIT        | Build, dev server and preview server (the preview server sets the security headers).  |
| svelte                         | 5.57.3  | MIT        | UI framework. Compiles away, and runs under strict CSP and Trusted Types.             |
| @sveltejs/vite-plugin-svelte   | 7.3.1   | MIT        | Compiles Svelte in Vite.                                                              |
| vitest                         | 5.1.0   | MIT        | Unit and property test runner.                                                        |
| fast-check                     | 4.10.2  | MIT        | Property tests.                                                                       |
| @playwright/test               | 1.65.0  | Apache-2.0 | e2e tests in Chromium.                                                                |
| eslint                         | 10.14.0 | MIT        | Linting, including the banned-sink rules.                                             |
| @eslint/js                     | 10.0.1  | MIT        | ESLint's recommended rules.                                                           |
| typescript-eslint              | 8.72.2  | MIT        | Strict, type-checked lint rules.                                                      |
| eslint-plugin-svelte           | 3.24.1  | MIT        | Svelte lint rules, including `no-at-html-tags`.                                       |
| svelte-eslint-parser           | 1.10.1  | MIT        | Lets ESLint read Svelte files.                                                        |
| prettier                       | 3.10.1  | MIT        | Formatting.                                                                           |
| prettier-plugin-svelte         | 4.1.1   | MIT        | Formats Svelte files.                                                                 |
| svelte-check                   | 4.7.8   | MIT        | Type checks Svelte files.                                                             |
| globals                        | 17.14.0 | MIT        | Global names for ESLint.                                                              |
| @types/node                    | 26.6.6  | MIT        | Node types for config and tests.                                                      |
| @vitest/coverage-v8            | 5.1.0   | MIT        | Line and branch coverage for `pnpm coverage`, against the targets in the test plan.   |
| @stryker-mutator/core          | 10.1.1  | Apache-2.0 | Mutation testing on `src/safety` and the codec (`pnpm mutate`). On demand, not in CI. |
| @stryker-mutator/vitest-runner | 10.1.1  | Apache-2.0 | Runs Stryker's mutants through Vitest.                                                |
| @types/three                   | 0.187.0 | MIT        | Types for three.js, which ships none of its own.                                      |

Versions are pinned exactly in `package.json`, and `pnpm-lock.yaml` is committed.

`@types/three` depends on six packages that exist to type three.js addons: `@dimforge/rapier3d-compat` 0.12.0 (Apache-2.0), `@tweenjs/tween.js` 23.1.3 (MIT), `@types/stats.js` 0.17.4 (MIT), `@types/webxr` 0.5.24 (MIT), `fflate` 0.8.3 (MIT) and `meshoptimizer` 1.1.1 (MIT). The app uses no addons, imports none of these, and none reaches `dist/`. They sit in `node_modules` with their install scripts blocked like every other package. The way to drop them is to write our own declarations for the dozen three.js classes the renderer uses.

## Python: the hardware server

`server/requirements.txt` pins the server's three run-time dependencies, every file by hash: python-dali 0.16, hidapi 0.15.0 and websockets 17.4. They are listed above as approved. websockets 17.4 needs Python 3.11 or later, so the server does too. Install with `--require-hashes --only-binary :all:` into `server/.venv`, which is git-ignored.

`server/requirements-dev.txt` pins the test runner and its own dependencies, also by hash. They run only in tests:

| Package   | Version | Licence                    | Why                                      |
| --------- | ------- | -------------------------- | ---------------------------------------- |
| pytest    | 9.2.0   | MIT                        | The server's tests (U-server, G-hasseb). |
| pluggy    | 1.7.0   | MIT                        | pytest's plugin system.                  |
| iniconfig | 2.3.1   | MIT                        | pytest reads its settings with it.       |
| packaging | 26.3    | Apache-2.0 or BSD-2-Clause | pytest's version handling.               |
| pygments  | 2.21.0  | BSD-2-Clause               | pytest's coloured output.                |

pip has no minimum release age. Each version above was at least seven days old when pinned (websockets 17.4 was released on 30 October 2026, pytest 9.2.0 on 27 October 2026). A new pin is made by hand after reading the release.

## Python (dev time only)

`tools/golden/requirements.txt` locks python-dali 0.16 (LGPL-3.0, used as a reference and test oracle, never copied into this repo or shipped) and hidapi 0.15.0 (python-dali's hasseb driver imports it). Every file is pinned by hash. `pnpm golden` runs `tools/golden/generate.py`, which calls python-dali and writes the JSON in `tests/golden/`. CI reads only that JSON.

Vite 8.3.8 (Stage 11) moves its bundler, rolldown, from 1.2.16 to 1.2.19. That release adds an optional build of rolldown for WebAssembly, `@rolldown/binding-wasm32-wasi`, with four packages under it: `@napi-rs/wasm-runtime` 1.2.6, `@emnapi/core` and `@emnapi/runtime` 2.0.0-beta.2, `@emnapi/wasi-threads` 2.2.0 and `@tybys/wasm-util` 0.10.5 (all MIT). They are in the lockfile and are installed only on a platform with no native rolldown build, which is none of ours. The two emnapi packages are beta releases, pinned by rolldown.

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

## Licences across the whole tree

Checked in Stage 11 with `pnpm licenses list` over all 350 packages in the lockfile: MIT (266), Apache-2.0 (35), ISC (13), BSD-2-Clause (6), BSD-3-Clause (5), MPL-2.0 (2, lightningcss and its native build), 0BSD (1), BlueOak-1.0.0 (1, minimatch) and CC-BY-4.0 (1, caniuse-lite, which is data). All are development tools except three.js and Svelte's runtime, both MIT, which are the only package code in `dist/`. lightningcss is MPL-2.0 and runs at build time: none of its code is copied into `dist/`. The server's three packages are in the table above. python-dali's own metadata says LGPL-3.0-or-later.

`THIRD_PARTY_NOTICES.md` at the top of the repo carries the notices for what a release ships: three.js, Svelte and the fonts.

## SBOM

`pnpm sbom:all` writes two CycloneDX 1.7 files into `sbom/`, which is git-ignored. `enlighten-app.cdx.json` comes from pnpm's own `pnpm sbom` and lists every npm package in the lockfile, development tools included, because Svelte is a development dependency whose runtime ships. `enlighten-server.cdx.json` comes from `tools/sbom/server.py`, which reads `server/requirements.txt` and uses the standard library only, so the SBOM tooling adds no package. The release workflow attaches both to a release.

## Advisories on transitive packages

All three are in development tools. None of the affected code is in `dist/` or the hardware server. Rechecked in Stage 11 on 26 November 2026: `pnpm audit` reports minimatch only.

- **qs, overridden to 6.16.2.** typed-rest-client 2.3.1, which Stryker uses for its dashboard reporter, pins qs 6.15.1 exactly. That version has four moderate advisories, all fixed by 6.16.2, a patch release in the same line. We don't use the dashboard reporter, so the risk was low, but the fix was cheap. Remove the override when typed-rest-client moves past 6.15.
- **minimatch 10.2.6, open.** It has one moderate advisory, GHSA-g3hv-75wg-m249 (a slow glob), fixed only in 11.0.1. ESLint, typescript-eslint and Stryker all ask for 10.x, and forcing a major version under them could break linting or mutation runs. Its patterns come from our own config files, never from outside input. It will be picked up when those tools move to 11.
- **deepmerge 4.3.1.** `pnpm audit` no longer reports it (26 November 2026), and the version is unchanged. It had one low advisory, GHSA-gcqx-w48m-w2h4 (prototype poisoning in the merged object), and no fixed release yet. vite-plugin-svelte uses it at build time to merge our own Svelte config. It will be updated when a fix is released.

CI and the setup steps in the README use `pnpm install --frozen-lockfile`, which fails if `package.json` and the lockfile disagree.
