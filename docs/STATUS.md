# Status

## Where the build is up to

Stage 0 (repo, tooling and security baseline) is merged. Stage 1 (research) is written on `stage-1-research` and waiting for the owner's review.

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

- Private repo `roger-lockerbie/enlighten` exists, with Dependabot alerts on. PR 1 (Stage 0) is merged.
- CodeQL is written but skips while the repo is private, because code scanning needs a paid plan there. It runs once the repo is public in Stage 11.
- The `main` ruleset is not set: rulesets on a private repo need GitHub Pro. Add it in Stage 11. Until then, merge only with a green `verify`.
- Commits use the GitHub noreply email.

## Stage 1 (research), done and waiting for review

Branch `stage-1-research`. The ten documents are in `docs/research/`. Start with `SUMMARY.md`: it lists twelve findings that change the brief and seven decisions for the owner.

- `dali.md`: commands, gear behaviour, bus timing, and every edge case that touches the ceiling.
- `hasseb.md`: the 10-byte protocol, the WebHID mapping, a risk that Chrome blocks the device, the server design, and the hardware-day checklist.
- `da5-l.md`: what is known about the driver, and the query that settles each unknown.
- `optics.md`, `rendering.md`, `effects.md`, `switchgear.md`, `console.md`, `security.md`.

No app code changed. python-dali 0.16 was read from a copy outside the repo and never run.

Known gaps: the research was cut short several times by usage limits. Each document lists what it could not confirm. Nothing has been measured on hardware.

## Next

The owner has answered the summary's questions: see "The owner's decisions" in `docs/research/SUMMARY.md`. In short: the brightness ceiling is a nice-to-have, the hardware path is a Python server on python-dali with SSH forwarding for remote use, WebHID is optional, and the visualiser is a best-effort estimate.

Then Stage 2 (design) on Fable, or Opus if Fable is short, in plan mode. Stage 2 should:

- Design to those decisions. `CLAUDE.md` and `docs/BRIEF.md` still describe the ceiling as a safety control, WebHID as the hardware path and python-dali as dev-time only. Ask the owner whether to update them before designing against them.
- Read the WebHID specification's security section by hand only if the WebHID transport is kept.
