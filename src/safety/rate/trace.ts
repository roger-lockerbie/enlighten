/**
 * Predicted output traces for the rate guard: each terminal, a luminance estimate per address, and
 * the room's luminance (SPEC S3.1 and S3.1a). Read from the simulator's output plans.
 */
import type { Da5l, OutputPlan } from '../../sim/gear.ts';
import { LUMINANCE_WEIGHT, type Terminal } from '../../sim/profile.ts';
import type { Simulator } from '../../sim/simulator.ts';
import {
  CAUTIOUS,
  FADE_MARGIN_MS,
  GRID_MS,
  HARD_FADE_MS,
  mergeRead,
  read,
  READINGS,
  unite,
  type Directed,
  type Read,
  type Reading,
  type Sample,
  type TraceEvents,
} from './legs.ts';

/** Saturated red: only the red channel above 10% (ADR 0005). */
export const SATURATED_RED = 0.1;
/** A pre-step sample this long before each breakpoint catches instant steps. */
const PRE_MS = 0.001;
/** The most grid times read inside one fade: 20 s of the whole grid. */
const MAX_GRID = 800;

export interface UnitSample {
  readonly t: number;
  readonly d: readonly number[];
}

/** Scope name for a unit: its short address, or its unit id if it has none. */
export function scopeOf(id: string, shortAddress: number | null): string {
  return shortAddress === null ? `unit:${id}` : `a${String(shortAddress)}`;
}

export const ROOM = 'room';
export const PHANTOM = 'phantom';

/**
 * The times a reading samples every trace in the room at (ADR 0019): every breakpoint of every unit's
 * plans, 0.001 ms before each, and the reading's 25 ms grid. The first is the grid time at or before
 * `from`. Grid times at which no unit is in a fade or identifying are left out, apart from the one
 * after each breakpoint: nothing moves there, so they would repeat the sample before them and change
 * no date. A fade longer than 20 s is read on a thinner grid, so a 16 minute fade does not cost 38,400
 * samples a judge. Its legs and reversals are then dated to the nearest sample kept.
 *
 * With `instant`, every change is made at once at its plan's start, so the times are the plan starts
 * and the moment before each.
 */
export function sampleTimes(
  sim: Simulator,
  from: number,
  to: number,
  shift: number,
  instant: boolean,
): number[] {
  const start = Math.floor((from - shift) / GRID_MS) * GRID_MS + shift;
  const times = new Set<number>([start]);
  const add = (b: number) => {
    if (b <= start || b > to) return;
    if (b - PRE_MS > start) times.add(b - PRE_MS);
    times.add(b);
    // The grid time after it too: a change that lands a moment after its breakpoint, as an identify
    // toggle can by rounding, is then read where the rule reads it.
    const next = Math.floor((b - shift) / GRID_MS) * GRID_MS + shift + GRID_MS;
    if (!instant && next <= to) times.add(next);
  };
  /** The grid inside a stretch in which a unit's output can move. */
  const grid = (a: number, b: number) => {
    // A stretch longer than 20 s is read at every k-th grid time. A fade that long ran 0.7 s or
    // longer, so nothing in it is fast, and a fast fade that crosses it brings the whole grid for as
    // long as it runs.
    const step = GRID_MS * Math.max(1, Math.ceil((b - a) / GRID_MS / MAX_GRID));
    const first = Math.floor((a - shift) / step) * step + shift + step;
    for (let t = first; t < b; t += step) times.add(t);
  };
  for (const u of sim.all) {
    if (instant) {
      for (const b of u.gear.planStarts(start, to)) add(b);
      continue;
    }
    for (const b of u.gear.planBreakpoints(start, to)) add(b);
    const plans = u.gear.plans();
    plans.forEach((p, i) => {
      const next = plans[i + 1]?.since ?? Infinity;
      for (const f of [p.level, p.colour])
        grid(Math.max(f.start, start), Math.min(f.end, next, to));
      // Identify flashes for as long as it runs.
      if (p.identifyUntil > p.since)
        grid(Math.max(p.since, start), Math.min(p.identifyUntil, next, to));
    });
  }
  return [...times].sort((a, b) => a - b);
}

