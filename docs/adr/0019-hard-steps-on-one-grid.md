# ADR 0019: Hard steps read on one grid, dated as a range and counted once

Status: accepted (approved by the owner on 2026-11-20)

Date: 2026-11-20

## Context

ADR 0015 and ADR 0016 date a hard step at one moment: the latest sample from which the change is still above 2, at the first sample that finds it. Both parts depend on where the samples fall. The guard samples a fade every 10 ms from the start of each segment. The checker samples every 25 ms from wherever its last recording stopped. They share only the plan breakpoints. Stage 6 taught the guard, case by case, every other date the checker's samples could give (`spanEarly`, `spanLate`, `found`, `mustUntil`, `joinLo`, `joinHi`, `border`), and each case opened another. On 2026-11-18 the owner chose to stop patching and give the guard this stage.

Stage 8b began by reproducing the open findings before changing anything. What that showed:

- **S6-D18-1** (a slow lead-in, a fast creep, then a fast fade, with a drop 1 s or 2 s later): the guard misses 336 of 414,288 traces in a sweep of that family.
- **S6-P14** reproduces from its seed. In a sweep of its shape with the checker's samples 3 to 24 ms out of step with the guard's, the guard misses 486 of 50,130.
- **With both sides reading the same sample times, the same sweeps give 0 of 828,576 and 25 of 50,130.** Nothing else was changed for that run. The 25 that remain come from the guard's own border logic, which was tuned for samples it no longer has.
- **S6-D18-3 and S6-D18-4** did not reproduce in sweeps aimed at them (38,880 two-channel traces and 4,320 traces of a short fade, a pause and a step). **S6-D18-5** was reasoning only. They have no fixed case. The new properties below cover their ground.
- **S6-P13** is a false alarm in the checker from the same cause: one fade from off, dated 100 ms apart on two channels.
- **S6-P16** reproduces from its seed and is not a dating fault. A driver seen fading in its scan is gear in an unknown state. A group DAPC 0 started a 2.8 s fade to off, and the guard counted that as a hard step when it was sent. The light made the hard step 2.8 s later, when the fade ended and the gear switched off, and a level sent 1.4 s after that passed. It is decided below.
- **S6-P15** reproduces from its seed on the simulator target: `rgb 1 118 0 0 w 15`, then `level 1 26% fade 300ms` three times, gives two hard steps on one channel. It is not diagnosed further. On the simulator target the guard predicts the same plans the checker records, so it is expected to be a dating fault, and that is checked when the grid is built. The counterexample is saved in `tests/properties/s6-p15.counterexample.json`.
- **S5-P1** is a different fault, diagnosed below.

The reproduced cases are in `tests/properties/hard-steps.test.ts`. Each failed before this ADR was built and passes now.

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
- The RESET pair, the pending OFF and the extra events for gear in an unknown state work on ranges.
- Legs and reversals keep single times, read on the same grid with the same readings united as `uniteTimes` does today.

The checker has one reading, so each of its hard steps has one date and it tests the plain window. The question the plan left for this gate, whether the checker should also measure between nearest ends, no longer arises.

### Gear in an unknown state: the hard step can come at any time in its fade (S6-P16)

- On hardware, a light change the shadow cannot predict counts as a leg at the moment it is sent, as now. Its hard step is a range: from that moment until the gear may have stopped moving, which is ADR 0016's time (its longest fade, plus 100 ms).
- The next change to that gear, and in the room, is then measured from the end of that range. Today it is measured from the command.
- An OFF is a range of one moment, since it takes effect at once.

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

