# Status

## Where the build is up to

Stages 0 to 4 are merged. Stage 5 (app shell, design system and playground) is done on `stage-5-shell`, on Opus by the owner's choice (the plan said Sonnet), and waiting for review in its PR.

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

## Stage 2 (design), merged

Branch `stage-2-design`. From this stage on, these documents are the authority, and the brief and `CLAUDE.md` are background:

- `docs/SPEC.md`: features and acceptance criteria for R1 to R16 and S1 to S6, the governor's rule table, the console language, the script format, the workspace file, the server protocol, and the traceability table.
- `docs/ARCHITECTURE.md`: modules, interfaces, the one path through the governor, the three output targets, the server, persistence and the folder layout.
- `docs/THREAT_MODEL.md`, `docs/TEST_PLAN.md` (with the hardware-day checklist), `docs/UI.md` with wireframes in `docs/wireframes/`.
- ADRs 0002 to 0010 in `docs/adr/`.
- `docs/OPEN_QUESTIONS.md`: nothing is open for the owner or the client. It lists what waits on hardware.

The spike is on `spike/stage-2-stack`, pushed and not merged. Its results are in ADR 0002: the default stack passed every check under the strict CSP and Trusted Types.

Decisions the owner made during this stage: panic's safe level is off, the server uses the `websockets` library, the server stays a relay with no rate limit of its own, and the answers to the Stage 2 questions, recorded as decisions 10 to 19 in `docs/research/SUMMARY.md`.

`docs/STAGES.md` now matches the design for Stages 3, 4, 5 and 12.

## Stage 3 (DALI core, simulator and safety governor), merged

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

## Stage 4 (transports and the hasseb), merged

Branch `stage-4-transports`. ADR 0012 records what was built and the choices made. What is in it:

- `src/bus/clock.ts`: `TimerClock`, the real clock, with timers as wake-ups only.
- `src/transport/`: `SimTransport`, the server protocol codec and `ServerTransport`, pure through an injected socket.
- `src/engine/`: the router (approvals used once per frame, in order and in time), the engine (targets, fresh hardware state on every connect, drops, panic, the heartbeat watchdog, ceiling, unlocks, requests), discovery, the divergence gate and background check for Both, the coalescer, commissioning, the hardware check, and the page and worker protocol.
- `src/workers/`: the bus worker shell and the one Trusted Types policy. `src/ui/`: the page's bus client and an interim page (top bar, banners, Devices page). Stage 5 builds the shell.
- `server/`: the hardware server, its fake hasseb and bench (`pnpm server:demo`), and its pytest suite (`pnpm test:server`). websockets 17.4, so Python 3.11 or later.
- e2e: E-modes and E-server against the server with its fake (`playwright.server.config.ts`), run by `pnpm e2e` after the preview tests. CI installs the server from hashes and runs its tests.
- SPEC section 9 fixes the encoding and adds `STOPPED`. ADR 0002 items 2 to 4 and `hid=()`, `fullscreen=()` moved here from Stage 5, because Stage 4 adds the first worker.

Stage close:

- `pnpm verify` passes: lint, typecheck, 2,322 unit and property tests at 98.46% line coverage on the pure core, the build, and both e2e configs (3 and 13 tests). The server's pytest suite runs in CI.
- `PROP_RUNS=1000 pnpm test:prop` passes. Two runs found counterexamples on unseen hardware, both present since Stage 3: a real gap in the rate guard (S4-P1, fixed with `uniteTimes`) and a fault in the test's own checker (S4-P4, fixed). Both are now fixed examples in the property.
- `pnpm mutate` scores 96.69% (96.58% on `src/safety`). Every survivor is explained in `docs/MUTATION.md`.
- `security-reviewer` and `dali-reviewer` ran on the diff, and again on each fix (the checker fix had the DALI review). Findings are fixed or logged in `docs/SECURITY_FINDINGS.md` (S4-H1 to S4-P5).

Open, for the owner or later stages:

- **S5-P1 (High, open):** a gap in the rate guard on unseen DT8 hardware, from Stage 3 or 4. It needs a change to `src/safety` with property tests, and the owner's word before it is made.

- S4-D6: lowering the ceiling on hardware with a DT8 colour unknown landed late. Fixed in Stage 5 by the owner's choice (ADR 0013).
- S4-R9: the hardware shadow assumes automatic activation is on and does not apply the gear features it reads. Needs a `src/safety` change once the DA5-L's setting is known.
- S4-P2 and S4-P3 are accepted, with property generators as follow-ups.
- WebHID is not built. The Stage 4 page is interim, and Stage 5 builds the shell.

## Stage 5 (app shell, design system and playground), done and waiting for review

