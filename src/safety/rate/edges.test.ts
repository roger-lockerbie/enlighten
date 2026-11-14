/**
 * U-safety: the rate guard's thresholds, each tested at its edge (ADR 0011), and the sampling that
 * finds events on a gear's output.
 */
import { describe, expect, it } from 'vitest';
import { short } from '../../dali/address.ts';
import { rgbwafCommands } from '../../dali/sequences.ts';
import { da5l, type Terminal } from '../../sim/profile.ts';
import { Rig } from '../../sim/rig.ts';
import { Simulator } from '../../sim/simulator.ts';
import {
  directedEvents,
  events,
  FADE_MARGIN_MS,
  HARD_FADE_MS,
  HARD_RATIO,
  isHard,
  isLeg,
  LEG_RATIO,
  mergeDirected,
  mergeTimes,
  RATIO_MARGIN,
  ratio,
  REVERSAL_MIN_RATIO,
  runs,
  touchesOff,
  type Run,
  type Sample,
  type TraceEvents,
} from './legs.ts';
import { scopeViolations, swingLimit, violations, withExtra } from './guard.ts';
import { PHANTOM, predictEvents, ROOM, sampleTimes, satRed } from './trace.ts';

const tr = (...pts: [number, number][]): Sample[] => pts.map(([t, v]) => ({ t, v }));
const run = (o: Partial<Run>): Run => ({
  start: 0,
  end: 0,
  dir: 1,
  from: 1,
  to: 1,
  jumpMax: 1,
  ...o,
});
const ev = (o: Partial<TraceEvents>): TraceEvents => ({ legs: [], hard: [], reversals: [], ...o });
const EMPTY = ev({});

describe('ratios and runs', () => {
  it('treats anything at or under 1e-9 as off', () => {
    expect(ratio(1e-9, 0)).toBe(1);
    expect(ratio(1e-9, 0.5)).toBe(Infinity);
    expect(touchesOff(run({ from: 1e-9, to: 0.5 }))).toBe(true);
    expect(touchesOff(run({ from: 0.5, to: 1e-9 }))).toBe(true);
    expect(touchesOff(run({ from: 0.5, to: 0.6 }))).toBe(false);
    expect(touchesOff(run({ from: 0, to: 0 }))).toBe(false);
  });
  it('ignores changes too small to be more than rounding', () => {
    expect(runs(tr([0, 1000], [10, 1000 + 5e-7]))).toEqual([]);
    expect(runs(tr([0, 0.5], [10, 0.5 + 5e-9]))).toHaveLength(1);
  });
  it('gives each run its direction, and a flat stretch of exactly 1 s ends a run', () => {
    expect(runs(tr([0, 0.1], [10, 0.2])).map((r) => r.dir)).toEqual([1]);
    expect(runs(tr([0, 0.2], [10, 0.1])).map((r) => r.dir)).toEqual([-1]);
    expect(runs(tr([0, 0.1], [10, 0.2], [1010, 0.2], [1020, 0.3]))).toHaveLength(2);
    expect(runs(tr([0, 0.1], [10, 0.2], [1009, 0.2], [1020, 0.3]))).toHaveLength(1);
  });
  it('counts a step within 50 ms as instant, and a slower one not', () => {
    expect(runs(tr([100, 0.1], [150, 0.5]))[0]?.jumpMax).toBeCloseTo(5);
    expect(runs(tr([100, 0.1], [151, 0.5]))[0]?.jumpMax).toBe(1);
  });
});

describe('legs, hard steps and reversals at their edges', () => {
  it('a leg is a ratio of 1.10 less the margin, or more', () => {
    const edge = LEG_RATIO * RATIO_MARGIN;
    expect(isLeg(run({ from: 1, to: edge }))).toBe(true);
    expect(isLeg(run({ from: 1, to: edge - 1e-6 }))).toBe(false);
  });
  it('a hard step is an instant step or a short fade above 2 less the margin', () => {
    const edge = HARD_RATIO * RATIO_MARGIN;
    expect(isHard(run({ from: 1, to: 1.5, jumpMax: edge }))).toBe(false);
    expect(isHard(run({ from: 1, to: 1.5, jumpMax: 2 }))).toBe(true);
    const fast = HARD_FADE_MS + FADE_MARGIN_MS;
    expect(isHard(run({ from: 0.1, to: 0.1 * edge, start: 1000, end: 1000 + fast - 1 }))).toBe(
      false,
    );
    expect(isHard(run({ from: 0.1, to: 0.3, start: 1000, end: 1000 + fast - 0.1 }))).toBe(true);
    expect(isHard(run({ from: 0.1, to: 0.3, start: 1000, end: 1000 + fast }))).toBe(false);
    expect(isHard(run({ from: 0.1, to: 0.3, start: 1000, end: 1000 + HARD_FADE_MS }))).toBe(true);
  });
  it('a reversal needs both runs to change by 0.4% or more, and one of them to be smaller than a leg', () => {
    const edge = 1 + (REVERSAL_MIN_RATIO - 1) * 0.8;
    const small = (lo: number) => directedEvents(tr([0, 1], [10, 1.5], [20, 1.5 / lo])).reversals;
    expect(small(edge)).toEqual([10]);
    expect(small(1.001)).toEqual([]);
    expect(small(1.006)).toEqual([10]);
    // Two legs that turn are not a small reversal.
    expect(directedEvents(tr([0, 1], [10, 1.5], [20, 1])).reversals).toEqual([]);
    expect(events(tr([0, 1], [10, 1.5], [20, edge * 1.5])).reversals).toEqual([]);
  });
});

