# Architecture

How Enlighten is put together. `docs/SPEC.md` says what it does. The decisions behind this shape are in `docs/adr/`.

## 1. The shape

```
 Page (main thread)                         Bus worker
 ┌───────────────────────────┐   typed    ┌──────────────────────────────────────────┐
 │ UI: playground, console,  │  messages  │ Engine                                   │
 │ visualiser, switches      │ ─────────► │  sources ─► transactions                 │
 │ Stores (mirror of state)  │ ◄───────── │  Scheduler ─► Governor ─► Router         │
 │ Renderer (three.js)       │            │                 │            │           │
 │ IndexedDB, wake lock      │            │           shadow gear     Transports     │
 └───────────────────────────┘            │           (Simulator)    sim │ server    │
              │                           └──────────────────────────────┼───────────┘
              ▼                                                          ▼ WebSocket /bus
 Light worker (radiosity)                              Hardware server (Python) ─► hasseb ─► DALI bus
```

Three rules hold the design together:

1. Every input becomes a transaction, and every transaction passes the governor before a transport sees it.
2. The core is pure TypeScript with no DOM and no direct access to time. It runs the same in Node, in the bus worker and in tests.
3. The simulator always runs. In Simulator mode it is the output. In Hardware and Both it is the governor's shadow and the visualiser's prediction.

## 2. Modules and interfaces

Types are shown in outline. Stage 3 fixes the details.

### `src/dali`: frames and commands

A data-driven command table, encoders and decoders. No state apart from the "previous frame" that device type commands need, which the caller passes in.

```ts
type Frame = { readonly a: number; readonly b: number }; // 16-bit forward frame
type Address =
  | { kind: 'short'; n: number }
  | { kind: 'group'; n: number }
  | { kind: 'broadcast' }
  | { kind: 'unaddressed' };
interface Command {
  id: CommandId;
  address?: Address;
  value?: number;
}
function encode(cmd: Command): {
  frame: Frame;
  sendTwice: boolean;
  reply: ReplyKind;
  deviceType?: number;
};
function decode(frame: Frame, previous?: Frame): Command | undefined;
function decodeReply(cmd: Command, byte: number): Reply;
```

Golden fixtures from python-dali are the oracle for `encode` and `decode`.

### `Clock`

```ts
interface Clock {
  now(): number; // milliseconds, monotonic
  at(time: number, run: () => void): Cancel; // run when now() >= time
}
```

`RealClock` reads `performance.now()` and treats timers as wake-ups only. `VirtualClock` moves when a test tells it to. See ADR 0010.

### `src/sim`: `GearModel` and the simulator

```ts
interface GearModel {
  receive(frame: Frame, at: number): Reply | undefined; // state change and any backward frame
  outputAt(time: number): ChannelDrive; // each channel's drive, 0 to 1, at a time
  snapshot(): GearState; // levels, limits, DTR view, fade, colour
  powerCycle(at: number): void;
  busFailure(at: number): void;
}
```

One implementation, `Da5l`, built from a profile: light type (C1 to C5), how it presents colour, and one setting per unknown with its researched default. `Simulator` holds a `GearModel` per address, delivers each frame to every model that should hear it, and merges replies (two answers at once become a framing error). `outputAt` is a pure function of state and time, so the preview and the visualiser can sample any moment of a fade.

### `src/safety`: `Governor`

```ts
interface Governor {
  judge(tx: Transaction, state: GovernorState, now: number): Verdict;
  observe(sent: SentFrame, reply: SendResult, state: GovernorState): GovernorState;
}
type Verdict =
  | { kind: 'allow' }
  | { kind: 'clamp'; tx: Transaction; note: string }
  | { kind: 'refuse'; reason: string; retryAt?: number };
```

`GovernorState` holds the ceiling, unlocks, the panic latch, the last frame sent, DTR0 to DTR2, the inventory with its verified flags, and the shadow simulator. `judge` runs the candidate transaction against a copy of the shadow to predict output, applies the rule table in `docs/SPEC.md` section 5 and the rate guard, and returns a verdict. It changes nothing. `observe` is called for each frame once it has been sent, and is the only way state advances. The safety profile builder (S1) and panic (S4) live here too.

### `src/bus`: `Scheduler`

```ts
interface Scheduler {
  submit(tx: Transaction, source: Source): Promise<TxResult>;
  panic(): Promise<void>;
  utilisation(): number; // share of the last second the bus was busy
}
```

