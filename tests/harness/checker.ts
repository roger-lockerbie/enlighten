/**
 * An independent check of the simulator's output trace against SPEC S3 and R6, for the property tests.
 *
 * It records what the simulated bench actually did and checks it against ADR 0011's and ADR 0015's
 * rules. It shares no code with `src/safety/rate`: the guard predicts and refuses, this measures what
 * came out. It reads the rules the same way the guard does, with its own code and without the guard's
 * margins, so a gap in the reading itself is in both (security finding S6-R10).
 */
import { arcToFraction } from '../../src/dali/curve.ts';
import type { Da5l, OutputPlan } from '../../src/sim/gear.ts';
import type { Simulator } from '../../src/sim/simulator.ts';

const LEG = 1.1;
const HARD = 2;
const FADE_MS = 700;
const FLOOR = 0.02;
const FLAT_MS = 1000;
const RED = 0.1;
/** The rule reads the light every whole 25 ms of the clock (ADR 0019). */
const GRID_MS = 25;
const WEIGHT: Record<string, number> = {
  R: 0.2126,
  G: 0.7152,
  B: 0.0722,
  W: 1,
  WW: 1,
  CW: 1,
  mono: 1,
  unused: 0,
};

export interface Point {
  readonly t: number;
  readonly d: readonly number[];
}

/** Whether a unit's output changed between two times only through fades that ran 0.7 s or longer. */
export type SlowTest = (x: number, y: number) => boolean;

/** Records every unit's output from the simulator's plans as time moves on. */
export class TraceRecorder {
  readonly points = new Map<string, Point[]>();
  readonly labels = new Map<string, readonly string[]>();
  readonly resets: { t: number; id: string }[] = [];
  /** Every plan each unit has run, by its start time, to tell how long each fade ran (ADR 0016). */
  readonly plans = new Map<string, Map<number, OutputPlan>>();
  /** A unit's slow test, set by tests that record made-up points instead of a simulator's. */
  readonly slow = new Map<string, SlowTest>();
  private last: number;
  /** The time of the last sample taken. */
  private sampled: number;

  constructor(
    private readonly sim: Simulator,
    start: number,
  ) {
    this.last = start;
    this.sampled = start;
    for (const u of sim.all) {
      this.points.set(u.id, [{ t: start, d: u.gear.outputAt(start).terminals }]);
      this.labels.set(u.id, u.gear.model.terminals);
    }
    this.keepPlans(start);
  }

  /** Plans that have started by `to` cannot change, so they are kept from here on. */
  private keepPlans(to: number): void {
    for (const u of this.sim.all) {
      const kept = this.plans.get(u.id) ?? new Map<number, OutputPlan>();
      for (const p of u.gear.plans()) if (p.since <= to) kept.set(p.since, p);
      this.plans.set(u.id, kept);
    }
  }

  /** A unit's slow test: its own if set, otherwise from the plans it ran. */
  slowTest(id: string): SlowTest {
    return this.slow.get(id) ?? slowFromPlans([...(this.plans.get(id)?.values() ?? [])]);
  }

  /**
   * Sample every unit from the last recorded time to `to`, on the rule's grid (ADR 0019): every whole
   * 25 ms of the clock, every breakpoint of every unit's plans, and 0.001 ms before each. The grid does
   * not depend on where a recording starts or stops. Every unit is sampled at every time, so the
   * room's sum adds outputs from the same moment. Summing one unit's fresh value with another's older
   * one shows a step in the room that the light never made.
   */
  record(to: number): void {
    if (to <= this.last) return;
    const times = new Set<number>();
    for (const u of this.sim.all) {
      for (const b of u.gear.planBreakpoints(this.last, to)) {
        times.add(b - 0.001);
        times.add(b);
      }
    }
    for (let t = (Math.floor(this.last / GRID_MS) + 1) * GRID_MS; t <= to; t += GRID_MS)
      times.add(t);
    // Plans that started by the last recording cannot change, so a time just before a breakpoint can
    // still be read when the last recording stopped between the two.
    const sorted = [...times].filter((t) => t > this.sampled && t <= to).sort((a, b) => a - b);
    for (const u of this.sim.all) {
      const list = this.points.get(u.id) ?? [];
      for (const t of sorted) list.push({ t, d: u.gear.outputAt(t).terminals });
      this.points.set(u.id, list);
    }
    this.sampled = sorted[sorted.length - 1] ?? this.sampled;
    this.keepPlans(to);
    this.last = to;
  }
}

