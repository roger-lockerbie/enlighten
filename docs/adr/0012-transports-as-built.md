# ADR 0012: The transports, the engine and the server as built

Status: accepted

Date: 2026-11-15

## Context

ADR 0003 sets out the hardware path, ADR 0010 the workers, and `docs/ARCHITECTURE.md` the interfaces in outline. Stage 4 built them and tested the whole hardware path against a fake hasseb. This ADR records what was fixed while building, where the outline left a choice, and the one addition to the server protocol.

## Decision

### The protocol

- SPEC section 9 now fixes the encoding: integers are big-endian, the token is 32 random bytes shown in the URL as 64 lowercase hex characters, the client picks the 16-bit SEND sequence, and CLOSE carries one of five reasons (silence, protocol error, the server stopping, not authorised, another client).
- One message is added: `0x84 STOPPED`, from the server after every stop it can still report, with the RESULT status of its TERMINATE and of its OFF. Without it the app could not tell whether the server's OFF went out. The owner approved this addition with the Stage 4 plan.
- The stop lets the frame already on the hasseb finish (its report or the 250 ms timeout) before TERMINATE, so frames stay in order whatever the app's 100 ms panic wait does (security review S3-RL3). The session stays open after a PANIC.
- RESULT status 6 (dropped) reaches the governor as `refused`, so a frame that was never sent is never fed to the shadow. Status 4 (the hasseb did not answer) is a `fault`: the frame may have reached the bus (SPEC R1.9).

### The transport and the router

- `Transport.send(frame)` takes a `TxFrame`, which carries its own send-twice and reply flags. `Transport.panic()` in the outline became `sendPanic(frame)`, one call per panic frame, matching the scheduler's `FrameSink`. The server transport sends one PANIC message for the pair and answers both calls from STOPPED.
- `src/transport/` is pure: `ServerTransport` takes an injected socket and clock, so it tests in Node with a scripted socket. Only the worker shell constructs a real WebSocket.
- Each router is bound to one transport and one governor. The simulated bench has its own router for the session; every hardware connection gets a new one. A router refuses an approval its own governor did not issue, so one connection's approval cannot reach another's transport.
- When a hardware connection is replaced or lost (a change of target, Reconnect, a drop, an unplugged hasseb), the engine retires it: its governor is latched, its scheduler drops its queue and refuses new work, and its router refuses every frame. Nothing it had queued can reach the bus after a later panic (security review H1). Panic still reaches the real lights when no hardware connection is in use but the server is connected, for example after a change to Simulator: a standby scheduler on the hardware transport, whose gate refuses everything and whose router has no approvals, sends TERMINATE and OFF (re-review R1).
- Approvals are single use and time bound (security review S3-M1). The governor stamps each approval with the time it judged it. The router sends a frame only if it is the identical next frame of that approval, and frame k only within (k + 1) seconds of the judgement. `sendPanic` accepts only `PANIC_FRAMES`.
- Lint keeps transports and sockets out of the page, keeps the worker shell and the engine (all but the router) from calling `send` or `sendPanic` by name, by key or by destructuring, and keeps `createPolicy` and `new Worker` in `src/workers/policy.ts`. `tests/lint/boundary.test.ts` proves each rule.

### The engine

- One engine in the bus worker. The simulated bench's governor and scheduler last for the session. Hardware and Both get a fresh governor, empty shadow, router and scheduler on every connect and every change of target to either (SPEC R1.1a), and a new hardware connection starts with no unlocks. One made while panic is latched starts latched.
- Changing target stops runners and sends nothing. Switching to Simulator leaves the server connection open and idle, so it does not turn the real lights off by itself. A drop or an unplugged hasseb shows as disconnected, stops work and sends nothing to the simulator (SPEC R1.8). Reconnecting is a person's choice.
- On connect the engine scans, writes the safety profile, reads everything else each driver reports, and asks the operator whether they can see the lights.
- In Both, a gate around the hardware governor compares the shadow's answer with the hardware's for the queries the shadow knows from read-backs and the writes since: levels, limits, fade settings, groups and scene levels. It does not compare while a scan or profile is running on that connection, and it compares QUERY ACTUAL LEVEL only when the shadow knows the level and no fade is running, because how the DA5-L fades is not yet confirmed. A difference goes to the divergence log, and the address is scanned again, at most every 10 seconds, which rebuilds its model from read-backs. A rescan that cannot model the address, because a fade was running, stays pending and is tried again. That is how the hardware's values correct the shadow: through the existing, reviewed path, not a new one. The background check sends QUERY ACTUAL LEVEL to one modelled address a second while the bus is idle.
- The heartbeat watchdog starts with the page's first heartbeat that says it is visible.
- A transport fault on any frame stops every runner, not only the job that saw it (SPEC R1.9).
- On hardware the `rate` unlock waits for the operator's answer to whether they can see the lights.
- The ceiling control reports the active connection's result, and names the drivers whose MAX LEVEL did not take.
- Commissioning assigns addresses only to gear without a short address, by the random address search. It sends TERMINATE before INITIALISE. Every command travels on its own, from a person, with the `reset` unlock and the typed word "commission". When two drivers answer the final COMPARE at once, they share a random address: the search randomises again, up to five times, and never programs a shared address. Afterwards the engine scans and writes the profile again.
- The hardware check's store steps store a different value, read it back and restore the original, so a store that does not take shows. Its throughput step sends DTR0 loads, which change no light, so the rate guard does not slow it. Its panic-in-flight step panics when the send-twice frame is handed to the transport, and records whether that frame went out.

