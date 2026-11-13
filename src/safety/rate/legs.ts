/**
 * Legs, hard steps and reversals on a sampled trace: the vocabulary of the rate guard (SPEC S3,
 * ADR 0005, with the exact rules in ADR 0011). Pure functions over arrays.
 */

export interface Sample {
  readonly t: number;
  readonly v: number;
}

/** A maximal monotonic run of a trace. Flat stretches shorter than `FLAT_BREAK_MS` do not end a run. */
export interface Run {
  /** Time of the first change. */
  readonly start: number;
  /** Time of the last change. */
  readonly end: number;
  readonly dir: 1 | -1;
  readonly from: number;
  readonly to: number;
  /** The largest ratio of any near-instant step inside the run (off counted as `OFF_FLOOR`). */
  readonly jumpMax: number;
}

export interface TraceEvents {
  /** Start times of legs. */
  readonly legs: number[];
  /** Start times of legs that are hard steps. */
  readonly hard: number[];
  /** Times of reversals that involve a run smaller than a leg. */
  readonly reversals: number[];
}

/** A run is a leg when its ends differ by this ratio or more, or one end is off (S3.1). */
export const LEG_RATIO = 1.1;
/** A leg with a ratio above this is a hard step unless faded (S3.3). */
export const HARD_RATIO = 2;
/** A fade this long or longer is not a hard step (S3.3). */
export const HARD_FADE_MS = 700;
/** Two samples this close are an instant step. */
export const JUMP_MS = 50;
/**
 * For hard steps, output below this fraction counts as this fraction. A fade from off starts with the
 * gear's jump to its minimum (about 1% on the DA5-L), and that jump alone is not a hard step, while an
 * instant jump from off to a higher level still is.
 */
export const OFF_FLOOR = 0.02;

/**
 * A flat stretch this long ends a run, so a change after a pause starts a new leg at its own time.
 * Without it, a move after a long hold would extend an old leg and its start would not count.
 */
export const FLAT_BREAK_MS = 1000;

const EPS = 1e-9;

/** The ratio between two outputs. A move between off and on is infinite. */
export function ratio(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi <= EPS) return 1;
  if (lo <= EPS) return Infinity;
  return hi / lo;
}

function floorRatio(a: number, b: number): number {
  return Math.max(a, b, OFF_FLOOR) / Math.max(Math.min(a, b), OFF_FLOOR);
}

export function runs(samples: readonly Sample[]): Run[] {
  const out: Run[] = [];
  let cur:
    | { start: number; end: number; dir: 1 | -1; from: number; to: number; jumpMax: number }
    | undefined;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1];
    const s = samples[i];
    if (p === undefined || s === undefined) continue;
    const d = s.v - p.v;
    if (Math.abs(d) <= EPS * Math.max(1, Math.abs(s.v))) continue;
    const dir: 1 | -1 = d > 0 ? 1 : -1;
    if (cur?.dir !== dir || p.t - cur.end >= FLAT_BREAK_MS) {
      if (cur !== undefined) out.push(cur);
      cur = { start: p.t, end: s.t, dir, from: p.v, to: s.v, jumpMax: 1 };
    }
    cur.end = s.t;
    cur.to = s.v;
    if (s.t - p.t <= JUMP_MS) cur.jumpMax = Math.max(cur.jumpMax, floorRatio(p.v, s.v));
  }
  if (cur !== undefined) out.push(cur);
  return out;
}

export function isLeg(r: Run): boolean {
  return ratio(r.from, r.to) >= LEG_RATIO;
}

export function touchesOff(r: Run): boolean {
  return r.from <= EPS !== r.to <= EPS;
}

/**
 * A hard step is a leg made with no fade of 0.7 s or longer whose ratio is above 2, or a leg with an
 * instant step above 2 inside it. Off counts as `OFF_FLOOR` here, so switching between off and a very
 * low level, or a channel fading out to zero, is not a hard step on its own.
 */
export function isHard(r: Run): boolean {
  if (!isLeg(r)) return false;
  if (r.jumpMax > HARD_RATIO) return true;
  return floorRatio(r.from, r.to) > HARD_RATIO && r.end - r.start < HARD_FADE_MS;
}

export function events(samples: readonly Sample[]): TraceEvents {
  const rs = runs(samples);
  const legs: number[] = [];
  const hard: number[] = [];
  const reversals: number[] = [];
  rs.forEach((r, i) => {
    if (isLeg(r)) legs.push(r.start);
    if (isHard(r)) hard.push(r.start);
    const prev = rs[i - 1];
    if (prev !== undefined && prev.dir !== r.dir && (!isLeg(prev) || !isLeg(r)))
      reversals.push(r.start);
  });
  return { legs, hard, reversals };
}

/** Merge sorted event times from several traces of one scope, counting events within `tol` ms as one. */
export function mergeTimes(lists: readonly (readonly number[])[], tol = 5): number[] {
  const all = lists.flat().sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > tol) out.push(t);
  }
  return out;
}
