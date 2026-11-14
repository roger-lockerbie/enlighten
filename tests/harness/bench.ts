/**
 * The bench for tests: the simulator, the governor and the scheduler on a virtual clock, with a sink
 * that plays the part of the Stage 4 router and SimTransport.
 */
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { Scheduler, type FrameSink, type TxResult } from '../../src/bus/scheduler.ts';
import { FORWARD_FRAME_MS, wireMs, withFloors, type BusTiming } from '../../src/bus/timing.ts';
import { frameEquals } from '../../src/dali/codec.ts';
import type { TxFrame } from '../../src/dali/sequences.ts';
import { Governor, isApproved } from '../../src/safety/governor.ts';
import {
  applySafetyProfile,
  patient,
  scan,
  type Submit,
  type Submitted,
} from '../../src/safety/profile.ts';
import type { Approved, SendResult, Target, Transaction } from '../../src/safety/types.ts';
import { Simulator } from '../../src/sim/simulator.ts';

export interface SinkLog {
  readonly frame: TxFrame;
  readonly at: number;
  readonly panic: boolean;
}

export class SimSink implements FrameSink {
  readonly log: SinkLog[] = [];
  /** Return true to make a frame end in a transport fault. `reached` says whether it still hit the bus. */
  fault: ((f: TxFrame) => { reached: boolean } | undefined) | undefined;
  /** Set when a frame arrived without a valid approval. Tests assert it stays false. */
  unapproved = false;
  /** Called as each frame starts on the wire, before the bus sees it. */
  onSend: ((frame: TxFrame) => void) | undefined;

  constructor(
    private readonly sim: Simulator,
    private readonly clock: VirtualClock,
    private readonly timing: BusTiming,
  ) {}

  send(frame: TxFrame, approval: Approved): Promise<SendResult> {
    if (
      !isApproved(approval, approval.tx) ||
      !approval.tx.frames.some((f) => f === frame || frameEquals(f.frame, frame.frame))
    ) {
      this.unapproved = true;
    }
    return this.transmit(frame, false);
  }

  sendPanic(frame: TxFrame): Promise<SendResult> {
    return this.transmit(frame, true);
  }

  private transmit(frame: TxFrame, panic: boolean): Promise<SendResult> {
    this.onSend?.(frame);
    const start = this.clock.now();
    const deliverAt = start + FORWARD_FRAME_MS;
    const end = start + wireMs(frame, this.timing);
    const fault = panic ? undefined : this.fault?.(frame);
    return new Promise((resolve) => {
      let result: SendResult = { kind: 'sent' };
      this.clock.at(deliverAt, () => {
        if (fault !== undefined && !fault.reached) return;
        this.log.push({ frame, at: deliverAt, panic });
        const r = this.sim.send(frame, deliverAt, this.timing.settleLaterMs + FORWARD_FRAME_MS);
        if (frame.expectReply) {
          result =
            r.kind === 'value'
              ? { kind: 'reply', byte: r.byte }
              : r.kind === 'collision'
                ? { kind: 'framing-error' }
                : { kind: 'no-reply' };
        }
      });
      this.clock.at(end, () => {
        resolve(
          fault !== undefined ? { kind: 'fault', reason: 'the transport did not answer' } : result,
        );
      });
    });
  }
}

const isDone = (st: { done: boolean }): boolean => st.done;

export interface Bench {
  readonly clock: VirtualClock;
  readonly sim: Simulator;
  readonly governor: Governor;
  readonly scheduler: Scheduler;
  readonly sink: SimSink;
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
  const sink = new SimSink(sim, clock, timing);
  const connect = () => {
    // On hardware the shadow is a separate model that knows nothing at connect (SPEC R1.1a).
    const shadow = target === 'hardware' ? Simulator.bench() : sim;
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
  const asSubmit: Submit = async (tx): Promise<Submitted> =>
    toSubmitted(await conn.scheduler.submit(tx));
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
  return async (tx) => toSubmitted(await b.scheduler.submit(tx));
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
