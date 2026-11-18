# Test plan

What is tested, how, and to what target. Test IDs are the ones `docs/SPEC.md` section 11 refers to. Tests come with the code in each stage, and `pnpm verify` runs everything here except mutation testing, performance and hardware day.

## 1. Targets

| Measure                                                 | Target                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Line coverage on the pure core (the "pure" folders)     | 90% or more, checked in CI                                                    |
| Branch coverage on `src/safety`                         | 95% or more                                                                   |
| Mutation score on `src/safety` and the `src/dali` codec | 85% or more, with every surviving mutant in `src/safety` listed and explained |
| Golden fixtures                                         | One or more for every supported command, 100% byte equal                      |
| e2e                                                     | Zero CSP violations, console errors or cross-origin requests on every page    |
| Frame time                                              | 4 ms of GPU time at 1440 by 900 with six mounts, on the reference laptop      |
| Radiosity solve                                         | 2 s or less per mount at 5,000 patches, on the reference laptop               |
| Bus timing                                              | Never under 29.1 ms a command, 42.1 ms a query, 56.7 ms a send-twice pair     |
| Panic on hardware                                       | OFF on the bus within 100 ms when idle                                        |
| Hidden-tab sequence                                     | A 30-minute plan ends within 2 s of its planned time                          |

The reference laptop is an Apple M1 Pro until the client's machine is known.

## 2. Unit tests (Vitest, Node)

| ID        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-headers | The header set and CSP string (exists from Stage 0, updated for ADR 0002)                                                                                                                                                                                                                                                                                                                                                                                                 |
| U-dali    | Addresses, the command table, encode and decode, reply decoding, device type context                                                                                                                                                                                                                                                                                                                                                                                      |
| U-sim     | One behaviour test per section of `docs/research/dali.md`: curve, limits, fades, scenes, groups, DTRs, send twice, queries, RESET, power-on, system failure, commissioning, DT8. Each profile setting in both positions                                                                                                                                                                                                                                                   |
| U-bus     | Settling times, send-twice spacing, reply windows, transactions kept whole, priorities, utilisation                                                                                                                                                                                                                                                                                                                                                                       |
| U-safety  | Every row of the rule table in the spec, the safety profile sequence and its failure cases, each rate guard rule, panic and the latch. Fast spans, their windows and margins, and the slow test on hand-built plans (`src/safety/rate/spans.test.ts`). The rule for gear in an unknown state on hardware (ADR 0016)                                                                                                                                                       |
| U-engine  | Compiling intents, shared DTR frames, the coalescer, the router in each target, divergence logging, runners, plan building                                                                                                                                                                                                                                                                                                                                                |
| U-console | Key-sequence tests for every binding, the kill ring, undo, search, completion, the command parser                                                                                                                                                                                                                                                                                                                                                                         |
| U-script  | The parser: every statement, every limit, every error message with its line                                                                                                                                                                                                                                                                                                                                                                                               |
| U-switch  | Every event and timer of the part 301 machine, and each preset's mapping                                                                                                                                                                                                                                                                                                                                                                                                  |
| U-store   | Validators, each migration against its fixture, set-aside on failure                                                                                                                                                                                                                                                                                                                                                                                                      |
| U-light   | Form factors against the closed forms for a cube and a 5 by 1.2 by 2.4 m box, row sums and reciprocity, the direct term against the strip formula and its integral against the flux, clipping by openings, the mesh and its cap, the solve (energy balance, black surfaces, reflectance near 1, linearity, mesh convergence), the lightmap, the scene validator, emitter and diffuser models, the frame, the probe, the camera, the cache and the light worker's protocol |
| U-colour  | XYZ conversions and the display matrices, the locus search against McCamy and Duv's sign, white balance, gamut mapping at held luminance, exposure and the tone curve, false colour                                                                                                                                                                                                                                                                                       |
| U-server  | pytest in `server/` (`pnpm test:server`): Host and Origin checks, GET only, the file list, the headers on every response, the token, message lengths, flags mismatch, device type context, the queue limit, the 3 s stop, stop on exit and on each signal, PANIC with a full queue (nothing queued is sent after OFF), the frame on the hasseb finishing before the stop, the single-use URL token, a missing Origin, the hasseb going and coming, with a fake HID device |

