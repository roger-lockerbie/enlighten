# ADR 0011: The core as built, and the rate guard's exact rules

Status: accepted

Date: 2026-11-14

## Context

ADR 0004 and ADR 0005 describe the governor and the rate guard in words, and `docs/ARCHITECTURE.md` gives the interfaces in outline and says Stage 3 fixes the details. Stage 3 built them and ran the property tests in `docs/TEST_PLAN.md` against an independent trace checker at 1,000 runs each. Those runs found several places where a plain reading of the words let the real output pass a limit. This ADR records the interfaces as built and the rules as they now stand, so the guard, the checker and the next stages agree.

## Decision

### Interfaces

- **`Governor`** (`src/safety/governor.ts`) is a class, one per target. `judge(tx, now)` changes nothing (a test compares a fingerprint of the state before and after). `observe(sent, result)` is the only way its view advances. ARCHITECTURE.md showed `observe` returning a new state. Copying a simulator on every frame would be slow, so the class holds its state and the purity of `judge` is tested instead.
- **`Approved`** values exist only in a `WeakSet` inside `governor.ts`. `isApproved(a, tx)` checks one. Stage 4's router calls it before a transport sees a frame.
- **`FrameSink`** (`src/bus/scheduler.ts`) is what the scheduler sends to: `send(frame, approval)` and `sendPanic(frame)`. The router implements it in Stage 4. The bench in `tests/harness/` implements it for tests.
- **The shadow.** In the Simulator target the shadow is the simulated bench, and the transport feeds it. In the Hardware target the shadow is a separate `Simulator` with the default DA5-L profile, fed by `observe`, and a new `Governor` and shadow are made on every connect.
- **Time.** `Clock` and `VirtualClock` are in `src/bus/clock.ts`. The real clock waits for the worker shell in Stage 4.
- **The simulator's output** is a list of plans per gear, each valid from a time on. `outputAt(t)` is pure, and the guard reads the recent past and the predicted future from the same plans.

### What counts

- **Measured on.** Each terminal's drive, a luminance estimate per address (placeholder weights), and the room's luminance (the sum over addresses).
- **A run** is a maximal monotonic stretch of a trace. A flat stretch of 1 s or more ends a run, so a change after a pause starts its own leg.
- **A leg** is a run whose ends differ by a ratio of 1.10 or more, or that goes between off and on. A change into or out of saturated red (red above 10%, every other channel at or under 10%) is also a leg.
- **One address, several traces.** Legs on an address's traces that go the same way and start within 100 ms of the first of them are one leg. One movement shows on several channels, each peaking at a slightly different time. Opposite directions are never merged, so a fast flicker still counts every leg.
- **A hard step** is a leg with an instant step (within 50 ms) whose ratio is above 2, or a leg whose ends differ by more than 2 and that took less than 0.7 s. For these ratios, output below 2% counts as 2%. A fade from off begins with the gear's jump to its minimum, about 1% on the DA5-L, and that jump alone is not a hard step.
- **A small reversal** is a change of direction where either run is smaller than a leg.

### The limits

With swing limit N (1 by default, 2 or 3 with the `rate` unlock, never more):

- No more than 2N leg starts in any 1 s window, per address and for the room.
- For N above 1, legs i and i+2 start at least 360 ms apart.
- At most one hard step starts in any 2 s per address, and in any 1 s for the room.
- At most three small reversals in any 1 s.
- A fast pattern stops after 5 s. A leg is fast when it and the two legs before it start within 2 s. A run of fast legs that has lasted 5 s refuses the next fast leg.
- An unlocked RESET and the OFF that follows it 350 ms later are judged together and count as one hard step. The OFF is not judged again. At most one RESET in 10 s.

### How the guard decides

- It predicts the output with and without the transaction, from 6 s before now to the end of every fade (up to 17 minutes), and refuses only breaches that involve an event the prediction without it does not have. That includes an older run that the transaction extends into a leg.
- It decides with a margin, so differences in where a trace is sampled cannot let the real output pass a limit: ratios 1% lower, windows 40 ms longer, the 0.7 s fade test 5 ms longer, same-direction legs merged within 60 ms rather than 100 ms, and fades sampled every 10 ms.
- On Hardware, until `FADE_BEHAVIOUR_CONFIRMED` is set by a reviewed commit, it counts the events of both an instant-step prediction and a faded one. Instant steps are the worst case for hard steps. A level and a colour fading together can make one channel rise and fall, and only the faded prediction shows that.
- On Hardware, a light change to an address whose level or colour is not known, and a broadcast or group frame while the inventory is stale or unaddressed gear is present, also count as a leg and a hard step there and in the room. Colour becomes known when this session has set a whole temporary colour and activated it.
- On Hardware, nothing is known about what the lights did before a connect, so light changes wait 2 s after it.
- A refusal carries the earliest time the same transaction would pass, found by judging it again at later times.

### The ceiling

- The ceiling's measure is the arc level's share of output times the sum of channel fractions, with Tc counting as one channel and gear without colour as one (SPEC R6.6). The governor uses the colour features the gear reported, and the worst case (every channel) where it has not reported.
- A transaction is checked on a prediction through to the end of its fades, sampled inside them, because a level fading up while the mix fades down can peak in between. DAPCs are lowered to fit. A transaction is refused only if it would raise the measure past the ceiling and nothing can be lowered. A transaction that lowers the light but cannot bring it under goes out with a note.
- Commands behind an unlock (RESET, SELECT DIMMING CURVE, the DT8 store commands) were confirmed by a person who was told what they do, and are not held to the ceiling.
- Lowering the ceiling waits for the rate guard rather than failing, and switches off any address whose colour mix cannot fit under the new ceiling even at its lowest level.
- After a RESET, registers loaded while gear may still be deaf (300 ms) are unknown.

## Consequences

- The guard is stricter than the words in ADR 0005 by its margins. Ordinary use does not notice 40 ms.
- An instant colour swap is a hard step, because a channel goes to or from off at once. A swap with a fade of 0.7 s or more is not.
- A slow fade is one long leg, and the guard predicts to its end to see whether it reaches the leg ratio.
- `tests/harness/checker.ts` implements these rules again, separately, without the margins. P-rate and P-rate-fade compare the simulator's trace against it.
- Stage 4 builds the router on `FrameSink` and `isApproved`, the `RealClock`, and the hasseb report builder that the G-hasseb fixtures test.

## Alternatives considered

- Leg starts merged with a fixed 5 ms tolerance: counted one movement as several legs when channels peaked apart.
- Merging every event within 100 ms, whatever its direction: would hide a fast flicker.
- Predicting only 10 s ahead: missed slow fades that reach the leg ratio late, and fades that end above the ceiling.
- Checking only instant steps on hardware: missed a channel rising and falling inside a combined fade.
