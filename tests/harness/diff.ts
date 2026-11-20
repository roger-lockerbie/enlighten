/**
 * The guard and the checker read one made-up trace, each with its own samples: the guard every 10 ms,
 * the checker every 25 ms, as each does on the bench. Shared by the differential property and the
 * fixed cases kept from it.
 */
import { expect } from 'vitest';
import { scopeViolations } from '../../src/safety/rate/guard.ts';
import {
  directedEvents,
  events,
  mergeDirected,
  mergeTimes,
  SAME_LEG_MS,
  TIME_MARGIN_MS,
  type TraceEvents,
} from '../../src/safety/rate/legs.ts';
import { ROOM } from '../../src/safety/rate/trace.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { rateProblems, TraceRecorder } from './checker.ts';

const EMPTY: TraceEvents = { legs: [], hard: [], reversals: [] };

export interface Seg {
  readonly flat: number;
  readonly fade: number;
  readonly ratio: number;
  readonly up: boolean;
  readonly off: boolean;
}

/** Breakpoints of a piecewise-linear trace: [time, value]. */
export type Pts = readonly (readonly [number, number])[];

export function trace(v0: number, segs: readonly Seg[]): Pts {
  const pts: [number, number][] = [[0, v0]];
  let t = 0;
  let v = v0;
  for (const s of segs) {
    t += s.flat;
    pts.push([t, v]);
    let next = v <= 0 ? 0.01 * s.ratio : s.up ? v * s.ratio : v / s.ratio;
    if (s.off) next = v > 0 ? 0 : 0.03 * s.ratio;
    next = Math.min(1, Math.max(0, next));
    t += s.fade === 0 ? 0.001 : s.fade;
    pts.push([t, next]);
    v = next;
  }
  pts.push([t + 3000, v]);
  return pts;
}

function at(pts: Pts, t: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i] ?? [0, 0];
    const [t0, v0] = pts[i - 1] ?? [0, 0];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1]?.[1] ?? 0;
}

/**
 * Sample times: every breakpoint of every channel, just before each, and a grid of `step` ms that
 * starts `phase` ms in.
 */
function times(channels: readonly Pts[], step: number, phase = 0): number[] {
  const s = new Set<number>([0]);
  let end = 0;
  for (const pts of channels) {
    end = Math.max(end, pts[pts.length - 1]?.[0] ?? 0);
    for (const [t] of pts) {
      s.add(t);
      if (t > 0.001) s.add(t - 0.001);
    }
  }
  for (let t = phase; t < end; t += step) s.add(t);
  return [...s].sort((a, b) => a - b);
}

/**
 * The slow test for a made-up trace: a change is slow when it lies inside a fade of 0.7 s or longer.
 * Breakpoints come in pairs, a fade's start and end, after the first.
 */
function slowOf(pts: Pts): (x: number, y: number) => boolean {
  const slow: [number, number][] = [];
  for (let i = 2; i < pts.length; i += 2) {
    const a = pts[i - 1]?.[0] ?? 0;
    const b = pts[i]?.[0] ?? 0;
    if (b - a >= 700) slow.push([a, b]);
  }
  return (x, y) => slow.some(([a, b]) => a <= x && y <= b);
}

/** The checker's breaches of a rule on trace X imply the guard's own, at the address and the room. */
export function agrees(pts: Pts): void {
  agreesAddress([pts]);
}

/**
 * The same for an address with several channels, each its own trace, as one unit in the room. The
 * checker's grid can start `phase` ms in, since on the bench the two grids do not line up.
 */
export function agreesAddress(channels: readonly Pts[], phase = 0): void {
  const rec = new TraceRecorder(Simulator.of([]), 0);
  rec.points.set(
    'X',
    times(channels, 25, phase).map((t) => ({ t, d: channels.map((pts) => at(pts, t)) })),
  );
  // White channels, so the luminance is the plain sum.
  rec.labels.set(
    'X',
    channels.map(() => (channels.length === 1 ? 'mono' : 'W')),
  );
  const slows = channels.map(slowOf);
  const slow = (x: number, y: number) => slows.every((f) => f(x, y));
  rec.slow.set('X', slow);
  const problems = rateProblems(rec, 3);
  const ts = times(channels, 10);
  const sampled = (v: (t: number) => number) =>
    ts.map((t, k) => ({ t, v: v(t), slow: k > 0 && slow(ts[k - 1] ?? t, t) }));
  const sum = sampled((t) => channels.reduce((acc, pts) => acc + at(pts, t), 0));
  const e = events(sum);
  // An address's events go through the merge of its traces, as `predictEvents` does (S6-D17-1).
  const lists = [...channels.map((pts) => directedEvents(sampled((t) => at(pts, t))))];
  if (channels.length > 1) lists.push(directedEvents(sum));
  const address: TraceEvents = {
    legs: mergeDirected(
      lists.map((l) => l.legs),
      SAME_LEG_MS - TIME_MARGIN_MS,
    ),
    hard: mergeDirected(
      lists.map((l) => l.hard),
      SAME_LEG_MS - TIME_MARGIN_MS,
    ),
    reversals: mergeTimes(lists.map((l) => l.reversals)),
  };
  const guard = (scope: string, rule: string) =>
    scopeViolations(scope, scope === ROOM ? e : address, EMPTY, 3).some((v) =>
      v.rule.includes(rule),
    );
  for (const [rule, guardRule] of [
    ['hard steps', 'hard step'],
    ['reversals', 'reversals'],
  ] as const) {
    const checker = problems.filter((p) => p.rule === rule);
    if (checker.some((p) => p.scope === 'X'))
      expect(guard('a0', guardRule), `${rule} at X`).toBe(true);
    if (checker.some((p) => p.scope === 'room'))
      expect(guard(ROOM, guardRule), `${rule} in the room`).toBe(true);
  }
}