## 3. Property tests (fast-check)

| ID          | Property                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-codec     | `decode(encode(c))` is `c` for every command, and `encode(decode(f))` is `f` for every frame that decodes                                                                                                                                                                                  |
| P-ceiling   | For any stream of intents, console lines, script steps and raw frames from any mix of sources, with no confirmed raise, the simulator's output never passes the ceiling. Run for both DA5-L light types and both colour presentations                                                      |
| P-dtr       | For any stream, a command that reads a DTR is sent only when the governor's view of that DTR equals the simulator's                                                                                                                                                                        |
| P-rate      | For any stream, with and without the `rate` unlock, the simulator's output trace has no more swing starts in any one-second window than the limit, and never more than three. Measured on the trace, not on the guard's counters                                                           |
| P-rate-fade | The same with random fade times, fade rates and extended fades, and with fade times changed mid-stream                                                                                                                                                                                     |
| P-rate-slow | The same with a slow fade running, and steps, fast fades and unlocked RESETs on top of it, which keeps runs going past hard steps (ADR 0015)                                                                                                                                               |
| P-rate-diff | On made-up traces with ratios near 2, near 1.1 and near the 0.5% change, and fades either side of 0.7 s, wherever the checker finds a hard-step or reversal breach, the guard's own reading finds one, with the counterexamples kept as examples (ADR 0015 and ADR 0016, S6-P10 to S6-P12) |
| P-slow-diff | For random commands on the bench, the guard's slow test and the checker's agree on every recorded interval: a change is slow only when it came from fades that ran 0.7 s or longer (ADR 0016)                                                                                              |
| P-panic     | For any stream and any moment, after panic at most the frame already on the wire completes, then TERMINATE and broadcast OFF are sent, nothing else follows until Resume, and the guard never delays it                                                                                    |
| P-sched     | For any set of transactions, frames of one transaction are never interleaved with another's, and no gap is shorter than the floor                                                                                                                                                          |
| P-parser    | The script parser never throws, never returns more than the step limit, and every accepted script prints back to an equivalent script                                                                                                                                                      |
| P-history   | History expansion never throws, and an expansion of a line with no `!` or leading `^` is the line                                                                                                                                                                                          |
| P-validator | The workspace validator never throws on any JSON value, never returns an object with a forbidden key, and accepts everything `exportWorkspace` produces                                                                                                                                    |
| P-plan      | Any sequence the planner accepts runs on the simulator without a refusal and ends within one frame time of its planned end                                                                                                                                                                 |
| P-light     | Energy balance in a closed box for random sizes, reflectances and emitter positions, within 2%. Superposition: the response to a sum is the sum of responses. A sum of gamut-mapped colours stays in gamut. The scene and response validators never throw                                  |

P-rate and P-rate-fade assert every clause of S3 on the traces, not only swings in a window: the 360 ms spacing, the 0.7 s fade for large legs, the reversal limit, saturated red, the 5 second stop, and legs on each channel and on luminance. Their generators include colour-only changes, staircases of small steps, group, broadcast and unaddressed frames with gear the governor has not seen, ENABLE DAPC SEQUENCE, SET MIN LEVEL and SET MAX LEVEL, RESET under the unlock, transport faults, target switches, reconnects, and several sources at once. P-ceiling uses the same generators.

Any change to the rate guard or panic adds or strengthens a property here in the same commit.

The property tests run on the bench in `tests/harness/`: the scheduler, the governor and the simulator on a virtual clock. P-rate and P-rate-fade check the simulator's recorded output with `tests/harness/checker.ts`, which implements ADR 0011's rules separately from `src/safety/rate`. `pnpm verify` runs 25 cases of each. Set `PROP_RUNS` to run more: each stage that changes `src/safety` runs 1,000 before it closes. Until Stage 4 brings intents, the console and scripts, P-ceiling's "sources" are transactions and raw frames tagged with each source. A hardware variant of P-rate runs the governor with a separate shadow that knows nothing at connect, across reconnects.

