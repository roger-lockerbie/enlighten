# Dependencies

Each dependency is justified here with its licence. Add a runtime dependency only with the owner's approval. There are no runtime dependencies yet: the app ships only its own code and Svelte's compiled output.

## Development dependencies

| Package                      | Version | Licence    | Why                                                                                  |
| ---------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------ |
| typescript                   | 6.0.3   | Apache-2.0 | Strict typing. Held at 6.0.x, see ADR 0001.                                          |
| vite                         | 8.3.6   | MIT        | Build, dev server and preview server (the preview server sets the security headers). |
| svelte                       | 5.57.3  | MIT        | UI framework. Compiles away, and runs under strict CSP and Trusted Types.            |
| @sveltejs/vite-plugin-svelte | 7.3.1   | MIT        | Compiles Svelte in Vite.                                                             |
| vitest                       | 5.1.0   | MIT        | Unit and property test runner.                                                       |
| fast-check                   | 4.10.2  | MIT        | Property tests.                                                                      |
| @playwright/test             | 1.65.0  | Apache-2.0 | e2e tests in Chromium.                                                               |
| eslint                       | 10.14.0 | MIT        | Linting, including the banned-sink rules.                                            |
| @eslint/js                   | 10.0.1  | MIT        | ESLint's recommended rules.                                                          |
| typescript-eslint            | 8.72.1  | MIT        | Strict, type-checked lint rules.                                                     |
| eslint-plugin-svelte         | 3.24.0  | MIT        | Svelte lint rules, including `no-at-html-tags`.                                      |
| svelte-eslint-parser         | 1.10.1  | MIT        | Lets ESLint read Svelte files.                                                       |
| prettier                     | 3.9.10  | MIT        | Formatting.                                                                          |
| prettier-plugin-svelte       | 4.1.1   | MIT        | Formats Svelte files.                                                                |
| svelte-check                 | 4.7.8   | MIT        | Type checks Svelte files.                                                            |
| globals                      | 17.14.0 | MIT        | Global names for ESLint.                                                             |
| @types/node                  | 26.6.6  | MIT        | Node types for config and tests.                                                     |

Versions are pinned exactly in `package.json`, and `pnpm-lock.yaml` is committed.

## Python (dev time only)

`tools/golden/requirements.txt` locks python-dali 0.16 (LGPL-3.0, used as a reference and test oracle, never copied into this repo or shipped) and hidapi 0.15.0 (python-dali's hasseb driver imports it). Every file is pinned by hash.

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

CI and `pnpm verify` use `pnpm install --frozen-lockfile`, which fails if `package.json` and the lockfile disagree.
