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
import { applySafetyProfile, scan, type Submit, type Submitted } from '../../src/safety/profile.ts';
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
  // On hardware the shadow is a separate model; here the sink drives `sim` as if it were the bus.
  const shadow = target === 'hardware' ? Simulator.bench() : sim;
  const governor = new Governor({
    target,
    shadow,
    timing,
    ...(opts.ceilingArc === undefined ? {} : { ceilingArc: opts.ceilingArc }),
  });
  const sink = new SimSink(sim, clock, timing);
  const scheduler = new Scheduler({ clock, sink, gate: governor, timing });
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
  const submit = (tx: Transaction) => scheduler.submit(tx);
  const asSubmit: Submit = async (tx): Promise<Submitted> => {
    const r = await scheduler.submit(tx);
    return r.kind === 'done'
      ? { kind: 'done', results: r.results }
      : r.kind === 'refused'
        ? { kind: 'refused', reason: r.reason }
        : { kind: r.kind, reason: r.reason };
  };
  return {
    clock,
    sim,
    governor,
    scheduler,
    sink,
    timing,
    submit,
    drive,
    run: (tx) => drive(submit(tx)),
    ready: async () => {
      await drive(
        (async () => {
          const found = await scan(governor, asSubmit, [0, 1, 2, 3]);
          for (const n of found) await applySafetyProfile(n, governor, asSubmit);
        })(),
      );
    },
  };
}

/** The bench's `Submit` for the profile and ceiling runners. */
export function asSubmit(b: Bench): Submit {
  return async (tx) => {
    const r = await b.scheduler.submit(tx);
    return r.kind === 'done'
      ? { kind: 'done', results: r.results }
      : { kind: r.kind, reason: r.reason };
  };
}
