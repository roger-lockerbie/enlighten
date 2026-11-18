/**
 * Legs, hard steps and reversals on a sampled trace: the vocabulary of the rate guard (SPEC S3,
 * ADR 0005, with the exact rules in ADR 0011). Pure functions over arrays.
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
  /**
   * The instant steps inside the run, each a change by more than 2 (less the margin) within
   * `JUMP_WINDOW_MS`.
   * Steps that follow on within `JUMP_MS` are one step. A run can hold more than one: a slow fade
   * elsewhere keeps the run going between them.
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
   * Where fast spans begin: fast change above 2 within 0.7 s, dated at the latest sample from which
   * it is still above 2. Spans that follow on are one (ADR 0016).
   */
  readonly spans: readonly number[];
  /**
   * Other dates the rule could give a span the guard counted, when they are more than the time margin
   * from the span. The rule dates a span at the latest sample from which the change is above 2 when it
   * first finds it, so the date depends on where the samples fall. The latest it could be: the guard
   * dates a span where it first might see it, which can be well before (DALI review S6-D16-1). The
   * earliest: the last sample at the lowest fast level in the window, which the rule gives when its
   * sample falls just as the change passes 2 (S6-P10). Each counts as a hard step too, so a hard step
   * on either side is judged against the date nearer to it.
   */
  readonly border: readonly number[];
}

/** An instant step: where it began and ended, the output there, and its largest ratio in 50 ms. */
export interface Jump {
  readonly t: number;
  readonly v: number;
  readonly endT: number;
  readonly endV: number;
  readonly max: number;
}

export interface TraceEvents {
  /** Start times of legs. */
  readonly legs: number[];
  /** When each hard step began: at its instant step, or at the start of a fast leg (ADR 0015). */
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
 * Samples closer than this are the two sides of an instant step: the trace puts a sample 0.001 ms
 * before each plan start, and the recorder takes both sides at one time.
 */
const STEP_GAP_MS = 0.01;
/**
 * The guard measures an instant step over a window one 10 ms sample longer than `JUMP_MS`, so its
 * window always reaches back as far as any 50 ms the light can be measured over, however the
 * samples fall (the differential property, ADR 0015).
 */
export const JUMP_WINDOW_MS = JUMP_MS + 10;
/**
 * For hard steps, output below this fraction counts as this fraction. A fade from off starts with the
 * gear's jump to its minimum (about 1% on the DA5-L), and that jump alone is not a hard step, while an
 * instant jump from off to a higher level still is.
 */
export const OFF_FLOOR = 0.02;

/**
 * A fast span is fast change above 2 within `HARD_FADE_MS` (ADR 0016). The guard reads it from a
 * window that reaches back further than that by the spacing of its own samples and the checker's, so
 * the guard never sees less of a span than the light makes.
 */
export const SPAN_WINDOW_MS = HARD_FADE_MS + 45;
/**
 * To decide that a later span is the same movement as an earlier one, the guard only counts spans it
 * is sure of: fast change above 2 within this shorter window, by the full ratio margin.
 */
export const SPAN_SURE_MS = HARD_FADE_MS - 55;
/** A later span joins an earlier one by starting within 0.7 s of it only with this much to spare. */
export const SPAN_MARGIN_MS = 50;
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
  let cur: Building | undefined;
  let p: Sample | undefined;
  const hard = HARD_RATIO * RATIO_MARGIN;
  const trim = (c: Building, t: number) => {
    while (c.win.length > 1 && t - (c.win[0]?.t ?? t) > JUMP_WINDOW_MS) c.win.shift();
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
        jumpMax: 1,
        jumps: [],
        win: [prev],
        ts: [prev.t],
        cum: [0],
        moved: [false],
        vs: [prev.v],
        spans: [],
        spanAt: -Infinity,
        sureUntil: -Infinity,
        spanFound: false,
        spanLate: -Infinity,
        spanLow: -Infinity,
        found: [],
        mustUntil: -Infinity,
        exactPrev: undefined,
        joinLo: undefined,
        joinHi: -Infinity,
        border: [],
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
    if (fast) spanStep(cur);
    // An instant step is a change within 50 ms, measured from the earliest sample of the run in that
    // time, not only from the sample before: finely sampled, a fast fade steps by less than 2 at each
    // sample but by more within 50 ms (DALI review of ADR 0015).
    cur.win.push(s);
    trim(cur, s.t);
    const q = cur.win[0];
    if (q === undefined || q === s) continue;
    const r = floorRatio(q.v, s.v);
    cur.jumpMax = Math.max(cur.jumpMax, r);
    if (r <= hard) continue;
    // Dated where it happens (ADR 0015): at the latest sample from which the output still changed by
    // more than 2, so as late as the step allows.
    let from = q;
    for (const w of cur.win) if (w !== s && floorRatio(w.v, s.v) > hard) from = w;
    const last = cur.jumps[cur.jumps.length - 1];
    if (last !== undefined && from.t - last.endT <= JUMP_MS) {
      last.endT = s.t;
      last.endV = s.v;
      last.max = Math.max(last.max, r);
    } else {
      cur.jumps.push({ t: from.t, v: from.v, endT: s.t, endV: s.v, max: r });
    }
  }
  if (cur !== undefined) out.push(done(cur));
  return out;
}

