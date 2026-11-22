# ADR 0015: Hard steps dated where they happen

Status: accepted

Date: 2026-11-18

## Context

ADR 0011 defines a hard step as a leg with an instant step above 2, or a fast leg, and both the rate guard and the trace checker dated it at the start of its run, one a run. A run goes on through any flat stretch under 1 s and through any slow fade in the same direction, so a run can hold more than one instant step, and its start can lie seconds before the step.

The Stage 6 property run found the effects (security finding S6-P1):

- **A flash through an unlocked RESET.** Driver A went from off to 40%, an unlocked RESET took it to full 0.7 s later, and its OFF to off 0.4 s after that. The jump to full was in the same run as the rise, so it had no hard step of its own. The guard's RESET rule dropped "the first hard step after the RESET", which was the OFF. The guard saw one hard step where the light made three changes in 1.1 s, and the old checker agreed with it.
- **A RESET at full.** The RESET makes no jump, so its OFF is the only hard step it makes, and the same rule dropped it. A RESET 0.5 s after a hard rise passed, and the light went on and off within a second.
- **A false alarm in the checker.** A drop that ended a slow fade on the other driver was dated at the fade's start, 17 ms after a real hard step that came 2.07 s before the drop.

The owner chose to fix this in Stage 6. The DALI review of the first version of the fix, the longer property runs after it, and the security review of the result found more in the same rules. They are recorded below and in `docs/SECURITY_FINDINGS.md` (S6-R1 to S6-R7, S6-P3, S6-P4 and S6-S1 to S6-S6).

## Decision

### Hard steps

- **A fast leg is one hard step from its start**, as S3.3 reads: ends more than 2 apart (output below 2% counting as 2%) in under 0.7 s.
- **In a longer leg, each instant step above 2 is its own hard step, dated where it happens.** An instant step is a change of more than 2 within 50 ms. The guard measures it over 60 ms (`JUMP_WINDOW_MS`) from the earliest sample in that window, so a fast fade inside a slow run is seen whole, and dates it at the latest sample from which the change is still more than 2.
- **Steps that follow on fold into one.** The guard folds instant steps within 50 ms (`JUMP_MS`) of the last. The checker folds within 100 ms, and a step between 1.96 and 2 that follows a jump extends the fold there, so the checker never splits what the guard joins.
- **On the border the guard counts both readings.** When a leg's ratio is near 2 or its time near 0.7 s, inside the 1% ratio margin or the 5 ms fade margin, the guard counts the leg's start and each instant step.
- What makes a run, a leg and a swing does not change.

### Small reversals

- **A turn is a small reversal unless both runs are legs beyond the margin**, a ratio of 1.1 / 0.99 or more. The guard used to call a run a leg at 1.1 × 0.99, which made it count fewer reversals than the rule when a run lay between the two (S6-P3).

### New events

- **Each event in the prediction without the transaction stands for one event at most.** The guard used to call any event within 2 ms of an old one old, so a fall that a transaction turned into a leg 1 ms after an old rise was not new, and three legs in a second passed at the default of one swing (S6-P4).

### RESET

- **A RESET and its OFF are one hard step.** If a hard step starts from the RESET's delivery to 150 ms after it (its jump to full), the hard step nearest the OFF, from 150 ms to 2 s after the RESET, is dropped. If the jump is not a hard step (the light was already bright), the OFF is the pair's one hard step and stays.
- **In the room, only the RESET's own driver's jump counts.** Another driver's hard step in the same 150 ms does not let the OFF be dropped from the room (S6-S4).
- **The pending OFF is judged with everything that comes before it.** From the RESET until the OFF goes, or 2 s after the RESET when the follow-up window ends, every transaction is judged with the OFF added to both predictions, at the later of now and 350 ms after the RESET. On hardware the OFF can go later than 350 ms (S6-R8).
- **The console sends RESET only through the engine's reset**, which sends RESET, OFF 350 ms later, then writes and verifies the safety profile again (`resetAndRestore`). `reset <n>` and `raw` with a RESET go there, one short address at a time. A bare RESET in the `commands` or `raw` intent is refused. Before this the console sent RESET alone, and the light stayed at full (S6-R1). The reset sends its RESET and its OFF once, without the retries other internal work has: a held RESET is refused at once rather than going out later (S6-S2), and a refused OFF goes straight to panic's OFF. Only an OFF the gear can hear, after its 300 ms of deafness, ends the follow-up (S6-S1). If the RESET went out and the rest did not finish, the engine says MAX LEVEL may be 254 (S6-S3).

### The checker

- The checker follows the same rules with its own code, and sums the room through one cursor a unit. It used to search each unit's whole trace for every sample, which took 18 minutes on one long property run.

## Consequences

- A hard step in a slow run is held to the 2 s window per address and 1 s for the room, from the moment it happens. Some sequences the guard used to pass are now held: a rise, a short pause and a second hard rise within 2 s.
- An unlocked RESET is held until 2 s after a hard step on its driver, a RESET at full counts its OFF, and a change made while a RESET's OFF is pending is judged with that OFF.
- The guard counts a few more small reversals near the leg border, and refuses a new leg that starts within 2 ms of an old one when the window is full.
- New tests:
  - Edge tests for the dating, the windows, the folding, `hardTimes`, the reversal border and the tagging.
  - Fixed cases in `tests/properties/hard-steps.test.ts` for each counterexample. Each fails on the old guard, and the checker's own tests fail on the old checker.
  - P-rate against slow runs (`tests/properties/rate-runs.prop.test.ts`), which puts steps, fast fades and RESETs on top of a slow fade.
  - A differential property (`tests/properties/hard-steps-diff.prop.test.ts`): on made-up traces with ratios near 2, near 1.1 and near the 0.5% change, wherever the checker finds a hard-step or reversal breach, the guard finds one too. It finds the old reversal rule's gap at once.
  - Engine and console tests that RESET from the console is followed by OFF within 500 ms and a verified profile.
- The guard and the checker still share no code.
- ADR 0016 amends this: change from fades that ran 0.7 s or longer is slow and never a hard step, fast change above 2 within 0.7 s is a hard step from where it starts, and a fast leg is dated where its fast movement began.
- ADR 0019 amends this: a hard step is still dated where it happens, on a grid the guard and the checker share. Where the guard's readings date it differently, its date is a range, and it counts once.

## Alternatives considered

- **A sliding window: any change above 2 within 0.7 s is a hard step.** Closer to how a flash is seen, but it makes a 2 s fade over a large ratio a hard step, which S3.3 allows as a fade. A change to S3.3 is the owner's to make, not this fix's.
- **End a run at every instant step.** Simpler to state, but it would split one movement's legs and change the swing count, which this fix does not need to touch.
- **Hold every other light change until a RESET's OFF has gone.** Simpler than judging with the pending OFF, but it delays the panel and the console for up to 0.7 s after each RESET for no gain.
- **Keep the old dating in the checker and log the guard's gap.** The checker would have kept agreeing with the guard on the RESET flash, and the console property would have failed at random in CI.
