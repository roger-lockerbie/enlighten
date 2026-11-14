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
/**
 * The guard decides with a small margin on every ratio and time, so differences in where a trace is
 * sampled cannot let the real output pass a limit (ADR 0011).
 */
export const RATIO_MARGIN = 0.99;
export const TIME_MARGIN_MS = 40;
/** Fade ends are exact in the trace, so the 0.7 s fade test needs only a small margin. */
export const FADE_MARGIN_MS = 5;
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
  let p: Sample | undefined;
  for (const s of samples) {
    const prev = p;
    p = s;
    if (prev === undefined) continue;
    const d = s.v - prev.v;
    if (Math.abs(d) <= EPS * Math.max(1, Math.abs(s.v))) continue;
    const dir: 1 | -1 = d > 0 ? 1 : -1;
    if (cur?.dir !== dir || prev.t - cur.end >= FLAT_BREAK_MS) {
      if (cur !== undefined) out.push(cur);
      cur = { start: prev.t, end: s.t, dir, from: prev.v, to: s.v, jumpMax: 1 };
    }
    cur.end = s.t;
    cur.to = s.v;
    if (s.t - prev.t <= JUMP_MS) cur.jumpMax = Math.max(cur.jumpMax, floorRatio(prev.v, s.v));
  }
  if (cur !== undefined) out.push(cur);
  return out;
}

/**
 * For the reversal rule, a run whose ends differ by less than 0.5% is not a change: a smooth peak
 * where two fades cross wobbles below that, by however the trace happens to be sampled. The guard
 * uses 0.4%, so it never counts fewer reversals than the rule.
 */
export const REVERSAL_MIN_RATIO = 1.005;

function isChange(r: Run): boolean {
  return ratio(r.from, r.to) >= 1 + (REVERSAL_MIN_RATIO - 1) * 0.8;
}

export function isLeg(r: Run): boolean {
  return ratio(r.from, r.to) >= LEG_RATIO * RATIO_MARGIN;
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
  const hard = HARD_RATIO * RATIO_MARGIN;
  if (r.jumpMax > hard) return true;
  return floorRatio(r.from, r.to) > hard && r.end - r.start < HARD_FADE_MS + FADE_MARGIN_MS;
}

/** An event with the direction of the leg it starts: 1 up, -1 down, 0 for a saturated red change. */
export interface Directed {
  readonly t: number;
  readonly dir: 1 | -1 | 0;
}

export interface DirectedEvents {
  readonly legs: Directed[];
  readonly hard: Directed[];
  readonly reversals: number[];
}

export function directedEvents(samples: readonly Sample[]): DirectedEvents {
  const rs = runs(samples);
  const legs: Directed[] = [];
  const hard: Directed[] = [];
  const reversals: number[] = [];
  rs.forEach((r, i) => {
    if (isLeg(r)) legs.push({ t: r.start, dir: r.dir });
    if (isHard(r)) hard.push({ t: r.start, dir: r.dir });
    const prev = rs[i - 1];
    if (
      prev !== undefined &&
      prev.dir !== r.dir &&
      (!isLeg(prev) || !isLeg(r)) &&
      isChange(prev) &&
      isChange(r)
    ) {
      reversals.push(r.start);
    }
  });
  return { legs, hard, reversals };
}

export function events(samples: readonly Sample[]): TraceEvents {
  const e = directedEvents(samples);
  return { legs: e.legs.map((x) => x.t), hard: e.hard.map((x) => x.t), reversals: e.reversals };
}

/**
 * Legs of one address on its several traces (each channel and luminance) that go the same way and
 * start within this time of the first of them are one leg: one movement shows up on several channels,
 * with each channel's peak at a slightly different time. Opposite directions are never merged.
 */
export const SAME_LEG_MS = 100;

/** Merge directed events from several traces into one list of start times (see `SAME_LEG_MS`). */
export function mergeDirected(
  lists: readonly (readonly Directed[])[],
  tol = SAME_LEG_MS,
): number[] {
  const all = lists.flat().sort((a, b) => a.t - b.t);
  const clusters: Directed[] = [];
  for (const e of all) {
    const near = clusters.some((c) => c.dir === e.dir && e.t - c.t <= tol);
    if (!near) clusters.push(e);
  }
  return mergeTimes([clusters.map((c) => c.t)]);
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

/**
 * Unite the events of two predictions of the same trace (faded, and with every change made at once,
 * ADR 0011). An event within `tol` ms of one in the other prediction is the same event, so each group
 * keeps as many events as the prediction that has the most of them. Unlike `mergeTimes`, events of one
 * prediction are never merged with each other: they were already merged where they came from, and two
 * left that close together are distinct legs (an instant rise with a fade starting down at the same
 * moment, found by the Stage 4 property run).
 */
export function uniteTimes(a: readonly number[], b: readonly number[], tol = 5): number[] {
  const all = [...a.map((t) => ({ t, i: 0 })), ...b.map((t) => ({ t, i: 1 }))].sort(
    (x, y) => x.t - y.t || x.i - y.i,
  );
  const out: number[] = [];
  let start = -Infinity;
  const counts = [0, 0];
  let kept = 0;
  for (const e of all) {
    if (e.t - start > tol) {
      start = e.t;
      counts[0] = 0;
      counts[1] = 0;
      kept = 0;
    }
    const c = (counts[e.i] ?? 0) + 1;
    counts[e.i] = c;
    if (c > kept) {
      out.push(e.t);
      kept = c;
    }
  }
  return out;
}
