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

### Changed

- The plan for Stages 3, 4, 5 and 12 follows the design: the governor as ADR 0004 sets it out, a Python hardware server before any WebHID transport, and the build settings the spike proved.
- The governor works out the bus schedule once, for both the rule check and the plan, and drops checks that cannot fail.
- A governor now refuses a starting ceiling outside arc levels 1 to 254, as `setCeiling` does.
- The server protocol fixes its encoding and close reasons, and adds `STOPPED` (SPEC section 9).
- The production CSP names one Trusted Types policy, `enlighten-worker`, and Svelte compiles with `fragments: 'tree'` (ADR 0002 items 2 to 4, moved from Stage 5).
- The Permissions-Policy turns `hid` and `fullscreen` off.

### Fixed

- On hardware, the rate guard counted two opposite legs that start at the same moment as one leg when it united its faded and instant predictions, so a room could rise and fall from one command past the limit. Found by the 1,000-run property tests, present since Stage 3.
- The property tests' trace checker summed each driver's last sample, taken at different times, so the room showed small steps the light never made. It now samples every driver at the same times.

### Security

- qs, a transitive dependency of Stryker, is overridden to 6.16.2 to clear four advisories. The two advisories left open (minimatch, deepmerge) are explained in `docs/DEPENDENCIES.md`.