describe('merging events from several traces', () => {
  it('sorts before merging same-direction legs within the tolerance, and keeps opposite ones', () => {
    expect(mergeDirected([[{ t: 100, dir: 1 }], [{ t: 0, dir: 1 }]])).toEqual([0]);
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1100, dir: 1 }]])).toEqual([1000]);
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1101, dir: 1 }]])).toEqual([1000, 1101]);
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1050, dir: -1 }]])).toEqual([1000, 1050]);
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1030, dir: 1 }]], 20)).toEqual([1000, 1030]);
  });
  it('merges times within 5 ms, after sorting', () => {
    expect(mergeTimes([[10], [0]])).toEqual([0, 10]);
    expect(mergeTimes([[0, 5, 11]])).toEqual([0, 11]);
    expect(mergeTimes([[30, 20], [10]])).toEqual([10, 20, 30]);
  });
});

describe('the limits at their edges', () => {
  it('an event within 2 ms of the prediction without the transaction is not new', () => {
    expect(scopeViolations('a0', ev({ hard: [0, 102] }), ev({ hard: [0, 100] }), 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [0, 103] }), ev({ hard: [0, 100] }), 1)).toHaveLength(
      1,
    );
  });
  it('windows are open at their end', () => {
    expect(scopeViolations('a0', ev({ hard: [0, 2040] }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [0, 2039] }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'more than one hard step in 2 s', retryAt: 2040 },
    ]);
  });
  it('the room allows one hard step a second, an address one in 2 s', () => {
    expect(scopeViolations(ROOM, ev({ hard: [0, 1500] }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations(ROOM, ev({ hard: [0, 1000] }), EMPTY, 1)).toEqual([
      { scope: ROOM, rule: 'more than one hard step in 1 s', retryAt: 1040 },
    ]);
    expect(scopeViolations('a0', ev({ hard: [0, 2000] }), EMPTY, 1)).toHaveLength(1);
  });
  it('two legs a swing, with a 40 ms margin on the second', () => {
    expect(scopeViolations('a0', ev({ legs: [0, 500, 1000] }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'more than 1 swing(s) in a second', retryAt: 1040 },
    ]);
    expect(scopeViolations('a0', ev({ legs: [0, 500, 1040] }), EMPTY, 1)).toEqual([]);
  });
  it('the 360 ms spacing applies only above one swing', () => {
    expect(scopeViolations('a0', ev({ legs: [0, 150, 300] }), EMPTY, 1).map((v) => v.rule)).toEqual(
      ['more than 1 swing(s) in a second'],
    );
    expect(scopeViolations('a0', ev({ legs: [0, 200, 399] }), EMPTY, 2)).toEqual([
      { scope: 'a0', rule: 'swings closer than 360 ms', retryAt: 400 },
    ]);
    expect(scopeViolations('a0', ev({ legs: [0, 200, 400] }), EMPTY, 2)).toEqual([]);
  });
  it('four small reversals in a second, with the margin', () => {
    expect(scopeViolations('a0', ev({ reversals: [0, 300, 600, 1039] }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'more than three small reversals in a second', retryAt: 1040 },
    ]);
    expect(scopeViolations('a0', ev({ reversals: [0, 300, 600, 1040] }), EMPTY, 1)).toEqual([]);
  });
  it('a fast pattern stops after 5 s less the margin, and restarts after a pause', () => {
    const legs = Array.from({ length: 9 }, (_, i) => i * 620);
    expect(scopeViolations('a0', ev({ legs }), EMPTY, 3)).toEqual([
      { scope: 'a0', rule: 'a fast repeating pattern ran for 5 s', retryAt: 4340 + 2040 },
    ]);
    expect(scopeViolations('a0', ev({ legs: legs.slice(0, 8) }), EMPTY, 3)).toEqual([]);
    // Two legs 2040 ms apart are not part of one pattern, so it starts again from the second.
    expect(
      scopeViolations('a0', ev({ legs: [0, 1000, 2040, 3000, 4000, 5000] }), EMPTY, 1),
    ).toEqual([]);
  });
  it('the swing limit is 1 for anything that is not a finite number', () => {
    expect(swingLimit(Number.NaN)).toBe(1);
    expect(swingLimit(Infinity)).toBe(1);
    expect(swingLimit(2.7)).toBe(2);
  });
  it('a scope missing from the prediction without the transaction is all new', () => {
    const v = violations(new Map([['a0', ev({ hard: [0, 10] })]]), new Map(), 1);
    expect(v.map((x) => x.scope)).toEqual(['a0']);
  });
});