- The four refusals ADR 0016 lists under Consequences came from one hard step counting as two dates. Counted once, a hard step no longer conflicts with itself. All four were expected to go. Three did and one stays: see "What the build changed and found".
- A change before or after a hard step with a wide range is judged against the nearer end, as it is against the nearer border date today.
- The guard reads four times at 25 ms where it read once at 10 ms, so about 1.6 times the samples. The radiosity and the UI are not on this path. `judge` is timed before and after.
- On hardware, a DT8 driver whose colour is unknown takes OFF or a colour before it takes a level. That is every DT8 driver after a connect or a rescan. The playground's Apply sends the colour and ACTIVATE first in that state. If that needs a change in `src/engine`, it is made in this stage and tested.
- Reading the colour and the pending temporary colour in the scan would make the colour known from the start. It depends on answers the DA5-L has not been seen to give, so it is a hardware-day item, not part of this stage.
- On hardware, gear in an unknown state takes its next hard change 2 s after its last fade could have ended, not 2 s after the command. With a long fade time set, that is a long wait. A scan once the gear settles models it and ends the wait. OFF always goes.
- S4-R9 (the shadow assumes automatic activation is on) is unchanged.
- The shifted readings sample the timing differences. They do not prove cover for every one. The properties below are aimed at that.
- New and changed tests:
  - The reproduced cases become plain tests, and S5-P1, S6-P14, S6-P15 and S6-P16 go into their properties' `examples`.
  - Containment: on made-up traces, every hard step the checker dates lies inside a guard range. (Planned with the checker's grid shifted by 0 to 25 ms. It holds on the rule's grid: see S8b-2 below.)
  - The differential property gains two-channel addresses whose channels cross the 2% floor apart, lead-ins and creeps up to 0.8 s, and steps of 1.96 to 2.04. (Planned with shifted grids too: see S8b-2 below.)
  - A property that the guard's exact reading and the checker give the same dates on the same samples.
  - Governor tests for the colour rule: a level command refused, OFF allowed, a colour and ACTIVATE allowed at a steady level and refused during a fade, a rescan that makes the colour unknown, and the ceiling's OFF.
  - The fixed cases in `spans.test.ts`, `edges.test.ts` and `hard-steps.test.ts` that pin border dates are rewritten for ranges.
- ADR 0011, ADR 0015 and ADR 0016 each get a line pointing here.

## What the build changed and found

The design above is what was approved. Building it changed some details and found two new things. Each is listed here so the record matches the code.

### Dating

- **An address's channels are merged inside each reading, before the readings are united.** The Decision says the merge takes the hull of ranges that overlap or lie within 60 ms. Ranges that overlap can still be two hard steps: two channels stepping the same way 290 ms apart, each with a wide range. Each reading therefore merges its channels as the rule does, and gets one date for each hard step. The readings are then united into ranges.
- **Two hard steps of one reading are never one.** Where a group of overlapping hard steps holds more than one from a reading, it gives as many ranges as the reading with the most, around that reading's dates. The guard then never counts fewer hard steps than any one reading, and every date of every reading lies in a range. The exact reading is one of them, so on the rule's grid the guard has every hard step the checker has, inside a range.
- **Extents within the 40 ms time margin count as overlapping.**
- **The reading with every change made at once (ADR 0011) is one more reading.** On hardware it is united with the others, where the governor used to unite two predictions.
- **Legs and reversals** from readings on grids out of step are the same event within 30 ms.
- **The guard leaves out grid times at which nothing can move**: no unit is in a fade or identifying. It keeps the grid time after each breakpoint. Left out, a time would repeat the sample before it and change no date. A property checks on the simulated bench that the guard's exact reading and the checker give the same legs, hard steps and reversals at the same dates. It found the first form of this wrong: an identify toggle lands a rounding error after its breakpoint, and the guard saw it 500 ms late.
- **A fade longer than 20 s is read at every k-th grid time**, 800 times at most. Without that a 16 minute fade costs 38,400 samples a judge. Such a fade ran 0.7 s or longer, so nothing in it is fast, and a fast fade that crosses it brings the whole grid. Its legs and reversals are dated to the nearest sample kept, as they were before this ADR with 400 samples a segment.
- **A judge is timed** at 0.35 ms with no fade (2.35 ms before), 2.5 ms with a 2 s fade (3.4 ms before), 8.2 ms with an 11 s fade (5.2 ms before), and 8 to 11 ms for fades of 16 s to 90 s (4.9 ms before), on the two-driver bench.
- **S6-P15 was a dating fault**, as expected. Its counterexample passes and is an example in the console property.
- **S6-P13, S6-D18-3, S6-D18-4 and S6-D18-5** have no reproduction. On the rule's grid the guard's exact reading is the checker's reading, which two properties check (made-up traces, and the simulated bench with fades of up to 4 s), and which `dali-reviewer` compared line by line. The two read the same samples for fades of up to 20 s. Past that the guard's grid is thinned, as the item above says.

