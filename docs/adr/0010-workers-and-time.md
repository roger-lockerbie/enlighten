# ADR 0010: Workers and time

Status: accepted

Date: 2026-11-14

## Context

Bus timing should not depend on what the UI is doing. S5 asks for long sequences to keep time in a hidden tab. Browsers slow main-thread timers in hidden tabs. The spike proved a module worker under Trusted Types, and saw a worker's timer ticks arrive late while its clock stayed right.

## Decision

- Two workers. The **bus worker** holds the engine: the clock, scheduler, governor, simulator, router, the server transport, and the runners for scripts, sequences, effects and switches. The **light worker** solves radiosity. Nothing else runs in a worker.
- The page holds the UI, the stores that mirror engine state, the visualiser's renderer, IndexedDB access and the Screen Wake Lock.
- The page and the bus worker exchange typed messages (requests, state snapshots and events). The message types are in `src/engine/protocol.ts`, and one function on each side is the only place that posts or receives.
- `Clock` is an interface with `now()` and `at(time, callback)`. The real clock reads `performance.now()` and uses timers only as wake-ups: when one fires, it reads the time and runs everything that is due. No code counts ticks or adds up intervals. The virtual clock for tests advances only when told.
- Everything in the core that needs time takes a `Clock`. No module in the core calls `Date.now`, `performance.now` or `setTimeout` directly, and lint enforces it.
- Sequence plans store absolute times from the start of the sequence. After a late wake-up the runner sends what is due and does not try to catch up by sending faster than the scheduler allows.
- While a sequence, effect or script is running the page holds a Screen Wake Lock and re-takes it when the page becomes visible again.
- Panic is a message the bus worker handles before anything else in its queue. ADR 0005 covers what the page does if the worker does not answer.

## Consequences

- The core stays pure and tests in Node with the virtual clock. The worker shell is thin.
- The policy file lists two worker URLs.
- If the bus worker stops, the WebSocket closes and the server turns the lights off. That is the intended failure.
- Stage 9's hidden-tab test is the proof for S5. Until then the design assumes late wake-ups and is correct under them.

## Alternatives considered

- Everything on the main thread: simpler, but hidden-tab timer limits would stretch sequences.
- A SharedWorker so two tabs share one bus: more moving parts, and the server takes one client anyway.
- WebHID in the worker: only matters if WebHID is built.