interface Building {
  start: number;
  end: number;
  dir: 1 | -1;
  from: number;
  to: number;
  jumpMax: number;
  jumps: { t: number; v: number; endT: number; endV: number; max: number }[];
  /** The run's samples from the last `JUMP_WINDOW_MS`, for the instant-step test. */
  win: Sample[];
  /** Every sample time of the run, and the log of the fast ratio from the run's start to each. */
  ts: number[];
  cum: number[];
  /** Whether the output moved fast from the sample before, and the output at each sample. */
  moved: boolean[];
  vs: number[];
  spans: number[];
  /** The last span the guard counted. */
  spanAt: number;
  /** The last sample at which the guard was sure of a span. */
  sureUntil: number;
  /** Whether the rule itself must have found the last span by now. */
  spanFound: boolean;
  /** The latest date the rule could give the last span. */
  spanLate: number;
  /** The earliest date the rule could give the last span. */
  spanLow: number;
  /** Samples at which the rule must find a span, until `RULE_STEP_MS` has passed. */
  found: number[];
  /** The latest of those whose `RULE_STEP_MS` has passed: the rule has found a span there. */
  mustUntil: number;
  /** The latest sample from which the change is above 2 within 0.7 s, at the sample before. */
  exactPrev: number | undefined;
  /** A movement the guard joined to the last span that the rule may count as its own: its dates. */
  joinLo: number | undefined;
  joinHi: number;
  border: number[];
  fastStart: number | undefined;
}

const LOG_SPAN = Math.log(HARD_RATIO * RATIO_MARGIN);
const LOG_SPAN_SURE = Math.log(HARD_RATIO / RATIO_MARGIN);
const LOG_HARD = Math.log(HARD_RATIO);
/**
 * The rule surely finds a span at its next sample once the change is above 2 by the ratio margin within
 * this time. That sample can be 25 ms on, and the rule has a sample no more than 25 ms after the start
 * of its 0.7 s window, so the window it surely sees is 0.7 s less two of the checker's 25 ms steps
 * (S6-S18-3).
 */
const FOUND_MS = HARD_FADE_MS - 50;
/**
 * The checker samples a moving light at least this often, so the rule finds a span within this time
 * of a sample at which it surely can. Until then it may still date it later, as the change grows
 * (the 1,000-run pass after the reviews, S6-P12).
 */
const RULE_STEP_MS = 25;

/** The first index whose time is at or after `t`. */
function firstAtOrAfter(ts: readonly number[], t: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ts[mid] ?? Infinity) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The latest sample within `window` of the newest one from which the fast change to it is more than
 * `logRatio`, or undefined. The fast change only grows looking back, so the samples that qualify are
 * the earliest ones in the window, and a binary search finds the last of them.
 */