### The refusals ADR 0016 listed

Three of the four are gone, and fixed tests hold each:

- a small fast change, then a fast fade that passes 2 (S6-P10): one hard step when the fade starts within 0.64 s;
- an instant step of 1.98 to 2.02 after a small fast change (S6-S17-1): one hard step;
- a leg of 695 to 705 ms whose fast movement began before its span (S6-P8): one hard step.

One stays. A movement that starts 0.66 to 0.7 s after the last span is one hard step to the rule, which joins it, and two to the guard (S6-P12, and the first case above at 0.66 to 0.7 s). A cautious reading joins a movement to the last span only with the 40 ms margin to spare, since a frame a little late would put it past 0.7 s. The second change then waits 2 s at the address and 1 s in the room.

### Gear in an unknown state

- **An OFF ends the range of every earlier change to the gear it reaches.** The range then ends at the OFF, or 0.8 s after the change if that came first. Later than 0.8 s the fade was slow, and the only hard step left in it was the switch off at its end, which the OFF is. An OFF therefore waits at most 2.84 s after a change to such gear (2.04 s before this ADR), and not for the whole fade.
- **A scan that models the gear ends its range** at the scan, since the gear was at rest then. A scan that finds no gear at an address ends its range at the scan too: one lost reply can make gear look absent.
- **Gear the inventory has not found** is gear in an unknown state too, with the longest fade DALI allows.
- **An event is kept while its range can still matter**, not for 7 s from the command.
- **A refusal names the unknown gear first**, when both that rule and the hard step window refuse a change.
- The ceiling's second pull-down on colour gear, and a change to other gear after a scan clears unknown gear, wait about a second longer than before. The tests that pinned those times are updated.

### S5-P1

- **A level waits for the colour's fade.** A whole colour with ACTIVATE makes the colour known, but it then fades in from a colour the shadow did not know, for as long as the gear's fade. A level in that time would fade with it. The level therefore waits for the gear's longest fade and 100 ms after the ACTIVATE. A colour and a level in one transaction are refused for that reason.
- **A colour brought in while the gear is off is no light change**, so it is no leg and no hard step. The first Apply to gear that is off then needs no 2 s wait.
- **Apply is split in the engine** (`src/engine/engine.ts`) when the governor does not know the colour: the colour with ACTIVATE, then the level once the governor takes it, for up to 5 s. An Apply with a level and no colour is refused, and the refusal says to set the colour first.
- **A refusal that no wait can lift gives no time to ask again.** The ceiling's hold then goes straight to its OFF.
- The saved counterexample no longer fails before this rule is applied: the range for gear in an unknown state already refuses its second transaction. The rule is needed for the same transaction sent a few seconds later, and the governor tests cover that.

### S8b-1: a scene recall has the same fault (new)

The scan reads a scene's level and not its colour. A recall on DT8 gear fades the level and a colour the guard does not know together, with the colour known beforehand or not. On the simulated bench a recall with a 1 s fade made three legs at one address in a second, and the guard counted one.

Decision: on hardware, GO TO SCENE to DT8 gear goes only when the shadow models the gear with no fade time of any kind, and no fade setting is sent in the same transaction. With no fade both change in one moment, which is one leg and one hard step. Otherwise it is refused, and the refusal says why. Reading scene colours in the scan would lift this, and is a hardware-day item with the colour read-back.

This goes beyond what was approved. It is the cautious reading of "any light change that could move its level and its colour together", and it is the owner's to relax.

### S8b-2: grids out of step (new, open)

The Decision's tests list had the checker's grid shifted by 0 to 25 ms in the containment and differential properties. Those do not hold for every shift.

