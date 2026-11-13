# ADR 0005: The rate guard and panic

Status: accepted

Date: 2026-11-14

## Context

Flashing light can trigger seizures, and the bus can flash a tape at about 16 Hz unaided (`docs/research/effects.md` section 1). The rate guard (S3) and panic (S4) are the project's two safety controls. The owner accepted one swing a second as the default with three as a fixed ceiling, and chose off as panic's safe level.

## Decision

### The rate guard

- It is part of the governor and judges every transaction that can change light, from every source.
- It works on predicted traces from the shadow gear model, per address and for the room (the sum over addresses). For each address it watches every channel's drive and a luminance estimate weighted by channel, so a swap between colours at a constant level is seen. It does not use the ceiling's mix sum.
- A leg is a maximal monotonic run of a trace, across commands and sources, whose ends differ by a ratio of 1.10 or more, or that starts or ends at off. A swing is two legs in opposite directions.
- Where the prediction is missing, the guard assumes the worst. On hardware, state is reset on every connect and target change, a transport fault makes the affected state unknown, and broadcast, group and unaddressed frames are also judged against a phantom driver with no fade and no limits.
- Default: no more than one swing starts in any one-second window. With the `rate` unlock the limit can be set up to three, with the leading edges of swings at least 360 ms apart. No setting, unlock or code path goes past three.
- A hard step is a leg with a ratio above 2, or to or from off, with no fade of at least 0.7 s. At most one starts in any 2 seconds per address and one a second for the room, whatever is unlocked. This lets lights be switched on and off and holds hard flashing to one change every 2 seconds.
- Changes smaller than a leg are limited to three reversals a second.
- A move to or from saturated red (only the red channel above 10%) counts as a leg whatever the change in output.
- A repeating pattern faster than half a swing a second stops after 5 seconds.
- On hardware, every level or colour command counts as an instant step until the driver's fade time has been read back and the DA5-L's fade behaviour is marked confirmed in the code after hardware day. Simulator profile settings never loosen the guard on hardware. Changing a fade time is judged too, because it changes what later commands do.
- A refused transaction carries the time at which it would be allowed. Live controls keep the newest value and send it then. The console and scripts show the refusal.
- Sequences and effects are checked against the guard when they are planned, so a valid plan should not be refused part way. The guard still judges every step when it is sent, and a refusal stops the run.
- An unlocked RESET is a full swing, allowed once in 10 seconds, from a person only, and followed by OFF (SPEC section 5). IDENTIFY DEVICE is refused always, because its flash pattern is the manufacturer's and unknown.

### Panic

- One always-visible button, one shortcut (Escape twice within 500 ms), and the console command `panic`.
- Panic clears the scheduler's queue, stops every script, sequence, effect and held switch, and sends TERMINATE and broadcast OFF. To the server it is one message: the server drops its own queue and sends the same two frames. Nothing that was queued is sent afterwards. The OFF is recorded in the guard's history.
- The rate guard never delays or refuses panic.
- Panic latches. Nothing is sent until a person chooses Resume. Turning lights back on afterwards goes through the rate guard like anything else.
- If the bus worker does not confirm panic within 250 ms, the page ends the worker. That closes the WebSocket, and the server's own stop sends OFF.
- The page and the dialogs are built so the Panic button can always be clicked: no modal state that makes the top bar inert, and no element fullscreen.
- If the page's main thread hangs, the button and the shortcut are lost until it recovers. While the page is visible it sends the worker a heartbeat, and the worker stops every runner after 3 seconds without one. A hidden page is exempt, because browsers slow its timers and S5 needs sequences to keep running there. The rate guard runs in the worker either way.
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
