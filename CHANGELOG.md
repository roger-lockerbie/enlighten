# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog.

## Unreleased

### Added

- Stage 0 baseline: TypeScript (strict), Vite, Svelte 5, Vitest, fast-check and Playwright.
- ESLint rules that ban `eval`, `new Function`, string timers, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `{@html}`, with a test that proves each one is caught.
- Security headers for build and preview: CSP with Trusted Types, COOP, COEP, CORP, Permissions-Policy, Referrer-Policy, nosniff and frame-ancestors, with a meta-tag fallback in the built page.
- An e2e test that fails on any CSP violation or console error.
- Hardened pnpm settings, GitHub Actions CI with pinned actions, CodeQL and Dependabot.
- `tools/golden/` with a hash-locked requirements file for python-dali 0.16 and hidapi.
- Stage 1 research in `docs/research/`: DALI gear behaviour and timing, the hasseb and WebHID, the DA5-L, optics, rendering, effects, switchgear, the console and security, with a summary of findings that change the brief.
- Stage 2 design: the specification, architecture, threat model, test plan with the hardware-day checklist, UI document with wireframes, ADRs 0002 to 0010 and open questions.
- Stage 3 core: the python-dali golden fixture generator and fixtures; `src/dali` (the command table, codec, replies, curve, fades and sequences, byte-equal to python-dali); `src/sim` (the DA5-L profile with every unknown as a sourced setting, the gear model and the simulated bus); `src/bus` (the clock, timing with floors, and the scheduler with panic); `src/safety` (the governor with the rule table, the RGBWAF mix rule, the rate guard, the safety profile, the ceiling and panic).
- Tests for the core: golden and decode-sweep tests, the differential check against python-dali's fake gear, behaviour tests per section of the DALI research, the rule table, the rate guard, and the property tests P-codec, P-ceiling, P-dtr, P-rate, P-rate-fade, P-panic and P-sched on a virtual-clock bench.
- A lint rule that keeps DOM, network, timers and the system clock out of the pure folders, with a test.
- `pnpm coverage` (in `verify`), `pnpm mutate` (Stryker, on demand) and `pnpm golden`.
- ADR 0011: the interfaces as built and the rate guard's exact rules.
- On hardware, a governor shadow built from scan read-backs (levels, limits, groups, fades, scenes, curve, colour features, physical minimum), with every unpredictable light change counted as the worst case, following the Stage 3 security review.
- Mutation testing on `src/safety` and the codec, with every surviving mutant in `src/safety` explained in `docs/MUTATION.md`, and the tests it called for: exact outcomes for the governor, the safety profile, the ceiling and the rate guard.

- Stage 4 transports: the real clock (`TimerClock`); the `Transport` interface, `SimTransport`, the server protocol codec and `ServerTransport`; the router, with approvals used once per frame, in order and in time.
- The engine: target changes with fresh hardware state on every connect, the operator question, discovery and what each driver reports, the safety profile on connect, the divergence log and background check for Both, the live-control coalescer, commissioning behind the `reset` unlock, the heartbeat watchdog, and the hardware check (parts 2 to 4 of the hardware-day checklist) with its JSON record.
- The bus worker, the one Trusted Types policy for workers, and the page's side with the token handling and the 250 ms panic confirmation.
- An interim page: target, connection, ceiling, Panic and Escape twice; the latch, disconnect and operator banners; the Devices page with inventory, profile status, ceiling, unlocks, commissioning, the hardware check and the divergence log.
- The hardware server in `server/`: one origin on 127.0.0.1:47821, Host, Origin and token checks, one client, the queue, the hasseb's reports built and matched, and the stop on panic, close, silence and exit. A fake hasseb and bench for CI and `pnpm server:demo`. pytest for the U-server list, G-hasseb and D-live.
- e2e tests against the server and its fake (E-modes, E-server), and CI steps that install the server from hashes and run its tests.
- ADR 0012: the transports, the engine and the server as built.

