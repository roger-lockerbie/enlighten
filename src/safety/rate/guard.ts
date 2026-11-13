/**
 * The rate guard's checks on predicted events (SPEC S3, ADR 0005, exact rules in ADR 0011).
 */
import type { TraceEvents } from './legs.ts';
import { ROOM } from './trace.ts';

/** No setting, unlock or code path goes past three swings a second (S3.2). */
export const MAX_SWINGS = 3;
export const SWING_SPACING_MS = 360;
export const HARD_WINDOW_MS = 2000;
export const HARD_WINDOW_ROOM_MS = 1000;
export const REVERSALS_PER_SECOND = 3;
/** A leg is part of a fast pattern when it and two more start within this time (over one leg a second). */
export const PATTERN_WINDOW_MS = 2000;
/** A fast pattern stops after this long (S3.6). */
export const PATTERN_MAX_MS = 5000;

export interface Violation {
  readonly scope: string;
  readonly rule: string;
  /** When the same change could pass this rule. */
  readonly retryAt: number;
}

interface Tagged {
  readonly t: number;
  readonly isNew: boolean;
}

function tag(times: readonly number[], baseline: readonly number[], newFrom: number): Tagged[] {
  return times.map((t) => ({
    t,
    isNew: t >= newFrom - 1 && !baseline.some((b) => Math.abs(b - t) <= 2),
  }));
}

/** Windows [t_i, t_i + span) holding more than `max` events, at least one of them new. */
function windowViolations(ev: readonly Tagged[], span: number, max: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ev.length; i++) {
    const a = ev[i];
    if (a === undefined) continue;
    let j = i;
    let anyNew = a.isNew;
    while (j + 1 < ev.length && (ev[j + 1]?.t ?? Infinity) < a.t + span) {
      j++;
      if (ev[j]?.isNew === true) anyNew = true;
    }
    if (j - i + 1 > max && anyNew) out.push(a.t + span);
  }
  return out;
}

export function swingLimit(n: number): number {
  return Math.max(1, Math.min(MAX_SWINGS, Math.floor(n)));
}

/** Every rule a scope's events break, counting only breaches that involve a new event. */
export function scopeViolations(
  scope: string,
  cand: TraceEvents,
  base: TraceEvents,
  newFrom: number,
  swings: number,
): Violation[] {
  const out: Violation[] = [];
  const n = swingLimit(swings);
  const legs = tag(cand.legs, base.legs, newFrom);
  for (const r of windowViolations(legs, 1000, 2 * n))
    out.push({ scope, rule: `more than ${String(n)} swing(s) in a second`, retryAt: r });
  if (n > 1) {
    for (let i = 0; i + 2 < legs.length; i++) {
      const a = legs[i];
      const c = legs[i + 2];
      if (a === undefined || c === undefined) continue;
      if (c.t - a.t < SWING_SPACING_MS && (a.isNew || legs[i + 1]?.isNew === true || c.isNew)) {
        out.push({ scope, rule: 'swings closer than 360 ms', retryAt: a.t + SWING_SPACING_MS });
      }
    }
  }
  const hardSpan = scope === ROOM ? HARD_WINDOW_ROOM_MS : HARD_WINDOW_MS;
  for (const r of windowViolations(tag(cand.hard, base.hard, newFrom), hardSpan, 1)) {
    out.push({
      scope,
      rule: `more than one hard step in ${String(hardSpan / 1000)} s`,
      retryAt: r,
    });
  }
  for (const r of windowViolations(
    tag(cand.reversals, base.reversals, newFrom),
    1000,
    REVERSALS_PER_SECOND,
  )) {
    out.push({ scope, rule: 'more than three small reversals in a second', retryAt: r });
  }
  // A fast repeating pattern stops after 5 s (S3.6).
  let patternStart: number | undefined;
  for (let k = 0; k < legs.length; k++) {
    const l = legs[k];
    if (l === undefined) continue;
    const back2 = legs[k - 2];
    const fast = back2 !== undefined && back2.t > l.t - PATTERN_WINDOW_MS;
    if (!fast) {
      patternStart = undefined;
      continue;
    }
    patternStart ??= back2.t;
    if (l.isNew && l.t - patternStart >= PATTERN_MAX_MS) {
      const prev = legs[k - 1];
      out.push({
        scope,
        rule: 'a fast repeating pattern ran for 5 s',
        retryAt: (prev?.t ?? l.t) + PATTERN_WINDOW_MS,
      });
    }
  }
  return out;
}

const EMPTY: TraceEvents = { legs: [], hard: [], reversals: [] };

export function violations(
  cand: ReadonlyMap<string, TraceEvents>,
  base: ReadonlyMap<string, TraceEvents>,
  newFrom: number,
  swings: number,
): Violation[] {
  const out: Violation[] = [];
  for (const [scope, ev] of cand)
    out.push(...scopeViolations(scope, ev, base.get(scope) ?? EMPTY, newFrom, swings));
  return out;
}

/** Add extra events (unknown state, phantom gear) to a scope and to the room. */
export function withExtra(
  m: ReadonlyMap<string, TraceEvents>,
  extra: readonly { t: number; scope: string }[],
): Map<string, TraceEvents> {
  const out = new Map<string, TraceEvents>();
  for (const [k, v] of m)
    out.set(k, { legs: [...v.legs], hard: [...v.hard], reversals: [...v.reversals] });
  for (const e of extra) {
    for (const scope of [e.scope, ROOM]) {
      const cur = out.get(scope) ?? { legs: [], hard: [], reversals: [] };
      const add = (xs: number[]) => {
        if (!xs.some((x) => Math.abs(x - e.t) <= 5)) xs.push(e.t);
        xs.sort((a, b) => a - b);
      };
      add(cur.legs);
      add(cur.hard);
      out.set(scope, cur);
    }
  }
  return out;
}
