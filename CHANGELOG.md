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

- Stage 7 light core in `src/light`: the scene as data with its validator; faces, openings and portal visibility; Lambert's edge integral for direct light, clipped by openings; graded meshes; form factors with closed rows, the radiosity solve and the lightmap; tape and cover data with the basis of every value; the per-frame colours; the probe; and the camera.
- The colour pipeline in `src/light/colour`: XYZ, the black-body locus with colour temperature and Duv, white balance, gamut mapping at held luminance, fixed exposure with a tone curve that keeps hue, and false colour.
- The light worker, its checked protocol, and a cache of solved light for the four scenes used most recently.
- The Visualiser page (Alt-6): the default hallway drawn with three.js in its own lazy chunk, direct light per pixel and the lightmap summed on the GPU, with exposure presets and a manual setting, white balance, false colour with a legend, a probe by pointer or arrow keys, and Display P3 where the screen has it.
- Preferences version 3: exposure, white balance and the false-colour view, with its migration.
- A reference path tracer (`pnpm reference`) that writes fixtures for the light core's tests, and timing scripts: `pnpm perf:solve` and `pnpm perf:frame`.
- U-light, U-colour, P-light, G-light, E-visualiser with a check of the shader's pixels against the pure core, four golden images of the hallway, and E-csp over every page and both workers.
- ADR 0017: the visualiser engine as built.
- Stage 8 on the Visualiser: the hallway's size, ends and finishes; up to six mounts added, edited, mirrored and removed, with a reason for every refused edit; five presets with drawings; cameras to walk, orbit and come close to a mount, with W, A, S and D, the wheel and number fields; and an A/B view of two set-ups with one camera, exposure and white balance.
- A mount binds to a DALI short address, and says when no driver is there or its driver does not feed all its tape's channels.
- The Visualiser's set-ups and view are kept between visits, in a checked `visualiser` record.
- Workspace files version 3: set-ups A and B and the view settings, checked in full by the light core before an import is offered.
- E-visualiser's editor and camera tests, E-ab, set-ups in E-import, the prediction label in E-modes, and V-hallway pictures for each preset and each cover close up.
- ADR 0018: the hallway, mounts, cameras and A/B view as built.

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
- The DALI name for the temporary colour temperature is python-dali's `set-temporary-colour-temperature`. The spec's `set-temporary-colour-temperature-tc` still works. A name shared with a general command goes to the general command, `dt6-` or `dt8-` reaches a device type one, and a name only device type commands share needs the prefix.
- The engine's failed results say whether they were refused, dropped or a fault, so the console prints a fault as a fault.
- Several IndexedDB records share one object store, each under its own key and schema version (ADR 0014).
- The bench preview on the Playground uses the visualiser's tape data and colour path, on one scale where tape A at full is white.
- three.js 0.187.0 is installed as the app's one runtime dependency, with `@types/three` for development.
- `e2e/bundle.spec.ts` allows the entry chunk its two lazy chunks and holds three.js to the renderer's.
- CI runs `pnpm verify` in two jobs at once, `checks` and `e2e`. On the repo's 2-core runner Playwright uses one worker, and with Stage 8's tests the suite took 35 to 40 minutes in one job.
- Stage 8b, the rate guard (ADR 0019). The guard and the trace checker read the light on one grid that is part of the rule: every whole 25 ms of the clock, every plan breakpoint and the moment before each. The guard reads its prediction as the rule does and again with its margins, and a hard step those readings date differently has a range of dates and counts once. The border dates of Stage 6 are gone, and with them three of the four refusals ADR 0016 listed.
- On hardware, the hard step of a change to gear in an unknown state can come until the gear may have stopped moving, so the next hard step waits from then. An OFF or a scan ends the wait.
- On hardware, no level command goes to DT8 gear until its colour is known, which is every DT8 driver after a connect or a scan. OFF goes, and so does a colour with ACTIVATE. The playground's Apply sends the colour first and the level after it. Lowering the ceiling switches such gear off. A scene is recalled on DT8 gear only with no fade time.
- ADR 0019 amendments 1 and 2: on the Hardware and Both targets the shadow allows nothing until hardware day. Every light-changing command to any gear is its own leg and hard step, so one goes about every 2 s to an address plus its fade time, and 1 s after a change to another address. A light change reaches one address at a time, so group and broadcast levels are refused (OFF is not). A colour, a scene recall and a Tc step go only with no fade time. A level goes to DT8 gear only after an ACTIVATE has reached it with no temporary colour loaded, scene recalled or Tc step sent since. The addressing commands forget every address until a rescan. Fade settings count only as read back from the gear, and Apply, the console and the hardware check read them back after writing them to a short address. The ceiling counts DT8 gear on hardware as every channel full. The simulator target is not changed, except that gear which missed one presence reply still counts as a possible member of a group or broadcast. This replaces the whole-colour rule of the first build.
- On hardware, no level command other than OFF goes to an address that has not been scanned, to gear with no short address, or to a group or broadcast while the inventory is stale. This replaces the line in ADR 0016 that let a level go to unscanned gear on its own, and is the owner's to relax (S8b-D2 in ADR 0019).