/**
 * Spans of time in which a unit's output can change fast: each plan's start, a fade that ran under
 * 0.7 s from its start until it ended or was replaced, the switch off at the end of a fade to off,
 * and identify. Anything else that changes is a fade that ran 0.7 s or longer (S3.3, ADR 0016).
 */
function slowFromPlans(unsorted: readonly OutputPlan[]): SlowTest {
  const plans = [...unsorted].sort((a, b) => a.since - b.since);
  const points: number[] = [];
  const spans: [number, number][] = [];
  const key = (o: unknown) => JSON.stringify(o);
  plans.forEach((p, i) => {
    points.push(p.since);
    const next = plans[i + 1]?.since ?? Infinity;
    if (p.identifyUntil > p.since) spans.push([p.since, Math.min(p.identifyUntil, next)]);
    // Each fade once: from the first plan that has it to the first that does not.
    const prev = plans[i - 1];
    for (const part of ['level', 'colour'] as const) {
      if (prev !== undefined && key(prev[part]) === key(p[part])) continue;
      let k = i + 1;
      while (k < plans.length && key(plans[k]?.[part]) === key(p[part])) k++;
      const until = Math.min(p[part].end, plans[k]?.since ?? Infinity);
      if (until - p[part].start < FADE_MS && until > p[part].start)
        spans.push([p[part].start, until]);
      if (part === 'level' && p.level.offAtEnd && p.level.end <= until) points.push(p.level.end);
    }
  });
  points.sort((a, b) => a - b);
  spans.sort((a, b) => a[0] - b[0]);
  // The longest span, so a search for spans that reach x can stop.
  const longest = spans.reduce((m, [a, b]) => Math.max(m, b - a), 0);
  /** How many of the sorted values are at or below v. */
  const upTo = (xs: readonly number[], v: number) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((xs[mid] ?? Infinity) <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const starts = spans.map(([a]) => a);
  return (x, y) => {
    if (upTo(points, y) > upTo(points, x)) return false;
    for (let i = upTo(starts, y) - 1; i >= 0; i--) {
      const [a, b] = spans[i] ?? [0, 0];
      if (a < x - longest) break;
      if (a < y && b > x) return false;
    }
    return true;
  };
}

interface Run {
  start: number;
  end: number;
  dir: number;
  from: number;
  to: number;
  /** Where the run changed by more than HARD within 50 ms. Steps within 100 ms are one step. */
  jumps: { t: number; v: number; endT: number; endV: number }[];
  jumpEnd: number;
  /** The run's points from the last 50 ms. */
  win: { t: number; v: number }[];
  /** Every point of the run, with the log of the fast change from the run's start to it. */
  pts: { t: number; v: number; fast: number; moved: boolean }[];
  /** Where fast change above 2 within 0.7 s began. Spans that follow on are one (ADR 0016). */
  spans: number[];
  spanAt: number;
  spanUntil: number;
}

function ratioOf(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi < 1e-9) return 1;
  if (lo < 1e-9) return Infinity;
  return hi / lo;
}

function floored(a: number, b: number): number {
  return Math.max(a, b, FLOOR) / Math.max(Math.min(a, b), FLOOR);
}

/** A trace's values at one point: each channel and the luminance, or the room's sum. */
interface Series {
  readonly t: number;
  readonly vs: readonly number[];
}