describe('extra events', () => {
  it('a new scope gets the event as a leg and a hard step, and the room too', () => {
    const m = withExtra(new Map(), [{ t: 5, scope: 'a0' }]);
    expect(Object.fromEntries(m)).toEqual({
      a0: { legs: [5], hard: [5], reversals: [] },
      [ROOM]: { legs: [5], hard: [5], reversals: [] },
    });
  });
  it('merges with a trace event from 5 ms before its start to 5 ms after its end', () => {
    const add = (x: number) =>
      withExtra(new Map([['a0', ev({ hard: [x] })]]), [{ t: 100, scope: 'a0', until: 200 }]).get(
        'a0',
      )?.hard;
    expect(add(95)).toEqual([95]);
    expect(add(205)).toEqual([205]);
    expect(add(94)).toEqual([94, 100]);
    expect(add(206)).toEqual([100, 206]);
  });
  it('phantom gear is named in the refusal', () => {
    expect(PHANTOM).toBe('phantom');
  });
});

describe('sampling a gear for events', () => {
  /** Fade time 4 (2 s), then a fade up from 100 to 200 that starts at 1000. */
  const gear = () => {
    const sim = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const r = new Rig(sim, 0);
    r.to('DAPC', 0, 100);
    r.set('SET_FADE_TIME', 0, 4);
    r.t = 1000 - r.step;
    r.to('DAPC', 0, 200);
    const g = sim.unit('X')?.gear;
    if (g === undefined) throw new Error('no gear');
    return g;
  };
  it('instant sampling takes each plan start and the ends, each with a sample just before', () => {
    const g = gear();
    const times = sampleTimes(g, 500, 4000, true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(500);
    expect(times).toContain(1000);
    expect(times).toContain(1000 - 0.001);
    expect(times).toContain(4000);
    expect(times.length).toBeLessThanOrEqual(6);
  });
  it('faded sampling also looks inside each segment, every 10 ms at most, and 400 times at most', () => {
    const g = gear();
    const times = sampleTimes(g, 500, 4000, false);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.min(...times)).toBe(500);
    expect(Math.max(...times)).toBe(4000);
    const fade = times.filter((t) => t > 1000 && t < 3000);
    expect(fade.length).toBeGreaterThanOrEqual(199);
    for (let i = 1; i < times.length; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      if ((times[i] ?? 0) <= 3000) expect(gap).toBeLessThanOrEqual(10 + 1e-9);
    }
    const long = sampleTimes(g, 0, 60_000, false).filter((t) => t > 3000);
    expect(long.length).toBeLessThanOrEqual(401);
    expect(long.length).toBeGreaterThan(100);
  });
  it('saturated red is red above 10% with every used channel at or under it', () => {
    const L: Terminal[] = ['R', 'G', 'B', 'unused', 'unused'];
    expect(satRed([0.5, 0, 0, 0, 0], L)).toBe(true);
    expect(satRed([0.5, 0.1, 0.1, 0.9, 0.9], L)).toBe(true);
    expect(satRed([0.1, 0, 0, 0, 0], L)).toBe(false);
    expect(satRed([0.5, 0.2, 0, 0, 0], L)).toBe(false);
    expect(satRed([0.5, 0, 0, 0, 0], ['G', 'B', 'W', 'unused', 'unused'])).toBe(false);
  });
  it('legs on two channels 100 ms apart are two legs, and reversals are listed exactly', () => {
    const sim = Simulator.of([
      { id: 'X', profile: da5l('C5', 'rgbwaf'), opts: { shortAddress: 0 } },
    ]);
    const r = new Rig(sim, 0);
    r.step = 10;
    r.run(rgbwafCommands(short(0), [0, 0, 0, 0, 0, 0]));
    r.to('DAPC', 0, 200);
    r.t += 2000;
    // Red comes on, then green about 100 ms later: both up, too far apart to be one leg.
    r.run(rgbwafCommands(short(0), [254, 0, 0, 0, 0, 0]));
    const t1 = r.t;
    r.run(rgbwafCommands(short(0), [254, 254, 0, 0, 0, 0]));
    const t2 = r.t;
    expect(t2 - t1).toBeGreaterThan(60);
    expect(t2 - t1).toBeLessThan(140);
    const e = predictEvents(sim, t1 - 50, t2 + 2000, false).get('a0');
    expect(e?.legs).toHaveLength(2);
    expect(e?.reversals).toEqual([]);
  });
});