- On the rule's grid, which is what the bench reads, a sweep of 6,000 traces aimed at the borders had 1,918 the checker flagged, and the guard flagged every one. The properties pass at 10,000 cases each.
- With the checker's grid 1 to 24 ms out of step, the guard missed 0 to 3 of about 1,920 flagged traces at each shift, about 1 in 2,000 overall. In each one looked at, the rule on the shifted grid dated one movement as two hard steps: a span and an instant step it put just over 100 ms apart.
- This cannot happen in the simulator target, where the guard and the checker read one clock. On hardware it is normal running: every frame goes out some ms off the judged time. What it costs there is one movement that the rule would count as two hard steps and the guard counts as one. The 8 ms and 17 ms readings sample that and do not cover every case, as Consequences says.

The properties therefore assert on the rule's grid, and keep two out-of-step cases that are covered as examples. Covering every shift would need the guard to work out the range from one set of samples, which is the path this ADR left. More shifted readings would lower the figure at a cost in time and not end it.

### What the reviews changed

`security-reviewer` and `dali-reviewer` both failed the stage as first built. Their findings are in `docs/SECURITY_FINDINGS.md` (S8b-H1 to S8b-I3). The ones that change this ADR:

- **A level goes only to gear that has been scanned** (S8b-D2). The colour rule as approved covered gear known to be DT8. Gear the app knows nothing of may be DT8 with a colour pending. On hardware a level command other than OFF is now refused for an address that has not been scanned, for unaddressed gear, and for a group or broadcast while the inventory is stale or unaddressed gear is present. The refusal says to scan. This reverses one line of ADR 0016, which let a level go to unscanned gear on its own for first light, and it is the owner's to relax.
- **A device type list with a lost reply is not read**, and the gear is then not modelled: the lost reply may have been the 8.
- **A masked colour does not make the colour known** (S8b-D1): 255 in a channel, or a colour temperature of 0 or 65535, leaves the gear's colour as it was.
- **A level after the ACTIVATE in one transaction is always refused** (S8b-L1), as the section above says.
- **A scene recall is held to no fade whatever level the scene holds** (S8b-D3), with the fast fade time counted as a fade (S8b-M1), and only while the level is steady.
- **Each command to gear in an unknown state is its own leg and hard step** (S8b-H1). One transaction of several used to count once.
- **Only an OFF that arrived ends a range** (S8b-D5), and only for gear it is sure to reach (S8b-L2).
- **A range carries its direction** (S8b-L4), and two hard steps of one reading never share a range whichever reading has the most (S8b-D6).
- **Apply's wait for the level ends on a stop, a panic or a newer level** (S8b-M3).

## Amendment 1: colour gear on hardware is gear in an unknown state

Status: approved by the owner on 2026-11-21.

The second review failed the colour rule again (S8b-R2 in `docs/SECURITY_FINDINGS.md`). The rule tried to make a DT8 driver's colour known by watching what the session sent: both parts, no masks, limits, COPY REPORT, groups, failed scans. Each fix left another way for the shadow's colour to differ from the gear's. Two findings showed the idea itself does not hold. A colour that becomes known still fades from one the shadow never had, so a later change joins a run the light did not make (S8b-R2-D1). And C5 gear presented as Tc has more colour than one ACTIVATE sets (S8b-R2-D2). The owner chose on 2026-11-21 to stop making the colour known.

### The rule

1. **On Hardware and Both, the colour of DT8 gear is never known**, until a later stage reads it back from the gear (a hardware-day item). Every light-changing command to such gear is then a change to gear in an unknown state, as the section above has it: its own leg and hard step at the address and in the room, with a range from the command to the end of the gear's longest fade and a 100 ms margin. The next hard step at that address waits 2 s from the end of that range, and the next in the room 1 s. The shadow's prediction for that gear is not used to allow anything.
2. **A level goes to DT8 gear only when no temporary colour can be waiting in it.** A level command with a temporary colour loaded brings the colour in by automatic activation, and a level and a colour fading together turn each channel at its own moment, which one leg does not cover. Nothing is waiting once an ACTIVATE has reached the gear for sure (sent without a fault, heard, and by short address, broadcast, or a group the gear is known to be in) and no command that loads a temporary colour has gone to it since. A connect, a scan, a SET TEMPORARY command of any kind, COPY REPORT TO TEMPORARY and a fault each make it "may be waiting" again. The ACTIVATE needs no colour loaded before it. The refusal reads: "A0 may hold a colour that is not activated, so set its colour before its level".
3. **A level and an ACTIVATE never go in one transaction** to the same gear, and each goes only while the other's range has ended. This is rule 1's window, stated for clarity: Apply sends the colour, waits, then sends the level.
4. **GO TO SCENE on DT8 gear stays as S8b-1 has it**: only with no fade time of any kind, on its own, with the level steady.
5. **An address whose level becomes known stays in an unknown state** until the command that made it known may have stopped moving, and for the hard-step window after that (2 s and the 40 ms margin). This is for all gear, not only DT8. It closes the level half of S8b-R2-D1: after GO TO LAST ACTIVE LEVEL, DAPC 180 and then DAPC 130 were read as one fall from a level the gear never had.

