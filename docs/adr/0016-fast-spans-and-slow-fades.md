# ADR 0016: Fast spans, slow fades by the time they ran, and gear in an unknown state

Status: accepted

Date: 2026-11-18

## Context

ADR 0015 dated each instant step where it happens and kept "a fast leg is one hard step from its start". The review and the property runs after it found three gaps in how the rate guard tells a fast change from a slow one:

- **A fast fade inside a longer run (S6-R4).** A one-step nudge kept a run going, then a 200 ms fade by 8.9 times followed 0.9 s later. No 50 ms of the fade changed by 2, so it was not an instant step, and the run took over 0.7 s, so it was not a fast leg. Neither the guard nor the checker found a hard step.
- **Run length as a stand-in for fade time (S6-P5).** The guard judged a leg fast when its run took under 0.7 s. Another driver's step can split the room's run, and the tail of a slow fade then looks like a fast leg. The checker found hard steps the light never made, and the guard could refuse a change for one.
- **Gear in an unknown state moving with other gear (S6-P6).** On hardware, gear that was fading during its scan is not modelled. A broadcast moved it together with modelled gear, their fades crossed at times the shadow did not know, and the room made four legs in 0.7 s while the guard counted one.

The owner chose to fix all three in Stage 6. The fix also found that the checker's channels could date one fast rise from off differently, because each crosses the 2% floor at its own moment (S6-P7).

## Decision

### Slow and fast changes

- **A change is slow when it came only from fades that ran 0.7 s or longer.** A fade runs until it ends or a later command replaces it, so a long fade cut short counts by the time it ran. The guard asks for 0.705 s, the fade margin more, so a fade the gear runs a few ms short of 0.7 s is fast to it, and fade time 1 (707 ms) is still slow (S6-D16-6). A new plan's start, the switch off at the end of a fade to off, anything during identify, and a fade that ran under 0.7 s are fast.
- The guard reads this from the shadow's output plans (`slowTest` in `src/safety/rate/trace.ts`) and tags each sample interval. A room interval is slow only if it is slow for every unit. The checker reads the plans it recorded, with its own code.
- Slow change is left out of fast legs and fast spans, whatever the run's length. This replaces "a leg that took under 0.7 s". The instant step test does not look at it: a change above 2 within 50 ms is a hard step even inside a slow fade (S6-D16-5).

### Fast spans

- **Fast change above 2 within 0.7 s is a hard step**, with output below 2% counting as 2%, as before. It is dated at the latest sample from which the change is still above 2, then walked back over fast movement from below the 2% floor, within the window.
- **Spans that follow on are one.** A span joins the last one when it starts at or before the last sample that was part of a span, or within 0.7 s of where the last one began.
- **On the margin the guard counts more.** It counts a span it might see (above 2 × 0.99 within 745 ms), but only a span it is sure of (above 2 / 0.99 within 645 ms) carries a movement on to join a later one, and the second clause joins only within 650 ms. A span on the border therefore never joins two that the checker would count.
- **A span the guard counts on the border also counts at the latest date the rule could give it.** The guard dates a span where it first might see it, which on a slow lead-in can be several hundred ms before the rule itself first finds change above 2 within 0.7 s. Until the rule must have found the span (above 2 / 0.99 within 650 ms, S6-S18-3), the guard follows the latest sample from which the change is above 2 within 0.7 s. When that is more than the 40 ms time margin after the span, it counts as a hard step too, so a hard step on either side is judged against the nearer date (S6-D16-1). A sweep of 158,112 such traces finds no breach the checker sees and the guard does not.
- **And at the earliest date the rule could give it.** The rule finds a span as soon as the change from the lowest fast level in the window passes 2, and if its sample falls at that moment, it dates the span at the last sample at that level. A small fast change earlier in the window can put that date up to 0.7 s before the guard's (S6-P10). When the guard counts a new span and the change that found it was a fade, it takes the last sample at the lowest fast level in its 745 ms window, walked back as before, and counts it as a hard step too when it is more than 40 ms before the span. After an instant step no sample falls between its two sides, so the rule finds the span at its far side, as the guard does, but with no margin: when the step alone is near 2, the rule can still date the span before a small change earlier in the window. There the guard takes the latest sample from which the change is surely above 2, less 25 ms since the checker's own last sample before it can be that much earlier (S6-S18-1), or the lowest fast level if there is none (S6-S17-1). Only a step by more than the margins allow a fade takes this path, since a plan's start in a fade has two samples a moment apart too.
- **A movement the guard joins can be a span of its own to the rule.** The guard sees a movement as soon as it might be a span, and at that moment its date can be within 0.65 s of the last span, so it joins. The rule, sampling every 25 ms, can first find it later, when its date has moved more than 0.7 s on, and count it on its own (S6-P12). The rule surely finds a span within 25 ms of a sample at which the change is above 2 / 0.99 within 650 ms, and has found one there once that time has passed. The 650 ms is 0.7 s less the checker's 25 ms steps at both ends of its window (S6-S18-3), and the same test ends the search for a span's late date above. Until then, while the latest sample from which the change is above 2 within 0.7 s is more than 0.7 s after the last span's earliest date (less the 40 ms margin) and after the last place the rule must have found a span, the guard keeps the range of those dates, and counts both ends as hard steps.