type Level = OutputPlan['level'];
type Colour = OutputPlan['colour'];

function sameLevel(a: Level, b: Level): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.from === b.from &&
    a.to === b.to &&
    a.offAtEnd === b.offAtEnd
  );
}

function sameColour(a: Colour, b: Colour): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.to.tc === b.to.tc &&
    a.from.tc === b.from.tc &&
    a.to.ch.every((v, i) => v === b.to.ch[i]) &&
    a.from.ch.every((v, i) => v === b.from.ch[i])
  );
}

/**
 * A fade is slow to the guard when it ran 0.7 s and the fade margin, so a fade time of 1 (707 ms)
 * is slow and a fade the gear runs a few ms short of 0.7 s is fast (DALI review S6-D16-6).
 */
export const SLOW_RAN_MS = HARD_FADE_MS + FADE_MARGIN_MS;

/**
 * A test of whether a gear's output changed between two sample times only through fades that ran
 * `SLOW_RAN_MS` or longer (S3.3, ADR 0016). A fade runs until it ends or a later plan replaces it, so a long
 * fade cut short counts by the time it ran. A new plan, the switch off at the end of a fade to off,
 * and anything during identify are instant. Sample times must include every plan start and the time
 * just before it, so no interval holds a plan start except at its end.
 */
export function slowTest(
  plans: readonly OutputPlan[],
  ran = SLOW_RAN_MS,
): (x: number, y: number) => boolean {
  const n = plans.length;
  const levelRan: number[] = new Array<number>(n).fill(0);
  const colourRan: number[] = new Array<number>(n).fill(0);
  let levelEnd = Infinity;
  let colourEnd = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    const p = plans[i];
    const next = plans[i + 1];
    if (p === undefined) continue;
    if (next === undefined || !sameLevel(next.level, p.level)) {
      levelEnd = Math.min(p.level.end, next?.since ?? Infinity);
    }
    if (next === undefined || !sameColour(next.colour, p.colour)) {
      colourEnd = Math.min(p.colour.end, next?.since ?? Infinity);
    }
    levelRan[i] = levelEnd - p.level.start;
    colourRan[i] = colourEnd - p.colour.start;
  }
  return (x, y) => {
    // The plan in force at y, as `Da5l.planAt` finds it.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((plans[mid]?.since ?? Infinity) <= y) lo = mid;
      else hi = mid - 1;
    }
    const p = plans[lo];
    if (p === undefined) return false;
    if (p.since > x && p.since <= y) return false;
    if (x < p.identifyUntil) return false;
    const l = p.level;
    if (l.offAtEnd && x < l.end && l.end <= y) return false;
    if (x < l.end && y > l.start && (levelRan[lo] ?? 0) < ran) return false;
    const c = p.colour;
    if (x < c.end && y > c.start && (colourRan[lo] ?? 0) < ran) return false;
    return true;
  };
}

/** Mark each sample whose change from the one before was slow under every test. */
function tagSlow<T extends { readonly t: number }>(
  samples: readonly T[],
  tests: readonly ((x: number, y: number) => boolean)[],
): (T & { slow: boolean })[] {
  return samples.map((s, i) => {
    const prev = samples[i - 1];
    return { ...s, slow: prev !== undefined && tests.every((f) => f(prev.t, s.t)) };
  });
}

export function sampleUnit(gear: Da5l, times: readonly number[], instant: boolean): UnitSample[] {
  return times.map((t) => ({
    t,
    d: (instant ? gear.settledOutputAt(t) : gear.outputAt(t)).terminals,
  }));
}

