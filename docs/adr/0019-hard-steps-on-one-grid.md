# ADR 0019: Hard steps read on one grid, dated as a range and counted once

Status: proposed

Date: 2026-11-20

## Context

ADR 0015 and ADR 0016 date a hard step at one moment: the latest sample from which the change is still above 2, at the first sample that finds it. Both parts depend on where the samples fall. The guard samples a fade every 10 ms from the start of each segment. The checker samples every 25 ms from wherever its last recording stopped. They share only the plan breakpoints. Stage 6 taught the guard, case by case, every other date the checker's samples could give (`spanEarly`, `spanLate`, `found`, `mustUntil`, `joinLo`, `joinHi`, `border`), and each case opened another. On 2026-11-18 the owner chose to stop patching and give the guard this stage.

Stage 8b began by reproducing the open findings before changing anything. What that showed:

- **S6-D18-1** (a slow lead-in, a fast creep, then a fast fade, with a drop 1 s or 2 s later): the guard misses 336 of 414,288 traces in a sweep of that family.
- **S6-P14** reproduces from its seed. In a sweep of its shape with the checker's samples 3 to 24 ms out of step with the guard's, the guard misses 486 of 50,130.
- **With both sides reading the same sample times, the same sweeps give 0 of 828,576 and 25 of 50,130.** Nothing else was changed for that run. The 25 that remain come from the guard's own border logic, which was tuned for samples it no longer has.
- **S6-D18-3 and S6-D18-4** did not reproduce in sweeps aimed at them (38,880 two-channel traces and 4,320 traces of a short fade, a pause and a step). **S6-D18-5** was reasoning only. They have no fixed case. The new properties below cover their ground.
- **S6-P13** is a false alarm in the checker from the same cause: one fade from off, dated 100 ms apart on two channels.
- **S6-P15 and S6-P16**: the seeded 1,000-run passes were still running when this was written. Their counterexamples go in as fixed cases when they finish, and if either is not a dating fault it is reported before the build goes on.
- **S5-P1** is a different fault, diagnosed below.

The reproduced cases are in `tests/properties/hard-steps.test.ts`, marked as failing until this ADR is built.

The plan approved for this stage had the guard work out, from its own samples, the range of dates any 25 ms reader could give. The sweep result changes that. The dates differ because the two readers look at different moments, so the first step is to fix the moments, and the range is kept for what is left.

## Decision

### One grid, which is part of the rule

- The rule reads the light at fixed times: every whole 25 ms of the clock, every breakpoint of every unit's output plans, and 0.001 ms before each breakpoint. Every trace in the room (each channel, each address's luminance and the room's sum) is read at all of those times.
- The guard predicts on that grid. The checker records on it. Two readers of the same output then see the same samples, wherever a recording starts or stops.
- This replaces the guard's 10 ms samples inside a segment and the checker's 25 ms steps from its last recording. SPEC S3.3 says so.

### The exact reading

- The rule is the one ADR 0015 and ADR 0016 state: instant steps above 2 within 50 ms, fast spans above 2 within 0.7 s, the fast leg from where its fast movement began, the folds and the joins. On the grid it gives each hard step one date.
- The checker reads it without margins, as now.
- The guard reads it the same way, with its own code. On the same output this reading gives the checker's hard steps at the checker's dates. The two still share no code.

### The cautious readings, and the range

The prediction is not always the output to the millisecond: a frame can go out a little later than judged, and on a real bus it will. A date can move by hundreds of ms when a sample falls either side of the moment a change passes 2. The guard therefore reads its prediction more than once:

- with its margins, as now: ratios 1% lower, windows 40 ms longer, the 0.7 s fade test 5 ms longer;
- with the grid shifted by 8 ms and by 17 ms.

Each reading gives each hard step a date and an extent: from its date to the last sample that was part of it. Hard steps from different readings of one trace are the same hard step when they go the same way and their extents overlap. That hard step's date is a **range**, from the earliest date any reading gives it to the latest. A hard step that only a cautious reading finds counts too, with its own range.

### Counted once, between the nearest ends

- A range is one event. Two hard steps are too close when the later one's earliest date is less than the window (plus the guard's 40 ms) after the earlier one's latest date. The windows do not change: 2 s at an address and 1 s in the room.
- A refusal's retry time is counted from the earlier step's latest date.
- A hard step is new when the prediction without the transaction has no hard step whose range overlaps it. Each old one stands for one new one at most, as now.
- Merging an address's channels takes the hull of ranges that go the same way and overlap or lie within 60 ms. A merge can no longer drop a date.
- The RESET pair, the pending OFF and the extra events for gear in an unknown state work on ranges. An extra event is a range of one moment.
- Legs and reversals keep single times, read on the same grid with the same readings united as `uniteTimes` does today.

The checker has one reading, so each of its hard steps has one date and it tests the plain window. The question the plan left for this gate, whether the checker should also measure between nearest ends, no longer arises.

### What goes

