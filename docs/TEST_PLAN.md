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

| ID        | Covers                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-headers | The header set and CSP string (exists from Stage 0, updated for ADR 0002)                                                                                                                                                                                                               |
| U-dali    | Addresses, the command table, encode and decode, reply decoding, device type context                                                                                                                                                                                                    |
| U-sim     | One behaviour test per section of `docs/research/dali.md`: curve, limits, fades, scenes, groups, DTRs, send twice, queries, RESET, power-on, system failure, commissioning, DT8. Each profile setting in both positions                                                                 |
| U-bus     | Settling times, send-twice spacing, reply windows, transactions kept whole, priorities, utilisation                                                                                                                                                                                     |
| U-safety  | Every row of the rule table in the spec, the safety profile sequence and its failure cases, each rate guard rule, panic and the latch                                                                                                                                                   |
| U-engine  | Compiling intents, shared DTR frames, the coalescer, the router in each target, divergence logging, runners, plan building                                                                                                                                                              |
| U-console | Key-sequence tests for every binding, the kill ring, undo, search, completion, the command parser                                                                                                                                                                                       |
| U-script  | The parser: every statement, every limit, every error message with its line                                                                                                                                                                                                             |
| U-switch  | Every event and timer of the part 301 machine, and each preset's mapping                                                                                                                                                                                                                |
| U-store   | Validators, each migration against its fixture, set-aside on failure                                                                                                                                                                                                                    |
| U-light   | Form factors against closed forms, row sums and reciprocity, the direct term against the strip formula, emitter and diffuser models                                                                                                                                                     |
| U-colour  | XYZ conversions, gamut mapping, the locus search against McCamy, exposure and tone mapping                                                                                                                                                                                              |
| U-server  | pytest in `server/`: Host and Origin checks, the token, message lengths, flags mismatch, the queue limit, the 3 s stop, stop on exit and on each signal, PANIC with a full queue (nothing queued is sent after OFF), the single-use URL token, a missing Origin, with a fake HID device |

## 3. Property tests (fast-check)

| ID          | Property                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-codec     | `decode(encode(c))` is `c` for every command, and `encode(decode(f))` is `f` for every frame that decodes                                                                                                                             |
| P-ceiling   | For any stream of intents, console lines, script steps and raw frames from any mix of sources, with no confirmed raise, the simulator's output never passes the ceiling. Run for both DA5-L light types and both colour presentations |
| P-dtr       | For any stream, a command that reads a DTR is sent only when the governor's view of that DTR equals the simulator's                                                                                                                   |
| P-rate      | For any stream, with and without the `rate` unlock, the simulator's output trace has no more swing starts in any one-second window than the limit, and never more than three. Measured on the trace, not on the guard's counters      |
| P-rate-fade | The same with random fade times, fade rates and extended fades, and with fade times changed mid-stream                                                                                                                                |
| P-panic     | For any stream and any moment, after panic at most the frame already on the wire completes, then TERMINATE and broadcast OFF are sent, nothing else follows until Resume, and the guard never delays it                               |
| P-sched     | For any set of transactions, frames of one transaction are never interleaved with another's, and no gap is shorter than the floor                                                                                                     |
| P-parser    | The script parser never throws, never returns more than the step limit, and every accepted script prints back to an equivalent script                                                                                                 |
| P-history   | History expansion never throws, and an expansion of a line with no `!` or leading `^` is the line                                                                                                                                     |
| P-validator | The workspace validator never throws on any JSON value, never returns an object with a forbidden key, and accepts everything `exportWorkspace` produces                                                                               |
| P-plan      | Any sequence the planner accepts runs on the simulator without a refusal and ends within one frame time of its planned end                                                                                                            |
| P-light     | Energy balance in a closed box for random sizes, reflectances and emitter positions. Superposition: the response to a sum is the sum of responses                                                                                     |

P-rate and P-rate-fade assert every clause of S3 on the traces, not only swings in a window: the 360 ms spacing, the 0.7 s fade for large legs, the reversal limit, saturated red, the 5 second stop, and legs on each channel and on luminance. Their generators include colour-only changes, staircases of small steps, group, broadcast and unaddressed frames with gear the governor has not seen, ENABLE DAPC SEQUENCE, SET MIN LEVEL and SET MAX LEVEL, RESET under the unlock, transport faults, target switches, reconnects, and several sources at once. P-ceiling uses the same generators.

