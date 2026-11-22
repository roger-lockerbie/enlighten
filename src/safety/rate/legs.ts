/**
 * Legs, hard steps and reversals on a sampled trace: the vocabulary of the rate guard (SPEC S3,
 * ADR 0005, with the exact rules in ADR 0011, ADR 0015 and ADR 0016). Pure functions over arrays.
 *
 * A trace is read more than once (ADR 0019). The exact reading is the rule itself, on the rule's grid.
 * The cautious readings use the guard's margins, on the grid and on grids a few ms out of step. Each
 * reading gives a hard step one date. United, a hard step's date is a range, and it counts once.
 */

export interface Sample {
  readonly t: number;
  readonly v: number;
  /**
   * The change from the previous sample came only from fades that ran 0.7 s or longer, so it is
   * never part of a hard step (S3.3, ADR 0016). Left out, the change counts as fast.
   */
  readonly slow?: boolean;
}

/** One way of reading a trace: the rule as written, or with the guard's margins, and where its grid sits. */
export interface Reading {
  /** The rule with no margins. Otherwise every ratio and time has the guard's margin. */
  readonly exact: boolean;
  /** How far this reading's 25 ms grid sits after the whole 25 ms of the clock. */
  readonly shift: number;
}

/** The rule reads the light every whole 25 ms of the clock, and at every plan breakpoint (ADR 0019). */
export const GRID_MS = 25;
export const EXACT: Reading = { exact: true, shift: 0 };
export const CAUTIOUS: Reading = { exact: false, shift: 0 };
/** Every reading the guard takes of a faded prediction. */
export const READINGS: readonly Reading[] = [
  EXACT,
  CAUTIOUS,
  { exact: false, shift: 8 },
  { exact: false, shift: 17 },
];

/** A maximal monotonic run of a trace. Flat stretches shorter than `FLAT_BREAK_MS` do not end a run. */
export interface Run {
  /** Time of the sample before the first change. */
  readonly start: number;
  /** Time of the last change. */
  readonly end: number;
  readonly dir: 1 | -1;
  readonly from: number;
  readonly to: number;
  /**
   * The instant steps inside the run, each a change by more than 2 within `JUMP_MS`. Steps that
   * follow on are one step. A run can hold more than one: a slow fade elsewhere keeps the run going
   * between them.
   */
  readonly jumps: readonly Jump[];
  /** The ratio the run's fast changes add up to (floored as for hard steps), slow fades left out. */
  readonly fastRatio: number;
  /**
   * The sample before the run's first fast change: where its fast movement began. A fast leg's hard
   * step is dated here, so every channel of one fade dates it alike, wherever each crosses 2%.
   */
  readonly fastStart: number | undefined;
  /**
   * Fast spans: fast change above 2 within 0.7 s, dated at the latest sample from which it is still
   * above 2 when it is first found. Spans that follow on are one (ADR 0016).
   */
  readonly spans: readonly Span[];
}

/** An instant step: where it began and ended. */
export interface Jump {
  readonly t: number;
  readonly endT: number;
}

/** A fast span: its date, and the last sample at which it was still found. */
export interface Span {
  readonly t: number;
  readonly until: number;
}

/** A hard step in one reading: its date, the last sample that was part of it, and its direction. */
export interface Step {
  readonly t: number;
  readonly until: number;
  readonly dir: 1 | -1 | 0;
}

/** A hard step's date: every date a reading gives it lies from `lo` to `hi` (ADR 0019). */
export interface Range {
  readonly lo: number;
  readonly hi: number;
  /** Which way it went, where a reading found it: 1 up, -1 down. An extra event has none. */
  readonly dir?: 1 | -1 | 0;
}

export interface TraceEvents {
  /** Start times of legs. */
  readonly legs: number[];
  /** Hard steps, each counted once, in order of their earliest date. */
  readonly hard: Range[];
  /** Times of reversals that involve a run smaller than a leg. */
  readonly reversals: number[];
}

/** A run is a leg when its ends differ by this ratio or more, or one end is off (S3.1). */
export const LEG_RATIO = 1.1;
/**
 * A cautious reading decides with a small margin on every ratio and time, so a frame that goes out a
 * little later than judged cannot let the real output pass a limit (ADR 0011).
 */
