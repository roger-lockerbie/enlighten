/**
 * The guard and the checker read one made-up trace on the rule's grid (ADR 0019): every 25 ms, every
 * breakpoint and the moment before each. Shared by the differential property and the fixed cases kept
 * from it.
 */
import { expect } from 'vitest';
import { scopeViolations } from '../../src/safety/rate/guard.ts';
import {
  GRID_MS,
  HARD_FADE_MS,
  mergeRead,
  read,
  READINGS,
  unite,
  type TraceEvents,
} from '../../src/safety/rate/legs.ts';
import { ROOM, SLOW_RAN_MS } from '../../src/safety/rate/trace.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import {
  rateEvents,
  rateProblems,
  TraceRecorder,
  type Events,
  type RateProblem,
} from './checker.ts';

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
 * One address's light as a function of time, for both readers: each channel's value, the times at
 * which a change can start or stop, and which changes came from a fade that ran `ran` ms or longer.
 */
export interface Source {
  readonly at: (t: number) => readonly number[];
  readonly bps: readonly number[];
  readonly slow: (ran: number) => (x: number, y: number) => boolean;
  readonly from: number;
  readonly to: number;
}

/** A source from piecewise-linear channels. Breakpoints come in pairs, a fade's start and end, after the first. */
export function sourceOf(channels: readonly Pts[]): Source {
  const slowOf = (pts: Pts, ran: number) => {
    const slow: [number, number][] = [];
    for (let i = 2; i < pts.length; i += 2) {
      const a = pts[i - 1]?.[0] ?? 0;
      const b = pts[i]?.[0] ?? 0;
      if (b - a >= ran) slow.push([a, b]);
    }
    return (x: number, y: number) => slow.some(([a, b]) => a <= x && y <= b);
  };
  return {
    at: (t) => channels.map((pts) => at(pts, t)),
    bps: channels.flatMap((pts) => pts.map(([t]) => t)),
    slow: (ran) => {
      const slows = channels.map((pts) => slowOf(pts, ran));
      return (x, y) => slows.every((f) => f(x, y));
    },
    from: 0,
    to: Math.max(...channels.map((pts) => pts[pts.length - 1]?.[0] ?? 0)),
  };
}

/**
 * The rule's grid over a source (ADR 0019): its first moment, every breakpoint, 0.001 ms before each,
 * and every 25 ms of the clock, `phase` ms on.
 */
function times(src: Source, phase: number): number[] {
  const s = new Set<number>([src.from]);
  for (const t of src.bps) {
    if (t < src.from || t > src.to) continue;
    s.add(t);
    if (t - 0.001 > src.from) s.add(t - 0.001);
  }
  const first = Math.ceil((src.from - phase) / GRID_MS) * GRID_MS + phase;
  for (let t = first; t < src.to; t += GRID_MS) s.add(t);
  return [...s].sort((a, b) => a - b);
}

/** The checker's events for the address, as unit X, and for the room it is alone in. */
export function checkerReads(
  src: Source,
  phase = 0,
): { rec: TraceRecorder; events: Map<string, Events> } {
  const rec = new TraceRecorder(Simulator.of([]), src.from);
  rec.points.set(
    'X',
    times(src, phase).map((t) => ({ t, d: src.at(t) })),
  );
  // White channels, so the luminance is the plain sum.
  const n = src.at(src.from).length;
  rec.labels.set(
    'X',
    Array.from({ length: n }, () => (n === 1 ? 'mono' : 'W')),
  );
  rec.slow.set('X', src.slow(HARD_FADE_MS));
  return { rec, events: rateEvents(rec) };
}

/**
 * The guard's events for the same: every reading, each on its own grid, united (ADR 0019). `only`
 * keeps some of the readings.
 */
export function guardReads(
  src: Source,
  only: (i: number) => boolean = () => true,
): { address: TraceEvents; room: TraceEvents } {
  const address = [];
  const room = [];
  const n = src.at(src.from).length;
  for (const reading of READINGS.filter((_, i) => only(i))) {
    const ts = times(src, reading.shift);
    const slow = src.slow(reading.exact ? HARD_FADE_MS : SLOW_RAN_MS);
    const values = ts.map((t) => src.at(t));
    const sampled = (v: (d: readonly number[]) => number) =>
      ts.map((t, k) => ({ t, v: v(values[k] ?? []), slow: k > 0 && slow(ts[k - 1] ?? t, t) }));
    const sum = read(
      sampled((d) => d.reduce((acc, x) => acc + x, 0)),
      reading,
    );
    // An address's events go through the merge of its traces, as `predictEvents` does (S6-D17-1).
    const lists = Array.from({ length: n }, (_, i) =>
      read(
        sampled((d) => d[i] ?? 0),
        reading,
      ),
    );
    lists.push(sum);
    address.push(mergeRead(lists, reading));
    room.push(sum);
  }
  return { address: unite(address), room: unite(room) };
}

/** The checker's breaches of a rule on trace X imply the guard's own, at the address and the room. */
export function agrees(pts: Pts): void {
  agreesAddress([pts]);
}

/**
 * The same for an address with several channels, each its own trace, as one unit in the room. The
 * checker's grid can sit `phase` ms after the clock's, as it would if a frame went out that much
 * later than judged.
 */
export function agreesAddress(channels: readonly Pts[], phase = 0): void {
  agreesSource(sourceOf(channels), phase);
}

/** The same for any source. Returns the checker's problems. */
export function agreesSource(src: Source, phase = 0, swings = 3): RateProblem[] {
  const { rec } = checkerReads(src, phase);
  const problems = rateProblems(rec, swings);
  const g = guardReads(src);
  const guard = (scope: string, rule: string) =>
    scopeViolations(scope, scope === ROOM ? g.room : g.address, EMPTY, swings).some((v) =>
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
  return problems;
}

/** Every hard step the checker dates lies inside one of the guard's ranges, at the address and in the room. */
export function contained(src: Source, phase = 0): void {
  const { events } = checkerReads(src, phase);
  const g = guardReads(src);
  for (const [scope, ranges] of [
    ['X', g.address.hard],
    ['room', g.room.hard],
  ] as const) {
    for (const t of events.get(scope)?.hard ?? [])
      expect(
        ranges.some((r) => r.lo <= t && t <= r.hi),
        `${scope}: ${String(t)} in ${JSON.stringify(ranges)}`,
      ).toBe(true);
  }
}

/**
 * The guard's exact reading is the rule itself: on the same grid it gives the checker's legs, hard
 * steps and reversals at the checker's dates (ADR 0019). The two share no code.
 */
export function sameReading(src: Source): void {
  const { events } = checkerReads(src);
  const g = guardReads(src, (i) => i === 0);
  for (const [scope, e] of [
    ['X', g.address],
    ['room', g.room],
  ] as const) {
    const c = events.get(scope);
    expect(e.legs, `${scope} legs`).toEqual(c?.legs);
    expect(
      e.hard.map((r) => r.lo),
      `${scope} hard steps`,
    ).toEqual(c?.hard);
    expect(e.reversals, `${scope} reversals`).toEqual(c?.reversals);
  }
}
