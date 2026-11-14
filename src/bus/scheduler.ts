/**
 * The scheduler (docs/ARCHITECTURE.md, `src/bus`). It keeps transactions whole, sends their frames one
 * at a time with the researched settling times, asks the governor to judge each transaction just
 * before it starts, and reports every frame back to the governor. Panic drops everything queued and
 * sends TERMINATE and broadcast OFF next, without the governor (SPEC S4).
 */
import { broadcast } from '../dali/address.ts';
import { framesForAll, type TxFrame } from '../dali/sequences.ts';
import type {
  Approved,
  SendResult,
  SentFrame,
  Source,
  Transaction,
  Verdict,
} from '../safety/types.ts';
import type { Cancel, Clock } from './clock.ts';
import {
  DEFAULT_TIMING,
  FORWARD_FRAME_MS,
  planFrames,
  settleMs,
  wireMs,
  withFloors,
  type BusTiming,
} from './timing.ts';

/** Where frames go: the router in Stage 4, a test sink here. */
export interface FrameSink {
  /** Send one frame now. Resolves when the bus is free again. */
  send(frame: TxFrame, approval: Approved): Promise<SendResult>;
  /** Panic's frames. The one route that needs no approval (SPEC S2.1). */
  sendPanic(frame: TxFrame): Promise<SendResult>;
}

/** The parts of the governor the scheduler uses. */
export interface Gate {
  judge(tx: Transaction, now: number): Verdict;
  observe(sent: SentFrame, result: SendResult): void;
  latch(): void;
}

/** `urgent` goes to the head of the queue (the OFF after an unlocked RESET). */
export type Priority = 'urgent' | 'interactive' | 'background';

export type TxResult =
  | {
      readonly kind: 'done';
      readonly tx: Transaction;
      readonly results: readonly SendResult[];
      readonly note?: string;
    }
  | { readonly kind: 'refused'; readonly reason: string; readonly retryAt?: number }
  | { readonly kind: 'dropped'; readonly reason: string; readonly results: readonly SendResult[] }
  | { readonly kind: 'fault'; readonly reason: string; readonly results: readonly SendResult[] };

/** The longest panic waits for a frame already on the wire: a send-twice pair with its reply window. */
export const PANIC_WAIT_MS = 100;

/** Panic's transaction: TERMINATE, then broadcast OFF (SPEC S4.3). */
export const PANIC_FRAMES: readonly TxFrame[] = framesForAll([
  { id: 'TERMINATE' },
  { id: 'OFF', address: broadcast },
]);

interface Queued {
  readonly tx: Transaction;
  readonly resolve: (r: TxResult) => void;
}

/** A record of what went on the bus, for the bus monitor and the tests. */
export interface BusRecord {
  readonly frame: TxFrame;
  readonly source: Source;
  readonly wireStart: number;
  readonly deliverAt: number;
  readonly end: number;
  readonly settle: number;
  readonly result: SendResult;
}

export interface SchedulerOptions {
  readonly clock: Clock;
  readonly sink: FrameSink;
  readonly gate: Gate;
  readonly timing?: Partial<BusTiming>;
  /** Called with each frame once it is done. */
  readonly onFrame?: (r: BusRecord) => void;
}

export class Scheduler {
  private readonly clock: Clock;
  private readonly sink: FrameSink;
  private readonly gate: Gate;
  readonly timing: BusTiming;
  private readonly onFrame: ((r: BusRecord) => void) | undefined;
  private readonly interactive: Queued[] = [];
  private readonly background: Queued[] = [];
  private busy = false;
  private freeAt = -Infinity;
  private wake: Cancel | undefined;
  private current: { abort: () => void } | undefined;
  private panicking: Promise<void> | undefined;
  /** Transactions started, to tag their frames for the governor. */
  private txCount = 0;
  /** How many times panic has run. */
  private panics = 0;
  /** The frame on the wire, if any. Panic waits for it and nothing else. */
  private inFlight: Promise<unknown> | undefined;
  private readonly busyLog: { from: number; to: number }[] = [];

  constructor(o: SchedulerOptions) {
    this.clock = o.clock;
    this.sink = o.sink;
    this.gate = o.gate;
    this.timing = withFloors(o.timing ?? DEFAULT_TIMING);
    this.onFrame = o.onFrame;
  }

  get queued(): number {
    return this.interactive.length + this.background.length;
  }

  /** Queue a transaction. It is judged when it reaches the head of the queue. */
  submit(tx: Transaction, priority: Priority = 'interactive'): Promise<TxResult> {
    return new Promise((resolve) => {
      if (priority === 'urgent') this.interactive.unshift({ tx, resolve });
      else (priority === 'interactive' ? this.interactive : this.background).push({ tx, resolve });
      this.pump();
    });
  }

  /** Share of the last second the bus was busy, settling times included. */
  utilisation(): number {
    const now = this.clock.now();
    const from = now - 1000;
    let busy = 0;
    for (const b of this.busyLog) busy += Math.max(0, Math.min(b.to, now) - Math.max(b.from, from));
    return Math.min(1, busy / 1000);
  }