export const RATIO_MARGIN = 0.99;
export const TIME_MARGIN_MS = 40;
/** Fade ends are exact in the trace, so the 0.7 s fade test needs only a small margin. */
export const FADE_MARGIN_MS = 5;
/** A leg with a ratio above this is a hard step unless faded (S3.3). */
export const HARD_RATIO = 2;
/** A fade this long or longer is not a hard step (S3.3). */
export const HARD_FADE_MS = 700;
/** A change within this time is an instant step. */
export const JUMP_MS = 50;
/** The rule counts instant steps this close as one, and a span and a step of one movement as one. */
export const SAME_STEP_MS = 100;
/** Samples closer than this are the two sides of one moment: the grid has one 0.001 ms before each breakpoint. */
const STEP_GAP_MS = 0.01;
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
/**
 * For the reversal rule, a run whose ends differ by less than 0.5% is not a change: a smooth peak
 * where two fades cross wobbles below that. A cautious reading uses 0.4%, so it never counts fewer
 * reversals than the rule.
 */
export const REVERSAL_MIN_RATIO = 1.005;

const EPS = 1e-9;

/** The limits one reading decides by. */
interface Limits {
  /** Log of the ratio a hard step is above. */
  readonly logHard: number;
  /** Log of the ratio above which a span surely carries the last one on. */
  readonly logSure: number;
  readonly jumpWindow: number;
  /** A later instant step this soon after the last one ended is part of it. */
  readonly jumpJoin: number;
  /** A step this close to 2, straight after a hard step, is part of it. Zero for none. */
  readonly fold: number;
  /** A span is fast change above 2 within this window. `spanOpen`: the window's far end is left out. */
  readonly spanWindow: number;
  readonly spanOpen: boolean;
  /** The window in which a span surely carries the last one on. */
  readonly sureWindow: number;
  /** A span that starts this long after the last one began is a new one. */
  readonly spanApart: number;
  /** A fast leg took less than this. */
  readonly fastLeg: number;
  readonly leg: number;
  readonly surelyLeg: number;
  readonly change: number;
  /** Spans and instant steps of one run this close are one hard step. */
  readonly same: number;
  /** Channels' events this close, going the same way, are one event at the address. */
  readonly sameLeg: number;
}

const RULE: Limits = {
  logHard: Math.log(HARD_RATIO),
  logSure: Math.log(HARD_RATIO),
  jumpWindow: JUMP_MS,
  jumpJoin: SAME_STEP_MS,
  fold: HARD_RATIO * 0.98,
  spanWindow: HARD_FADE_MS,
  spanOpen: true,
  sureWindow: HARD_FADE_MS,
  spanApart: HARD_FADE_MS,
  fastLeg: HARD_FADE_MS,
  leg: LEG_RATIO,
  surelyLeg: LEG_RATIO,
  change: REVERSAL_MIN_RATIO,
  same: SAME_STEP_MS,
  sameLeg: 100,
};

const MARGINS: Limits = {
  logHard: Math.log(HARD_RATIO * RATIO_MARGIN),
  logSure: Math.log(HARD_RATIO / RATIO_MARGIN),
  jumpWindow: JUMP_MS + 10,
  jumpJoin: JUMP_MS,
  fold: 0,
  spanWindow: HARD_FADE_MS + TIME_MARGIN_MS,
  spanOpen: false,
  sureWindow: HARD_FADE_MS - TIME_MARGIN_MS,
  spanApart: HARD_FADE_MS - TIME_MARGIN_MS,
  fastLeg: HARD_FADE_MS + FADE_MARGIN_MS,
  leg: LEG_RATIO * RATIO_MARGIN,
  surelyLeg: LEG_RATIO / RATIO_MARGIN,
  change: 1 + (REVERSAL_MIN_RATIO - 1) * 0.8,
  same: JUMP_MS,
  sameLeg: 100 - TIME_MARGIN_MS,
};

function limits(reading: Reading): Limits {
  return reading.exact ? RULE : MARGINS;
}

/**
 * Legs of one address on its several traces (each channel and luminance) that go the same way and
 * start within this time of the first of them are one leg: one movement shows up on several channels,
 * with each channel's peak at a slightly different time. Opposite directions are never merged. A
 * cautious reading merges less than the rule allows.
 */
export const SAME_LEG_MS = 100;

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