- Stage 5 shell: the top bar (target and connection, the ceiling with its verified count, bus use, unlocks, Panic), the rail with Alt-1 to Alt-4, a collapsible inspector, a placeholder console drawer with Ctrl-` that remembers its height, F6 between regions, and the banner line.
- The design system: dark tokens, self-hosted Inter and JetBrains Mono with their licences and checksums, and paired sliders, number fields, segmented controls, a colour picker, a fade picker, toggles, dialogs opened without modal state, typed confirmations and status chips.
- The Playground: a panel for each device as it reports itself (level, colour temperature, colour and raw channels, fade), Live and Commit modes, power, step and hold-to-dim, feedback on what was sent, clamped or refused, and a 2D bench preview.
- The ceiling dialog: lower at once, raise with the new value typed.
- The Bus monitor with filters, pause and the divergence log. Settings with preferences, workspace export and import, records set aside, and the key legend. Device names and the simulator's settings on the Devices page.
- `src/store`: the hand-written validator, preferences, migrations and workspace files, with U-store and P-validator. IndexedDB through `src/ui/idb.ts`.
- The engine gives the page each unit's light, feedback on live values, numbered monitor lines and the bench set-up. New intents for colour temperature, RGBWAF and Commit's Apply, and the DAPC sequence for a moving level.
- e2e: E-shell, E-playground, E-ceiling, E-import, E-panic and E-a11y, the CSP test on every page, the Devices page, the entry chunk's budget, and the playground and ceiling in Hardware and Both against the fake. V-ui by hand with `pnpm e2e:visual`.
- A `max-level` quirk in the fake server, for the mismatch test.
- ADR 0013: the shell and playground as built.

- Stage 6 console: a zsh-style line editor in the drawer with the emacs keymap from one binding table, a kill ring, undo and redo, incremental search, completion, and history with `!` expansion and verify mode.
- The console language from SPEC section 6: friendly commands, every DALI command by python-dali's name, `raw`, decoded replies, and typed confirmations at a `confirm>` prompt. Every frame goes through the governor with the source `console`.
- Scripts: the parser with ADR 0007's limits, the built-in `first-light`, and a runner in the bus worker with the source `script`, which panic, Ctrl-C, a target change and the watchdog stop. A step held by the rate guard waits up to 10 s.
- The Scripts page (Alt-5): list, edit with parse errors by line, save, delete, import and export. A screen wake lock while a script runs.
- History settings in Settings, and a key legend built from the binding table.
- Preferences version 2, the history and scripts records, and workspace version 2 with its migration.
- U-console, U-script, P-history, P-parser, P-ceiling for console lines and scripts, E-console, E-keys, E-script, a script that tries to raise the ceiling, and panic mid-script.
- ADR 0014: the console and scripts as built.

### Changed

- The plan for Stages 3, 4, 5 and 12 follows the design: the governor as ADR 0004 sets it out, a Python hardware server before any WebHID transport, and the build settings the spike proved.
- The governor works out the bus schedule once, for both the rule check and the plan, and drops checks that cannot fail.
- A governor now refuses a starting ceiling outside arc levels 1 to 254, as `setCeiling` does.
- The server protocol fixes its encoding and close reasons, and adds `STOPPED` (SPEC section 9).
- The production CSP names one Trusted Types policy, `enlighten-worker`, and Svelte compiles with `fragments: 'tree'` (ADR 0002 items 2 to 4, moved from Stage 5).
- The Permissions-Policy turns `hid` and `fullscreen` off.
- The Permissions-Policy turns off 15 more features the app never uses (THREAT_MODEL section 4). Three that Chromium does not recognise are left out.
- A style attribute in a component is a lint error. A `style:` directive is allowed (ADR 0002).
- `src/light` and `src/store` join the pure core, for lint and coverage.
- The page imports the hardware check's step list without its runners.
- Output percentages show one decimal everywhere, as 39.5% for arc 220.
- The e2e tests run at 1440 by 900, with a 90 s limit for the start-up scan.
- The DALI name for the temporary colour temperature is python-dali's `set-temporary-colour-temperature`. The spec's `set-temporary-colour-temperature-tc` still works. Shared names go to the general command, and `dt6-` or `dt8-` reaches the device type one.
- The engine's failed results say whether they were refused, dropped or a fault, so the console prints a fault as a fault.
- Several IndexedDB records share one object store, each under its own key and schema version (ADR 0014).

### Fixed

- S4-D6: lowering the ceiling on hardware with a DT8 colour unknown left a second lit driver above it for 3 to 5 s. Lit gear is now turned down before the MAX LEVEL writes: the first driver lands at once and the second one second later.
- S5-D19: a ceiling lowered while the simulated bench was being rebuilt switched a lit unit off instead of holding it at the ceiling, because the governor dropped the rebuild hold's retry time. Found by mutation testing. The hold's retry time now reaches the ceiling's work, and the ceiling's holds wait for the rate guard by time, with one 5 s deadline before the OFF.

- On hardware, the rate guard counted two opposite legs that start at the same moment as one leg when it united its faded and instant predictions, so a room could rise and fall from one command past the limit. Found by the 1,000-run property tests, present since Stage 3.
- The property tests' trace checker summed each driver's last sample, taken at different times, so the room showed small steps the light never made. It now samples every driver at the same times.

### Security

- qs, a transitive dependency of Stryker, is overridden to 6.16.2 to clear four advisories. The two advisories left open (minimatch, deepmerge) are explained in `docs/DEPENDENCIES.md`.