### What goes

The whole-colour test and its parts (S8b-D1), the wait for a colour's fade as its own rule, the colour temperature limits refusal (S8b-R2-M1), and `colourKnown` as something a command can set on hardware. COPY REPORT, masks, limits and the parts a gear reports no longer matter, since no colour is trusted. Kept from the reviews: the scan-before-level rule (S8b-D2), three tries before an address is empty and no level to an empty address (S8b-R2-H2), and the group rule for ACTIVATE (S8b-R2-L1).

### What it costs

- On hardware, one colour or level change to a DT8 address every 2 s plus its fade time, and in the room every 1 s plus that. With fade time 0 on the DA5-L that is about one change every 2.1 s for a tape, and the two tapes take turns about 1.1 s apart. Dragging a slider sends its last value when the wait ends.
- A colour and a level from Apply arrive at least 2.1 s apart.
- The simulator target is not changed, and neither is DT6 gear, apart from rule 5.
- Panic and OFF are not held by any of this. An OFF to such gear is still a hard step in the window, as it is now.

### Tests

The reproductions of S8b-R2-D1 (colour and level) and S8b-R2-D2 become fixed cases on the bench. The property generators get a real bench whose colour, pending temporary colour, last active level and Tc limits differ from the shadow's (S8b-R2-L2), since without it the properties cannot see this class of fault. Then both reviewers, `pnpm verify`, and two fresh `PROP_RUNS=1000` passes.

### What the build of amendment 1 found