interface Pt {
  readonly t: number;
  readonly v: number;
  /** The change from the point before came only from fades that ran 0.7 s or longer. */
  readonly slow?: boolean;
}

/**
 * Fast change above 2 within 0.7 s, ending at the run's newest point, is a span from the latest
 * point it is still above 2 from. It is part of the last span when it starts at or before the last
 * point that was part of one, or within 0.7 s of where that span began.
 */
function spanCheck(r: Run): void {
  const end = r.pts[r.pts.length - 1];
  if (end === undefined) return;
  let from: number | undefined;
  for (let i = r.pts.length - 2; i >= 0; i--) {
    const p = r.pts[i];
    if (p === undefined || end.t - p.t >= FADE_MS) break;
    if (end.fast - p.fast > Math.log(HARD)) {
      // Back over fast movement under the 2% floor, where the movement began, within 0.7 s.
      let k = i;
      while (k > 0) {
        const q = r.pts[k];
        const before = r.pts[k - 1];
        if (q === undefined || before === undefined || !q.moved || before.v > FLOOR) break;
        if (end.t - before.t >= FADE_MS) break;
        k--;
      }
      from = r.pts[k]?.t;
      break;
    }
  }
  if (from === undefined) return;
  if (from > r.spanUntil && from >= r.spanAt + FADE_MS) {
    r.spans.push(from);
    r.spanAt = from;
  }
  r.spanUntil = end.t;
}

function runsOf(pts: readonly Pt[]): Run[] {
  const out: Run[] = [];
  let cur: Run | undefined;
  const trim = (r: Run, t: number) => {
    while (r.win.length > 1 && t - (r.win[0]?.t ?? t) > 50) r.win.shift();
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    const diff = b.v - a.v;
    if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(b.v))) {
      if (cur !== undefined) {
        cur.win.push(b);
        trim(cur, b.t);
        cur.pts.push({
          t: b.t,
          v: b.v,
          fast: cur.pts[cur.pts.length - 1]?.fast ?? 0,
          moved: false,
        });
      }
      continue;
    }
    const dir = Math.sign(diff);
    if (cur?.dir !== dir || a.t - cur.end >= FLAT_MS) {
      if (cur !== undefined) out.push(cur);
      cur = {
        start: a.t,
        end: b.t,
        dir,
        from: a.v,
        to: b.v,
        jumps: [],
        jumpEnd: -Infinity,
        win: [a],
        pts: [{ t: a.t, v: a.v, fast: 0, moved: false }],
        spans: [],
        spanAt: -Infinity,
        spanUntil: -Infinity,
      };
    }
    cur.end = b.t;
    cur.to = b.v;
    const before = cur.pts[cur.pts.length - 1]?.fast ?? 0;
    const fast = b.slow !== true;
    cur.pts.push({
      t: b.t,
      v: b.v,
      fast: before + (fast ? Math.log(floored(a.v, b.v)) : 0),
      moved: fast,
    });
    if (fast) spanCheck(cur);
    cur.win.push(b);
    trim(cur, b.t);
    // A hard step is a change by more than 2 within 50 ms, dated where it happened (as late as it
    // allows), not where its run began: a slow fade that ends in a hard step would otherwise date the
    // step to the fade's start (ADR 0015).
    const q = cur.win[0];
    if (q === undefined || q === b) continue;
    const r = floored(q.v, b.v);
    if (r > HARD) {
      let from = q;
      for (const w of cur.win) if (w !== b && floored(w.v, b.v) > HARD) from = w;
      const last = cur.jumps[cur.jumps.length - 1];
      if (last !== undefined && from.t - cur.jumpEnd <= 100) {
        last.endT = b.t;
        last.endV = b.v;
      } else cur.jumps.push({ t: from.t, v: from.v, endT: b.t, endV: b.v });
      cur.jumpEnd = b.t;
    } else if (r > HARD * 0.98 && q.t - cur.jumpEnd <= 100) {
      // A step just under 2 that follows on from a hard step is the same movement. The guard, with its
      // margin, may count it as part of the step, so the checker folds at least as much.
      const last = cur.jumps[cur.jumps.length - 1];
      if (last !== undefined) {
        last.endT = b.t;
        last.endV = b.v;
      }
      cur.jumpEnd = b.t;
    }
  }
  if (cur !== undefined) out.push(cur);
  return out;
}