Branch `stage-5-shell`. ADR 0013 records what was built and the owner's four planning decisions. What is in it:

- The shell from `docs/UI.md`:
  - The top bar: target and connection, the ceiling with its verified count, bus use, unlocks, and Panic.
  - The rail for the four built pages, reached with Alt-1 to Alt-4.
  - A collapsible inspector.
  - A placeholder console drawer: Ctrl-` opens it and it remembers its height.
  - F6 between regions, and the banner line.
- The design system:
  - The dark tokens.
  - Inter and JetBrains Mono, self-hosted with their licences and checked sums.
  - Accessible components: paired sliders, number fields, segmented controls, the colour and fade pickers, toggles, dialogs opened with `show()`, typed confirmations, and status chips.
- The pages:
  - Playground: one panel for each driver as it reports itself, Live and Commit, and feedback on what was sent, clamped, held or refused. The 2D bench preview sits below, labelled "estimated", or "prediction" on hardware.
  - Devices: names, and the simulator's settings with each one's source and hardware-day check.
  - Bus monitor: 2,000 frames, filters, and the divergence log.
  - Settings: preferences, workspace export and import, records set aside, and the key legend.
- The ceiling dialog: lowering takes effect at once, and raising needs the new value typed. A stored ceiling above the default is offered back, not applied, at start.
- `src/store`: the hand-written validator, preferences, migrations and workspace version 1. IndexedDB goes through `src/ui/idb.ts`.
- The engine gives the page live light, feedback, numbered monitor lines and the bench set-up. New intents: colour temperature, RGBWAF, and Apply. A moving level uses the DAPC sequence.
- S4-D6 is fixed, the owner's choice: lit gear is turned down, with its MAX LEVEL write where the governor takes it, before the profile work.
- The Permissions-Policy turns off 31 features. A style attribute in a component is a lint error. `src/light` and `src/store` joined the pure core.
- The fake server has a `max-level` quirk, for the mismatch test.

Stage close:

- `pnpm verify` passes:
  - lint and the typecheck
  - 2,438 unit and property tests, at 98.46% line coverage and 92.19% branch coverage on the pure core
  - the build
  - 26 preview e2e tests and 16 against the server's fake
- `PROP_RUNS=1000 pnpm test:prop` passed on the S4-D6 fix. A second 1,000-run pass at the end of the stage found S5-P1: P-rate on unseen hardware, two swings in a second on a C5 driver through automatic activation. It fails on `main` too, so it predates this stage. It is open, for the owner, with the counterexample saved.
- V-ui baselines for macOS are in `e2e/visual/` (`pnpm e2e:visual`, by hand, not in CI).
- `pnpm mutate` scores 93.92% (93.61% on `src/safety`), past the 85% target, on a fresh run at `76138cb`. The run found S5-D19: the S5-D13 fix had no effect. That is fixed, and targeted runs after the fix give `src/safety/ceiling.ts` 97.79%. Every survivor in `src/safety` is listed in `docs/MUTATION.md`. 57 of them are in unchanged code that Stage 4's run killed only through its checker's false failures (S4-P4). A spot check confirms this for one, and the rest are listed, not yet analysed one by one.
- `security-reviewer` passed the stage with follow-ups. `dali-reviewer` passed the S5-D19 fix and its re-check with follow-ups, all taken. Before that, `dali-reviewer` failed the stage on S5-D1: changing a simulator setting could flash the bench past the rate guard. Every finding is fixed or accepted with a reason in `docs/SECURITY_FINDINGS.md` (S5-M1 to S5-D19, and S5-P1 for the owner). Two fixes changed the design in ADR 0013:
  - the bench waits 2 s after a rebuild
  - Apply activates the colour before the level unless the driver reports automatic activation

Open, for the owner or later stages:

- **S5-P1 (High, open):** a gap in the rate guard on unseen DT8 hardware, from Stage 3 or 4. It needs a change to `src/safety` with property tests, and the owner's word before it is made.

- Tests aimed at the 57 mutants that only the old checker killed (`docs/MUTATION.md`, last group), starting with the sampling in `src/safety/rate/trace.ts`.
- Groups as a target for the playground's controls are not built.
- A script raising the ceiling (E-ceiling) and panic mid-script (E-panic) wait for the console in Stage 6.
- The manual checks in Chrome, Brave, Firefox and Safari are for the owner at review: this session drove only the built-in Chromium.
- three.js waits for Stage 7. `e2e/bundle.spec.ts` checks that the entry chunk stays free of lazy chunks and under 250 kB.
- S4-R9 (the hardware shadow assumes automatic activation is on) is unchanged. Apply no longer relies on it.

## Next

Review and merge the Stage 5 PR. Then Stage 6 (console and scripts) on Sonnet, in plan mode.