A queue of transactions with two priorities (interactive ahead of background queries). For the transaction at the head it calls `judge`, then sends its frames one at a time through the router with the researched settling times, keeping a send-twice pair, a device type pair and a query pair together. It calls `observe` after each frame. `panic` drops the queue and sends panic's transaction next.

### `Transport`

```ts
interface Transport {
  readonly kind: 'sim' | 'server' | 'webhid';
  state(): 'down' | 'connecting' | 'ready' | 'fault';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(frame: Frame, flags: { sendTwice: boolean; expectReply: boolean }): Promise<SendResult>;
  panic(): Promise<void>;
}
type SendResult =
  | { kind: 'sent' }
  | { kind: 'reply'; byte: number }
  | { kind: 'no-reply' }
  | { kind: 'framing-error' }
  | { kind: 'fault'; reason: string }
  | { kind: 'refused'; reason: string };
```

`SimTransport` wraps the simulator and takes as long as the real bus would. `ServerTransport` speaks the protocol in `docs/SPEC.md` section 9. `webhid` is reserved (ADR 0003). No transport retries by itself. Only `src/engine/router.ts` calls `send`, and it needs an `Approved` value that only the governor's `judge` creates. The worker shell constructs transports and passes them to the router.

### `Router`

Sends each frame according to the output target:

| Target    | Frame goes to                              | Reply comes from | Shadow                                    |
| --------- | ------------------------------------------ | ---------------- | ----------------------------------------- |
| Simulator | `SimTransport`                             | The simulator    | The simulator is the shadow               |
| Hardware  | `ServerTransport`                          | The hardware     | Fed each frame after the hardware reports |
| Both      | `ServerTransport`, then the same to shadow | The hardware     | As Hardware, and its replies are compared |

The shadow for the hardware is a separate instance from the simulated bench, with its own governor state, reset on every connect and target change (SPEC R1.1a). A frame the server refused or dropped is not given to the shadow. A frame that ended in a fault may have reached the bus, so the state it could have changed becomes unknown (SPEC R1.9). In Both, a difference between the shadow's reply and the hardware's goes to the divergence log, and the hardware's value corrects the shadow where the query makes that possible (levels, limits, fade settings, colour).

### `src/engine`: `Engine`

The one object the page talks to. It owns the scheduler, governor state, router and runners, and exposes:

- `request(intent, source)`: an intent is what a person asked for (set level, set colour, recall a look, raw frame, a console command already parsed). The engine compiles it to transactions. Compiling is where friendly controls are fitted to the ceiling, where ENABLE DEVICE TYPE and DTR loads are added, and where two addresses that take the same colour share their DTR frames.
- Runners for scripts, sequences, effects and switch plates. A runner is a source like any other: it calls `request` and waits.
- A live-control coalescer: for a moving slider it keeps the newest value per address and control, and submits it when the previous one has been sent or when a refusal's `retryAt` arrives.
- `subscribe()`: state snapshots and events for the page (device state, verdicts, bus monitor lines, divergence, runner progress).

### `Store`

```ts
interface Store {
  load<K extends StoreKey>(key: K): Promise<StoreValue<K>>; // validated, migrated, or defaults
  save<K extends StoreKey>(key: K, value: StoreValue<K>): Promise<void>;
  exportWorkspace(): Promise<string>;
  importWorkspace(text: string): Promise<ImportReport>;
}
```

IndexedDB in the page, an in-memory map in tests. See section 5.

### Console core, script parser, switch engine, light core

- `src/console`: the line editor state machine, history and expansion, the command parser, completion. Pure.
- `src/script`: the parser and step list. Pure. The runner is in the engine.
- `src/switch`: the part 301 event machine per button, on a `Clock`. Pure.
- `src/light`: form factors, the radiosity solve, the direct term, emitter and diffuser models, colour maths. Pure, and shared by the light worker, the probe and the tests.

## 3. The path every input takes

| Source                                                 | Enters as                                 | Then                                                                   |
| ------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| Playground control                                     | An intent from the page                   | Coalescer, compile, scheduler, governor, router                        |
| Console command                                        | Parsed command, sent as an intent         | Compile, scheduler, governor, router. The result prints in the console |
| Raw frame                                              | `raw` intent with two bytes               | No compile step. Decoded and judged by the governor like any frame     |
| Script                                                 | Step list held by the script runner       | Each step is a console command intent                                  |
| Sequence                                               | Plan held by the sequence runner          | Checked against the rate guard when planned, then one intent per step  |
| Effect                                                 | Generator held by the effect runner       | As a sequence, repeating                                               |
| Switch                                                 | Button events into the switch engine      | Mapped actions become intents                                          |
| Import                                                 | Validated data into the store             | Sends nothing. What it adds is used later through the paths above      |
| Ceiling control                                        | A governor setting, then profile writes   | The writes are transactions like any other                             |
| Scan, safety profile, background check, hardware check | Internal sources in the engine            | Transactions through the scheduler and governor like any other         |
| Panic                                                  | A message handled first by the bus worker | Scheduler `panic()`, straight to the transports                        |