### Fixed

- S4-D6: lowering the ceiling on hardware with a DT8 colour unknown left a second lit driver above it for 3 to 5 s. Lit gear is now turned down before the MAX LEVEL writes: the first driver lands at once and the second one second later.
- S5-D19: a ceiling lowered while the simulated bench was being rebuilt switched a lit unit off instead of holding it at the ceiling, because the governor dropped the rebuild hold's retry time. Found by mutation testing. The hold's retry time now reaches the ceiling's work, and the ceiling's holds wait for the rate guard by time, with one 5 s deadline before the OFF.

- On hardware, the rate guard counted two opposite legs that start at the same moment as one leg when it united its faded and instant predictions, so a room could rise and fall from one command past the limit. Found by the 1,000-run property tests, present since Stage 3.
- The property tests' trace checker summed each driver's last sample, taken at different times, so the room showed small steps the light never made. It now samples every driver at the same times.
- S6-P1: the rate guard dated a hard step at the start of its run and counted one a run, so a step inside a slow run, or a RESET's jump after a rise, had no hard step of its own. An unlocked RESET after a rise let a flash through, and a RESET at full had its OFF dropped. A fast leg is now a hard step from its start, each instant step in a longer leg is its own hard step dated where it happens, and a RESET and its OFF are one hard step (ADR 0015). Found by the Stage 6 console property, present since Stage 3.
- S6-R1: a RESET typed at the console sent no OFF and did not write the safety profile again, so the driver stayed at full. It now runs the full RESET sequence, one short address at a time.
- S6-R4 to S6-R6: instant steps are measured within 60 ms, not only between neighbouring samples; the RESET pair drops the step nearest the OFF, and only when the RESET's jump was a hard step; and a change made while a RESET's OFF is pending is judged with it.
- S6-S1 to S6-S4: an OFF from another control while the gear was deaf after a RESET no longer lets the guard hold the reset's own OFF; a held RESET is refused at once instead of going out later; a reset that panic stops says MAX LEVEL may be 254; and in the room only the RESET's own driver's jump counts.
- S6-P3 and S6-P4: the guard counted a turn after a run on the leg border as no small reversal, and took a new leg 1 ms after an old one for the old one, so four small reversals, or three legs at the default of one swing, could pass in a second. Found by the 1,000-run property pass.
- S6-R4 (again): a fast fade inside a longer run, by 8.9 times in 200 ms, changed by less than 2 in any 50 ms and was not a hard step. Fast change above 2 within 0.7 s is now a hard step from where it starts (ADR 0016).
- S6-P5: a slow fade's tail, split from the rest by another driver's step, counted as a fast leg. Change from a fade that ran 0.7 s or longer is now slow and never a hard step, read from the drivers' fade plans, and a fade cut short counts by the time it ran.
- S6-P6: on hardware, gear seen fading during its scan, and so not modelled, moved with other gear on one broadcast, and the room made four legs in 0.7 s where the guard counted one. Gear in an unknown state now changes only on its own while nothing else moves, and other gear waits while it may still be fading.
- S6-P7: the trace checker dated one fast rise from off at different times on different channels, which gave a false alarm. A fast leg is now dated where its fast movement began, in the guard and the checker.
- S6-S16-1 to S6-S16-4 and S6-D16-1 to S6-D16-6, from the reviews of ADR 0016: a command to an empty address no longer holds the room, a fault or CONTINUOUS UP or DOWN marks gear as moving for as long as it may move, OFF and panic end the marks, gear the inventory has not found is under the same rule, a span the guard counts on the border also counts at the latest date the rule could give it, and the guard asks a fade to run 705 ms before calling it slow.
- S6-P8 to S6-P10, from the 1,000-run property pass after the reviews: on the border of a fast leg the guard also counts the leg's start; a span also counts at the earliest date the rule could give it, when a fade found it; and the trace checker pairs a RESET's jump dated just before the RESET. S6-S17-1 to S6-S17-3, from the security review of those fixes: after an instant step near 2, a span also counts at the latest date it is surely above 2 from, and the checker pairs a RESET only with a step still going when it went out. S6-D17-1, from the DALI review: merging an address's channels no longer drops a span's own date for a border date just before it. S6-P11: the same merge no longer takes a step up and a fade down a few ms apart for one hard step. S6-P12, from the 1,000-run pass on those fixes: a movement the guard joins to the last span also counts at the dates the rule could give it as a span of its own. S6-S18-1 to S6-S18-5, from the security review of those fixes: after an instant step near 2 the early date allows for the checker's own sample spacing, the test for where the rule must have found a span allows for it at both ends of the window, the guard samples a segment every 10 ms at most, and the merge of an address's events is linear.
- S6-P2: the trace checker dated hard steps the same way, which gave a false alarm on the console property, and its room sum took 18 minutes on one long run. Both are fixed.
- S5-P1: two swings in a second on a C5 driver the governor had never seen. A rescan dropped what the shadow knew of the colour, and a level and a colour fading together were counted as one leg.
- S6-P13 to S6-P16 and S6-D18-1, S6-D18-3, S6-D18-4 and S6-D18-5: hard steps the guard and the trace checker dated differently by where their samples fell. S6-P16 was not one of those: a fade to off on gear in an unknown state made its hard step when it ended, and the guard had counted it at the command.
- S8b-1: on hardware, a scene recall on DT8 gear faded its level and a colour the scan does not read together, and made three legs in a second with the guard counting one.
- From the second review of Stage 8b (S8b-R2 in `docs/SECURITY_FINDINGS.md`): a scan asks an address three times before calling it empty, and an address found empty takes no level; a failed rescan forgets what was known of the colour; and an ACTIVATE to a group counts only for gear it is sure to reach.
- From the two reviews of Stage 8b (S8b-H1 to S8b-I3 in `docs/SECURITY_FINDINGS.md`): each light-changing command to gear the shadow does not model is its own leg and hard step, so one transaction of several no longer counts as one; a temporary colour of masked values no longer makes the colour known; a scene with a masked level is still judged for its colour; the scene rule reads DT6's fast fade time; an OFF that faulted or met deaf gear ends no wait; two hard steps of one reading never share a range; and the playground's Apply drops its waiting level on a stop, a panic, a target change or a newer level.

### Security

- Stage 7 review: the frame-time measurement draws off screen in short runs and cannot hold up Panic or change the picture; the light cache reaches only its own keys in the store; a solved response is used only when its lightmap matches the page's layout.

- qs, a transitive dependency of Stryker, is overridden to 6.16.2 to clear four advisories. The two advisories left open (minimatch, deepmerge) are explained in `docs/DEPENDENCIES.md`.