function spanFrom(c: Building, window: number, logRatio: number): number | undefined {
  const j = c.ts.length - 1;
  const t = c.ts[j] ?? 0;
  const top = c.cum[j] ?? 0;
  const first = firstAtOrAfter(c.ts, t - window);
  if (first >= j || top - (c.cum[first] ?? 0) <= logRatio) return undefined;
  let lo = first;
  let hi = j - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (top - (c.cum[mid] ?? 0) > logRatio) lo = mid;
    else hi = mid - 1;
  }
  return c.ts[back(c, lo, first, t, window)];
}

/**
 * Fast movement from below the 2% floor adds little to the ratio, but it is where the movement began:
 * each channel of one fade from off crosses 2% at a different moment, and they must agree.
 */
function back(c: Building, lo: number, first: number, t: number, window: number): number {
  let k = lo;
  while (
    k > first &&
    c.moved[k] === true &&
    (c.vs[k - 1] ?? Infinity) <= OFF_FLOOR &&
    t - (c.ts[k - 1] ?? -Infinity) <= window
  )
    k--;
  return k;
}

/**
 * The earliest date the rule could give a span it finds at the newest sample: the last sample in the
 * window at the lowest fast level, walked back as `spanFrom` does. The rule finds the span as soon as
 * the change from that sample passes 2, and only that sample is above 2 then (S6-P10). After an
 * instant step, 25 ms before the latest sample the change is surely above 2 from, if there is one.
 */
function spanEarly(c: Building): number | undefined {
  const j = c.ts.length - 1;
  const t = c.ts[j] ?? 0;
  const first = firstAtOrAfter(c.ts, t - SPAN_WINDOW_MS);
  if (first >= j) return undefined;
  // After an instant step no sample falls between its two sides, so the rule finds the span at its far
  // side too. It dates it at the latest of its own samples from which the change is above 2, which can
  // be before the guard's date when the step itself is near 2 (S6-S17-1). The rule's last sample at or
  // before the latest guard sample the change is surely above 2 from is less than 25 ms before it, and
  // the change from it is above 2 too (S6-S18-1). A plan's start in a fade also has two samples a
  // moment apart, so only a step by more than the margins takes this path.
  const step = (c.cum[j] ?? 0) - (c.cum[j - 1] ?? 0);
  if (t - (c.ts[j - 1] ?? -Infinity) <= STEP_GAP_MS && step > LOG_SPAN_SURE - LOG_SPAN) {
    const sure = spanFrom(c, SPAN_WINDOW_MS, LOG_SPAN_SURE);
    if (sure !== undefined) return sure - RULE_STEP_MS;
  }
  // The fast level only rises along a run.
  const low = c.cum[first] ?? 0;
  let k = first;
  while (k + 1 < j && (c.cum[k + 1] ?? Infinity) <= low) k++;
  return c.ts[back(c, k, first, t, SPAN_WINDOW_MS)];
}

/**
 * The fast span test at the newest sample (ADR 0016). A span the guard might see counts unless it is
 * surely part of the last one: it starts at or before the last sample at which the guard was sure of
 * a span, or within 0.7 s of the last span counted with `SPAN_MARGIN_MS` to spare. Only spans the guard
 * is sure of carry a movement on, so a span on the border never joins two the checker would count.
 */
