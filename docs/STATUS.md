# Status

## Where the build is up to

Stages 0 to 3 are merged. Stage 4 (transports and the hasseb) is in progress on `stage-4-transports`, on Opus. The approved plan's parts: A core plumbing, B engine, C workers and the page, D the Python server, E e2e and CI, F docs and stage close.

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
- `docs/OPEN_QUESTIONS.md`: nothing is open for the owner or the client. It lists what waits on hardware.

The spike is on `spike/stage-2-stack`, pushed and not merged. Its results are in ADR 0002: the default stack passed every check under the strict CSP and Trusted Types.

Decisions the owner made during this stage: panic's safe level is off, the server uses the `websockets` library, the server stays a relay with no rate limit of its own, and the answers to the Stage 2 questions, recorded as decisions 10 to 19 in `docs/research/SUMMARY.md`.

`docs/STAGES.md` now matches the design for Stages 3, 4, 5 and 12.

## Stage 3 (DALI core, simulator and safety governor), done and waiting for review

Branch `stage-3-core`. What is in it:

- `tools/golden/generate.py` and the fixtures in `tests/golden/` (`pnpm golden`). `src/dali` is byte-equal to python-dali for every supported command and a decode sweep, with one documented departure (ADR 0011).
- `src/sim`: the DA5-L profile with every unknown as a sourced setting and a hardware-day check, the gear model, the simulated bus. Behaviour tests per section of `dali.md`, and the differential check against python-dali's fake gear.
- `src/bus`: the clock, timing with floors, and the scheduler with panic.
- `src/safety`: the governor (rule table, mix rule, rate guard, safety profile, ceiling, panic), and on hardware a shadow built from scan read-backs. ADR 0011 records the interfaces as built and the rate guard's exact rules.
- Property tests on a virtual-clock bench, including a hardware variant where the real gear differs from anything the governor starts with. All 15 pass at 1,000 runs each.
- `pnpm verify` runs `pnpm coverage`: 99% of lines on the pure core and over 95% of branches on `src/safety`.
- `pnpm mutate` scores 94.73% (94.46% on `src/safety`), past the 85% target. Every surviving mutant in `src/safety` is listed with its reason in `docs/MUTATION.md`. The runs found gaps in the tests, now closed, and one bug: a governor accepted a starting ceiling outside arc levels 1 to 254. That is fixed.
- Reviews: `dali-reviewer` passed with follow-ups, all fixed and re-checked. `security-reviewer` failed the first run (hardware shadow) and the first re-run (rescan staleness). Both were fixed, and the second re-run passed with follow-ups, which are fixed or logged in `docs/SECURITY_FINDINGS.md`.

Owner decision on the ceiling. When the ceiling is lowered while a driver is fading down from above the new ceiling, and that driver does not pull its output down to a lower MAX LEVEL, `lowerCeiling` sends the hold DAPC and then an OFF, because the light is still above the new ceiling while it fades. The owner chose to keep the OFF as the safe choice. With the profile default (`maxLowerPullsDown: true`, a hardware-day item) the case does not arise. `src/safety/ceiling.edges.test.ts` pins it.

Carried to Stage 4: the router with single-use, time-bound approvals; `RealClock`; the hasseb report builder and its G-hasseb test; the transport keeping frames in order when panic stops waiting after 100 ms.

## Stage 4 (transports and the hasseb), in progress: stage close

Branch `stage-4-transports`. ADR 0012 records what was built and the choices made. What is in it:

- `src/bus/clock.ts`: `TimerClock`, the real clock, with timers as wake-ups only.
- `src/transport/`: `SimTransport`, the server protocol codec and `ServerTransport`, pure through an injected socket.
- `src/engine/`: the router (approvals used once per frame, in order and in time), the engine (targets, fresh hardware state on every connect, drops, panic, the heartbeat watchdog, ceiling, unlocks, requests), discovery, the divergence gate and background check for Both, the coalescer, commissioning, the hardware check, and the page and worker protocol.
- `src/workers/`: the bus worker shell and the one Trusted Types policy. `src/ui/`: the page's bus client and an interim page (top bar, banners, Devices page). Stage 5 builds the shell.
- `server/`: the hardware server, its fake hasseb and bench (`pnpm server:demo`), and its pytest suite (`pnpm test:server`). websockets 17.4, so Python 3.11 or later.
- e2e: E-modes and E-server against the server with its fake (`playwright.server.config.ts`), run by `pnpm e2e` after the preview tests. CI installs the server from hashes and runs its tests.
- SPEC section 9 fixes the encoding and adds `STOPPED`. ADR 0002 items 2 to 4 and `hid=()`, `fullscreen=()` moved here from Stage 5, because Stage 4 adds the first worker.

Found while building, for the owner: on hardware, while any DT8 driver's colour is unknown this session, lowering MAX LEVEL below a lit driver's level is refused with no retry time (the rate guard counts two hard steps in one transaction, ADR 0011). The hardware check sets a known colour on every driver first. Lowering the ceiling while lights are on, right after a connect, can fail the same way.

Stage close: `pnpm verify`, `PROP_RUNS=1000 pnpm test:prop`, `pnpm mutate`, then `security-reviewer` and `dali-reviewer`.

## Next

Finish the Stage 4 close. Then Stage 5 (app shell, design system and playground) on Sonnet, in plan mode.
