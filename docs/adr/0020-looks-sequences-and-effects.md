# ADR 0020: Looks, sequences, effects and extra simulated drivers

Status: accepted

Date: 2026-11-22

## Context

Stage 9 builds R4 (effects), R5 (looks, scene slots, sequences and export), S5 (background timing) and the rest of R14.2 (simulated drivers beyond the bench's two). The owner approved this plan on 2026-11-22 and chose Fable for the stage in place of Opus.

Three things constrain the design:

- ADR 0019's holding rules for Hardware and Both. One address changes at a time, a colour changes only with no fade, and no light change but OFF goes to a group or to all. The owner's closing position on Stage 8b is that these stay until hardware day shows what the driver does.
- ADR 0005: a sequence or effect is checked against the guard when it is planned, and the guard still judges every step when it is sent.
- The words "scene", "sequences" and "Effect" already name other things in `src/light`, `src/dali` and `src/console`.

## Decision

### Owner decisions in planning

1. Extra simulated drivers are added on the Devices page, up to six drivers in total, and exist on the Simulator target only. On Hardware and Both a mount on such an address draws unlit with the "simulated only" chip, and a design step for such an address is skipped with a note.
2. All ten effects of SPEC R4.1 are built.
3. Looks, Sequences and Effects join the rail as Alt-7 to Alt-9. The rail is then full, so the Switches page of Stage 10 needs its own decision.
4. The hidden-tab proof for S5.3 is a 2-minute test in CI and a 30-minute run by hand (`pnpm e2e:hidden`), run once at stage close.

### Hardware and Both

Nothing in ADR 0019 is relaxed. Everything here works as designed on the Simulator. On Hardware and Both the governor refuses what the holding rules refuse, and the page shows the governor's reason. A plan is not checked ahead on those targets, and the page says so.

### No change to `src/safety`

The check at planning time is a dry run: the engine copies the simulated bench (`Simulator.fork`), builds a fresh governor with the live ceiling, swing limit and verified addresses, and runs the plan on a virtual clock. The first refusal comes back with the governor's own reason, which is how R4.2's "saying which limit" is met. The governor gains no new entry point.

### `src/design`

The pure core for this stage is `src/design`: looks and the slot map, sequences and their presets, the planner, the ten effects, the export, and the schema for stored records. The runner, the dry run and the scene operations are in `src/engine`, as `docs/ARCHITECTURE.md` plans.

### Slots

A slot's level is verified by QUERY SCENE LEVEL. No route is confirmed for reading back a slot's colour (`docs/research/dali.md` section 9), so the slot map marks a stored colour "assumed". Hardware day checks it.

### Night presets

SPEC R5.5 names one preset: off to 20% at 2700 K over 25 minutes. The others built here (a wind-down, a night light and sunrise) are additions of this stage, with values from `docs/research/effects.md`.

## As built

### Looks and slots

- A look is a name, an arc level, a colour (none, a colour temperature in mirek, or six RGBWAF channel levels with 255 for "leave alone") and an optional fade. Names are unique. A look is not tied to one device: the slot map holds, for each address and slot, the look's name and the level that was written.
- A store is one transaction: the colour loaded as the temporary colour, DTR0, SET SCENE and QUERY SCENE LEVEL. A look with no colour stores a temporary colour of MASK on colour gear, so nothing left waiting from before is stored by accident. A second transaction then leaves a temporary colour of MASK, which changes nothing when a later level command activates it. Without it, the simulator's gear brings the stored colour in at the next level command, because a store does not clear the temporary colour.
- A slot is `verified` when the level the driver reports, the level written and the look's level all agree, `mismatch` when they do not, `unlisted` when the driver holds a level the map does not know, and `empty` or `pending` otherwise. The engine's device view carries the sixteen levels as the governor last read them.
- The simulated drivers start afresh on a reload, so a slot written before a reload shows as a mismatch after it. That is the simulator being honest about what its gear holds, not a fault in the map.

### The planner

- A step becomes one row for each driver it reaches, or several when its duration is chained. A row is one change to one driver: the fade if it differs from the one this plan last set there, the colour loaded without ACTIVATE, then the level. Gear without automatic activation gets ACTIVATE before the level on the way up and after it on the way down, as Apply does (ADR 0013).
- The fades come from both tables. Where a standard fade time and an extended one are the same length, the standard one is used: it takes two frames to set and the extended one four. A duration under 50 ms is no fade. What is left at the end of a chain, under 100 ms, goes to the nearest fade.
- A fade from off starts at the driver's minimum level, and a fade to off runs to the minimum and ends on off.
- A group is planned for its members and broadcast for every driver, as rows to short addresses. A group or broadcast frame cannot carry a different level to each driver, and on hardware it cannot be read back.
- A plan is at most 5,000 rows. A step lasts at most 24 hours.

### The check and the run

- The check copies the bench, so it starts with no history: what the bench did in the last few seconds is not carried over. The copy's governor scans the copy first, which takes time on the copy's clock, so a fade in progress on the bench has ended by the time the plan starts on the copy. The guard still judges every row when the real run sends it.
- The first run loop waited out every refusal that came with a retry time. That let a plan of on, off, on, off through the check by spacing it out, and made the check's answer mean little. The check waits for nothing, and a real run waits at most 0.5 s in all for one row. A retry time that has already passed still costs 10 ms, so the waits always add up to the limit.
- A repeating effect is checked for the longer of 30 s and two periods. A fault that needs a longer build-up is left to the guard at run time, which stops the run.
- Stopping a run sends nothing. A repeating effect that is stopped leaves each light where it was in its cycle. Panic turns everything off, as always.
- On Hardware and Both a row goes through the engine's Apply, which sends a colour as its own change and reads fades back. Nothing is checked ahead there.

### Cost, measured

On an Apple M1 Pro in Node, with six simulated drivers (the bench's two and four more), while other tests were running:

- Checking two-tone across all six takes about 0.7 s. Checking a 25-minute fade on all six takes about 0.9 s.
- A minute of two-tone across all six, 60 changes, costs about 0.9 s of work in the worker: the governor's judgement of each change over its fade.

The check gives way to other work every 400 steps of its clock, so Panic is not held up by it.

### Effects

- Each effect is built as timed steps from its settings and the drivers it is aimed at, and planned by the same planner. A repeating effect returns to where it started, so its plan starts again each period.
- The ranges are the research's starting points. Three values have no source and are placeholders: six channel levels for one step of colour difference in accent tint, the mix of the two whites for "about 4000 K" on RGBWAF gear, and the filament curve of warm shift (the square of the fraction dimmed, in three steps).
- Sunrise reaches 30% by default, because the default ceiling is 39.5%.
- Breathe is a triangle wave. The softer turns the research describes, two extra commands a cycle, are not built.

### Simulated drivers

- An extra driver has an address and a light type and uses the default profile settings. Per-driver settings for the extras are not built: the settings editor still covers units A and B only.
- A change of the list rebuilds the bench as a settings change does: drivers that go are turned off through the governor, light changes are held for 2 s after, and the bench is scanned again.

### The bundle

- Devices, the Visualiser, Looks, Sequences and Effects load in one chunk when one of them is first opened (`src/ui/pages/later.ts`). With one such chunk the bundler keeps code shared with the entry in the entry. With two it split the entry into several files that load at start, which `e2e/bundle.spec.ts` forbids.
- The worker's checks on what the page sends are in `src/engine/protocol-in.ts`. While they sat in `protocol.ts`, the page's import of the message types pulled the checks on looks, sequences and effects, and with them the planner and the effects, into the first chunk.
- The entry chunk is 239 kB against 256,000 bytes.

### Four differences from the approved plan

1. **The hidden-tab proof.** The plan had a 2-minute test in CI and a 30-minute run by hand with `pnpm e2e:hidden`. Both exist, but neither can make a browser treat a tab as hidden: Playwright keeps every page focused and turns background throttling off, and the test cannot undo it. The tests hide the page as the app sees it, which covers the heartbeat, the watchdog and the run loop. What a browser does to a hidden tab's timers is a check by hand in a real browser, written out in `docs/TEST_PLAN.md` section 7.
2. **Extras have no settings of their own**, as above.
3. **A wall clock reaches the engine**, for the end-of-run report only.
4. **No change to `src/safety` was made.** `src/sim` gained `Simulator.remove` and the extra-unit builder, and `src/dali` the fade command builder moved from the console.

## Consequences

- R4, R5 and S5.1, S5.2 and S5.4 are built for the Simulator target. S5.3 is met in the tests as far as a test can show, and waits on the hidden-tab check by hand.
- On Hardware and Both the features are there and the holding rules of ADR 0019 refuse most of what they send. Hardware day's part 7 lists which sequences and effects run, and part 8 relaxes the rules.
- A run's clock stops while the page is suspended or the computer sleeps (S9-T1). The drivers finish the fade in hand and the run picks up late, without knowing. The report at the end gives the wall-clock time when it differs, from a wall clock the worker passes in for that alone. Making the run follow the wall clock would change the time the rate guard works in (ADR 0010), which is the owner's decision.
- S9-P1 is open: five transactions the governor allows and the trace checker faults, found by P-plan. Nothing in `src/safety` was changed.
- A stored colour in a slot is never verified. The slot map says "assumed".
- There are no console commands for looks, sequences or effects. Stage 10's switch mappings call the engine's `sceneRecall`, `runDesign` and `stopRun`.
- The rail is full at nine pages. Stage 10 has to decide where Switches goes.
- P-plan and P-effect cost about 3 s a case. At 10 cases each they add about 2 minutes to `pnpm coverage`. A 1,000-case pass of this file alone takes about 3 hours.

## Alternatives considered

- A `predict` entry point on the governor, to ask for a verdict without an approval. It would be exact where the dry run starts from a fresh history, but it changes `src/safety` for something the dry run and the judgement at send time already cover between them.
- Simulated drivers that follow the visualiser's mounts. Rejected by the owner: the bench would rebuild on every address edit.
- Extra drivers lit in Both. Rejected by the owner: it changes the hardware path, which nothing can test before the hasseb arrives.
