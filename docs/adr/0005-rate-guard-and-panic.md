# ADR 0005: The rate guard and panic

Status: accepted

Date: 2026-11-14

## Context

Flashing light can trigger seizures, and the bus can flash a tape at about 16 Hz unaided (`docs/research/effects.md` section 1). The rate guard (S3) and panic (S4) are the project's two safety controls. The owner accepted one swing a second as the default with three as a fixed ceiling, and chose off as panic's safe level.

## Decision

### The rate guard

- It is part of the governor and judges every transaction that can change light, from every source.
- It works on predicted light output from the shadow gear model, per address and for the room (the sum over addresses).
- A leg is a monotonic change in output whose ends differ by a ratio of 1.10 or more, or that starts or ends at off. A swing is two legs in opposite directions.
- Default: no more than one swing starts in any one-second window. With the `rate` unlock the limit can be set up to three, with the leading edges of swings at least 360 ms apart. No setting, unlock or code path goes past three.
- A leg with a ratio above 2 needs a fade of at least 0.7 s, or it is refused.
- Changes smaller than a leg are limited to three reversals a second.
- A move to or from saturated red (only the red channel above 10%) counts as a leg whatever the change in output.
- A repeating pattern faster than half a swing a second stops after 5 seconds.
- Until a driver's fade time has been read back, every level command counts as an instant step, which is the worst case. Changing a fade time is judged too, because it changes what later commands do.
- A refused transaction carries the time at which it would be allowed. Live controls keep the newest value and send it then. The console and scripts show the refusal.
- Sequences and effects are checked against the guard when they are planned, so a valid plan is never refused part way.

### Panic

- One always-visible button, one shortcut (Escape twice within 500 ms), and the console command `panic`.
- Panic clears the scheduler's queue, stops every script, sequence, effect and held switch, and sends broadcast OFF. If any gear might be in a self-run procedure it sends TERMINATE first. To the server it is one message that the server acts on ahead of anything queued.
- The rate guard never delays or refuses panic.
- Panic latches. Nothing is sent until a person chooses Resume. Turning lights back on afterwards goes through the rate guard like anything else.
- If the bus worker does not confirm panic within 250 ms, the page ends the worker. That closes the WebSocket, and the server's own stop sends OFF.
- OFF is chosen because it is one frame, takes effect at once whatever fade is stored, and needs no configuration write.

## Consequences

- Any change to the guard comes with property tests that try to defeat it, as `CLAUDE.md` requires. The invariant is stated on the simulator's output trace, not on the guard's own counters.
- A fast wiggle of a slider is held to one reversal a second. That is the intended feel.
- Panic leaves the hallway dark. The owner chose this.

## Alternatives considered

- Three swings a second as the default: the broadcast limit, set for a television, with an exemption room lighting cannot claim.
- Counting frames and not predicted output: a DAPC with a long fade and a DAPC with none are the same frame.
- A low level as the safe level: needs a fade time write first, so it is slower and has more ways to fail.
- A global key chord for panic: every candidate is reserved by some browser or system. Escape is reserved by none outside fullscreen.