interface Building {
  start: number;
  end: number;
  dir: 1 | -1;
  from: number;
  to: number;
  jumps: { t: number; endT: number }[];
  /** The run's samples from the last `jumpWindow`, for the instant-step test. */
  win: Sample[];
  /** Every sample time of the run, and the log of the fast ratio from the run's start to each. */
  ts: number[];
  cum: number[];
  /** Whether the output moved fast from the sample before, and the output at each sample. */
  moved: boolean[];
  vs: number[];
  spans: { t: number; until: number }[];
  /** The last sample at which a span surely carried on. */
  sureUntil: number;
  fastStart: number | undefined;
}

/** The first index whose time is within `window` of `t`. `open` leaves out the window's far end. */
function firstWithin(ts: readonly number[], t: number, window: number, open: boolean): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const gap = t - (ts[mid] ?? -Infinity);
    if (open ? gap >= window : gap > window) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The latest sample within `window` of the newest one from which the fast change to it is more than
 * `logRatio`, or undefined. The fast change only grows looking back, so the samples that qualify are
 * the earliest ones in the window, and a binary search finds the last of them. Fast movement from
 * below the 2% floor adds little to the ratio, but it is where the movement began: each channel of
 * one fade from off crosses 2% at a different moment, and they must agree. The date therefore walks back
 * over it.
 */
function spanFrom(
  c: Building,
  window: number,
  open: boolean,
  logRatio: number,
): number | undefined {
  const j = c.ts.length - 1;
  const t = c.ts[j] ?? 0;
  const top = c.cum[j] ?? 0;
  const first = firstWithin(c.ts, t, window, open);
  if (first >= j || top - (c.cum[first] ?? 0) <= logRatio) return undefined;
  let lo = first;
  let hi = j - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (top - (c.cum[mid] ?? 0) > logRatio) lo = mid;
    else hi = mid - 1;
  }
  let k = lo;
  while (k > first && c.moved[k] === true && (c.vs[k - 1] ?? Infinity) <= OFF_FLOOR) k--;
  return c.ts[k];
}

/**
 * The fast span test at the newest sample (ADR 0016). Fast change above 2 within 0.7 s is a span from
 * the latest sample it is still above 2 from. It is part of the last span when it starts at or before
 * the last sample at which that span carried on, or within 0.7 s of where that span began.
 */
function spanStep(c: Building, lim: Limits): void {
  const now = c.ts[c.ts.length - 1] ?? 0;
  const from = spanFrom(c, lim.spanWindow, lim.spanOpen, lim.logHard);
  if (from === undefined) return;
  const last = c.spans[c.spans.length - 1];
  if (last === undefined || (from > c.sureUntil && from >= last.t + lim.spanApart))
    c.spans.push({ t: from, until: now });
  else last.until = now;
  // A cautious reading lets only a span it is sure of carry the last one on, so a span on the border
  // never joins two that the rule would count.
  if (lim === RULE || spanFrom(c, lim.sureWindow, lim.spanOpen, lim.logSure) !== undefined)
    c.sureUntil = now;
}

