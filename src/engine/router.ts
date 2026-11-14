/**
 * The router (docs/ARCHITECTURE.md, SPEC S2.1, ADR 0012). The one place that calls a transport's
 * send. Each router is bound to one transport: the simulated bench has its own, and every hardware
 * connection gets a new one, so an approval for one target can never reach the other.
 *
 * An approval from the governor is single use and time bound: each of its frames goes out once, in
 * order, and frame k must go out within (k + 1) seconds of the judgement (security review S3-M1).
 * Panic's two frames are the only frames that need no approval.
 */
import type { Clock } from '../bus/clock.ts';
import { PANIC_FRAMES, type FrameSink } from '../bus/scheduler.ts';
import { frameEquals } from '../dali/codec.ts';
import type { TxFrame } from '../dali/sequences.ts';
import { isApproved } from '../safety/governor.ts';
import type { Approved, SendResult } from '../safety/types.ts';
import type { Transport } from './transport.ts';

/** How long each frame of an approval stays valid, counted from the judgement. */
export const APPROVAL_FRAME_MS = 1000;

/** The router's connection governor, as far as the router needs it. */
export interface Issuer {
  issued(a: unknown): boolean;
}

export interface RouterOptions {
  readonly transport: Transport;
  readonly clock: Clock;
  /** The governor of this router's connection. Approvals from any other are refused. */
  readonly issuer: Issuer;
  /** Called when a frame is refused here. The engine shows it, and the tests assert it never happens. */
  readonly onRefused?: (reason: string, frame: TxFrame) => void;
}

const isPanicFrame = (f: TxFrame): boolean =>
  PANIC_FRAMES.some(
    (p) =>
      frameEquals(p.frame, f.frame) &&
      p.sendTwice === f.sendTwice &&
      p.expectReply === f.expectReply,
  );

export class Router implements FrameSink {
  private readonly transport: Transport;
  private readonly issuer: Issuer;
  private readonly clock: Clock;
  /** Set by `close`, when the connection is replaced. Nothing more goes out. */
  private closed = false;
  private readonly onRefused: ((reason: string, frame: TxFrame) => void) | undefined;
  /** For each approval, the index of the next frame it allows. */
  private readonly used = new WeakMap<Approved, number>();

  constructor(o: RouterOptions) {
    this.transport = o.transport;
    this.issuer = o.issuer;
    this.clock = o.clock;
    this.onRefused = o.onRefused;
  }

  /** The connection is replaced: refuse every frame from now on, panic's included. */
  close(): void {
    this.closed = true;
  }

  send(frame: TxFrame, approval: Approved): Promise<SendResult> {
    const why = this.check(frame, approval);
    if (why !== undefined) return this.refuse(why, frame);
    return this.transport.send(frame);
  }

  sendPanic(frame: TxFrame): Promise<SendResult> {
    if (this.closed) return this.refuse('The connection was replaced.', frame);
    if (!isPanicFrame(frame))
      return this.refuse('Only TERMINATE and broadcast OFF go out as panic.', frame);
    return this.transport.sendPanic(frame);
  }

  private refuse(reason: string, frame: TxFrame): Promise<SendResult> {
    this.onRefused?.(reason, frame);
    return Promise.resolve({ kind: 'refused', reason });
  }

  private check(frame: TxFrame, approval: unknown): string | undefined {
    if (this.closed) return 'The connection was replaced.';
    if (typeof approval !== 'object' || approval === null)
      return 'The frame has no approval from the governor.';
    const a = approval as Approved;
    if (!isApproved(a, a.tx)) return 'The frame has no approval from the governor.';
    if (!this.issuer.issued(a)) return "The approval is from another connection's governor.";
    const next = this.used.get(a) ?? 0;
    const frames = a.tx.frames;
    if (next >= frames.length) return 'The approval has already been used.';
    if (frames[next] !== frame) return 'The frame is not the next one the governor approved.';
    if (this.clock.now() > a.issuedAt + (next + 1) * APPROVAL_FRAME_MS)
      return 'The approval has expired.';
    this.used.set(a, next + 1);
    return undefined;
  }
}
