/**
 * An independent check of the simulator's output trace against SPEC S3 and R6, for the property tests.
 *
 * It records what the simulated bench actually did and checks the rules by brute force. It shares no
 * code with `src/safety/rate`: the guard predicts and refuses, this measures what came out.
 */
import { arcToFraction } from '../../src/dali/curve.ts';
import type { Da5l } from '../../src/sim/gear.ts';
import type { Simulator } from '../../src/sim/simulator.ts';

const LEG = 1.1;
const HARD = 2;
const FADE_MS = 700;
const FLOOR = 0.02;
const FLAT_MS = 1000;
const RED = 0.1;
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

/** Records every unit's output from the simulator's plans as time moves on. */
export class TraceRecorder {
  readonly points = new Map<string, Point[]>();
  readonly labels = new Map<string, readonly string[]>();
  readonly resets: { t: number; id: string }[] = [];
  private last: number;

  constructor(
    private readonly sim: Simulator,
    start: number,
  ) {
    this.last = start;
    for (const u of sim.all) {
      this.points.set(u.id, [{ t: start, d: u.gear.outputAt(start).terminals }]);
      this.labels.set(u.id, u.gear.model.terminals);
    }
  }

  /** Sample every unit from the last recorded time to `to`. */
  record(to: number): void {
    if (to <= this.last) return;
    for (const u of this.sim.all) {
      const times = new Set<number>();
      for (const b of u.gear.breakpoints(this.last, to)) {
        if (b > this.last) times.add(b);
        if (b - 0.001 > this.last) times.add(b - 0.001);
      }
      for (let t = this.last + 25; t < to; t += 25) times.add(t);
      times.add(to);
      const list = this.points.get(u.id) ?? [];
      for (const t of [...times].sort((a, b) => a - b))
        list.push({ t, d: u.gear.outputAt(t).terminals });
      this.points.set(u.id, list);
    }
    this.last = to;
  }
}

interface Run {
  start: number;
  end: number;
  dir: number;
  from: number;
  to: number;
  jump: number;
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

function runsOf(pts: readonly { t: number; v: number }[]): Run[] {
  const out: Run[] = [];
  let cur: Run | undefined;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    const diff = b.v - a.v;
    if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(b.v))) continue;
    const dir = Math.sign(diff);
    if (cur?.dir !== dir || a.t - cur.end >= FLAT_MS) {
      if (cur !== undefined) out.push(cur);
      cur = { start: a.t, end: b.t, dir, from: a.v, to: b.v, jump: 1 };
    }
    cur.end = b.t;
    cur.to = b.v;
    if (b.t - a.t <= 50) cur.jump = Math.max(cur.jump, floored(a.v, b.v));
  }
  if (cur !== undefined) out.push(cur);
  return out;
}

interface Events {
  legs: number[];
  hard: number[];
  reversals: number[];
}

function eventsOf(pts: readonly { t: number; v: number }[]): Events {
  const rs = runsOf(pts);
  const isLeg = (r: Run) => ratioOf(r.from, r.to) >= LEG;
  const e: Events = { legs: [], hard: [], reversals: [] };
  rs.forEach((r, i) => {
    if (isLeg(r)) {
      e.legs.push(r.start);
      if (r.jump > HARD || (floored(r.from, r.to) > HARD && r.end - r.start < FADE_MS))
        e.hard.push(r.start);
    }
    const p = rs[i - 1];
    if (p !== undefined && p.dir !== r.dir && (!isLeg(p) || !isLeg(r))) e.reversals.push(r.start);
  });
  return e;
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
  const roomTimes = new Set<number>();
  for (const pts of rec.points.values()) for (const p of pts) roomTimes.add(p.t);
  const ids = [...rec.points.keys()];
  const at = (id: string, t: number): readonly number[] => {
    const pts = rec.points.get(id) ?? [];
    let best: Point | undefined;
    for (const p of pts) {
      if (p.t <= t) best = p;
      else break;
    }
    return best?.d ?? [];
  };
  const dropResetPair = (id: string, e: Events) => {
    for (const r of rec.resets.filter((x) => x.id === id || id === 'room')) {
      const i = e.hard.findIndex((t) => t > r.t + 1 && t <= r.t + 2000);
      if (i >= 0) e.hard.splice(i, 1);
    }
  };
  for (const id of ids) {
    const pts = rec.points.get(id) ?? [];
    const labels = rec.labels.get(id) ?? [];
    const lists: Events[] = labels.flatMap((l, i) =>
      l === 'unused' ? [] : [eventsOf(pts.map((p) => ({ t: p.t, v: p.d[i] ?? 0 })))],
    );
    lists.push(eventsOf(pts.map((p) => ({ t: p.t, v: lum(p.d, labels) }))));
    const red: number[] = [];
    let was: boolean | undefined;
    const r = labels.indexOf('R');
    for (const p of pts) {
      const now =
        r >= 0 &&
        (p.d[r] ?? 0) > RED &&
        p.d.every((x, i) => i === r || labels[i] === 'unused' || x <= RED);
      if (was !== undefined && now !== was) red.push(p.t);
      was = now;
    }
    const e: Events = {
      legs: merge([...lists.map((l) => l.legs), red]),
      hard: merge(lists.map((l) => l.hard)),
      reversals: merge(lists.map((l) => l.reversals)),
    };
    dropResetPair(id, e);
    problems.push(...checkScope(id, e, swings, 2000));
  }
  const times = [...roomTimes].sort((a, b) => a - b);
  const room = eventsOf(
    times.map((t) => ({
      t,
      v: ids.reduce((s, id) => s + lum(at(id, t), rec.labels.get(id) ?? []), 0),
    })),
  );
  dropResetPair('room', room);
  problems.push(...checkScope('room', room, swings, 1000));
  return problems;
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
