# Status

## Where the build is up to

Stage 0 (repo, tooling and security baseline) is built and verified locally. `pnpm verify` passes. The branch is pushed and PR 1 is open (see "Open items").

## Done in Stage 0

- Repo initialised on `main`. Review subagents moved to `.claude/agents/`.
- Toolchain pinned: Node 26.13.1, pnpm 12.18.0, TypeScript 6.0.3, Vite 8, Svelte 5, Vitest 5, Playwright 1.65 (Chromium only), ESLint 10.
- pnpm hardened (see `docs/DEPENDENCIES.md`).
- Security headers served by `vite preview` on 127.0.0.1:47821, with a meta-tag fallback in the build. The dev server uses 127.0.0.1:47820 and relaxes only what hot reload needs.
- Placeholder page, e2e CSP test, lint sink test, header unit and property tests.
- CI, CodeQL and Dependabot workflows written, with every action pinned to a commit SHA.
- `tools/golden/` requirements locked and installed into a git-ignored venv.

- `security-reviewer` run on the diff. Medium findings fixed, the rest logged in `docs/SECURITY_FINDINGS.md`.

## Open items

- Private repo `roger-lockerbie/enlighten` exists, with Dependabot alerts on. PR 1 is open and `verify` is green in CI.
- CodeQL is written but skips while the repo is private, because code scanning needs a paid plan there. It runs once the repo is public in Stage 11.
- The `main` ruleset is not set: rulesets on a private repo need GitHub Pro. Add it in Stage 11. Until then, merge only with a green `verify`.
- Commits use the GitHub noreply email.

## Next

Stage 1 (research) on Fable, in plan mode.