export interface Events {
  legs: number[];
  hard: number[];
  reversals: number[];
}

interface Dir {
  t: number;
  dir: number;
}

interface DirEvents {
  legs: Dir[];
  hard: Dir[];
  reversals: number[];
}

function dirEventsOf(pts: readonly Pt[]): DirEvents {
  const rs = runsOf(pts);
  const isLeg = (r: Run) => ratioOf(r.from, r.to) >= LEG;
  const e: DirEvents = { legs: [], hard: [], reversals: [] };
  rs.forEach((r, i) => {
    if (isLeg(r)) {
      e.legs.push({ t: r.start, dir: r.dir });
      // Fast change from end to end above 2 in under 0.7 s is one hard step. Otherwise each span and
      // each instant step is a hard step, dated where it happened (ADR 0015 and ADR 0016). A span and
      // a step within 100 ms are the same movement.
      const fast = Math.exp((r.pts[r.pts.length - 1]?.fast ?? 0) - (r.pts[0]?.fast ?? 0));
      // A fast leg is dated where its fast movement began, the point before its first fast change.
      const k = r.pts.findIndex((q) => q.moved);
      const began = r.pts[k - 1]?.t;
      if (fast > HARD && r.end - r.start < FADE_MS && r.spans.length > 0 && began !== undefined)
        e.hard.push({ t: began, dir: r.dir });
      else {
        let last = -Infinity;
        for (const t of [...r.spans, ...r.jumps.map((j) => j.t)].sort((x, y) => x - y)) {
          if (t - last > 100) e.hard.push({ t, dir: r.dir });
          last = t;
        }
      }
    }
    const p = rs[i - 1];
    // A run under 0.5% is not a change for the reversal rule (ADR 0011).
    const change = (x: Run) => ratioOf(x.from, x.to) >= 1.005;
    if (p !== undefined && p.dir !== r.dir && (!isLeg(p) || !isLeg(r)) && change(p) && change(r)) {
      e.reversals.push(r.start);
    }
  });
  return e;
}

function eventsOf(pts: readonly Pt[]): Events {
  const e = dirEventsOf(pts);
  return { legs: e.legs.map((x) => x.t), hard: e.hard.map((x) => x.t), reversals: e.reversals };
}

/** One address's legs on several traces: same direction within 100 ms of the first is one leg. */
function mergeDir(lists: Dir[][]): number[] {
  const all = lists.flat().sort((a, b) => a.t - b.t);
  const kept: Dir[] = [];
  for (const e of all) if (!kept.some((k) => k.dir === e.dir && e.t - k.t <= 100)) kept.push(e);
  return merge([kept.map((k) => k.t)]);
}

function merge(lists: number[][]): number[] {
  const all = lists.flat().sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all)
    if (out.length === 0 || t - (out[out.length - 1] ?? -Infinity) > 5) out.push(t);
  return out;
}

function lum(d: readonly number[], labels: readonly string[]): number {
  return d.reduce((s, x, i) => s + x * (WEIGHT[labels[i] ?? 'unused'] ?? 0), 0);
}

export interface RateProblem {
  readonly scope: string;
  readonly rule: string;
  readonly at: number;
}

function count(ts: readonly number[], from: number, span: number): number {
  return ts.filter((t) => t >= from && t < from + span).length;
}

