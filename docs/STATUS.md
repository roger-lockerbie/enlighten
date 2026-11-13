# Status

## Where the build is up to

Stage 0 (repo, tooling and security baseline) is built and verified locally. `pnpm verify` passes. The branch has not been pushed, because `gh` isn't installed and no GitHub remote is set (see "Open items").

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

- `gh` is not installed, so the private GitHub repo, Dependabot alerts and the `main` ruleset are not set up. The workflows have not run on GitHub yet, so "passes in CI" is unconfirmed.
- Stage 0 is not done until CI is green and the PR is merged.

## Next

Stage 1 (research) on Fable, in plan mode.