export function runs(samples: readonly Sample[], reading: Reading = CAUTIOUS): Run[] {
  const lim = limits(reading);
  const hard = Math.exp(lim.logHard);
  const out: Run[] = [];
  let cur: Building | undefined;
  let p: Sample | undefined;
  const trim = (c: Building, t: number) => {
    while (c.win.length > 1 && t - (c.win[0]?.t ?? t) > lim.jumpWindow) c.win.shift();
  };
  for (const s of samples) {
    const prev = p;
    p = s;
    if (prev === undefined) continue;
    const d = s.v - prev.v;
    if (Math.abs(d) <= EPS * Math.max(1, Math.abs(s.v))) {
      // A flat sample stays in the window: a step is measured from where the output was 50 ms ago.
      if (cur !== undefined) {
        cur.win.push(s);
        trim(cur, s.t);
        cur.ts.push(s.t);
        cur.cum.push(cur.cum[cur.cum.length - 1] ?? 0);
        cur.moved.push(false);
        cur.vs.push(s.v);
      }
      continue;
    }
    const dir: 1 | -1 = d > 0 ? 1 : -1;
    if (cur?.dir !== dir || prev.t - cur.end >= FLAT_BREAK_MS) {
      if (cur !== undefined) out.push(done(cur));
      cur = {
        start: prev.t,
        end: s.t,
        dir,
        from: prev.v,
        to: s.v,
        jumps: [],
        win: [prev],
        ts: [prev.t],
        cum: [0],
        moved: [false],
        vs: [prev.v],
        spans: [],
        sureUntil: -Infinity,
        fastStart: undefined,
      };
    }
    cur.end = s.t;
    cur.to = s.v;
    const fast = s.slow !== true;
    if (fast && cur.fastStart === undefined) cur.fastStart = prev.t;
    cur.ts.push(s.t);
    cur.cum.push(
      (cur.cum[cur.cum.length - 1] ?? 0) + (fast ? Math.log(floorRatio(prev.v, s.v)) : 0),
    );
    cur.moved.push(fast);
    cur.vs.push(s.v);
    if (fast) spanStep(cur, lim);
    // An instant step is a change within 50 ms, measured from the earliest sample of the run in that
    // time, not only from the sample before: finely sampled, a fast fade steps by less than 2 at each
    // sample but by more within 50 ms (DALI review of ADR 0015).
    cur.win.push(s);
    trim(cur, s.t);
    const q = cur.win[0];
    if (q === undefined || q === s) continue;
    const r = floorRatio(q.v, s.v);
    const last = cur.jumps[cur.jumps.length - 1];
    if (r > hard) {
      // Dated where it happens (ADR 0015): at the latest sample from which the output still changed
      // by more than 2, so as late as the step allows.
      let from = q;
      for (const w of cur.win) if (w !== s && floorRatio(w.v, s.v) > hard) from = w;
      if (last !== undefined && from.t - last.endT <= lim.jumpJoin) last.endT = s.t;
      else cur.jumps.push({ t: from.t, endT: s.t });
    } else if (
      last !== undefined &&
      r > lim.fold &&
      lim.fold > 0 &&
      q.t - last.endT <= lim.jumpJoin
    ) {
      // The rule folds a step just under 2 that follows on from a hard step into it.
      last.endT = s.t;
    }
  }
  if (cur !== undefined) out.push(done(cur));
  return out;
}

function done(c: Building): Run {
  return {
    start: c.start,
    end: c.end,
    dir: c.dir,
    from: c.from,
    to: c.to,
    jumps: c.jumps.map((x) => ({ ...x })),
    fastRatio: Math.exp(c.cum[c.cum.length - 1] ?? 0),
    fastStart: c.fastStart,
    spans: c.spans.map((x) => ({ ...x })),
  };
}

export function isLeg(r: Run, reading: Reading = CAUTIOUS): boolean {
  return ratio(r.from, r.to) >= limits(reading).leg;
}

/**
 * A leg beyond the margin. The reversal rule counts a turn unless both runs are legs, so a cautious
 * reading uses this stricter test: a run on the border counts as smaller than a leg there, and the
 * guard never counts fewer reversals than the rule.
 */
export function isSurelyLeg(r: Run, reading: Reading = CAUTIOUS): boolean {
  return ratio(r.from, r.to) >= limits(reading).surelyLeg;
}

export function touchesOff(r: Run): boolean {
  return r.from <= EPS !== r.to <= EPS;
}

/**
 * A leg's hard steps in one reading (ADR 0015 and ADR 0016). Movement from a fade that ran 0.7 s or
 * longer never counts. Fast change above 2 within 0.7 s is a hard step from where it starts (a fast
 * span), and each instant step above 2 is its own hard step, dated where it happened. A fast leg, fast
 * change above 2 in under 0.7 s from end to end, is one hard step from where its fast movement began,
 * as S3.3 reads.
 */
export function hardSteps(r: Run, reading: Reading = CAUTIOUS): Step[] {
  const lim = limits(reading);
  if (ratio(r.from, r.to) < lim.leg) return [];
  // Dated where its fast movement began, not where it passes 2: each channel of a fade from off
  // passes the 2% floor at its own moment, and they must agree.
  if (
    r.fastRatio > Math.exp(lim.logHard) &&
    r.end - r.start < lim.fastLeg &&
    r.spans.length > 0 &&
    r.fastStart !== undefined
  )
    return [{ t: r.fastStart, until: r.end, dir: r.dir }];
  // A span and an instant step of the same movement can be dated a little apart: they are one.
  const all = [
    ...r.spans.map((s) => ({ t: s.t, until: s.until })),
    ...r.jumps.map((j) => ({ t: j.t, until: j.endT })),
  ].sort((a, b) => a.t - b.t);
  const out: { t: number; until: number; dir: 1 | -1 }[] = [];
  let near = -Infinity;
  for (const s of all) {
    const last = out[out.length - 1];
    if (last === undefined || s.t - near > lim.same) {
      out.push({ ...s, dir: r.dir });
      near = s.t;
    } else {
      last.until = Math.max(last.until, s.until);
      // The rule measures from the one before, kept or not. A cautious reading from the last kept.
      if (reading.exact) near = s.t;
    }
  }
  return out;
}

