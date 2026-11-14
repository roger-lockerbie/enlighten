/**
 * The bench for tests: the simulator, the governor, the scheduler, the router and `SimTransport` on a
 * virtual clock.
 */
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { Scheduler, type FrameSink, type TxResult } from '../../src/bus/scheduler.ts';
import { withFloors, type BusTiming } from '../../src/bus/timing.ts';
import type { TxFrame } from '../../src/dali/sequences.ts';
import { Router } from '../../src/engine/router.ts';
import { Governor } from '../../src/safety/governor.ts';
import {
  applySafetyProfile,
  patient,
  scan,
  type Submit,
  type Submitted,
} from '../../src/safety/profile.ts';
import type { Approved, SendResult, Target, Transaction } from '../../src/safety/types.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { SimTransport, type SimLog } from '../../src/transport/sim.ts';

/**
 * The bench's sink: the real router over a `SimTransport`, with the transport's test hooks in reach.
 * A frame the router refuses sets `unapproved`, which tests assert stays false.
 */
export class BenchSink implements FrameSink {
  unapproved = false;
  readonly transport: SimTransport;
  private readonly router: () => Router;

  constructor(transport: SimTransport, router: () => Router) {
    this.transport = transport;
    this.router = router;
  }

  get log(): readonly SimLog[] {
    return this.transport.log;
  }

  get fault(): SimTransport['fault'] {
    return this.transport.fault;
  }

  set fault(f: SimTransport['fault']) {
    this.transport.fault = f;
  }

  get onSend(): SimTransport['onSend'] {
    return this.transport.onSend;
  }

  set onSend(f: SimTransport['onSend']) {
    this.transport.onSend = f;
  }

  send(frame: TxFrame, approval: Approved): Promise<SendResult> {
    return this.router().send(frame, approval);
  }

  sendPanic(frame: TxFrame): Promise<SendResult> {
    return this.router().sendPanic(frame);
  }
}

const isDone = (st: { done: boolean }): boolean => st.done;

export interface Bench {
  readonly clock: VirtualClock;
  readonly sim: Simulator;
  readonly governor: Governor;
  readonly scheduler: Scheduler;
  readonly sink: BenchSink;
  readonly timing: BusTiming;
  submit(tx: Transaction): Promise<TxResult>;
  /** Run the clock until a promise settles. */
  drive<T>(p: Promise<T>): Promise<T>;
  /** Submit and drive to the result. */
  run(tx: Transaction): Promise<TxResult>;
  /** Scan and apply the safety profile to every address found. */
  ready(): Promise<void>;
  /** A new connection: a fresh governor and scheduler, as Stage 4's router makes on reconnect. */
  reconnect(): void;
}

export function makeBench(
  opts: {
    sim?: Simulator;
    target?: Target;
    ceilingArc?: number;
    timing?: Partial<BusTiming>;
    start?: number;
  } = {},
): Bench {
  const clock = new VirtualClock(opts.start ?? 1000);
  const sim = opts.sim ?? Simulator.bench();
  const timing = withFloors(opts.timing ?? {});
  const target = opts.target ?? 'simulator';
  const transport = new SimTransport(sim, clock, timing);
  // A new router per connection, as the engine makes one per hardware connect.
  let router: Router | undefined;
  const sink = new BenchSink(transport, () => {
    if (router === undefined) throw new Error('The bench has no connection.');
    return router;
  });
  const connect = () => {
    router = new Router({
      transport,
      clock,
      onRefused: () => {
        sink.unapproved = true;
      },
    });
    // On hardware the shadow is a separate model that knows nothing at connect (SPEC R1.1a).
    const shadow = target === 'hardware' ? new Simulator([]) : sim;
    const governor = new Governor({
      target,
      shadow,
      timing,
      connectedAt: clock.now(),
      ...(opts.ceilingArc === undefined ? {} : { ceilingArc: opts.ceilingArc }),
    });
    const scheduler = new Scheduler({ clock, sink, gate: governor, timing });
    return { governor, scheduler };
  };
  let conn = connect();
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    const st: { done: boolean; failed: boolean; value?: T; error?: unknown } = {
      done: false,
      failed: false,
    };
    p.then(
      (v) => {
        st.done = true;
        st.value = v;
      },
      (e: unknown) => {
        st.done = true;
        st.failed = true;
        st.error = e;
      },
    );
    for (let i = 0; i < 1_000_000 && !st.done; i++) {
      await flushMicrotasks();
      if (isDone(st)) break;
      const n = clock.next();
      if (n === undefined) throw new Error('The bench is stuck: nothing is waiting on the clock.');
      await clock.advanceTo(n);
    }
    if (st.failed) throw st.error;
    return st.value as T;
  };
  const submit = (tx: Transaction) => conn.scheduler.submit(tx);
  const asSubmit: Submit = async (tx, priority): Promise<Submitted> =>
    toSubmitted(await conn.scheduler.submit(tx, priority));
  const bench: Bench = {
    clock,
    sim,
    get governor() {
      return conn.governor;
    },
    get scheduler() {
      return conn.scheduler;
    },
    sink,
    timing,
    submit,
    drive,
    run: (tx) => drive(submit(tx)),
    ready: async () => {
      await drive(
        (async () => {
          const wait = (ms: number) =>
            new Promise<void>((r) => {
              clock.at(clock.now() + ms, r);
            });
          const s = patient(asSubmit, wait, () => clock.now());
          const found = await scan(conn.governor, s, [0, 1, 2, 3]);
          for (const n of found) await applySafetyProfile(n, conn.governor, s);
        })(),
      );
    },
    reconnect: () => {
      conn = connect();
    },
  };
  return bench;
}

/** The bench's `Submit` for the profile and ceiling runners. */
export function asSubmit(b: Bench): Submit {
  return async (tx, priority) => toSubmitted(await b.scheduler.submit(tx, priority));
}

function toSubmitted(r: TxResult): Submitted {
  if (r.kind === 'done') return { kind: 'done', results: r.results };
  if (r.kind === 'refused')
    return {
      kind: 'refused',
      reason: r.reason,
      ...(r.retryAt === undefined ? {} : { retryAt: r.retryAt }),
    };
  return { kind: r.kind, reason: r.reason };
}