  private record(from: number, to: number): void {
    this.busyLog.push({ from, to });
    const cutoff = this.clock.now() - 2000;
    while ((this.busyLog[0]?.to ?? Infinity) < cutoff) this.busyLog.shift();
  }

  private pump(): void {
    if (this.busy || this.panicking !== undefined) return;
    const next = this.interactive.shift() ?? this.background.shift();
    if (next === undefined) return;
    this.busy = true;
    void this.run(next).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  private waitUntil(t: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        this.current = undefined;
        resolve(ok);
      };
      this.current = {
        abort: () => {
          finish(false);
        },
      };
      this.wake = this.clock.at(t, () => {
        finish(true);
      });
    });
  }

  private async run(q: Queued): Promise<void> {
    const start = Math.max(this.clock.now(), this.freeAt);
    const verdict = this.gate.judge(q.tx, start);
    if (verdict.kind === 'refuse') {
      q.resolve({
        kind: 'refused',
        reason: verdict.reason,
        ...(verdict.retryAt === undefined ? {} : { retryAt: verdict.retryAt }),
      });
      return;
    }
    // Send exactly what was approved: the governor's frozen copy (security review M1).
    const tx = verdict.approval.tx;
    // A panic during this transaction drops the rest of it, however its timers fall (review L1).
    const epoch = this.panics;
    const txId = ++this.txCount;
    const times = planFrames(tx.frames, start, this.timing);
    const results: SendResult[] = [];
    for (let k = 0; k < tx.frames.length; k++) {
      const f = tx.frames[k];
      const at = times[k];
      if (f === undefined || at === undefined) break;
      // Never closer than the settle time to the end of the frame before, whatever the transport took.
      const go = await this.waitUntil(
        Math.max(at.wireStart, this.freeAt + settleMs(f, k === 0, this.timing)),
      );
      if (!go || this.panics !== epoch) {
        q.resolve({ kind: 'dropped', reason: 'Panic dropped this transaction.', results });
        return;
      }
      const wireStart = this.clock.now();
      const sending = this.sink.send(f, verdict.approval);
      this.inFlight = sending;
      const result = await sending;
      this.inFlight = undefined;
      const end = Math.max(this.clock.now(), wireStart + wireMs(f, this.timing));
      const settle = settleMs(f, k === 0, this.timing);
      this.freeAt = end;
      this.record(wireStart - settle, end);
      const deliverAt = wireStart + FORWARD_FRAME_MS;
      this.gate.observe({ frame: f, at: deliverAt, source: tx.source, tx: txId }, result);
      this.onFrame?.({ frame: f, source: tx.source, wireStart, deliverAt, end, settle, result });
      results.push(result);
      if (result.kind === 'fault' || result.kind === 'refused') {
        q.resolve({ kind: 'fault', reason: result.reason, results });
        return;
      }
    }
    q.resolve({
      kind: 'done',
      tx,
      results,
      ...(verdict.kind === 'clamp' ? { note: verdict.note } : {}),
    });
  }

  /**
   * Panic: latch the governor, drop the queue, let the frame on the wire finish, then send TERMINATE
   * and broadcast OFF. The rate guard is not asked (SPEC S4.3, S3.8).
   */
  panic(): Promise<void> {
    if (this.panicking !== undefined) return this.panicking;
    this.panics++;
    this.gate.latch();
    this.wake?.();
    this.current?.abort();
    for (const q of [...this.interactive.splice(0), ...this.background.splice(0)]) {
      q.resolve({ kind: 'dropped', reason: 'Panic dropped this transaction.', results: [] });
    }
    this.panicking = this.sendPanic().finally(() => {
      this.panicking = undefined;
      this.pump();
    });
    return this.panicking;
  }

  private async sendPanic(): Promise<void> {
    // Let a frame already on the wire finish (the sink resolves when the bus is free), but do not wait
    // on a transport that has stopped answering (review L1).
    const inFlight = this.inFlight;
    if (inFlight !== undefined) {
      await Promise.race([
        inFlight.catch(() => undefined),
        this.waitFor(this.clock.now() + PANIC_WAIT_MS),
      ]);
    }
    for (let k = 0; k < PANIC_FRAMES.length; k++) {
      const f = PANIC_FRAMES[k];
      if (f === undefined) continue;
      const settle = settleMs(f, k === 0, this.timing);
      const wireStartAt = Math.max(this.clock.now(), this.freeAt + settle);
      if (wireStartAt > this.clock.now()) await this.waitFor(wireStartAt);
      const wireStart = this.clock.now();
      const result = await this.sink.sendPanic(f);
      const end = Math.max(this.clock.now(), wireStart + wireMs(f, this.timing));
      this.freeAt = end;
      this.record(wireStart - settle, end);
      const deliverAt = wireStart + FORWARD_FRAME_MS;
      this.gate.observe({ frame: f, at: deliverAt, source: 'panic' }, result);
      this.onFrame?.({ frame: f, source: 'panic', wireStart, deliverAt, end, settle, result });
    }
  }

  private waitFor(t: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.at(t, resolve);
    });
  }
}