### A leg's hard steps

- **A fast leg is one hard step from where its fast movement began**: fast change above 2 from end to end in under 0.7 s. It is dated at the sample before the leg's first fast change, so every channel of one fade dates it alike (S6-P7).
- **On the border of 0.7 s, both.** A leg that took under 0.705 s with fast change above 2 × 0.99 may be a fast leg to the checker, so the guard counts its start as well as its spans and steps, unless one of them is within 40 ms of it. A leg that began below the 2% floor can start well before its span (S6-P8).
- **Otherwise each span and each instant step is a hard step**, dated where it happens. A span and an instant step of the same movement fold within 50 ms in the guard and 100 ms in the checker.
- Instant steps (above 2 within 50 ms, measured by the guard over 60 ms) do not change.

### Gear in an unknown state, on hardware

- **Gear in an unknown state changes only on its own while nothing else moves.** A light change is refused when it moves such gear together with other changed gear, moves more than one such address, or comes while other gear may still be moving. The same gear may change again while it may still be moving: each change counts as a leg and a hard step on its own, and only that gear moves.
- **Other gear waits while gear in an unknown state may still be moving.** That lasts from its last change for its longest fade, from its scan's read-backs, plus 100 ms. After CONTINUOUS UP or DOWN, and for gear seen fading in a scan, the longest fade includes the whole range at the fade rate, up to 90 s (S6-D16-2). Gear seen fading during its scan is marked the same way, and so is modelled gear when a light change to it faults, using the shadow's longest fade from before the fault. The refusal says when to ask again.
- **A fade setting sent to any gear makes its read-back fade time unknown**, modelled or not, since a scan under way may unmodel it (S6-D16-4).
- **A fade setting sent to such gear makes its longest fade unknown.** It is then taken as 16 minutes, the longest fade DALI allows, so a refusal always has a time to ask again. A scan that models the gear clears the mark sooner.
- **OFF crosses nothing.** A transaction whose only light changes are OFF is never refused by this rule, and an OFF ends the mark on the gear it reaches 100 ms later. A broadcast OFF, which panic sends, ends every mark. Panic and the RESET's follow-up OFF do not go through the guard at all.
- **Gear the inventory has not found is gear in an unknown state too.** While the inventory is stale or unaddressed gear is present, a broadcast or group change moves it with the gear the app knows, and is refused. A frame to unaddressed gear alone goes when nothing else moves, and other gear then waits for it, for up to 16 minutes, until an OFF or a fresh inventory with no unaddressed gear (S6-D16-3).
- **An address a scan found empty is never marked**, and a scan that finds an address empty clears its mark, so a typed command to an empty address does not hold the room.

## Consequences

