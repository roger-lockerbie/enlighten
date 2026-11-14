/**
 * Bus timing (`docs/research/dali.md` section 14, SPEC R1.7). The simulated bus is never faster than
 * the real one: every setting below its floor is raised to the floor.
 */
import type { TxFrame } from '../dali/sequences.ts';

export interface BusTiming {
  /** Settling time before the first frame of a transaction (priority 2 to 5). */
  readonly settleFirstMs: number;
  /** Settling time before later frames of a transaction and the second copy of a pair (priority 1). */
  readonly settleLaterMs: number;
  /** Reply window and backward frame, waited out whether or not gear answers. */
  readonly replyMs: number;
}

/** A 16-bit forward frame: a start bit and 16 bits at 1200 bit/s. */
export const FORWARD_FRAME_MS = 14.2;

/**
 * Defaults: 31.2 ms a command, 46.7 ms a query and 59.4 ms a send-twice pair, Beckhoff's figures at
 * priority 3.
 */
export const DEFAULT_TIMING: BusTiming = {
  settleFirstMs: 17.0,
  settleLaterMs: 14.0,
  replyMs: 15.5,
};

/**
 * Floors no setting may go below: the priority 2 minimum for a first frame (29.1 ms a command), the
 * priority 1 minimum inside a transaction, and the earliest reply (5.5 ms) with a 7.5 ms backward frame.
 */
export const FLOOR_TIMING: BusTiming = { settleFirstMs: 14.9, settleLaterMs: 13.5, replyMs: 13.0 };

export function withFloors(t: Partial<BusTiming>): BusTiming {
  const v = { ...DEFAULT_TIMING, ...t };
  const f = (x: number, floor: number) => (Number.isFinite(x) ? Math.max(x, floor) : floor);
  return {
    settleFirstMs: f(v.settleFirstMs, FLOOR_TIMING.settleFirstMs),
    settleLaterMs: f(v.settleLaterMs, FLOOR_TIMING.settleLaterMs),
    replyMs: f(v.replyMs, FLOOR_TIMING.replyMs),
  };
}

/** How long a frame keeps the bus once its settle time has passed: the frame, a second copy, and the reply window. */
export function wireMs(f: Pick<TxFrame, 'sendTwice' | 'expectReply'>, t: BusTiming): number {
  let ms = FORWARD_FRAME_MS;
  if (f.sendTwice) ms += t.settleLaterMs + FORWARD_FRAME_MS;
  if (f.expectReply) ms += t.replyMs;
  return ms;
}

/**
 * Settle time before a frame. The first frame of a transaction waits the first-frame priority. Later
 * frames wait priority 1, except a send-twice frame, whose first copy is a parameter write at
 * priority 2 or slower, so a pair is never under 56.7 ms (dali.md section 14, SPEC R1.7).
 */
export function settleMs(f: Pick<TxFrame, 'sendTwice'>, first: boolean, t: BusTiming): number {
  return first || f.sendTwice ? t.settleFirstMs : t.settleLaterMs;
}

/** A frame's total bus time, settle included. */
export function frameMs(
  f: Pick<TxFrame, 'sendTwice' | 'expectReply'>,
  first: boolean,
  t: BusTiming,
): number {
  return settleMs(f, first, t) + wireMs(f, t);
}

export interface FrameTime {
  /** When the frame starts on the wire, after its settle time. */
  readonly wireStart: number;
  /** When gear has the whole forward frame (the time the simulator receives it). */
  readonly deliverAt: number;
  /** When the bus is free again. */
  readonly end: number;
}

/** When each frame of a transaction goes out, starting from a free bus at `startAt`. */
export function planFrames(
  frames: readonly Pick<TxFrame, 'sendTwice' | 'expectReply'>[],
  startAt: number,
  t: BusTiming,
): FrameTime[] {
  let at = startAt;
  return frames.map((f, i) => {
    const wireStart = at + settleMs(f, i === 0, t);
    const end = wireStart + wireMs(f, t);
    at = end;
    return { wireStart, deliverAt: wireStart + FORWARD_FRAME_MS, end };
  });
}