function checkScope(scope: string, e: Events, swings: number, hardSpan: number): RateProblem[] {
  const out: RateProblem[] = [];
  for (const t of e.legs)
    if (count(e.legs, t, 1000) > 2 * swings) out.push({ scope, rule: 'swings a second', at: t });
  if (swings > 1) {
    for (let i = 0; i + 2 < e.legs.length; i++) {
      const a = e.legs[i] ?? 0;
      const c = e.legs[i + 2] ?? 0;
      if (c - a < 360) out.push({ scope, rule: '360 ms', at: a });
    }
  }
  for (const t of e.hard)
    if (count(e.hard, t, hardSpan) > 1) out.push({ scope, rule: 'hard steps', at: t });
  for (const t of e.reversals)
    if (count(e.reversals, t, 1000) > 3) out.push({ scope, rule: 'reversals', at: t });
  // A fast pattern (three legs within 2 s, again and again) may run for at most 5 s.
  let start: number | undefined;
  e.legs.forEach((t, k) => {
    const back = e.legs[k - 2];
    if (back === undefined || back <= t - 2000) {
      start = undefined;
      return;
    }
    start ??= back;
    if (t - start >= 5000) out.push({ scope, rule: 'pattern', at: t });
  });
  return out;
}

/**
 * Check a recorded trace against the rate guard's rules. `resets` lists unlocked RESETs: the RESET
 * and the OFF that follows are one hard step (SPEC S3.10).
 */
export function rateProblems(rec: TraceRecorder, swings: number): RateProblem[] {
  const problems: RateProblem[] = [];
  for (const [scope, e] of rateEvents(rec))
    problems.push(...checkScope(scope, e, swings, scope === 'room' ? 1000 : 2000));
  return problems;
}

