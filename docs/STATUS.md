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

## Stage 1 (research), in progress

Branch `stage-1-research`. The plan: read python-dali 0.16 (sdist checked against the hash in `tools/golden/requirements.txt`, kept outside the repo), run nine web research threads through subagents, then write the ten documents in `docs/research/` one commit at a time.

Progress:

- python-dali 0.16 source read: `gear/general.py`, `gear/colour.py`, `gear/sequences.py`, `gear/led.py`, `sequences.py`, `command.py`, `driver/hasseb.py`, `driver/hid.py` and `tests/fakes.py`.
- Research threads started: DALI gear behaviour, hasseb and WebHID, DA5-L, optics, rendering, effects, switchgear, console, security. Their notes live in a session scratch folder, not in the repo, so a new session has to rerun any thread whose document is not yet committed.
- Documents committed so far: none.

## Next

Finish Stage 1 on Fable. Then Stage 2 (design) on Fable, in plan mode.
