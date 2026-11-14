/**
 * The simulator as a transport (docs/ARCHITECTURE.md). It takes as long as the real bus would: the
 * frame reaches the gear at the end of the forward frame, and the result comes back when the bus is
 * free again (SPEC R1.7).
 */
import { FORWARD_FRAME_MS, wireMs, type BusTiming } from '../bus/timing.ts';
import type { Clock } from '../bus/clock.ts';
import type { TxFrame } from '../dali/sequences.ts';
import type { Transport, TransportState } from '../engine/transport.ts';
import type { SendResult } from '../safety/types.ts';
import type { Simulator } from '../sim/simulator.ts';

export interface SimLog {
  readonly frame: TxFrame;
  readonly at: number;
  readonly panic: boolean;
}

export class SimTransport implements Transport {
  readonly kind = 'sim';
  /** Every frame that reached the simulated bus, with the time it arrived. Kept for tests only. */
  readonly log: SimLog[] = [];
  private readonly keepLog: boolean;
  /** For tests: make a frame end in a transport fault. `reached` says whether it still hit the bus. */
  fault: ((f: TxFrame) => { reached: boolean } | undefined) | undefined;
  /** For tests: called as each frame starts on the wire. */
  onSend: ((frame: TxFrame) => void) | undefined;
  private readonly sim: Simulator;
  private readonly clock: Clock;
  private readonly timing: BusTiming;

  constructor(sim: Simulator, clock: Clock, timing: BusTiming, opts: { keepLog?: boolean } = {}) {
    this.sim = sim;
    this.clock = clock;
    this.timing = timing;
    this.keepLog = opts.keepLog === true;
  }

  state(): TransportState {
    return 'ready';
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  send(frame: TxFrame): Promise<SendResult> {
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
        if (this.keepLog) this.log.push({ frame, at: deliverAt, panic });
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