/** The legs, hard steps and reversals of every unit and of the room, as the rule dates them. */
export function rateEvents(rec: TraceRecorder): Map<string, Events> {
  const found = new Map<string, Events>();
  const roomTimes = new Set<number>();
  for (const pts of rec.points.values()) for (const p of pts) roomTimes.add(p.t);
  const ids = [...rec.points.keys()];
  // The RESET's jump to full and its OFF are one hard step. When the jump (a hard step within 150 ms
  // of the RESET) was hard, the hard step nearest the OFF, about 350 ms on, is dropped. When it was
  // not, the OFF alone is the hard step.
  // Resets whose own unit jumped: only those drop a step from the room.
  const unitJumped = new Set<object>();
  const dropResetPair = (id: string, e: Events, series: readonly Series[]) => {
    // A step that had finished before the RESET went out is not its jump (S6-S17-2).
    const finished = (from: number, before: number): boolean => {
      const a = series.findLast((p) => p.t <= from);
      const b = series.findLast((p) => p.t < before);
      return (
        a !== undefined && b !== undefined && a.vs.some((v, i) => floored(v, b.vs[i] ?? v) > HARD)
      );
    };
    for (const r of rec.resets.filter((x) => x.id === id || id === 'room')) {
      // A jump is dated at the latest point within 50 ms that it is above 2 from, which can be a point
      // just before the RESET when other gear's fade adds to it (S6-P9).
      const jumped = (t: number) =>
        t <= r.t + 150 && (t >= r.t - 1 || (t >= r.t - 50 && !finished(t, r.t)));
      if (!e.hard.some(jumped)) continue;
      if (id !== 'room') unitJumped.add(r);
      else if (!unitJumped.has(r)) continue;
      let j = -1;
      e.hard.forEach((t, k) => {
        if (t <= r.t + 150 || t > r.t + 2000) return;
        const best = e.hard[j];
        if (best === undefined || Math.abs(t - r.t - 350) < Math.abs(best - r.t - 350)) j = k;
      });
      if (j >= 0) e.hard.splice(j, 1);
    }
  };
  const tests = new Map<string, SlowTest>(ids.map((id) => [id, rec.slowTest(id)]));
  for (const id of ids) {
    const pts = rec.points.get(id) ?? [];
    const labels = rec.labels.get(id) ?? [];
    const test = tests.get(id) ?? (() => false);
    const slow = pts.map((p, k): boolean => k > 0 && test(pts[k - 1]?.t ?? p.t, p.t));
    const lists: DirEvents[] = labels.flatMap((l, i) =>
      l === 'unused'
        ? []
        : [dirEventsOf(pts.map((p, k) => ({ t: p.t, v: p.d[i] ?? 0, slow: slow[k] === true })))],
    );
    lists.push(
      dirEventsOf(pts.map((p, k) => ({ t: p.t, v: lum(p.d, labels), slow: slow[k] === true }))),
    );
    const red: Dir[] = [];
    let was: boolean | undefined;
    const r = labels.indexOf('R');
    for (const p of pts) {
      const now =
        r >= 0 &&
        (p.d[r] ?? 0) > RED &&
        p.d.every((x, i) => i === r || labels[i] === 'unused' || x <= RED);
      if (was !== undefined && now !== was) red.push({ t: p.t, dir: 0 });
      was = now;
    }
    const e: Events = {
      legs: mergeDir([...lists.map((l) => l.legs), red]),
      hard: mergeDir(lists.map((l) => l.hard)),
      reversals: merge(lists.map((l) => l.reversals)),
    };
    dropResetPair(
      id,
      e,
      pts.map((p) => ({
        t: p.t,
        vs: [...p.d.filter((_, i) => labels[i] !== 'unused'), lum(p.d, labels)],
      })),
    );
    found.set(id, e);
  }
  const times = [...roomTimes].sort((a, b) => a - b);
  // One cursor a unit: the times are sorted, so each unit's last point at or before t only moves on.
  const cursor = new Map<string, number>(ids.map((id) => [id, -1]));
  const at = (id: string, t: number): readonly number[] => {
    const pts = rec.points.get(id) ?? [];
    let i = cursor.get(id) ?? -1;
    while (i + 1 < pts.length && (pts[i + 1]?.t ?? Infinity) <= t) i++;
    cursor.set(id, i);
    return pts[i]?.d ?? [];
  };
  const roomPts = times.map((t, k): Pt => {
    const before = times[k - 1];
    return {
      t,
      v: ids.reduce((s, id) => s + lum(at(id, t), rec.labels.get(id) ?? []), 0),
      // The room's change was slow only if every unit's was.
      slow: before !== undefined && ids.every((id) => tests.get(id)?.(before, t) ?? false),
    };
  });
  const room = eventsOf(roomPts);
  dropResetPair(
    'room',
    room,
    roomPts.map((p) => ({ t: p.t, vs: [p.v] })),
  );
  found.set('room', room);
  return found;
}

/** The ceiling's measure for one gear at a time, from its own model (SPEC R6.6). */
export function measureOf(g: Da5l, t: number): number {
  const m = g.model;
  const c = g.colourAt(t);
  let sum = m.tc ? 1 : 0;
  for (let i = 0; i < m.channels; i++) sum += Math.max(0, Math.min(254, c.ch[i] ?? 0)) / 254;
  if (!m.tc && m.channels === 0) sum = 1;
  return g.arcFractionAt(t) * sum;
}

/** The highest measure over a time range, at every breakpoint and on a 25 ms grid. */
export function maxMeasure(
  sim: Simulator,
  from: number,
  to: number,
): { id: string; t: number; v: number } {
  let best = { id: '', t: from, v: 0 };
  for (const u of sim.all) {
    const times = new Set<number>(u.gear.breakpoints(from, to));
    for (let t = from; t <= to; t += 25) times.add(t);
    for (const t of times) {
      const v = measureOf(u.gear, t);
      if (v > best.v) best = { id: u.id, t, v };
    }
  }
  return best;
}

export const ceilingFraction = arcToFraction;
