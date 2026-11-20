# Status

## Where the build is up to

Stages 0 to 7 are merged. Stage 8 (hallway, mounts and tapes) is on `stage-8-hallway`, on Opus as planned. The rate guard stage the owner chose on 2026-11-18 has not run: Stage 8 ran beside it and changed nothing in `src/safety`, `src/sim`, `src/bus` or `src/dali`.

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

- **S5-P1 (High, open):** a gap in the rate guard on unseen DT8 hardware, from Stage 3 or 4. It needs a change to `src/safety` with property tests. On 2026-11-16 the owner chose to leave it for a later stage.

- S4-D6: lowering the ceiling on hardware with a DT8 colour unknown landed late. Fixed in Stage 5 by the owner's choice (ADR 0013).
- S4-R9: the hardware shadow assumes automatic activation is on and does not apply the gear features it reads. Needs a `src/safety` change once the DA5-L's setting is known.
- S4-P2 and S4-P3 are accepted, with property generators as follow-ups.
- WebHID is not built. The Stage 4 page is interim, and Stage 5 builds the shell.

## Stage 5 (app shell, design system and playground), merged

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
  - 2,463 unit and property tests, at 98.32% line coverage and 92.16% branch coverage on the pure core
  - the build
  - 26 preview e2e tests and 16 against the server's fake
- `PROP_RUNS=1000 pnpm test:prop` passed on the S4-D6 fix. A second 1,000-run pass at the end of the stage found S5-P1: P-rate on unseen hardware, two swings in a second on a C5 driver through automatic activation. It fails on `main` too, so it predates this stage. It is open, for the owner, with the counterexample saved. A third 1,000-run pass after the S5-D19 fix passed: the failure needs a seed that run did not draw.
- V-ui baselines for macOS are in `e2e/visual/` (`pnpm e2e:visual`, by hand, not in CI).
- `pnpm mutate` scores 93.92% (93.61% on `src/safety`), past the 85% target, on a fresh run at `76138cb`. The run found S5-D19: the S5-D13 fix had no effect. That is fixed, and targeted runs after the fix give `src/safety/ceiling.ts` 97.79%. Every survivor in `src/safety` is listed in `docs/MUTATION.md`. 57 of them are in unchanged code that Stage 4's run killed only through its checker's false failures (S4-P4). A spot check confirms this for one, and the rest are listed, not yet analysed one by one.
- `security-reviewer` passed the stage with follow-ups. `dali-reviewer` passed the S5-D19 fix and its re-check with follow-ups, all taken. Before that, `dali-reviewer` failed the stage on S5-D1: changing a simulator setting could flash the bench past the rate guard. Every finding is fixed or accepted with a reason in `docs/SECURITY_FINDINGS.md` (S5-M1 to S5-D19, and S5-P1 for the owner). Two fixes changed the design in ADR 0013:
  - the bench waits 2 s after a rebuild
  - Apply activates the colour before the level unless the driver reports automatic activation

Open, for the owner or later stages:

- **S5-P1 (High, open):** a gap in the rate guard on unseen DT8 hardware, from Stage 3 or 4. It needs a change to `src/safety` with property tests. On 2026-11-16 the owner chose to leave it for a later stage.

- Tests aimed at the 57 mutants that only the old checker killed (`docs/MUTATION.md`, last group), starting with the sampling in `src/safety/rate/trace.ts`.
- Groups as a target for the playground's controls are not built.
- The manual checks in Chrome, Brave, Firefox and Safari are for the owner at review: this session drove only the built-in Chromium.
- three.js waits for Stage 7. `e2e/bundle.spec.ts` checks that the entry chunk stays free of lazy chunks and under 250 kB.
- S4-R9 (the hardware shadow assumes automatic activation is on) is unchanged. Apply no longer relies on it.

## Stage 6 (console and scripts), merged

Branch `stage-6-console`. ADR 0014 records what was built and the owner's five planning decisions. What is in it:

- `src/console/`, pure: the binding table, the line editor (kill ring, undo and redo, search, word moves as zsh does them), history with expansion and the zsh error texts, the lexer and values, DALI names from the command table, the line parser, completion, reply texts and help.
- `src/script/`, pure: the script parser with ADR 0007's limits, the printer, and the built-in `first-light`, which follows `tools/first_light.py` and never passes the ceiling.
- `src/engine/console.ts`: `ConsoleExec`, which runs every friendly and DALI command through `Engine.request` and the governor. The engine runs lines and scripts as jobs that panic, a target change, the watchdog and Ctrl-C stop. The worker parses every line and script again. New protocol calls: `console`, `runScript`, `scriptContinue` and `stopConsole`.
- `src/store`: preferences version 2 (history length, the leading-space rule, verify mode), the history and scripts records, and workspace version 2 with its migration.
- The UI: the console drawer, the Scripts page (Alt-5), a screen wake lock while a script runs, an unload guard, and the history settings and key legend in Settings.
- e2e: E-console, E-keys and E-script, a script that tries to raise the ceiling, and panic mid-script.
- SPEC sections 6, 7 and 8, `docs/UI.md` and `docs/TEST_PLAN.md` follow what was built.

After the first reviews, `pnpm verify` found S6-P1, a rate guard gap from earlier stages. The owner chose to fix it in this stage (ADR 0015), and then to fix the re-review's S6-R4 and the property findings S6-P5 and S6-P6 as well (ADR 0016). These changed `src/safety`:

- Hard steps are dated where they happen. A RESET and its OFF are one hard step, and a change made while the OFF is pending is judged with it (ADR 0015).
- Change from fades that ran 0.7 s or longer is slow and never a hard step, read from the drivers' fade plans. Fast change above 2 within 0.7 s is a hard step from where it starts (ADR 0016).
- On hardware, gear in an unknown state changes only on its own while nothing else moves (ADR 0016).
- A console RESET runs the engine's full reset sequence (S6-R1).

Stage close:

- `pnpm verify` passes:
  - lint and the typecheck
  - 2,685 unit and property tests, at 98.63% line coverage and 92.49% branch coverage on the pure core
  - the build
  - 39 preview e2e tests and 16 against the server's fake
- The last 1,000-run property pass on the final code: 44 of 47 tests pass. Three find a hard-step breach the guard missed, each logged for the rate guard stage (S6-P14 to S6-P16). None involves the swing limit, and no other property failed.
- `security-reviewer` and `dali-reviewer` passed the console and scripts with follow-ups, all fixed or logged. The rate guard fixes went through four more rounds of both reviews and three 1,000-run passes (S6-R, S6-P, S6-S, S6-S16, S6-D16, S6-S17, S6-D17, S6-S18 and S6-D18 in `docs/SECURITY_FINDINGS.md`). Each round found new cases where the guard and the trace checker date one hard step differently by where the samples fall. The last `dali-reviewer` pass failed the guard on S6-D18-1 to S6-D18-5, and one of those, S6-D18-2, came from the S6-P13 fix, which is reverted. On 2026-11-18 the owner chose to stop patching and give the rate guard a stage of its own.
- `pnpm mutate` was not rerun in this stage.

Open, for the owner or later stages:

- **A rate guard stage, before Stage 7 or beside it:** S6-P13, S6-D18-1 to S6-D18-5 and S6-P14 to S6-P16. The guard can still miss a pair of hard steps a little closer than 2 s at an address or 1 s in the room, where it and the checker date them differently. These are misses of the hard-step rule. The swing limit is a separate rule, and none of the findings involves it. The suggested design treats a hard step's date as a range, counted once, which should also end the refusals the border dates cost today (ADR 0016, Consequences).
- **S5-P1 (High, open):** unchanged, for the same stage.
- S6-S16-5, S6-R10, S6-S6 and S6-D10 stay as logged.
- `pnpm mutate` on the new `src/safety/rate` code, and the 57 mutants from Stage 5 that only the old checker killed.
- The hardware-day list in `docs/research` gains nothing from this stage.

## Stage 7 (visualiser engine: light and colour), merged

Branch `stage-7-visualiser`. ADR 0017 records what was built, the choices ADR 0008 left open, and three differences from the approved plan. What is in it:

- `src/light`, pure: the scene and its validator, geometry with portal visibility, the edge integral for direct light, the mesh, form factors and solve, the lightmap, tape and cover data, the frame, the probe, the camera, the cache checks and the light worker's protocol. `src/light/colour` holds the colour pipeline.
- `src/workers/light.worker.ts`, and the second worker URL in the policy file.
- `src/ui/visualiser`: the three.js renderer and its shaders, the solver manager and the drive mapping. `src/ui/pages/Visualiser.svelte` is the page, sixth in the rail (Alt-6).
- `src/store`: preferences version 3 and `light.ts`, the cache's store.
- `tools/reference` (the reference path tracer and `pnpm reference`), `tools/perf` (`pnpm perf:solve`) and `e2e/perf` (`pnpm perf:frame`).
- three.js 0.187.0 is installed. The entry chunk is 250 kB, with three.js and the light core in lazy chunks.

Stage 7 shows one fixed hallway from one fixed camera: tape A in a skirting slot on the left and tape B in a flush channel on the right. Stage 8 adds the editors, the cameras and the A/B view.

Measured on an Apple M1 Pro:

- Frame: about 3.1 ms with six mounts, all lit, at 1440 by 900 in steady state, against 4 ms. A single frame drawn from an idle GPU takes 5 to 8 ms.
- Solve: 0.65 s per mount with six mounts (4,348 patches) and 0.73 s for the default scene, against 2 s per mount.
- Against the reference path tracer: direct light within 1% at all 124 points. Indirect light within 5% at 122, with one corner point 8% high and one shadow-edge point 21% high.

Stage close:

- `pnpm verify` passes: lint, the typecheck, the unit and property tests with coverage, the build, and both e2e configs.
- `security-reviewer` passed the stage with follow-ups (S7-M1 and S7-L1 to S7-L5 in `docs/SECURITY_FINDINGS.md`), all fixed. `dali-reviewer` did not run: nothing in `src/dali`, `src/sim`, `src/bus` or `src/safety` changed.
- `pnpm mutate` was not run: it covers `src/safety` and the codec, which this stage did not touch.
- V-ui baselines were rewritten: the rail has a new entry and there is a new page.
- The manual checks in Chrome, Brave, Firefox and Safari are for the owner at review: this session drove Chromium only.

Known gaps, all in ADR 0017:

- No glossy floor term, no tinted surfaces, and tape emission is even with angle.
- Tape and cover data are placeholders. Every cover's haze is assumed.
- The view settings are not in workspace files yet. Stage 8 adds them.
- Bounced light within about 50 mm of an opening's shadow edge is smoothed over one 12.5 mm patch.
- The frame budget is met with a thin margin.

## Stage 8 (hallway, mounts and tapes), in review

Branch `stage-8-hallway`. ADR 0018 records what was built and two differences from the approved plan. What is in it:

- `src/light/scene.ts`: a mount binds to a short address, 0 to 63, in place of a bench unit. `src/ui/visualiser/drives.ts` reads each driver's drive by address.
- `src/light/setup.ts`, pure: the set-up (a scene and its links), every edit as a function that returns the new set-up or a reason, five presets with their drawings' data, finishes and tapes with their basis, and `parseSetup`.
- `src/light/camera.ts`: walk, orbit and close-up views, the presets down the hall and at a wall, moves by key and wheel, and `keepInside`.
- `src/light/saved.ts`: the stored `visualiser` record and the workspace file's form of the set-ups, loaded only by the Visualiser and Settings.
- The Visualiser page: the camera bar, the A/B view, the mounts card with presets, the hallway card, and the mount editor in the inspector.
- Workspace files version 3, with set-ups A and B and the view settings. Version 2 files migrate.
- e2e: `mounts.spec.ts`, `ab.spec.ts`, set-ups in `import.spec.ts`, the prediction label and no-driver note in `server/modes.spec.ts`, and ten new V-hallway pictures.

Owner decision in planning: a mount binds to any address, but no simulated drivers are added. A mount on an address with no driver draws unlit and says so. Extra drivers wait for Stage 9. This is a recorded gap against R14.2's "simulated only" wording.

Measured on an Apple M1 Pro:

- Solve: 0.37 s per mount for the default scene (2,520 patches) and 0.65 s per mount with six mounts (4,348 patches), against 2 s per mount.
- Frame: a median of 3.10 ms with six mounts, all lit, at 1440 by 900 (`pnpm perf:frame`: 2.82 to 3.26 ms over five runs), against 4 ms. Unchanged from Stage 7. The A/B view draws two half-width pictures, so about as many pixels as one.
- The entry chunk is 253.45 kB against its 256,000 byte budget.