## 4. Golden and differential tests

- **G-frames.** `tools/golden/generate.py` writes JSON fixtures from python-dali for every supported command: frame bytes, send-twice flag and reply type, the DT8 sequences `tools/first_light.py` sends, and commissioning frames. Tests read only the fixtures.
- **G-hasseb.** The 10-byte reports python-dali's driver builds for a sample of commands, without a device. The server's report builder is tested against the same fixtures (`server/tests/test_hasseb.py`). One departure on purpose: a reply length byte of 8 is accepted as well as 1 (ADR 0012).
- **D-fakes.** Where python-dali's fake gear models a behaviour (clamping, scenes, groups, DTRs, addressing, commissioning), the same command streams run through it and through the simulator, and the query replies are compared. The four known differences in `dali.md` section 15 are listed as expected.
- **G-light.** `tools/reference/trace.ts` (`pnpm reference`) is a small path tracer that shares only the scene description with the light core. It writes the direct and indirect illuminance at 124 points of four set-ups (a channel, a skirting slot, a reveal lit upward, and a low reveal with open ends) to `tests/golden/light/reference.json`, with each estimate's standard error. `src/light/reference.test.ts` reads the file: direct light within 1% or the reference's noise, indirect within 10%, and within 25% at the one point that sits on a shadow edge of bounced light (ADR 0017).
- **D-live.** In Hardware and Both, the server refuses a frame whose flags differ from python-dali's decoding. The server's decoding is checked against every command in `tests/golden/frames.json`, and any such refusal in an e2e run against the fake device is a failure.

## 5. Mutation testing

- **M-safety.** Stryker with the Vitest runner on `src/safety` and the codec in `src/dali` (`pnpm mutate`). It is a development dependency added in Stage 3, and runs on demand and before each stage close that touched those folders, not on every push. Surviving mutants in `src/safety` are listed with reasons in `docs/MUTATION.md`.

## 6. Lint tests

- **L-sinks.** Exists from Stage 0: each banned sink is caught.
- **L-boundary.** A test file proves lint catches an import of a transport's send outside `src/engine/router.ts`, a DOM global or timer in a pure folder, `createPolicy` or `new Worker` outside `src/workers`, and an inline style attribute in a component. Stage 3 adds the pure-folder part (`eslint.boundary.js`, `tests/lint/boundary.test.ts`). The rest comes with the router, the workers and the components.

## 7. End-to-end tests (Playwright, Chromium)

Every e2e test uses the harness in `e2e/harness.ts`, so each also fails on a CSP violation, console error or cross-origin request. E-modes and E-server run from `playwright.server.config.ts`, one at a time, each against its own `python -m server --demo` on the server's fixed port. `pnpm e2e` runs the preview tests, then these.

| ID           | Flow                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-csp        | Exists. Extended to visit every route, load both workers, and check the meta fallback enforces Trusted Types                                                                                                               |
| E-shell      | Navigation, preferences persist across a reload, unlocks and the latch do not                                                                                                                                              |
| E-playground | Level, colour temperature, colour, fade, live and commit modes, clamped and refused values shown                                                                                                                           |
| E-modes      | Simulator, Hardware and Both against the server with a fake HID device: connect, inventory, safety profile, a divergence logged when the fake is made to differ, fallback on disconnect                                    |
| E-server     | A page from another origin, a wrong Host, a missing or wrong token and a second client are each refused. Closing the tab turns the fake bus off                                                                            |
| E-ceiling    | Lower at once, raise needs confirmation, a script cannot raise, mismatch shown                                                                                                                                             |
| E-panic      | Button, Escape twice, and `panic`, from every page, with a dialog open, mid-script and mid-sequence. The latch holds until Resume. An unresponsive bus worker is ended. The button is clicked while a confirmation is open |
| E-console    | Typing sessions: editing, history, expansion with verify, completion, replies, refusals                                                                                                                                    |
| E-keys       | A matrix of every binding against what Chromium lets a page cancel, so the legend is true                                                                                                                                  |
| E-script     | Run, pause, Ctrl-C, a refused step, import of a bad script                                                                                                                                                                 |
| E-import     | Workspace export and import, oversized and malformed files refused, a file with a higher ceiling does not raise it                                                                                                         |
| E-sequence   | Plan preview, run, stop                                                                                                                                                                                                    |
| E-hidden     | A long sequence with the page hidden, timed against the virtual bus                                                                                                                                                        |
| E-effects    | Each built-in effect starts, shows its bus cost, and stops                                                                                                                                                                 |
| E-visualiser | Mount editor, presets, cameras, exposure, probe values against the pure core                                                                                                                                               |
| E-ab         | Two set-ups side by side, one exposure                                                                                                                                                                                     |
| E-switch     | Every event type by mouse, touch and keyboard, and a plate on an unverified address doing nothing                                                                                                                          |
| E-a11y       | Keyboard reach of every control, roles and names, reduced motion, and no element that blinks                                                                                                                               |