/** An event with the direction of the leg it starts: 1 up, -1 down, 0 for a saturated red change. */
export interface Directed {
  readonly t: number;
  readonly dir: 1 | -1 | 0;
}

/** What one reading finds on one trace, or on one address once its traces are merged. */
export interface Read {
  readonly legs: Directed[];
  readonly hard: Step[];
  readonly reversals: number[];
}

/** One reading of one trace. */
export function read(samples: readonly Sample[], reading: Reading = CAUTIOUS): Read {
  const lim = limits(reading);
  const rs = runs(samples, reading);
  const legs: Directed[] = [];
  const hard: Step[] = [];
  const reversals: number[] = [];
  const change = (r: Run) => ratio(r.from, r.to) >= lim.change;
  const surely = (r: Run) => ratio(r.from, r.to) >= lim.surelyLeg;
  rs.forEach((r, i) => {
    if (ratio(r.from, r.to) >= lim.leg) legs.push({ t: r.start, dir: r.dir });
    hard.push(...hardSteps(r, reading));
    const prev = rs[i - 1];
    if (
      prev !== undefined &&
      prev.dir !== r.dir &&
      (!surely(prev) || !surely(r)) &&
      change(prev) &&
      change(r)
    ) {
      reversals.push(r.start);
    }
  });
  return { legs, hard, reversals };
}

/**
 * One address's events on its several traces, in one reading. Events that go the same way within
 * `SAME_LEG_MS` of the first of them are one. What is left within 5 ms is one event too: in the rule
 * whatever the directions, and in a cautious reading when they go the same way or one has no
 * direction. Opposite ones are then one only at the same moment, as a swap between colours is.
 */
function mergeSteps(lists: readonly (readonly Step[])[], reading: Reading): Step[] {
  const lim = limits(reading);
  const all = lists.flat().sort((a, b) => a.t - b.t);
  const firsts: { t: number; until: number; dir: 1 | -1 | 0 }[] = [];
  for (const e of all) {
    const first = firsts.find((c) => c.dir === e.dir && e.t - c.t <= lim.sameLeg);
    if (first === undefined) firsts.push({ ...e });
    else first.until = Math.max(first.until, e.until);
  }
  const kept: { t: number; until: number; dir: 1 | -1 | 0 }[] = [];
  for (const e of firsts) {
    let same: { t: number; until: number; dir: 1 | -1 | 0 } | undefined;
    if (reading.exact) {
      const last = kept[kept.length - 1];
      if (last !== undefined && e.t - last.t <= 5) same = last;
    } else {
      // Sorted, so only the kept events of the last 5 ms can be the same one.
      for (let i = kept.length - 1; i >= 0 && same === undefined; i--) {
        const k = kept[i];
        if (k === undefined || e.t - k.t > 5) break;
        if (k.dir === e.dir || k.dir === 0 || e.dir === 0 || e.t - k.t <= STEP_GAP_MS) same = k;
      }
    }
    if (same === undefined) kept.push(e);
    else same.until = Math.max(same.until, e.until);
  }
  return kept;
}

