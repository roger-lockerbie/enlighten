# Status

## Where the build is up to

Stage 0 (repo, tooling and security baseline) and Stage 1 (research) are merged. Stage 2 (design) is written on `stage-2-design` and waiting for the owner's review. Stage 3 (DALI core, simulator and safety governor) is next, on Opus, in plan mode.

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

## Stage 1 (research), merged

The ten documents are in `docs/research/`. `SUMMARY.md` lists the findings that change the brief and the owner's decisions on them. Each document lists what it could not confirm. Nothing has been measured on hardware.

## Stage 2 (design), done and waiting for review

Branch `stage-2-design`. From this stage on, these documents are the authority, and the brief and `CLAUDE.md` are background:

- `docs/SPEC.md`: features and acceptance criteria for R1 to R16 and S1 to S6, the governor's rule table, the console language, the script format, the workspace file, the server protocol, and the traceability table.
- `docs/ARCHITECTURE.md`: modules, interfaces, the one path through the governor, the three output targets, the server, persistence and the folder layout.
- `docs/THREAT_MODEL.md`, `docs/TEST_PLAN.md` (with the hardware-day checklist), `docs/UI.md` with wireframes in `docs/wireframes/`.
- ADRs 0002 to 0010 in `docs/adr/`.
- `docs/OPEN_QUESTIONS.md`: what is needed from the owner and the client.

The spike is on `spike/stage-2-stack`, pushed and not merged. Its results are in ADR 0002: the default stack passed every check under the strict CSP and Trusted Types.

Decisions the owner made during this stage: panic's safe level is off, the server uses the `websockets` library, and the edits to later stages in `docs/STAGES.md` are their own commit.

`docs/STAGES.md` now matches the design for Stages 3, 4, 5 and 12.

## Next

Stage 3 on Opus, in plan mode. Read `docs/SPEC.md` section 5, ADR 0004 and ADR 0005 first. Before starting, check `docs/OPEN_QUESTIONS.md` for answers: question 1 (a small rate limit in the server) affects Stage 4, not Stage 3.