- **The ceiling counts DT8 gear on hardware as every channel full.** The ceiling read the shadow's colour when it was known, and it is now never known. A dim mix is therefore held to the level a full mix would be. It is the cautious side for a comfort feature, and the owner's to relax (the session's own colour could be used for the ceiling alone).
- **The span of an event reaches the second copy of a command sent twice.** Gear acts on the second copy, so the shadow dates its change there, 100 ms at most after the first. The event and the shadow's hard step for one SET MAX LEVEL were counted as two, and the command was refused with no time to ask again. The join of two copies still uses the time of the last copy.
- **A level made known inside a transaction does not make the next command in it known** (rule 5 again).
- **The hardware check's step that lowers MAX LEVEL** sends its colour, level, SET MAX LEVEL and OFF one at a time, asking again while the guard holds each.
- **The refusal reads** "A0 may hold a colour that is not activated, so set its colour before its level".
- **A property aimed at the fault**: colours, parts of colours, levels, recalls and switch-offs from 0 to 3 s apart, on a real bench whose colour, waiting colour, Tc limits and last active level differ from the shadow's. It fails on the rule as it was within 205 cases and passes on this one.

## Amendment 2: on hardware the shadow allows nothing

Status: approved by the owner on 2026-11-21.

Amendment 1 stopped trusting the colour. The third review then failed the stage on the level (S8b-R3 in `docs/SECURITY_FINDINGS.md`): a rescan forgets what the gear did before it, QUERY ACTUAL LEVEL makes a level known in the middle of a movement, and a colour fade turns more than once. Three reviews have each found that some rule saying "this is known now" has a way round it. The shadow is a simulator's guess at gear that has not been on a bench yet. The owner chose on 2026-11-21 to stop using it to allow anything on hardware until hardware day.

### The rule

On the Hardware and Both targets:

1. **Every light-changing command, to any gear, is a change to gear in an unknown state.** It is its own leg and hard step at each address it reaches and in the room, with a range from the command to the end of that gear's longest fade and 100 ms. DT6 gear is treated as DT8 gear is under amendment 1. Whether a level or a colour is "known" no longer decides anything in the rate guard, so rule 5 of amendment 1 goes, and a scan or a query cannot make gear trusted.
2. **The shadow can still refuse.** Its prediction is read as before and its events are counted beside the events above. It cannot make a change count for less.
3. **One address at a time.** A transaction that changes light reaches one address, and goes only while no other gear may be moving, as the rule for gear in an unknown state already has it (ADR 0016). A group or broadcast level, or a scene to several drivers, is refused when it reaches more than one. Two drivers fading at once cross in the room at moments nobody can count. OFF is the exception, to any address, group or broadcast: it ends every fade it reaches.
4. **A level may fade. A colour may not.** With the colour steady, a level fade moves every channel one way, which is one leg, and its hard step can come at any time in its range. A colour fade can turn a channel more than once (S8b-R3-1), and so can a scene recall, so ACTIVATE, GO TO SCENE and the Tc steps go to DT8 gear only when the gear has no fade time of any kind (fade time, extended fade time and fast fade time all 0, as read in the scan, with none set in the transaction), and only while its level is steady. The refusal says to set the fade time to 0 first.
5. **A level still needs no colour waiting** (amendment 1, rule 2). Two additions. A scene recall or a Tc step changes the colour without using the temporary colour, so after one a colour may be waiting again, whatever the DA5-L does with the temporary colour on ACTIVATE (S8b-R3-4). And PROGRAM SHORT ADDRESS and SET SHORT ADDRESS forget what was read of every address, so no level goes until a rescan (S8b-R3-7).
6. **A scan ends a range only as the section on gear in an unknown state has it**, and a lost presence reply ends none until the scan has called the address empty (S8b-R3-6).

The simulator target is not changed. There the shadow is the gear.

### What it closes

S8b-R3-2 (the events are the governor's own record, which a rescan does not erase), S8b-R3-3 and S8b-R3-5 (nothing becomes known, and every small step is a leg and a hard step), S8b-R3-1 (no colour fades), S8b-R3-4, S8b-R3-6 and S8b-R3-7. S8b-R3-9 loses most of its reach, since colour changes no longer fade. S8b-R3-10 and S8b-R3-11 stay open as written.

### What it costs

- On hardware, about one light change every 2 s to an address plus its fade time, and 1 s plus that in the room, for every kind of gear. Dragging a slider sends its last value when the wait ends.
- No colour fades and no faded scene recalls on hardware. The fade time has to be 0 for a colour change.
- No group or broadcast level, and no scene across both tapes, on hardware. Each tape is driven on its own, about 1.1 s apart. This bears on Stage 9: sequences and effects will run in the simulator as designed and on hardware only at this pace.
- The ceiling keeps counting DT8 gear on hardware as every channel full.
- Panic is not held, and neither is OFF by rules 3 to 5. An OFF is still a hard step in the window, as it is now.

### How it is relaxed

Fact by fact on hardware day, each by its own ADR: once a read-back is shown to hold on the real DA5-L (the level after a fade, the colour, the fade bit in QUERY STATUS, what ACTIVATE does to the temporary colour), the guard may use it. Until then the rate guard on hardware rests on what the app sent and when, and on nothing the gear is assumed to have done.

### Tests

The third review's reproductions become fixed cases on the bench. The aimed property gets queries, rescans, groups and broadcast, addressing commands under the unlock, C3 and C4 tapes, a ceiling of 254 and the profile's alternatives for the temporary colour and the channel law (S8b-R3-8). Then both reviewers, `pnpm verify`, and two fresh `PROP_RUNS=1000` passes.

### What the build of amendment 2 found

- **A colour sent to gear that is off is an event too.** Whether the gear is off was the shadow's word. Switching a tape on from off with Apply therefore takes a colour, about 2.3 s, then the level.
- **The profile's writes at a connect are light changes**, so the first change after a connect waits them out, about 3.3 s on the bench.
- **A refusal names the gear being waited for** when one address is held only by other gear that may still be moving, and gives the time to ask again. Several addresses in one transaction get the older reason, with the first address named.
- **`Governor.markEmpty`**: the scan calls it when its last presence try went unanswered, and only then does an empty address end its ranges (rule 6).
- **The hardware check's MAX LEVEL step** sends a colour first. On a driver with a fade time set it is now refused with the reason, until the fade time is 0.
- **A RESET of gear that is off** still shows on and then off about 0.4 s apart. That is the RESET pair ADR 0015 accepts under the reset unlock, and this amendment does not change it.
- **The aimed property** fails on amendment 1's rule within 21 cases and passes on this one.
- **Fade settings count only as read back** (S8b-R4-1). The first build of this amendment still read the shadow's fade settings for gear a scan had modelled. Gear that ignores a SET FADE TIME would then fade where the guard thought it could not. On hardware the guard now uses a fade setting only as a query read it since it was last written, and the longest DALI fade until then. Apply, the console's fade writes to a short address and the hardware check follow a fade write with the two queries. A write to a group or to all cannot be read back.
- **An address is empty only on the scan's word** (S8b-R4-2). One lost presence reply no longer shortens its ranges, hides it from other gear, or takes it out of the colour rule.
- **No light change but OFF goes to a group, to all, or to unaddressed gear** (S8b-R4-D2). Rule 3 as first built let one through when it reached one address the scan had found. It also reached any driver the scan had not heard, with nothing counted.
- **Rule 4's premise is wrong for gear with a red channel** (S8b-R4-D1, open). A faded level there crosses the saturated-red line, which SPEC S3.1a counts as legs. Not settled in this build.

## Closing position (owner, 2026-11-22)

Four reviews each failed the stage on the Hardware target, each on less than the one before. What they found comes down to one thing: the simulator stood in for drivers that have not been on a bench, and for state the app has not read from them. The owner's position is that the answer is to find out what the hardware does and bring the simulator into line with it, not to add rules against guesses.

So the stage closes here:

- **The dating of hard steps**, which is what the stage was for, stands as decided above. It is exact in the simulator target and is not in question.
- **Amendments 1 and 2 stay as a holding position** for Hardware and Both. They cost nothing until the hasseb arrives, and they are known to refuse too much: no colour fades, no group or broadcast levels, one change about every 2 s. They are not the design for hardware. They are what the guard does until it has evidence.
- **No further rule is added.** S8b-R4-D1 (a faded level on gear with a red channel) is logged and not built: "no fades on colour gear" was withdrawn. The other open findings of the third and fourth reviews are logged for hardware day.
- **Hardware day settles it** (`docs/STAGES.md` Stage 12, `docs/TEST_PLAN.md` section 10 part 8). The hardware check reads back the driver's colour, temporary colour, level and fade settings, times its fades, and tries the faults. The simulator's profile is corrected to match. Each hardware rule a read-back supports is then relaxed by its own ADR, with property tests whose real bench differs from the shadow.

## Alternatives considered

- **Work out the range from one set of samples** (the approved plan's first form). The rule's later choices (which span a movement joins, what folds) depend on the earlier dates, so the range of one step feeds the next. That is the path Stage 6 was on.
- **Keep both sample sets and widen the margins.** The dates move by up to 0.7 s, so no margin short of that covers them, and a margin that wide refuses ordinary use.
- **A rule in continuous time, with no samples.** The date still jumps at the moment a change passes 2, and the checker would need the same exact arithmetic on the plans, which makes it less independent.
- **The shared grid alone, with no cautious readings.** Enough on the virtual clock, where the prediction is exact. It leaves nothing for a bus that sends a frame a few ms late.
- **S5-P1: count three or more legs for such a transaction.** At one swing a second that is a refusal by another name, and the count has no firm bound with five channels.
- **S5-P1: carry the shadow's colour across a rescan.** It keeps a colour the session set, but a scan is run because something may have changed, and the colour is not read back.