After the router, every frame that was sent reaches `observe`, the shadow, the bus monitor and, through `outputAt`, the bench preview and the visualiser. The visualiser reads the shadow in every mode. It never reads the hardware.

## 4. The hardware server

`server/` is a Python package of four small modules:

| Module     | Job                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `__main__` | Arguments (the `dist` path, nothing network-related), token, start, and the stop on exit                                      |
| `http`     | Host check, static files from `dist/` with a fixed list of types, the security headers, and the upgrade with its Origin check |
| `session`  | One client, the token, the message parser, the queue of at most 8, the 3 second timer, and the stop                           |
| `hasseb`   | Opens 04CC:0802 through hidapi, builds 10-byte reports, matches sequence numbers, times out, drops idle reports               |

python-dali decodes each frame, so the server knows by itself whether to send twice and whether to wait for a reply. The header values come from a JSON file that `config/security.ts` writes at build time, and a test checks the two match. The server refuses to start without it, and sends the headers on every response, worker scripts included, because a worker takes its CSP from its own response.

Remote use: the server runs on the bench computer, and the other computer forwards 127.0.0.1:47821 to it over SSH. Both ends are loopback, so the Host and Origin checks pass unchanged. The server cannot tell a forwarded client from a local one. The app therefore asks once on connect whether the person can see the lights, shows the answer in the top bar, and the README says to keep a way to stop the server within reach of the bench (`docs/OPEN_QUESTIONS.md` item 2).

## 5. Persistence and migrations

- Stores and their keys are in ADR 0009. Each value is `{ version, data }`.
- `load` reads, checks the version, runs the migrations from that version to the present one, validates the result, and returns it. Failure at any step sets the record aside under a dated key and returns defaults.
- Migrations live in `src/store/migrations/`, one file per step, each with a fixture of the old shape.
- The same validators check workspace files and stored records.
- The radiosity cache is keyed by a hash of geometry, materials and the solver's version. It is safe to delete, and is validated for shape and size like anything else.
- History is written line by line as commands run, so a reload or a closed tab loses nothing.

## 6. Folder layout

```
config/            security headers, shared by Vite and the server
docs/              brief, spec, architecture, threat model, test plan, UI, ADRs, research
e2e/               Playwright tests
server/            the hardware server (Python), its requirements and tests
src/
  dali/            frames, addresses, command table, codec          pure
  sim/             GearModel, Da5l, Simulator                       pure
  bus/             Scheduler, timing                                pure
  safety/          Governor, rate guard, safety profile, panic      pure
  engine/          Engine, router, runners, coalescer, protocol     pure
  console/         line editor, history, parser, completion         pure
  script/          script parser                                    pure
  switch/          part 301 event machine, presets                  pure
  light/           radiosity, direct term, emitters, colour         pure
  store/           validators, migrations, Store interface          pure, plus an IndexedDB adapter
  transport/       SimTransport, ServerTransport                    ServerTransport uses WebSocket
  workers/         bus worker and light worker shells, the Trusted Types policy
  ui/              Svelte components, stores, design tokens, the three.js renderer
tests/             cross-module tests, lint tests, golden fixtures
tools/golden/      fixture generator (python-dali)
tools/first_light.py
```

"Pure" means no DOM, no `window`, no timers and no network, enforced by a lint rule on imports and globals for those folders. Coverage targets in `docs/TEST_PLAN.md` apply to them.

## 7. What runs where

| Thread       | Holds                                                                 | Why                                                              |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Page         | UI, renderer, IndexedDB, wake lock, the session token until handed on | DOM and WebGL live here                                          |
| Bus worker   | Engine and everything under it, the WebSocket                         | Timing free of the UI, and timers that hidden tabs do not slow   |
| Light worker | Radiosity solves                                                      | A solve takes up to a second or two and must not hold up the bus |

The page passes the token to the bus worker in its first message and then drops its own copy.