From Stage 5 the preview tests are in `e2e/*.spec.ts`, one file per flow. They run in the Simulator target. `e2e/server/playground.spec.ts` runs E-playground and E-ceiling in Hardware and Both against the fake. It includes a mismatch from the fake's `max-level` quirk, and the order of the hold and the MAX LEVEL writes when lowering. `e2e/devices.spec.ts` covers the simulator settings (R1.6). `e2e/bundle.spec.ts` checks that the entry chunk has no lazily loaded code and stays under 250 kB, ready for three.js in Stage 7. Each test needs about 15 s for the start-up scan, because the simulated bus runs at DALI speed. Still to come: panic mid-sequence (E-panic, Stage 9).

Stage 6 adds `e2e/console.spec.ts` (E-console), `e2e/keys.spec.ts` (E-keys, which checks that each bound key is handled and that Escape then Tab leaves) and `e2e/script.spec.ts` (E-script). `e2e/ceiling.spec.ts` adds a script that tries to raise the ceiling, and `e2e/panic.spec.ts` adds panic mid-script from the button and typed in the console. U-console is in `src/console/*.test.ts`, U-script in `src/script/parse.test.ts`, and P-history and P-parser in their `*.prop.test.ts` files. The U-engine tests for `ConsoleExec` and the script runner run on a virtual clock in `src/engine/console.test.ts`, and cover pause, Ctrl-C, panic, the watchdog, a refused step, the wait for the rate guard, and `first-light` on the simulated bench never passing the ceiling. P-ceiling's second part runs random console lines and scripts through the engine.

