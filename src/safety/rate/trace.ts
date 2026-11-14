/**
 * Predicted output traces for the rate guard: each terminal, a luminance estimate per address, and
 * the room's luminance (SPEC S3.1 and S3.1a). Read from the simulator's output plans.
 */
import type { Da5l } from '../../sim/gear.ts';
import { LUMINANCE_WEIGHT, type Terminal } from '../../sim/profile.ts';
import type { Simulator } from '../../sim/simulator.ts';
import {
  directedEvents,
  events,
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

function sampleTimes(gear: Da5l, from: number, to: number, instant: boolean): number[] {
  const bps = instant ? [from, to, ...gear.planStarts(from, to)] : gear.breakpoints(from, to);
  const sorted = [...new Set(bps)].sort((a, b) => a - b);
  const times = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b === undefined) continue;
    if (b - PRE_MS > from) times.add(b - PRE_MS);
    times.add(b);
    const next = sorted[i + 1];
    if (!instant && next !== undefined && next - b > STEP_MS) {
      const n = Math.min(MAX_INTERIOR, Math.floor((next - b) / STEP_MS));
      for (let k = 1; k < n; k++) times.add(b + ((next - b) * k) / n);
    }
  }
  return [...times].sort((a, b) => a - b);
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

function satRed(d: readonly number[], labels: readonly Terminal[]): boolean {
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
  for (const { u, times } of perUnit) {
    const samples = sampleUnit(u.gear, times, instant);
    const labels = u.gear.model.terminals;
    const lists: DirectedEvents[] = [];
    labels.forEach((label, i) => {
      if (label === 'unused') return;
      lists.push(directedEvents(samples.map((s): Sample => ({ t: s.t, v: s.d[i] ?? 0 }))));
    });
    lists.push(directedEvents(samples.map((s) => ({ t: s.t, v: luminance(s.d, labels) }))));
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
  const room = grid.map((t) => ({
    t,
    v: sim.all.reduce((acc, u) => {
      const d = instant ? u.gear.settledOutputAt(t) : u.gear.outputAt(t);
      return acc + luminance(d.terminals, d.labels);
    }, 0),
  }));
  out.set(ROOM, events(room));
  return out;
}
