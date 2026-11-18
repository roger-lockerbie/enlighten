/**
 * Predicted output traces for the rate guard: each terminal, a luminance estimate per address, and
 * the room's luminance (SPEC S3.1 and S3.1a). Read from the simulator's output plans.
 */
import type { Da5l, OutputPlan } from '../../sim/gear.ts';
import { LUMINANCE_WEIGHT, type Terminal } from '../../sim/profile.ts';
import type { Simulator } from '../../sim/simulator.ts';
import {
  directedEvents,
  events,
  FADE_MARGIN_MS,
  HARD_FADE_MS,
  mergeDirected,
  mergeTimes,
  SAME_LEG_MS,
  TIME_MARGIN_MS,
  type DirectedEvents,
  type Sample,
  type TraceEvents,
} from './legs.ts';

/** Saturated red: only the red channel above 10% (ADR 0005). */
export const SATURATED_RED = 0.1;
/** Interior samples inside a segment, at most this far apart. */
const STEP_MS = 10;
const MAX_INTERIOR = 400;
/** A pre-step sample this long before each breakpoint catches instant steps. */
const PRE_MS = 0.001;

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

export function sampleTimes(gear: Da5l, from: number, to: number, instant: boolean): number[] {
  const bps = instant ? [from, to, ...gear.planStarts(from, to)] : gear.breakpoints(from, to);
  const sorted = [...new Set(bps)].sort((a, b) => a - b);
  const times = new Set<number>();
  let last: number | undefined;
  for (const b of sorted) {
    if (b - PRE_MS > from) times.add(b - PRE_MS);
    times.add(b);
    // Inside a segment, sample often enough to find the peak where a level and a colour fade cross.
    if (!instant && last !== undefined && b - last > STEP_MS) {
      const a = last;
      const n = Math.min(MAX_INTERIOR, Math.ceil((b - a) / STEP_MS));
      for (let k = 1; k < n; k++) times.add(a + ((b - a) * k) / n);
    }
    last = b;
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
export function slowTest(plans: readonly OutputPlan[]): (x: number, y: number) => boolean {
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
    if (x < l.end && y > l.start && (levelRan[lo] ?? 0) < SLOW_RAN_MS) return false;
    const c = p.colour;
    if (x < c.end && y > c.start && (colourRan[lo] ?? 0) < SLOW_RAN_MS) return false;
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

/** Leg, hard step and reversal times for every unit (by scope) and for the room. */
export function predictEvents(
  sim: Simulator,
  from: number,
  to: number,
  instant: boolean,
): Map<string, TraceEvents> {
  const out = new Map<string, TraceEvents>();
  const allTimes = new Set<number>();
  const perUnit = sim.all.map((u) => {
    const times = sampleTimes(u.gear, from, to, instant);
    for (const t of times) allTimes.add(t);
    return { u, times };
  });
  const tests = new Map<string, (x: number, y: number) => boolean>();
  for (const { u, times } of perUnit) {
    const test = slowTest(u.gear.plans());
    tests.set(u.id, test);
    const samples = tagSlow(sampleUnit(u.gear, times, instant), [test]);
    const labels = u.gear.model.terminals;
    const lists: DirectedEvents[] = [];
    labels.forEach((label, i) => {
      if (label === 'unused') return;
      lists.push(
        directedEvents(samples.map((s): Sample => ({ t: s.t, v: s.d[i] ?? 0, slow: s.slow }))),
      );
    });
    lists.push(
      directedEvents(samples.map((s) => ({ t: s.t, v: luminance(s.d, labels), slow: s.slow }))),
    );
    const red: { t: number; dir: 0 }[] = [];
    let was: boolean | undefined;
    for (const s of samples) {
      const now = satRed(s.d, labels);
      if (was !== undefined && now !== was) red.push({ t: s.t, dir: 0 });
      was = now;
    }
    out.set(scopeOf(u.id, u.gear.shortAddress), {
      // The guard merges less than the rule allows, so it never counts fewer legs than the trace has.
      legs: mergeDirected([...lists.map((l) => l.legs), red], SAME_LEG_MS - TIME_MARGIN_MS),
      hard: mergeDirected(
        lists.map((l) => l.hard),
        SAME_LEG_MS - TIME_MARGIN_MS,
      ),
      reversals: mergeTimes(lists.map((l) => l.reversals)),
    });
  }
  const grid = [...allTimes].sort((a, b) => a - b);
  const room = tagSlow(
    grid.map((t) => ({
      t,
      v: sim.all.reduce((acc, u) => {
        const d = instant ? u.gear.settledOutputAt(t) : u.gear.outputAt(t);
        return acc + luminance(d.terminals, d.labels);
      }, 0),
    })),
    [...tests.values()],
  );
  out.set(ROOM, events(room));
  return out;
}