Stage 7 adds `e2e/visualiser.spec.ts` (E-visualiser, the engine's part): the page solves in the light worker; a console command shows in the mounts' output and in the probe; a screenshot's pixels match the pure core's `shade` at a grid of points, within 6 levels of 255; false colour matches the palette; the view settings and the page persist; a solved scene is reused; a spoiled cache record is replaced; and measuring the frame leaves the picture unchanged and Panic there to press. `e2e/hallway.spec.ts` is V-hallway's first part. `e2e/csp.spec.ts` visits Scripts and the Visualiser and waits for the light worker. `e2e/bundle.spec.ts` holds the entry chunk under 250 kB and three.js to the renderer's chunk. The harness allows one warning from headless Chromium, in its exact form, "GL Driver Message ... GPU stall due to ReadPixels", which its software GL logs when it reads a frame back to show it. Still to come in Stage 8: the mount editor, presets and cameras.

CI runs Chromium only. The client uses Chrome and Brave, so from Stage 5 the app is checked by hand in both at each stage close, with hardware through the server from Stage 4. The simulator is also checked by hand in Firefox and Safari. The results go in the stage report.

## 8. Visual regression

- **V-ui.** Screenshots of each page in the dark theme at 1440 by 900. Run by hand on the reference laptop with `pnpm e2e:visual`, not in CI, because fonts render differently on Linux and one set of baselines cannot serve both (ADR 0013).
- **V-hallway.** Pictures of the hallway against saved ones, in Chromium's software renderer so CI and laptops agree, with a small per-pixel tolerance (1% of pixels, at a colour threshold of 0.06). One set of baselines serves every platform (`snapshotPathTemplate` in `playwright.config.ts`). Stage 7 has four of the default hallway: tape A warm, the same in false colour, tape B a saturated blue, and both at the night exposure. Stage 8 adds one per mount preset and diffuser.
- Numeric checks carry the accuracy: probe values from the pure core against fixtures. Screenshots catch regressions in the shader and layout.

## 9. Performance

- **Perf-frame.** `pnpm perf:frame` opens the Visualiser in a headed browser on a real GPU and presses "Measure frame time" five times. Each press draws a six-mount scene, all lit, 60 times at 1440 by 900 to an off-screen target, each frame forced to finish, in runs of at most 40 ms so the page stays live. The test takes the median against 4 ms. Run by hand on the reference laptop at the close of Stages 7 and 8. CI cannot run it, because it draws in software. Stage 7: medians of 3.05 to 3.34 ms on an Apple M1 Pro. This is the steady figure. One frame drawn from an idle GPU takes 5 to 8 ms (ADR 0017).
- **Perf-solve.** `pnpm perf:solve` times the form factors and the solve in Node for six mounts from 1,000 to 5,000 patches, and the whole solve of the default scene. Stage 7: 0.65 s per mount with six mounts (4,348 patches), and 0.73 s for the default scene, on an Apple M1 Pro.
- **Perf-bus.** The scheduler's frames a second on the virtual clock, against the timing floors.

## 10. Hardware day

A checklist, run in order with the bench powered and both tapes unrolled. The app's hardware check flow (Stage 4) runs parts 2 to 4 and records the answers. Each answer goes into `docs/research/hasseb.md` or `docs/research/da5-l.md`, and into the simulator's profile.

### Part 1: the hasseb, before the bench is wired

- [ ] Read the vendor and product IDs. Expect 04CC and 0802.
- [ ] Dump the HID report descriptor. Record the usage page, usage, any report ID, the report lengths and the polling interval.
- [ ] Note whether the device has a serial number string.
- [ ] Start the server and connect. Record the firmware version.
- [ ] Count idle reports for five seconds.
- [ ] If WebHID is still wanted: from a throwaway page on another port, not the app's origin, request the device in Chrome and print `collections`. Record whether reports are listed, then call `forget()`.

### Part 2: read both drivers, before sending any level

- [ ] Device types, including QUERY NEXT DEVICE TYPE if the answer is 255.
- [ ] Colour type features: Tc capable, xy capable, RGBWAF channel count. This settles how C2 and C5 present colour.
- [ ] Assigned colour for channels 0 to 5.
- [ ] Physical minimum, MIN LEVEL, MAX LEVEL.
- [ ] POWER ON LEVEL, SYSTEM FAILURE LEVEL.
- [ ] Fade time and rate, extended fade time, fast fade time and its minimum.
- [ ] Dimming curve, gear features (automatic activation), RGBWAF control.
- [ ] Colour temperature limits, all four.
- [ ] All 16 scene levels and both group bytes.
- [ ] The colour as shipped: QUERY COLOUR VALUE selectors 226 and 233 to 238.
- [ ] With the `expert` unlock, STORE COLOUR TEMPERATURE Tc LIMIT on driver A, then read it back. Whether limits can be stored at all.
- [ ] Version numbers and memory bank 0.

### Part 3: the transport

- [ ] QUERY STATUS to address 0. Record all 10 reply bytes. Settle byte 4 (1 or 8) and that byte 2 echoes the sequence number.
- [ ] A query to an empty address. Record the status and the time taken.
- [ ] Throughput: 100 level commands, then 100 queries, each sent when the last report arrives.
- [ ] A send-twice command with sniffing on. Measure the gap between the two frames. It passes at 13.5 to 14.7 ms.
- [ ] STORE GEAR FEATURES/STATUS and read back, to settle ENABLE DEVICE TYPE with send-twice commands.
- [ ] Unplug the hasseb mid-session. The app shows the fault, and the tapes do what SYSTEM FAILURE LEVEL says.

### Part 4: the safety profile

- [ ] Write the profile to both drivers and read it back.
- [ ] Power-cycle the drivers. They stay off. Film the first second for any flash.
- [ ] Pull the bus supply for a second. The level does not change.
- [ ] Set SYSTEM FAILURE LEVEL to a low level with a 4 s fade time, pull the bus supply for two seconds, and watch: a step or a fade, and what the tape does when the bus returns. Then write the profile again.
- [ ] Store a warm power-on colour, power-cycle, raise the level. Record the colour.
- [ ] Lower MAX LEVEL below the present level. Record whether the output drops by itself.
- [ ] Panic from the app, from Escape and by closing the tab. Time each to dark.
- [ ] Panic while a send-twice frame with a reply is in flight: check the hasseb keeps frames in order when panic stops waiting after 100 ms (`PANIC_WAIT_MS`).
- [ ] Stop the server with Ctrl-C. The tapes go off.

### Part 5: behaviour (`dali.md` section 16)

- [ ] Fade up from off, with a long fade, logging QUERY ACTUAL LEVEL every 100 ms.
- [ ] A new level mid-fade, and DAPC 255 mid-fade.
- [ ] DAPC 0 with a fade time.
- [ ] A colour change with a 4 s fade. Watch, and poll the fade-running bit.
- [ ] A colour temperature outside the limits.
- [ ] Temporary colour before and after ACTIVATE (selector 208).
- [ ] What SET SCENE stores as colour, with and without a temporary colour.
- [ ] Send twice with a frame to the other driver in between.
- [ ] Twenty UPs at fade rate 15, querying after each.
- [ ] Level 100, SET MIN LEVEL 150, query: does raising MIN lift the level.
- [ ] DAPC 200, SET MAX LEVEL 150, query at once and after 2 s. Repeat during a slow fade upward.
- [ ] GO TO LAST ACTIVE LEVEL at a known level, and query.
- [ ] If QUERY MIN FAST FADE TIME shows support, time a fade at a count of 27 (675 or 700 ms).
- [ ] An extended fade of 16 minutes, timed.
- [ ] Fade time 1, timed: the guard calls a fade slow from 705 ms, and fade time 1 should run 707 ms (S6-D16-6).
- [ ] With the tapes covered, once: RESET from the app, then re-read everything, including the stored power-on colour and GO TO LAST ACTIVE LEVEL after the OFF.
- [ ] With the tapes covered, `reset 0` from the console on Hardware and on Both: OFF follows within about 0.4 s, the safety profile verifies, and panic in the 0.35 s between RESET and OFF still ends with the tape off (S6-S5).
- [ ] Before `FADE_BEHAVIOUR_CONFIRMED` is set: a fade the shadow thinks ran 0.7 s or longer is slow to the rate guard (ADR 0016). After a DTR0 sent in the deaf window, or a frame faulted, read the fade times back and check they match the shadow before trusting it (S6-S16-5).
- [ ] With the tapes covered, once: IDENTIFY DEVICE from a python-dali script, since the app refuses it. Record what the driver does.

### Part 6: light, with a lux meter if one is to hand

- [ ] Step the level from the physical minimum upward at PWM FA and count distinct readings. Repeat at F2.
- [ ] Sweep colour temperature at a fixed level. Constant lux means constant total.
- [ ] One RGBWAF channel: sweep the channel level at arc level 254, then the arc level with the channel at 254.
- [ ] Lux at the wall for each tape at the ceiling and at the minimum, to set the visualiser's placeholders.
- [ ] Light each white channel of driver A (C2) on its own and note which terminals light, to set the C2 terminal order. Do the same for W and A on driver B (C5).

### Part 7: Both mode

- [ ] Run the comparison set: `first-light`, each built-in night preset and each effect for one minute.
- [ ] If driver A (C2) presents colour as RGBWAF rather than Tc, `first-light` stops at its first `tc 0` step, where `tools/first_light.py` would go on to tape B. Record it, and change the built-in script to match what the drivers report (DALI review S6-D10).
- [ ] Every divergence is either fixed in the DA5-L profile or explained in the log. No special cases for hardware in the code.

Done when the divergence log is clear or explained and the safety profile is verified on both drivers.