`spanEarly`, `spanLate`, `spanLow`, `spanFound`, `found`, `mustUntil`, `exactPrev`, `joinLo`, `joinHi` and `border` in `src/safety/rate/legs.ts`, `HardDate.border`, the border handling in `mergeDirected`, and the constants `SPAN_WINDOW_MS`, `SPAN_SURE_MS`, `SPAN_MARGIN_MS`, `FOUND_MS` and `RULE_STEP_MS`. `TraceEvents.hard` becomes a list of ranges.

### S5-P1: a level and a colour fading together on gear whose colour is not known

The counterexample, replayed: a temporary colour is loaded on a DT8 driver, a rescan follows, and DAPC 255 brings the colour in by automatic activation. Two seconds later one transaction loads a new colour and sends a DAPC with a 707 ms fade. The level falls while the colour fades, so the white channel falls, red and blue rise and then fall, and the address makes three legs in a second.

Two faults, both in `src/safety/governor.ts`:

1. **A rescan rebuilds the shadow's unit and drops what the shadow knew of the colour.** `modelAddress` makes a fresh unit with the default colour and no pending temporary colour, but leaves `colourKnown` as it was. In the counterexample it was already false. Had the colour been set earlier in the session it would have stayed true, with the shadow's colour wrong.
2. **With the colour unknown, the guard counts one leg and one hard step for a transaction.** That is right when only the level moves or only the colour moves, since every channel then goes one way. It is not enough when both move over a fade: each channel can turn once, at its own moment.

Decision:

- A scan that models DT8 gear makes its colour unknown, and forgets which parts of a temporary colour this session has set.
- On hardware, while a DT8 address's colour is unknown, the guard refuses any light change that could move its level and its colour together. A temporary colour may be pending on gear the app did not set up, and automatic activation brings it in with any level command, so that is every level command except OFF, by short address, group or broadcast.
- What still goes: OFF, and a whole temporary colour followed by ACTIVATE while the level is steady. That makes the colour known, and everything is predicted from then on.
- The refusal says to set the driver's colour first.
- `lowerCeiling` already falls back to OFF when its hold is refused, so lowering the ceiling on such gear switches it off. That is the cautious side of a comfort feature.

## Consequences

- The four refusals ADR 0016 lists under Consequences came from one hard step counting as two dates. Counted once, a hard step no longer conflicts with itself. All four are expected to go. A property test checks each, and any that stay are recorded here.
- A change before or after a hard step with a wide range is judged against the nearer end, as it is against the nearer border date today.
- The guard reads four times at 25 ms where it read once at 10 ms, so about 1.6 times the samples. The radiosity and the UI are not on this path. `judge` is timed before and after.
- On hardware, a DT8 driver whose colour is unknown takes OFF or a colour before it takes a level. That is every DT8 driver after a connect or a rescan. The playground's Apply sends the colour and ACTIVATE first in that state. If that needs a change in `src/engine`, it is made in this stage and tested.
- Reading the colour and the pending temporary colour in the scan would make the colour known from the start. It depends on answers the DA5-L has not been seen to give, so it is a hardware-day item, not part of this stage.
- S4-R9 (the shadow assumes automatic activation is on) is unchanged.
- The shifted readings sample the timing differences. They do not prove cover for every one. The properties below are aimed at that.
- New and changed tests:
  - The reproduced cases become plain tests, and S5-P1, S6-P14, S6-P15 and S6-P16 go into their properties' `examples`.
  - Containment: on made-up traces, with the checker's grid shifted by 0 to 25 ms, every hard step the checker dates lies inside a guard range.
  - The differential property gains two-channel addresses whose channels cross the 2% floor apart, lead-ins and creeps up to 0.8 s, steps of 1.96 to 2.04, and shifted grids.
  - A property that the guard's exact reading and the checker give the same dates on the same samples.
  - Governor tests for the colour rule: a level command refused, OFF allowed, a colour and ACTIVATE allowed at a steady level and refused during a fade, a rescan that makes the colour unknown, and the ceiling's OFF.
  - The fixed cases in `spans.test.ts`, `edges.test.ts` and `hard-steps.test.ts` that pin border dates are rewritten for ranges.
- ADR 0011, ADR 0015 and ADR 0016 each get a line pointing here.

## Alternatives considered

- **Work out the range from one set of samples** (the approved plan's first form). The rule's later choices (which span a movement joins, what folds) depend on the earlier dates, so the range of one step feeds the next. That is the path Stage 6 was on.
- **Keep both sample sets and widen the margins.** The dates move by up to 0.7 s, so no margin short of that covers them, and a margin that wide refuses ordinary use.
- **A rule in continuous time, with no samples.** The date still jumps at the moment a change passes 2, and the checker would need the same exact arithmetic on the plans, which makes it less independent.
- **The shared grid alone, with no cautious readings.** Enough on the virtual clock, where the prediction is exact. It leaves nothing for a bus that sends a frame a few ms late.
- **S5-P1: count three or more legs for such a transaction.** At one swing a second that is a refusal by another name, and the count has no firm bound with five channels.
- **S5-P1: carry the shadow's colour across a rescan.** It keeps a colour the session set, but a scan is run because something may have changed, and the colour is not read back.