/** Merge one address's traces (each channel and its luminance) in one reading. */
export function mergeRead(
  lists: readonly Read[],
  reading: Reading = CAUTIOUS,
  red: readonly Directed[] = [],
): Read {
  const asSteps = (xs: readonly Directed[]) => xs.map((x) => ({ ...x, until: x.t }));
  return {
    legs: mergeSteps([...lists.map((l) => asSteps(l.legs)), asSteps(red)], reading).map((s) => ({
      t: s.t,
      dir: s.dir,
    })),
    hard: mergeSteps(
      lists.map((l) => l.hard),
      reading,
    ),
    reversals: mergeTimes(lists.map((l) => l.reversals)),
  };
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
 * Unite the events of several readings of the same trace. An event within `tol` ms of one in another
 * reading is the same event, so each group keeps as many events as the reading that has the most of
 * them, and the result never has fewer events than any one reading. Events of one reading are never
 * merged with each other: they were already merged where they came from, and two left that close
 * together are distinct legs (an instant rise with a fade starting down at the same moment, found by
 * the Stage 4 property run).
 */
export function uniteAll(lists: readonly (readonly number[])[], tol = 5): number[] {
  const all = lists
    .flatMap((list, i) => list.map((t) => ({ t, i })))
    .sort((x, y) => x.t - y.t || x.i - y.i);
  const out: number[] = [];
  let start = -Infinity;
  let counts = new Map<number, number>();
  let kept = 0;
  for (const e of all) {
    if (e.t - start > tol) {
      start = e.t;
      counts = new Map<number, number>();
      kept = 0;
    }
    const c = (counts.get(e.i) ?? 0) + 1;
    counts.set(e.i, c);
    if (c > kept) {
      out.push(e.t);
      kept = c;
    }
  }
  return out;
}

export function uniteTimes(a: readonly number[], b: readonly number[], tol = 5): number[] {
  return uniteAll([a, b], tol);
}

/**
 * Readings on grids out of step date a leg or a reversal up to one grid step apart, so across
 * readings events this close are the same one.
 */
export const READING_TOL_MS = GRID_MS + 5;

interface Cluster {
  dir: 1 | -1 | 0;
  until: number;
  steps: { t: number; until: number; dir: 1 | -1 | 0; i: number }[];
}

/**
 * Unite the hard steps of several readings of one trace into ranges (ADR 0019). Hard steps from
 * different readings are the same hard step when they go the same way and their extents overlap, or
 * lie within the time margin. Its date is the range from the earliest date a reading gives it to the
 * latest. Two hard steps of one reading are never one: where a group holds more than one from a
 * reading, it gives a range around each date of the reading with the most, and a hard step of another
 * reading that would share a range with one of its own gets a range to itself. The result then never
 * has fewer hard steps than any one reading, every date of every reading lies in a range, and two
 * hard steps a reading finds too close are in two ranges at least as close.
 */
export function uniteHard(lists: readonly (readonly Step[])[], slack = TIME_MARGIN_MS): Range[] {
  const all = lists
    .flatMap((list, i) => list.map((s) => ({ ...s, i })))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  const clusters: Cluster[] = [];
  for (const s of all) {
    const c = clusters.find(
      (x) => (x.dir === s.dir || x.dir === 0 || s.dir === 0) && s.t <= x.until + slack,
    );
    if (c === undefined) clusters.push({ dir: s.dir, until: s.until, steps: [s] });
    else {
      c.until = Math.max(c.until, s.until);
      c.steps.push(s);
    }
  }
  const out: Range[] = [];
  for (const c of clusters) {
    const counts = new Map<number, number>();
    for (const s of c.steps) counts.set(s.i, (counts.get(s.i) ?? 0) + 1);
    let most = -1;
    for (const [i, n] of counts)
      if (n > (counts.get(most) ?? 0) || (n === counts.get(most) && i < most)) most = i;
    const anchors = c.steps
      .filter((s) => s.i === most)
      .map((s) => ({ t: s.t, lo: s.t, hi: s.t, dir: s.dir, readings: new Set<number>() }));
    for (const s of c.steps) {
      if (s.i === most) continue;
      let best = anchors[0];
      for (const a of anchors)
        if (best === undefined || Math.abs(a.t - s.t) < Math.abs(best.t - s.t)) best = a;
      // Two hard steps of one reading never share a range: the second gets its own, so a pair that
      // reading finds too close stays two hard steps (DALI review S8b-D6).
      if (best === undefined || best.readings.has(s.i)) {
        out.push({ lo: s.t, hi: s.t, dir: s.dir });
        continue;
      }
      best.readings.add(s.i);
      best.lo = Math.min(best.lo, s.t);
      best.hi = Math.max(best.hi, s.t);
    }
    for (const a of anchors) out.push({ lo: a.lo, hi: a.hi, dir: a.dir });
  }
  return out.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
}

/** Unite several readings of one scope: legs and reversals as times, hard steps as ranges. */
export function unite(reads: readonly Read[]): TraceEvents {
  return {
    legs: uniteAll(
      reads.map((r) => r.legs.map((x) => x.t)),
      READING_TOL_MS,
    ),
    hard: uniteHard(reads.map((r) => r.hard)),
    reversals: uniteAll(
      reads.map((r) => r.reversals),
      READING_TOL_MS,
    ),
  };
}

/** One reading of one trace as events, each hard step a range of one date. */
export function events(samples: readonly Sample[], reading: Reading = CAUTIOUS): TraceEvents {
  return unite([read(samples, reading)]);
}