- A fast fade inside a longer run is a hard step, held to 2 s per address and 1 s for the room.
- A slow fade is never a hard step, even when another driver splits the room's run.
- Counting every date the rule could give a hard step refuses some changes the rule would allow. Each case counts as two hard steps, so the second change waits about 2 s from the first date at an address, and 1 s in the room:
  - a fast change, or a fast creep or stepwise ramp, followed within 745 ms by a fast fade that passes 2 (S6-P10);
  - an instant step of 1.98 to 2.02 that follows a small fast change within 745 ms (S6-S17-1);
  - a leg of 695 to 705 ms with fast change above 1.98, whose fast movement began more than 40 ms before its span (S6-P8);
  - a movement more than 0.66 s after the last span, after a pause in fast change, that the rule could find late enough to count on its own (S6-P12).
- These border dates are kept apart when an address's channels are merged, so the merge never drops one or lets one absorb a span's own date (S6-D17-1). The merge also takes events in opposite directions for one only at the same moment, as a swap between colours is, not within 5 ms (S6-P11).
- On hardware, a broadcast or group change that would move unscanned gear or gear seen fading is refused until a scan. The panel and the console show the reason. A short-address change to that gear alone still goes when nothing else moves, and OFF always goes.
- While unaddressed gear is present, a broadcast or group light change is refused, not only an indirect level command (S3.1b). The panel's all-gear controls on hardware need the gear addressed or OFF.
- A command to an address that was never scanned holds other light changes for up to 16 minutes, or until a scan or an OFF. A scan at connect covers every address, so this needs gear added after the scan.
- The simulator target does not change, since the shadow there is the simulator.
- New tests:
  - `src/safety/rate/spans.test.ts`: spans, their windows and margins, folding, a fast fade from off on every channel, and the slow test on hand-built plans.
  - Edge tests for `hardTimes` with spans and the fast leg's date.
  - Fixed cases in `tests/properties/hard-steps.test.ts`: S6-R4 through the bench, the slow tail, and the unseen hardware case. Each fails on the code before this ADR, apart from the slow tail, which guards against a false alarm.
  - The differential property adds fades of 120 to 600 ms, and a second property checks on random bench commands that the guard and the checker agree on which changes are slow.
  - Governor tests for the unknown-gear rule: a broadcast, a lone change, waiting for a fade, a fade setting, an empty address, OFF and a broadcast OFF, a fault, and a scan that clears it.
  - The counterexamples the property runs found are kept as `examples`, including S6-P8 to S6-P10 from the 1,000-run pass after the reviews, and S6-P12 from the pass after that.
  - The trace checker pairs an unlocked RESET's jump dated up to 50 ms before the RESET, its instant-step window, since another driver's slow fade can add to the jump (S6-P9). It does so only when the step had not finished before the RESET went out, so a separate hard step just before a RESET still counts (S6-S17-2).
- The guard and the checker still share no code.
- S5-P1, two swings in a second on a C5 driver the shadow never saw, is a different case and stays open.
- The guard still misses some breaches the checker finds, where the two date one hard step differently by where the samples fall (S6-P13, S6-D18-1 to S6-D18-5 and S6-P14 to S6-P16). Each pair of hard steps it misses is a little closer than 2 s at an address or 1 s in the room. The owner chose to fix these in a rate guard stage of their own, with a design that treats a hard step's date as a range counted once, which should also end the refusals the border dates cost.
- ADR 0019 amends this: the border dates are gone. Three of the four refusals listed above went with them, and the one for a movement 0.66 to 0.7 s after the last span stays. The findings in the item above are closed there. Gear in an unknown state now has a range for its hard step, up to the end of its longest fade, and S5-P1 is closed by a rule on DT8 gear whose colour is not known. That rule reverses one line above: a level no longer goes to gear that has not been scanned, even on its own, since it may be colour gear. OFF still goes. And each command to gear in an unknown state now counts on its own, where one transaction counted once.

## Alternatives considered

- **Any change above 2 within 0.7 s, slow or fast.** Simpler, but it makes a 2 s fade over a large ratio a hard step, which S3.3 allows as a fade.
- **Keep run length as the fade measure and widen the checker's margin.** It hides the false alarm but leaves the guard refusing changes for hard steps the light does not make.
- **Treat gear in an unknown state as the worst-case phantom.** The phantom counts events, but it cannot say when two fades cross in the room, which is what made the four legs.
- **Refuse every change to gear in an unknown state.** Safe, but it would block the commissioning and first-light steps that bring such gear into a known state.