Stage close:

- `security-reviewer` passed the stage with follow-ups (S8-L1 to S8-L5 and S8-I1 to S8-I4 in `docs/SECURITY_FINDINGS.md`), all fixed or noted. The main one: an edit cleared the bounced light until the solve came back, so fast clicking dimmed and restored the picture several times a second. The picture now holds until the new light is ready and changes at most once a second. `dali-reviewer` did not run: nothing in `src/dali`, `src/sim`, `src/bus` or `src/safety` changed.
- V-ui's Visualiser baseline was rewritten for the new page.
- The manual checks in Chrome, Brave, Firefox and Safari are for the owner at review.
- The first CI run on the PR ran out of its 30 minutes in the preview e2e, at test 49 of 50, with nothing failed. `main`'s run after the Stage 7 merge had hit the same limit. The repo is private, so its runner has 2 cores and Playwright uses one worker. Each e2e test waits about 12 s for the simulated bus's scan at start, which runs at DALI speed. In one job the suite took 35 to 40 minutes, with coverage alone taking 12.7 to 18.5. CI now runs it in two jobs at once: `checks` (lint, typecheck and coverage) and `e2e` (server tests, build and both e2e configs). The second run also timed the A/B test out in its 20 turns of B on and off. That part is now a test of its own, with 4 minutes for each A/B test, and it now fails when the fix for S8-L3 is taken out.

Known gaps:

- No simulated drivers beyond the bench's two addresses (R14.2), until Stage 9.
- The tape list holds only the three researched tapes. No other density is offered.
- The floor's finishes are placeholders, and surfaces are neutral and matte.
- The manual checks in Chrome, Brave, Firefox and Safari are for the owner at review: this session drove Chromium only.

## Stage 8b (rate guard), in progress

Branch `stage-8b-rate-guard`, on Fable as planned. Where it stands on 2026-11-20:

- Step 1, reproduce, is done. S6-D18-1, S6-P14, S6-P16 and S5-P1 reproduce and are fixed cases in `tests/properties/hard-steps.test.ts`, marked `it.fails` until the fix. S6-P15 reproduces from its seed, with its counterexample saved in `tests/properties/s6-p15.counterexample.json`, and has no fixed case yet. S6-D18-3 and S6-D18-4 did not reproduce in sweeps, S6-D18-5 has no repro, and S6-P13 was not reproduced.
- S6-P16 is not a dating fault: for gear in an unknown state the guard dates a fade's hard step at the command, and the light makes it when the fade ends. ADR 0019 covers it.
- `tests/harness/diff.ts` holds the differential test's trace helpers, now with several channels and a shifted checker grid.
- **ADR 0019 is proposed and waits for the owner.** No code in `src/safety` has changed. It differs from the approved plan in one way: the guard and the checker read the light on one shared grid, and the range comes from the guard's cautious readings. It also sets the S5-P1 rule, which the owner should read: on hardware, a DT8 driver whose colour is unknown takes OFF or a colour before it takes a level.
- After approval, the build order is in the plan: the checker, the guard, S5-P1, the properties, coverage, mutation, docs, then the stage close.

## Next

Review and merge the Stage 8 PR. Then, in either order:

- The rate guard stage the owner chose on 2026-11-18 (S6-P13, S6-D18-1 to S6-D18-5, S6-P14 to S6-P16 and S5-P1), which needs a row in `docs/STAGES.md` and a model.
- The branch coverage target on `src/safety` (95%) failed two CI runs of four on 2026-11-18 and 2026-11-19 at 94.96%. The property tests had no fixed seed, so the branches they reached in `src/safety/rate` changed from run to run. `pnpm coverage` now sets `PROP_SEED=1` and its figures are the same on every run. The margin over 95% is small, so the rate guard stage should add unit tests for the uncovered branches in `legs.ts` and `trace.ts`.
- Stage 9 (scenes, sequences and effects) on Opus, in plan mode. Its choreography across more addresses than the bench has is where simulated drivers beyond the bench arrive.
