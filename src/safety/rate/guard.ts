/**
 * The rate guard's checks on predicted events (SPEC S3, ADR 0005, exact rules in ADR 0011).
 */
import { TIME_MARGIN_MS as M, type TraceEvents } from './legs.ts';
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
  /** Set on the hold after a connect or during a rebuild, which a judge further ahead cannot see past. */
  readonly hold?: true;
}

interface Tagged {
  readonly t: number;
  readonly isNew: boolean;
}

/**
 * An event is new when the prediction without the transaction does not have it. That includes an old
 * run that the transaction extends into a leg or a hard step, whose start lies in the past. Each
 * baseline event stands for one candidate event at most, so a new leg that starts within 2 ms of an
 * old one, such as the fall straight after a rise, is still new.
 */
function tag(times: readonly number[], baseline: readonly number[]): Tagged[] {
  const used = new Set<number>();
  return times.map((t) => {
    const i = baseline.findIndex((b, k) => !used.has(k) && Math.abs(b - t) <= 2);
    if (i >= 0) used.add(i);
    return { t, isNew: i < 0 };
  });
}

/** Windows [t_i, t_i + span) holding more than `max` events, at least one of them new. */
function windowViolations(ev: readonly Tagged[], span: number, max: number): number[] {
  const out: number[] = [];
  ev.forEach((a, i) => {
    const inWindow = ev.slice(i).filter((e) => e.t < a.t + span);
    if (inWindow.length > max && inWindow.some((e) => e.isNew)) out.push(a.t + span);
  });
  return out;
}

export function swingLimit(n: number): number {
  // Anything that is not a finite number is the default (security review H2).
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_SWINGS, Math.floor(n)));
}

/** Every rule a scope's events break, counting only breaches that involve a new event. */
export function scopeViolations(
  scope: string,
  cand: TraceEvents,
  base: TraceEvents,
  swings: number,
): Violation[] {
  const out: Violation[] = [];
  const n = swingLimit(swings);
  const legs = tag(cand.legs, base.legs);
  for (const r of windowViolations(legs, 1000 + M, 2 * n))
    out.push({ scope, rule: `more than ${String(n)} swing(s) in a second`, retryAt: r });
  if (n > 1) {
    legs.forEach((a, i) => {
      const three = legs.slice(i, i + 3);
      const c = three[2];
      if (c !== undefined && c.t - a.t < SWING_SPACING_MS + M && three.some((e) => e.isNew)) {
        out.push({ scope, rule: 'swings closer than 360 ms', retryAt: a.t + SWING_SPACING_MS + M });
      }
    });
  }
  const hardWindow = scope === ROOM ? HARD_WINDOW_ROOM_MS : HARD_WINDOW_MS;
  for (const r of windowViolations(tag(cand.hard, base.hard), hardWindow + M, 1)) {
    out.push({
      scope,
      rule: `more than one hard step in ${String(hardWindow / 1000)} s`,
      retryAt: r,
    });
  }
  for (const r of windowViolations(
    tag(cand.reversals, base.reversals),
    1000 + M,
    REVERSALS_PER_SECOND,
  )) {
    out.push({ scope, rule: 'more than three small reversals in a second', retryAt: r });
  }
  // A fast repeating pattern stops after 5 s (S3.6).
  let patternStart: number | undefined;
  // Each leg with the two before it: fast when all three start within 2 s.
  let back2: Tagged | undefined;
  let back1: Tagged | undefined;
  for (const l of legs) {
    if (back2 === undefined || back1 === undefined || back2.t <= l.t - PATTERN_WINDOW_MS - M) {
      patternStart = undefined;
    } else {
      patternStart ??= back2.t;
      if (l.isNew && l.t - patternStart >= PATTERN_MAX_MS - M) {
        out.push({
          scope,
          rule: 'a fast repeating pattern ran for 5 s',
          retryAt: back1.t + PATTERN_WINDOW_MS + M,
        });
      }
    }
    back2 = back1;
    back1 = l;
  }
  return out;
}

const EMPTY: TraceEvents = { legs: [], hard: [], reversals: [] };

export function violations(
  cand: ReadonlyMap<string, TraceEvents>,
  base: ReadonlyMap<string, TraceEvents>,
  swings: number,
): Violation[] {
  const out: Violation[] = [];
  for (const [scope, ev] of cand)
    out.push(...scopeViolations(scope, ev, base.get(scope) ?? EMPTY, swings));
  return out;
}

/**
 * Add extra events (unknown state, phantom gear) to a scope and to the room. Each covers one
 * transaction, from `t` to `until`. It merges with an event the trace already has inside that span,
 * so one transaction is not counted twice, and never with another transaction's.
 */
export function withExtra(
  m: ReadonlyMap<string, TraceEvents>,
  extra: readonly { t: number; scope: string; until?: number | undefined }[],
): Map<string, TraceEvents> {
  const out = new Map<string, TraceEvents>();
  for (const [k, v] of m)
    out.set(k, { legs: [...v.legs], hard: [...v.hard], reversals: [...v.reversals] });
  for (const e of extra) {
    for (const scope of [e.scope, ROOM]) {
      const cur = out.get(scope) ?? { legs: [], hard: [], reversals: [] };
      const add = (xs: number[]) => {
        const until = e.until ?? e.t;
        if (!xs.some((x) => x >= e.t - 5 && x <= until + 5)) xs.push(e.t);
        xs.sort((a, b) => a - b);
      };
      add(cur.legs);
      add(cur.hard);
      out.set(scope, cur);
    }
  }
  return out;
}
