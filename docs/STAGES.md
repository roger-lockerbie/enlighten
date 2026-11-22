# Build plan

## How to run a stage

In the Claude desktop app's Code tab:

1. Start a new session for each stage, with the environment set to Local and the folder set to this repo.
2. Pick the stage's model in the model picker under the prompt box.
3. For stages marked plan mode, set the mode selector to Plan. Read the plan, approve it, then let it build.
4. Type: `Run Stage N from docs/STAGES.md.`
5. Read the report, try what it tells you to try, and merge the PR.

In the terminal the same steps are `/clear`, `/model sonnet` (or `opus`, `fable`), and Shift+Tab or `/plan` for plan mode.

If a stage spans more than one session, start the next with: `Continue Stage N from docs/STAGES.md. docs/STATUS.md says where it stopped.`

## Models

Fable goes where depth of reasoning pays most: the research, the light and colour engine, and the design. If the allowance runs short, spend it in that order (Stage 1, then 7, then 2) and use Opus for the rest. Opus takes the correctness-critical code and the security review. Fable passes security-heavy work to Opus automatically, so the review runs on Opus from the start. Sonnet takes scaffolding and UI.

| Stage | What                                                    | Model                          | Plan mode |
| ----- | ------------------------------------------------------- | ------------------------------ | --------- |
| 0     | Repo, tooling and security baseline                     | Sonnet                         | no        |
| 1     | Research                                                | Fable                          | yes       |
| 2     | Design: spec, architecture, threat model, UI            | Fable (Opus if Fable is short) | yes       |
| 3     | DALI core, simulator and safety governor                | Opus                           | yes       |
| 4     | Transports and the hasseb                               | Opus                           | yes       |
| 5     | App shell, design system and playground                 | Sonnet                         | yes       |
| 6     | Console and scripts                                     | Sonnet                         | yes       |
| 7     | Visualiser engine: light and colour                     | Fable                          | yes       |
| 8     | Hallway, mounts and tapes                               | Opus                           | yes       |
| 8b    | Rate guard                                              | Fable (Opus if Fable is short) | yes       |
| 9     | Scenes, sequences and effects                           | Fable (owner's choice)         | yes       |
| 10    | Switchgear                                              | Sonnet                         | yes       |
| 11    | Hardening, independent review, going public             | Opus                           | yes       |
| 12    | Hardware day, whenever the hasseb arrives after Stage 4 | Opus                           | yes       |

The repo goes to GitHub as a private repo in Stage 0, so CI and backups run from the first day. It goes public in Stage 11, after the independent review and only with my yes.

Every stage ends with the stage-close checklist in `CLAUDE.md` and then stops.

---

## Stage 0: Repo, tooling and security baseline

Goal: an empty repo the client would trust, with every guard in place before there is code to guard.

1. Check the tools: git, the current Node LTS, pnpm through corepack, Python 3.10 or later (for golden fixtures), gh (optional), and Chrome or Edge. Report anything missing, and stop if Node or pnpm is.
2. `git init` on `main` if needed. Leave the pack files where they are, with one exception: if `setup/agents/` exists, move its two files into `.claude/agents/` and remove `setup/`. They define the review subagents that `CLAUDE.md` relies on.
3. Scaffold by hand, with no `create-*` generators: TypeScript (strict), Vite, Svelte 5, Vitest, fast-check, Playwright (Chromium only), ESLint flat config (typescript-eslint strict type-checked, the Svelte plugin, and rules banning the sinks listed in `CLAUDE.md`), Prettier and svelte-check. The package is named `enlighten`. Latest stable versions, pinned exactly. Pin Node in `.nvmrc`, `engines` and `packageManager`.
4. Harden pnpm: frozen lockfile, dependency install scripts blocked except an explicit allowlist, a minimum release age for new versions (check the current setting names), and exact saves. Explain each setting in `docs/DEPENDENCIES.md`.
5. Security baseline for build and preview: CSP and Trusted Types, COOP, COEP and CORP, a Permissions-Policy that turns off powerful features the app doesn't use (camera, microphone, geolocation, USB, serial, Bluetooth, payment and the like) and allows `hid`, `screen-wake-lock` and `fullscreen` for self only, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `frame-ancestors 'none'`. Headers come from `vite preview`, with a meta-tag fallback in the build where a header can't be set. Preview binds to 127.0.0.1 on a fixed, strict port that other local tools are unlikely to use. The dev server may relax only what hot reload needs.
6. A placeholder page, an e2e test that fails on any CSP violation or console error, and a lint test file proving each banned sink is caught.
7. Scripts: `dev`, `build`, `preview`, `start` (build then preview), `test`, `test:prop`, `e2e`, `lint`, `typecheck`, `verify` (all of them). Fill in the Commands section of `CLAUDE.md`.
8. CI on GitHub Actions: `verify` on push and PR, every action pinned to a commit SHA (resolve tags with `gh api`), `permissions: contents: read`, and the Playwright browser cached. Dependabot for npm and actions. CodeQL for JavaScript and TypeScript.
9. Docs: a short README (what it is, how to run it), `SECURITY.md` (how to report a problem), `CHANGELOG.md`, `docs/STATUS.md`, `docs/adr/0000-template.md`, `docs/DEPENDENCIES.md` and `docs/SECURITY_FINDINGS.md`.
10. `tools/golden/`: a README and a hash-locked `requirements.txt` for python-dali 0.16 and hidapi (python-dali's hasseb driver imports it), installed into a git-ignored venv. No generator yet.
11. GitHub: if `gh auth status` works, confirm the account or organisation with me, then create a private repo named `enlighten` and push. Turn on Dependabot alerts. If the account's plan allows rulesets on a private repo, require PRs and green CI on `main`. Otherwise leave that for Stage 11.

Done when: `pnpm verify` passes locally and in CI, the CSP test passes under the strict policy, the lint test passes, and the PR is merged.

---

## Stage 1: Research

Goal: find out everything that would be expensive to get wrong later, with sources, then stop for my review. Write no app code.

Read `CLAUDE.md`, `docs/BRIEF.md` and `tools/first_light.py`. Download the python-dali 0.16 source into a scratch folder outside the repo and read it, without running it. Use subagents for parallel research threads and do the synthesis yourself. Cite every claim with a URL, or a python-dali file and line. Mark anything you couldn't confirm as unknown, with how to find out. The IEC 62386 texts are paywalled, so don't look for copies: use python-dali, DALI Alliance documents, Beckhoff's documentation and manufacturers' manuals.

Write these to `docs/research/`:

1. `dali.md`: the commands we need from IEC 62386-102, 207 and 209, and exactly how gear behaves for each. Arc levels and the log curve; MIN, MAX and physical minimum; POWER ON and SYSTEM FAILURE levels; RESET and its reset values; DTR0 to DTR2; send-twice rules; fade time, fade rate and extended fade; fading up from off; UP, DOWN and the step commands; scenes, including DT8 colour; groups; queries and their replies; DT8 colour temperature, RGBWAF and xy (temporary and actual colour, ACTIVATE, automatic activation, colour fading, colour temperature limits, assigned colours); commissioning; and bus timing (frame lengths, settling times, send-twice spacing, reply windows). List every edge case that touches the brightness ceiling.
2. `hasseb.md`: the 10-byte protocol in `dali/driver/hasseb.py` (fields, status codes, sequence numbers, the firmware version command, sniffer mode, the idle reports it sends continuously), and how it maps onto WebHID: `sendReport`, `inputreport`, report IDs and sizes from `HIDDevice.collections`, and whether 0xAA is a report ID or the first data byte. Cover WebHID's permission and origin model, `forget()`, Linux udev rules and browser support, then write a hardware-day checklist. Design the contingency bridge on paper.
3. `da5-l.md`: everything known about the driver and the queries that settle the unknowns in the brief.
4. `optics.md`: tape photometry from the Linear Lux datasheets (lumens per metre per channel, colour temperatures or chromaticities, LED pitch and layout, COB); the diffusers Linear Lux and the wider market sell, with transmission and how much each spreads the light; channel depths, LED-to-diffuser distance and when dots show; reflectances for the hallway finishes; and common Australian shadowline and reveal details, with real dimensions for the visualiser's defaults.
5. `rendering.md`: compare ways to light the hallway (the superposition approach in the brief, analytic area or line lights, baked lightmaps, in-browser path tracing for a reference still) on accuracy, speed and dependencies. Cover the colour pipeline (chromaticities to XYZ to display, Display P3 where the screen supports it, gamut mapping, tone mapping, fixed exposure) and frame-time targets on a typical laptop. Recommend one approach.
6. `effects.md`: what DALI can do for subtle cues on RGBCCT, given the bus's bandwidth and the drivers' own fades. Candidate effects; the frames per second each needs per address; how large and how slow a change in brightness or colour can be and still be noticed at low light levels; photosensitivity limits; and a plain comparison with pixel tape.
7. `switchgear.md`: two or three providers common in high-end DALI homes in Australia (start with zencontrol, Basalte and Gira; confirm or replace them). Their 1, 2 and 4 button models; documented behaviour for press, double press and hold (toggle, scene, dimming direction, LED feedback); and how each maps onto IEC 62386-301 events and timers. The app will draw generic plates, with no logos or trade dress.
8. `console.md`: the zsh line editing and history behaviour to reproduce (emacs keymap, kill ring, undo, incremental search, history expansion rules, and the history options worth copying, such as ignoring duplicates and verifying an expansion before running it), plus the shortcuts browsers reserve and how to work around them.
9. `security.md`: current guidance for each security rule in `CLAUDE.md` as it applies here: CSP and Trusted Types with the candidate framework, WebHID's permission model, pnpm's install-script and release-age settings, GitHub Actions hardening and build provenance attestations.
10. `SUMMARY.md`: one page of findings that change the brief, with recommendations.

Done when: the research is committed on the stage branch, you've reported the summary, and you've stopped. I'll review before Stage 2.

---

## Stage 2: Design

Goal: turn the brief and the research into the documents every later stage builds against, and prove the stack works under strict CSP and Trusted Types.

1. Spike on a throwaway branch: the default stack (Svelte 5, three.js and a Web Worker) built and previewed under the full CSP and Trusted Types, with the CSP e2e test. Try alternatives only if it fails. Record the result in an ADR.
2. `docs/SPEC.md`: features and acceptance criteria for R1 to R16 and S1 to S6. Include a capability map for R13 (each DALI capability, what a person wants from it, and the control that delivers it), the console's command language and address syntax, the script format, the workspace file schema and the switch behaviour model. End with a traceability table: requirement, spec items, tests.
3. `docs/ARCHITECTURE.md`: modules and their interfaces (Transport, Clock, GearModel, Governor, Scheduler, Engine, Store); the path every input takes (playground, console, script, sequence, effect, switch, import) through the governor and scheduler to the transports and the visualiser; how Simulator, Hardware and Both route frames and replies; persistence and migrations; and the folder layout.
4. `docs/THREAT_MODEL.md`: assets (including the occupants' comfort), entry points, threats in STRIDE terms, and mitigations mapped to tests. Cover XSS as a physical-safety risk, WebHID permissions and origins, imported files, the supply chain, CI, local serving and the contingency bridge.
5. `docs/TEST_PLAN.md`: unit, property, golden, differential, mutation, e2e, visual regression and performance tests, with targets, plus the hardware-day acceptance plan as a checklist.
6. `docs/UI.md`: information architecture, layout, the keyboard map (including the panic shortcut), design tokens for the dark UI, and wireframes saved in the repo.
7. ADRs for the stack and framework, WebHID with the paper bridge, the console design, light transport, persistence, the script format, and anything else you decide.
8. `docs/OPEN_QUESTIONS.md`: what you need from me or the client.

Done when: everything is committed, you've reported a one-page summary of the decisions and open questions, and you've stopped.

---

## Stage 3: DALI core, simulator and safety governor

Goal: a correct, tested core with no UI: frames, commands, simulated drivers, bus timing and the governor.

1. `tools/golden/generate.py`: with python-dali, write JSON fixtures for every command we support (frame bytes, send-twice flag, reply type), the DT8 sequences `first_light.py` sends (including ENABLE DEVICE TYPE 8), commissioning frames, and hasseb reports built by the driver's `construct` method without a device attached. Commit the fixtures and the generator. Tests read only the fixtures.
2. `src/dali`: addressing, frames, a data-driven command table, encoders and decoders, typed replies and sequences, byte-for-byte equal to the fixtures.
3. `src/sim`: a control-gear model per address with a virtual clock, following `docs/research/dali.md`: levels and the curve, fades (standard, extended, fade rate, from off), scenes, groups, DTRs, the send-twice window, queries, RESET, power-on and system-failure behaviour, commissioning and DT8 colour. One DA5-L profile with light types C1 to C5, both colour presentations for C2 and for C5, and a setting for each unknown in the research with its sourced default. Its output is each channel's drive over time, which the 2D preview and the visualiser read.
4. `src/bus`: a scheduler that serialises frames with the researched timing, send-twice spacing and reply windows, reports utilisation, and runs on an injectable clock (virtual in tests, real in the app).
5. `src/safety`: the governor as ADR 0004 and the rule table in `docs/SPEC.md` section 5 set it out (a pure `judge` and `observe` over tracked state, DTR0 to DTR2, a shadow gear model, the RGBWAF mix rule, raw frames decoded then judged, the three unlocks), the gear safety profile builder (S1), the rate guard (S3) and panic with its latch (S4), both as ADR 0005. The ceiling covers the ordinary paths listed in ADR 0004 and no more.
6. Tests as `docs/TEST_PLAN.md` sets them out: the fixtures; a behaviour test for each section of the research doc; the property tests P-codec, P-ceiling, P-dtr, P-rate, P-rate-fade, P-panic and P-sched; mutation testing on `src/safety` and the codec, to the score in the test plan. Stryker is added as a development dependency for this.
7. A differential check: where python-dali's fake gear (`dali/tests/fakes.py`) implements a behaviour, run the same command streams through it and through the simulator, and compare the query replies.

Done when: the stage-close checklist passes and `dali-reviewer` signs off.

---

## Stage 4: Transports and the hasseb

Goal: one Transport interface, the engine that sits above it, and the hardware server, tested end to end without hardware. ADR 0003 and `docs/ARCHITECTURE.md` are the design.

1. `src/engine` and `src/transport`: the engine, router, live-control coalescer and `SimTransport`, with the bus worker shell and its message protocol (ADR 0010).
2. `server/`: the Python hardware server. It binds to 127.0.0.1:47821, serves `dist/` and the `/bus` WebSocket with the full header set, checks Host, Origin and the session token, takes one client, speaks the protocol in `docs/SPEC.md` section 9, builds the hasseb's 10-byte reports itself with sequence numbers matched, and sends broadcast OFF when the client goes away, falls silent for 3 seconds, or the server stops. Its requirements (python-dali, hidapi, `websockets`) are pinned by hash.
3. `ServerTransport` in the app. Hardware and Both are offered only when the page came from the server with a token.
4. A fake HID device for the server that speaks the hasseb protocol and drives a small gear model. CI uses it, and so does a "demo hardware" start option, so the whole hardware path runs today.
5. Both mode: hardware leads, the shadow simulator follows, query replies are compared, and differences go to a divergence log.
6. Discovery and inventory: scan addresses, then query device types, colour type features, RGBWAF channels and assigned colours, colour temperature limits, physical minimum, levels and extended fade. Show what each driver reports, and choose how to drive it from that.
7. Commissioning (address assignment) behind the `reset` unlock and a confirmation step.
8. The gear safety profile: write, verify, re-apply after RESET or commissioning, and warn on mismatch.
9. A hardware check flow, the acceptance plan as code: parts 2 to 4 of the hardware-day checklist in `docs/TEST_PLAN.md`, with results recorded for Stage 12.

WebHID is not built in this stage. It may be added after hardware day (Stage 12) if the hasseb's descriptor allows it, as ADR 0003 describes.

Done when: the full hardware path passes e2e against the fake device in Chromium, the server's own tests pass, the stage-close checklist passes, and `dali-reviewer` signs off.

---

## Stage 5: App shell, design system and playground

Goal: the app you'll use every day, without the console or the 3D hallway yet.

1. Apply ADR 0002 to the build: `fragments: 'tree'`, the `enlighten-worker` policy as the only Trusted Types policy, the lint rules for `createPolicy`, `new Worker` and inline styles, the Permissions-Policy changes in `docs/THREAT_MODEL.md` section 4 (the wider list, `hid=()` and `fullscreen=()`), and three.js as a lazily loaded chunk.
2. Layout per `docs/UI.md`: navigation; a top bar with the output target (Simulator, Hardware, Both) and its connection state, the ceiling, bus activity and panic; the main view; an inspector; and a placeholder console drawer.
3. Design system: the dark tokens, self-hosted fonts, and components (sliders with paired readouts such as % and arc level, or K and mirek; numeric fields with units; segmented controls; a colour picker with white channels; toggles, menus and dialogs). Keyboard and screen-reader accessible, with reduced motion honoured.
4. Playground per device. Tunable white: level, colour temperature and fade. RGBCCT: colour plus whites, raw channels, and a mode that matches how the driver presents itself. A fade picker that explains standard and extended fades. Live and commit modes, with slider movement coalesced to what the bus can carry.
5. Ceiling: set in light output %, with the arc level shown. It lowers at once and rises only with a deliberate action, and it shows its state in the app and in each driver.
6. Bench preview: a 2D view of the two tapes at their true relative brightness and colour from the simulator, so the app is useful before the hallway exists.
7. Bus monitor: frames, their decoded meaning, timing and utilisation.
8. Preferences and persistence (IndexedDB with a schema version and migrations), and workspace export and import, validated.

Done when: e2e tests cover the main flows in all three output modes against the fake device, and the stage-close checklist passes.

---

## Stage 6: Console and scripts

1. A line-editor core in pure TypeScript with the keymap from `docs/research/console.md`: kill ring, undo, and Tab completion for commands, addresses, scene numbers and script names.
2. History: persisted, length from preferences (default 1000), duplicates ignored, an optional leading-space rule that keeps a line out of history, `history`, `history -c`, `!!`, `!n`, `!-n`, `!prefix`, `!?text?`, `^old^new` and Ctrl-R. Expansions show before they run, with verify mode on by default.
3. The command language from the spec: friendly commands (such as `level`, `tc`, `rgb`, `fade`, `scene`, `cap`, `target`, `devices` and `trace`), the full DALI set under python-dali's names in kebab case, the spec's address syntax, decoded replies, and `raw` frames that go through the governor like everything else.
4. Scripts in the spec's format (commands, `wait`, `pause "message"`, `echo`, comments, bounded `repeat`): a parser with clear errors, and a runner that obeys panic and Ctrl-C. Scripts are stored locally and importable as text. Ship `first-light`, reproducing `tools/first_light.py`.
5. Tests: key-sequence tests for the editor, property tests for expansion and the parser, and e2e typing sessions.

Done when: the stage-close checklist passes.

---

## Stage 7: Visualiser engine: light and colour

Goal: physically grounded light and colour for the rest of the visualiser to plug into.

1. The light-transport method chosen in Stage 2, running in a worker: a unit response per mount, cached in IndexedDB against geometry and materials, combined each frame on the GPU from each tape's current output.
2. The emitter model, per tape type and channel: flux per metre and chromaticity from the research, the dimming curve, the colour temperature mixing law and RGBWAF scaling from the driver profile, an optional voltage-drop gradient along the tape, LED pitch, chip layout (warm and cool alternating on SMD tunable white), COB, and diffuser transmission and blur as a function of diffuser type and LED-to-diffuser distance.
3. The colour pipeline: XYZ to the display (P3 when the screen supports it, sRGB otherwise) with gamut mapping and tone mapping; fixed exposure presets (night-adapted, evening, day) plus a manual setting; a false-colour luminance view; and lux readouts.
4. Validation against analytic cases (energy conservation, a uniformly lit box, falloff from a line source) and golden images with tolerances.

Done when: the engine meets the frame-time budget in the test plan and the stage-close checklist passes.

---

## Stage 8: Hallway, mounts and tapes

1. A parametric hallway (length, width, height, end walls open or closed) with the R11 materials, adjustable by preset and by reflectance.
2. The mount editor for R11: shadowline height with up, down or both; wall channel height; per side, with a mirror toggle; presets with small diagrams. Each mount sets its tape type, density or COB, diffuser, profile depth, length and DALI address.
3. Cameras: an eye-level walk view, orbit, and presets (down the hall, at the wall, and close up on the channel to judge dots).
4. The A/B view: two set-ups side by side, driven by the same devices.
5. The visualiser follows the simulator in every output mode, labelled as a prediction when hardware is driving.
6. Visual regression tests for each preset.

Done when: the stage-close checklist passes.

---

## Stage 8b: Rate guard

The owner chose on 2026-11-18 to stop patching the rate guard and give it a stage of its own. Each round in Stage 6 found new cases where the guard and the trace checker date one hard step differently, by where the samples fall. This stage changes how a hard step is dated, not the rule's limits: one swing a second by default, never more than three, and Panic is never delayed.

1. A design in a new ADR, approved before code: each hard step is dated as the range of times the rule could give it and counted once, the same way in the guard (`src/safety/rate`) and in the trace checker the property tests use. ADR 0016's Consequences suggest this.
2. Close S5-P1 (High): two swings in a second on DT8 hardware the governor has never seen.
3. Close S6-P13, S6-D18-1, S6-D18-3, S6-D18-4, S6-D18-5 and S6-P14 to S6-P16. Each counterexample becomes a fixed example in its property.
4. End the refusals that ADR 0016 lists under Consequences where the new dating allows it, and record any that stay.
5. Unit tests for the branches in `legs.ts` and `trace.ts` that only the property tests reach, so `src/safety` keeps a margin over its 95% branch target.
6. `pnpm mutate` on `src/safety/rate`: kill or explain each survivor, including the 57 Stage 5 mutants that only the old checker killed.

Done when: the stage-close checklist passes, `dali-reviewer` and `security-reviewer` sign off, and two `PROP_RUNS=1000` passes with fresh seeds find nothing.

---

## Stage 9: Scenes, sequences and effects

1. A scene library: named looks per device (level plus colour) stored in the app; written to and read from the drivers' 16 scene slots with a slot map and verification; recalled by address, group or broadcast. A scene can carry its own fade: DALI keeps one fade time per driver, not per scene, so the app sets the driver's fade just before the recall.
2. Sequences for R5, such as off to 20% at 2700 K over 25 minutes. Plans use the drivers' fades first (extended fades up to 16 minutes) and chain steps beyond that, with a preview of every frame and its time. Built-in night presets.
3. An effects engine for R4 with the effects chosen in research (for example breathe, drift, swell, warm shift, two-tone across addresses, accent tint). Parameters as sliders, a bus budget meter per effect, the rate guard, and choreography across more addresses than the bench has drivers, for set-ups in the visualiser.
4. Export a design as a table an integrator can read (CSV and JSON: time, address, command, values, fade).
5. Background timing per S5, with a test that runs a long sequence in a hidden tab.

Done when: the stage-close checklist passes and `dali-reviewer` signs off.

---

## Stage 10: Switchgear

1. Check `docs/research/switchgear.md` and fill any gaps.
2. An IEC 62386-301 event engine (pressed, released, short press, double press, long press start, repeat and stop, stuck, free) with its four timers, driven by pointer, touch and keyboard.
3. Plates: generic 1, 2 and 4 button drawings following each provider's layout, with LED feedback.
4. Behaviour presets per provider from the research, and a mapping editor (event to action: toggle, scene, dim up or down on hold, sequence, effect).
5. The app acts as the application controller. Actions go through the engine and the governor to the current output target, and switch events show in the console.

Done when: e2e tests cover every event type and the stage-close checklist passes.

---

## Stage 11: Hardening, independent review, going public

1. Start in a fresh session. Run the `security-reviewer` subagent over the whole repo against `docs/THREAT_MODEL.md`, not a diff, and walk the threat model yourself as well.
2. Fix the findings, and log anything accepted with its reasons.
3. Supply chain: audit dependencies and licences, generate a CycloneDX SBOM, and check every action pin.
4. Release v0.1.0: a CI-built artefact with its SHA-256 and a build provenance attestation, and README steps for the client to build from source and to verify a release.
5. Ask me which licence to use (suggest Apache-2.0) and whether to make the repo public. Only after my yes: add the licence, make it public, turn on secret scanning and push protection, and add the `main` ruleset if Stage 0 couldn't.

Done when: there are no open high or critical findings, the release is published, and I've confirmed.

---

## Stage 12: Hardware day

Run whenever the hasseb arrives, once Stage 4 is merged.

1. Work through the hardware-day checklist in `docs/TEST_PLAN.md` section 10, with the server running and the bench powered. Part 1 comes first, before the bench is wired: it includes the hasseb's report descriptor, which decides whether a WebHID transport is possible.
2. Record the facts in `docs/research/da5-l.md` and `docs/research/hasseb.md`: the report descriptor, firmware version, C5 presentation, assigned colours, colour temperature limits, physical minimum, fade from off and measured throughput.
3. Run Both mode through the test plan's comparison set. Fix differences in the simulator's profiles, not with special cases for hardware.
4. Calibrate fade timing, colour mixing and low-level steps, optionally with lux and colour temperature readings from a meter entered by hand.
5. Write the gear safety profile to both drivers and verify it.
6. Decide with the owner whether to build the WebHID transport, from what part 1 found.
7. Work through part 8 of the checklist: what the rate guard rests on. Stage 8b left the Hardware and Both targets trusting nothing about the drivers (ADR 0019 amendments 1 and 2), as a holding position until the real DA5-L could be read. Bring the simulator's profile into line with what the driver does, then relax each hardware rule that a read-back supports, each by its own ADR with property tests.

Done when: the divergence log is clear or explained, and the stage-close checklist passes.