function spanStep(c: Building): void {
  const now = c.ts[c.ts.length - 1] ?? 0;
  const before = c.ts[c.ts.length - 2] ?? -Infinity;
  // The rule has found a span by now wherever it surely could 25 ms before the sample before.
  while (c.found.length > 0 && (c.found[0] ?? Infinity) <= before - RULE_STEP_MS)
    c.mustUntil = c.found.shift() ?? c.mustUntil;
  const exact = spanFrom(c, HARD_FADE_MS, LOG_HARD);
  const from = spanFrom(c, SPAN_WINDOW_MS, LOG_SPAN);
  if (
    from !== undefined &&
    from > c.sureUntil &&
    from >= c.spanAt + HARD_FADE_MS - SPAN_MARGIN_MS
  ) {
    closeSpan(c);
    closeJoin(c);
    c.spans.push(from);
    c.spanAt = from;
    c.spanLow = from;
    c.spanFound = false;
    const early = spanEarly(c);
    if (early !== undefined && early < from - TIME_MARGIN_MS) {
      c.border.push(early);
      c.spanLow = early;
    }
  } else joinStep(c, exact);
  // Until the rule itself must have found the last span, it may date it as late as the latest sample
  // from which the change is above 2 within 0.7 s (DALI review S6-D16-1).
  if (!c.spanFound && c.spans.length > 0 && exact !== undefined)
    c.spanLate = Math.max(c.spanLate, exact);
  if (spanFrom(c, FOUND_MS, LOG_SPAN_SURE) !== undefined) {
    c.found.push(now);
    if (c.spans.length > 0) c.spanFound = true;
  }
  if (spanFrom(c, SPAN_SURE_MS, LOG_SPAN_SURE) !== undefined) c.sureUntil = now;
  c.exactPrev = exact;
}

/**
 * A movement the guard joins to the last span. The rule counts it as a span of its own when, at the
 * first of its samples to find it, its date is more than 0.7 s after the last span and after the last
 * sample at which the rule found one. The rule may find it up to 25 ms after the guard could, with a
 * later date, so while that can hold the guard keeps the range of dates the rule could give it, and
 * counts both ends as hard steps on the border (S6-P12).
 */
function joinStep(c: Building, exact: number | undefined): void {
  const after = c.spanLow + HARD_FADE_MS - TIME_MARGIN_MS;
  if (c.spans.length === 0 || exact === undefined || exact <= c.mustUntil || exact < after) {
    closeJoin(c);
    return;
  }
  c.joinLo ??= Math.max(after, c.mustUntil, c.exactPrev ?? -Infinity);
  c.joinHi = Math.max(c.joinHi, exact);
}

function closeJoin(c: Building): void {
  if (c.joinLo !== undefined) {
    c.border.push(c.joinLo);
    if (c.joinHi > c.joinLo + TIME_MARGIN_MS) c.border.push(c.joinHi);
  }
  c.joinLo = undefined;
  c.joinHi = -Infinity;
}

/** Keep the last span's late date when it is far enough from the span to matter. */
function closeSpan(c: Building): void {
  if (c.spanLate > c.spanAt + TIME_MARGIN_MS) c.border.push(c.spanLate);
  c.spanLate = -Infinity;
}

function closed(c: Building): number[] {
  closeSpan(c);
  closeJoin(c);
  return [...c.border];
}