### The page and the worker

- ADR 0002 items 2 to 4 are applied now, because Stage 4 adds the first worker: Svelte compiles with `fragments: 'tree'`, the CSP names one policy, `enlighten-worker`, and the policy passes only the bus worker's URL. The Permissions-Policy turns `hid` and `fullscreen` off now (ADR 0003, SPEC S4.1).
- The page reads the token from the fragment, removes it with `history.replaceState`, refuses it under a service worker, and hands it to the worker without keeping a copy. The worker confirms panic as soon as it has latched and dropped every queue. The page ends the worker if that confirmation takes over 250 ms.
- The Stage 4 page is interim: a top bar, the banner, and a Devices page with the inventory, the profile, the ceiling, unlocks, commissioning, the hardware check and the divergence log. Stage 5 builds the shell.

### The server

- Seven small modules: `__main__` (arguments with no network option, signals, the terminal), `app` (the one way the server is built, used by the tests too), `web` (named so it never shadows the standard library's `http`), `session`, `protocol`, `frames` (python-dali decoding) and `hasseb`, plus `fake`.
- websockets 17.4, which needs Python 3.11 or later. The server sends no `Server` header and serves GET only.
- A reply report with a length byte of 1 or 8 is accepted. python-dali accepts only 1. Which one the device sends is a hardware-day item.
- The server keeps at least 20 ms from one frame's report to the next frame, as python-dali does before every send, because the firmware may not keep the bus's settling time itself and the server's stop and a draining queue do not go through the app's scheduler. `--gap-ms` changes it. The send-twice delay the hasseb uses (byte 6, 10 ms as python-dali) is `--send-twice-ms`. Both are hardware-day items.
- After ENABLE DEVICE TYPE, a standard command numbered below 224 decodes as the part 102 command, the same departure from python-dali as ADR 0011.
- The stop drops SENDs that arrive while the server is stopping, and refuses new connections then, so nothing follows the final OFF (security review M1). Each frame has one deadline, whatever reports arrive. A failing frame pump runs the stop.
- Between frames, the device poll does a 1 ms read, which is how an idle session notices an unplug.
- The fake hasseb and its gear are our own small model of the bench, dispatching on python-dali's command classes. Levels change at once with no fades. Quirks make it differ for tests.

## Consequences

- The whole hardware path runs in CI and from `pnpm server:demo` before the hasseb arrives.
- On hardware, while any DT8 driver's colour is unknown this session, a lone SET MAX LEVEL below a lit driver's level is refused with no retry time: the rate guard counts two hard steps in the one transaction, the unknown-colour event at the first copy and the predicted pull-down at the second. The hardware check sets a known colour on every driver first. Lowering the ceiling still lands, because `lowerCeiling` sends its hold DAPC and the profile's own write waits for the rate guard, but it lands late: in the DALI review's run, about 6 s for the light and 9 s in all, where SPEC R6.2 says at once. It is conservative and comes from ADR 0011's rules. Two fixes are open for the owner: order `lowerCeiling` to turn lit drivers down before the MAX LEVEL writes, and merge the two events across a send-twice pair in the governor.
- The page's bundle includes the hardware check's step list and with it parts of the core it does not run. It costs bundle size and no behaviour. Stage 5 can split the list from its runners.

## Alternatives considered

- Answering PANIC with no message: the app could not report whether the OFF went out.
- Having the client send TERMINATE and OFF itself after PANIC: two more frames, and the server's own stop already sends them.
- Correcting the shadow directly from each query answer: a new path into the shadow that the Stage 3 review never saw. A rescan reuses the reviewed one.
- One router with a target switch: an approval from the simulated governor could have reached the hardware.
- python-dali's fake gear for the fake bench: it has no RGBWAF and no device type 6.
- Letting the app send the two copies of a send-twice command itself, if the hasseb's own repeat turns out too fast: the server refuses a send-twice command sent without its flag, so this would need a protocol change. `--send-twice-ms` is tried first.