export function luminance(d: readonly number[], labels: readonly Terminal[]): number {
  return d.reduce((acc, x, i) => acc + x * LUMINANCE_WEIGHT[labels[i] ?? 'unused'], 0);
}

export function satRed(d: readonly number[], labels: readonly Terminal[]): boolean {
  const r = labels.indexOf('R');
  if (r < 0 || (d[r] ?? 0) <= SATURATED_RED) return false;
  return d.every((x, i) => i === r || labels[i] === 'unused' || x <= SATURATED_RED);
}

/** How long a fade must have run to be slow, in a reading: 0.7 s in the rule, and the fade margin more with margins. */
function ranFor(reading: Reading): number {
  return reading.exact ? HARD_FADE_MS : SLOW_RAN_MS;
}

/** Every unit's events (by scope) and the room's, in one reading of one set of samples. */
function readAll(
  sim: Simulator,
  times: readonly number[],
  units: readonly (readonly UnitSample[])[],
  reading: Reading,
): Map<string, Read> {
  const out = new Map<string, Read>();
  const tests = sim.all.map((u) => slowTest(u.gear.plans(), ranFor(reading)));
  sim.all.forEach((u, n) => {
    const test = tests[n];
    const samples = tagSlow(units[n] ?? [], test === undefined ? [] : [test]);
    const labels = u.gear.model.terminals;
    const lists: Read[] = [];
    labels.forEach((label, i) => {
      if (label === 'unused') return;
      lists.push(
        read(
          samples.map((s): Sample => ({ t: s.t, v: s.d[i] ?? 0, slow: s.slow })),
          reading,
        ),
      );
    });
    lists.push(
      read(
        samples.map((s) => ({ t: s.t, v: luminance(s.d, labels), slow: s.slow })),
        reading,
      ),
    );
    const red: Directed[] = [];
    let was: boolean | undefined;
    for (const s of samples) {
      const now = satRed(s.d, labels);
      if (was !== undefined && now !== was) red.push({ t: s.t, dir: 0 });
      was = now;
    }
    out.set(scopeOf(u.id, u.gear.shortAddress), mergeRead(lists, reading, red));
  });
  const room = tagSlow(
    times.map((t, k) => ({
      t,
      v: sim.all.reduce(
        (acc, u, n) => acc + luminance(units[n]?.[k]?.d ?? [], u.gear.model.terminals),
        0,
      ),
    })),
    tests,
  );
  out.set(ROOM, read(room, reading));
  return out;
}

/**
 * Leg and reversal times and hard step ranges for every unit (by scope) and for the room: every
 * reading of the faded prediction, united (ADR 0019). With `instant`, a reading with every change made
 * at once is united with them too (ADR 0011). Tests pass `readings` to take one reading alone.
 */
export function predictEvents(
  sim: Simulator,
  from: number,
  to: number,
  instant: boolean,
  readings: readonly Reading[] = READINGS,
): Map<string, TraceEvents> {
  const reads: Map<string, Read>[] = [];
  const sampled = new Map<number, { times: number[]; units: UnitSample[][] }>();
  for (const reading of readings) {
    let s = sampled.get(reading.shift);
    if (s === undefined) {
      const times = sampleTimes(sim, from, to, reading.shift, false);
      s = { times, units: sim.all.map((u) => sampleUnit(u.gear, times, false)) };
      sampled.set(reading.shift, s);
    }
    reads.push(readAll(sim, s.times, s.units, reading));
  }
  if (instant) {
    const times = sampleTimes(sim, from, to, 0, true);
    reads.push(
      readAll(
        sim,
        times,
        sim.all.map((u) => sampleUnit(u.gear, times, true)),
        CAUTIOUS,
      ),
    );
  }
  const out = new Map<string, TraceEvents>();
  const empty: Read = { legs: [], hard: [], reversals: [] };
  for (const scope of reads[0]?.keys() ?? [])
    out.set(scope, unite(reads.map((r) => r.get(scope) ?? empty)));
  return out;
}