Any change to the rate guard or panic adds or strengthens a property here in the same commit.

## 4. Golden and differential tests

- **G-frames.** `tools/golden/generate.py` writes JSON fixtures from python-dali for every supported command: frame bytes, send-twice flag and reply type, the DT8 sequences `tools/first_light.py` sends, and commissioning frames. Tests read only the fixtures.
- **G-hasseb.** The 10-byte reports python-dali's driver builds for a sample of commands, without a device. The server's report builder is tested against the same fixtures.
- **D-fakes.** Where python-dali's fake gear models a behaviour (clamping, scenes, groups, DTRs, addressing, commissioning), the same command streams run through it and through the simulator, and the query replies are compared. The four known differences in `dali.md` section 15 are listed as expected.
- **D-live.** In Hardware and Both, the server refuses a frame whose flags differ from python-dali's decoding. Any such refusal in an e2e run against the fake device is a failure.

## 5. Mutation testing

- **M-safety.** Stryker with the Vitest runner on `src/safety` and the codec in `src/dali`. It is a development dependency added in Stage 3, and runs on demand and before each stage close that touched those folders, not on every push.

## 6. Lint tests

- **L-sinks.** Exists from Stage 0: each banned sink is caught.
- **L-boundary.** A test file proves lint catches an import of a transport's send outside `src/engine/router.ts`, a DOM global or timer in a pure folder, `createPolicy` or `new Worker` outside `src/workers`, and an inline style attribute in a component.

## 7. End-to-end tests (Playwright, Chromium)

Every e2e test uses the Stage 0 harness, so each also fails on a CSP violation, console error or cross-origin request.

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

CI runs Chromium only. The client uses Chrome and Brave, so from Stage 5 the app is checked by hand in both at each stage close, with hardware through the server from Stage 4. The simulator is also checked by hand in Firefox and Safari. The results go in the stage report.

## 8. Visual regression

- **V-ui.** Screenshots of each page in the dark theme at 1440 by 900.
- **V-hallway.** One screenshot per mount preset and diffuser, in Chromium's software renderer so CI and laptops agree, with a small per-pixel tolerance.
- Numeric checks carry the accuracy: probe values from the pure core against fixtures. Screenshots catch regressions in the shader and layout.

## 9. Performance

- **Perf-frame.** A script opens the visualiser with six mounts on a real GPU, renders 60 frames, and reports milliseconds a frame. Run by hand on the reference laptop at the close of Stages 7 and 8. CI cannot run it, because it renders in software.
- **Perf-solve.** The radiosity solve timed in Node for 1,000 to 5,000 patches.
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
- [ ] Store a warm power-on colour, power-cycle, raise the level. Record the colour.
- [ ] Lower MAX LEVEL below the present level. Record whether the output drops by itself.
- [ ] Panic from the app, from Escape and by closing the tab. Time each to dark.
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
- [ ] An extended fade of 16 minutes, timed.
- [ ] With the tapes covered, once: RESET from the app, then re-read everything.
- [ ] With the tapes covered, once: IDENTIFY DEVICE from a python-dali script, since the app refuses it. Record what the driver does.

### Part 6: light, with a lux meter if one is to hand

- [ ] Step the level from the physical minimum upward at PWM FA and count distinct readings. Repeat at F2.
- [ ] Sweep colour temperature at a fixed level. Constant lux means constant total.
- [ ] One RGBWAF channel: sweep the channel level at arc level 254, then the arc level with the channel at 254.
- [ ] Lux at the wall for each tape at the ceiling and at the minimum, to set the visualiser's placeholders.

### Part 7: Both mode

- [ ] Run the comparison set: `first-light`, each built-in night preset and each effect for one minute.
- [ ] Every divergence is either fixed in the DA5-L profile or explained in the log. No special cases for hardware in the code.

Done when the divergence log is clear or explained and the safety profile is verified on both drivers.