function done(c: Building): Run {
  return {
    start: c.start,
    end: c.end,
    dir: c.dir,
    from: c.from,
    to: c.to,
    jumpMax: c.jumpMax,
    jumps: c.jumps.map((x) => ({ ...x })),
    fastRatio: Math.exp(c.cum[c.cum.length - 1] ?? 0),
    fastStart: c.fastStart,
    spans: [...c.spans],
    border: closed(c),
  };
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

/**
 * A leg beyond the margin. The reversal rule counts a turn unless both runs are legs, so it uses
 * this stricter test: a run on the border counts as smaller than a leg there, and the guard never
 * counts fewer reversals than the rule.
 */
export function isSurelyLeg(r: Run): boolean {
  return ratio(r.from, r.to) >= LEG_RATIO / RATIO_MARGIN;
}

export function touchesOff(r: Run): boolean {
  return r.from <= EPS !== r.to <= EPS;
}

/**
 * When a leg's hard steps began (ADR 0015 and ADR 0016). Movement from a fade that ran 0.7 s or longer
 * never counts. Fast change above 2 within 0.7 s is a hard step from where it starts (a fast span), and
 * each instant step above 2 is its own hard step, dated where it happened. A fast leg, fast change above
 * 2 in under 0.7 s from end to end, is one hard step from where its fast movement began, as S3.3
 * reads. On its border the guard counts the leg's start, the spans and the instant steps, and for each
 * span the earliest and latest dates the rule could give it.
 */
export function hardTimes(r: Run): readonly number[] {
  return hardDates(r).map((d) => d.t);
}

/** A hard step's date, and whether it is one of the other dates the rule could give a span. */
export interface HardDate {
  readonly t: number;
  readonly border: boolean;
}

/** `hardTimes`, with each border date marked, so merging channels never drops one (S6-D17-1). */
export function hardDates(r: Run): readonly HardDate[] {
  if (!isLeg(r)) return [];
  const took = r.end - r.start;
  const surelyFast =
    r.fastRatio > HARD_RATIO / RATIO_MARGIN && took < HARD_FADE_MS - FADE_MARGIN_MS;
  // Dated where its fast movement began, not where it passes 2: each channel of a fade from off
  // passes the 2% floor at its own moment, and they must agree.
  if (surelyFast && r.spans.length > 0 && r.fastStart !== undefined)
    return [{ t: r.fastStart, border: false }];
  // A span and an instant step of the same movement can be dated a few ms apart: they are one.
  const out: number[] = [];
  for (const t of [...r.spans, ...r.jumps.map((j) => j.t)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > JUMP_MS) out.push(t);
  }
  // The other dates the rule could give a span the guard counted (S6-D16-1 and S6-P10).
  const extra: number[] = [];
  for (const t of r.border) if (out.every((k) => Math.abs(t - k) > TIME_MARGIN_MS)) extra.push(t);
  // A leg on the fast leg's border may be one hard step from where its fast movement began, and that
  // can be well before its spans, when it began below the 2% floor (S6-P8).
  const mightBeFast =
    r.fastRatio > HARD_RATIO * RATIO_MARGIN && took < HARD_FADE_MS + FADE_MARGIN_MS;
  const start = r.fastStart;
  if (
    mightBeFast &&
    r.spans.length > 0 &&
    start !== undefined &&
    [...out, ...extra].every((k) => Math.abs(start - k) > TIME_MARGIN_MS)
  )
    extra.push(start);
  return [
    ...out.map((t) => ({ t, border: false })),
    ...extra.map((t) => ({ t, border: true })),
  ].sort((a, b) => a.t - b.t);
}

/** An event with the direction of the leg it starts: 1 up, -1 down, 0 for a saturated red change. */
export interface Directed {
  readonly t: number;
  readonly dir: 1 | -1 | 0;
  /** A border date of a hard step: kept whatever the merge (S6-D17-1). */
  readonly border?: boolean;
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
    for (const d of hardDates(r))
      hard.push(d.border ? { t: d.t, dir: r.dir, border: true } : { t: d.t, dir: r.dir });
    const prev = rs[i - 1];
    if (
      prev !== undefined &&
      prev.dir !== r.dir &&
      (!isSurelyLeg(prev) || !isSurelyLeg(r)) &&
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
    if (e.border === true) continue;
    const near = clusters.some((c) => c.dir === e.dir && e.t - c.t <= tol);
    if (!near) clusters.push(e);
  }
  // A border date is one the guard counts on purpose, so the merge never drops it, nor lets it absorb
  // a date it would otherwise keep (S6-D17-1). Events within 5 ms are one when they go the same way,
  // or one has no direction. Opposite ones are one only at the same moment, as a swap between colours
  // is: a step up and a fade down that starts 4 ms later are two, since the checker's samples can
  // date them 20 ms apart (S6-P11).
  const kept: Directed[] = [];
  const events = [...clusters, ...all.filter((x) => x.border === true)];
  for (const e of events.sort((a, b) => a.t - b.t)) {
    // Sorted, so only the kept events of the last 5 ms can be the same one.
    let same = false;
    for (let i = kept.length - 1; i >= 0 && !same; i--) {
      const k = kept[i];
      if (k === undefined || e.t - k.t > 5) break;
      same = k.dir === e.dir || k.dir === 0 || e.dir === 0 || e.t - k.t <= STEP_GAP_MS;
    }
    if (!same) kept.push(e);
  }
  return kept.map((k) => k.t);
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
