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
  hardTimes,
  JUMP_MS,
  isLeg,
  isSurelyLeg,
  LEG_RATIO,
  mergeDirected,
  mergeTimes,
  uniteTimes,
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
  jumps: [],
  fastRatio: 1,
  fastStart: undefined,
  spans: [],
  border: [],
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
  it('counts a step within 50 ms (60 ms to the guard) as instant, and a slower one not', () => {
    expect(runs(tr([100, 0.1], [150, 0.5]))[0]?.jumpMax).toBeCloseTo(5);
    // The guard looks one 10 ms sample further back than 50 ms, for where its samples fall.
    expect(runs(tr([100, 0.1], [160, 0.5]))[0]?.jumpMax).toBeCloseTo(5);
    expect(runs(tr([100, 0.1], [161, 0.5]))[0]?.jumpMax).toBe(1);
  });
  it('dates each instant step above 2 where it happens, inside a run kept going by a slow fade', () => {
    // A slow fall with a drop at 1 s and another at 1.8 s: one run, two hard steps (ADR 0015).
    const pts: [number, number][] = [];
    for (let t = 0; t <= 3000; t += 10) {
      const v = (t < 1000 ? 1 : t < 1800 ? 0.33 : 0.1) - t / 100_000;
      pts.push([t, v]);
    }
    // The fall is slow, apart from the drops.
    const samples = tr(...pts).map((p, k) => ({ ...p, slow: k % 100 !== 0 || k === 0 }));
    const r = runs(samples);
    expect(r).toHaveLength(1);
    expect(r[0]?.jumps.map((j) => j.t)).toEqual([990, 1790]);
    expect(directedEvents(samples).hard.map((e) => e.t)).toEqual([990, 1790]);
    // Were the fall fast, the drop's span could be dated as far back as the window reaches: the rule
    // finds it when the change from the window's lowest point passes 2, partway down the drop (S6-P10).
    expect(directedEvents(tr(...pts)).hard.map((e) => e.t)).toEqual([260, 990, 1060, 1790]);
  });
  it('finds a step above 2 within 50 ms when no two samples differ by 2', () => {
    // A slow rise keeps the run going, then a 100 ms fade by 15: 1.31 a sample, 3.9 within 50 ms.
    const pts: [number, number][] = [
      [0, 0.5],
      [10, 0.05],
    ];
    for (let t = 200; t <= 1000; t += 10) pts.push([t, 0.05 + (t - 200) / 100_000]);
    for (let k = 1; k <= 10; k++) pts.push([1000 + k * 10, 0.058 * 15 ** (k / 10)]);
    // The rise is slow, the fade fast.
    const samples = tr(...pts).map((p) => ({ ...p, slow: p.t > 200 && p.t <= 1000 }));
    const r = runs(samples).find((x) => x.dir === 1);
    expect(r?.jumps.length).toBe(1);
    expect(directedEvents(samples).hard.map((e) => e.t)).toHaveLength(2);
  });
  it('counts instant steps that follow on within 50 ms as one', () => {
    // A fast fade sampled finely: each sample a step above 2, one hard step.
    const on = runs(tr([0, 0.02], [10, 0.05], [20, 0.12], [30, 0.3], [40, 0.8]));
    expect(on[0]?.jumps.map((j) => j.t)).toEqual([0]);
    // Two steps with a gap of exactly 50 ms between them are one; a gap over 50 ms is two.
    expect(runs(tr([0, 0.03], [10, 0.1], [60, 0.11], [70, 0.4]))[0]?.jumps.map((j) => j.t)).toEqual(
      [0],
    );
    expect(runs(tr([0, 0.03], [10, 0.1], [61, 0.11], [71, 0.4]))[0]?.jumps.map((j) => j.t)).toEqual(
      [0, 61],
    );
    expect(JUMP_MS).toBe(50);
  });
  it('dates a fast leg where its fast movement began, and each span and instant step in a longer leg', () => {
    const jump = (t: number) => ({ t, v: 0, endT: t + 10, endV: 0, max: 3 });
    // A fast leg is one hard step, where its fast movement began, whatever steps it holds.
    const r = run({
      from: 0.1,
      to: 0.3,
      start: 1000,
      end: 1500,
      fastRatio: 3,
      fastStart: 1000,
      spans: [1150],
    });
    expect(hardTimes(r)).toEqual([1000]);
    expect(hardTimes({ ...r, jumps: [jump(1200)] })).toEqual([1000]);
    // Without a span, the fast change did not pass 2 within 0.7 s on the guard's samples.
    expect(hardTimes({ ...r, spans: [] })).toEqual([]);
    // A longer leg: each span and step where it happened. A span and a step within 50 ms are one.
    const slow = run({ from: 0.1, to: 0.9, start: 1000, end: 3000, fastRatio: 9, spans: [1300] });
    expect(hardTimes({ ...slow, jumps: [jump(1300), jump(2500)] })).toEqual([1300, 2500]);
    expect(hardTimes({ ...slow, jumps: [jump(1350)] })).toEqual([1300]);
    expect(hardTimes({ ...slow, jumps: [jump(1351)] })).toEqual([1300, 1351]);
    expect(hardTimes({ ...slow, spans: [] })).toEqual([]);
    // Ends far apart in under 0.7 s, but through a slow fade: not a hard step (ADR 0016).
    expect(hardTimes(run({ from: 0.1, to: 0.9, start: 1000, end: 1300 }))).toEqual([]);
    // On the border of 0.7 s, both readings: the fast leg's start, and each span and step (S6-P8).
    const edge = { ...r, end: 1000 + HARD_FADE_MS - FADE_MARGIN_MS };
    expect(hardTimes({ ...edge, jumps: [jump(1690)] })).toEqual([1000, 1150, 1690]);
    expect(hardTimes({ ...edge, end: edge.end - 0.01, jumps: [jump(1690)] })).toEqual([1000]);
    const far = { ...r, end: 1000 + HARD_FADE_MS + FADE_MARGIN_MS };
    expect(hardTimes({ ...far, end: far.end - 0.01, jumps: [jump(1690)] })).toEqual([
      1000, 1150, 1690,
    ]);
    expect(hardTimes({ ...far, jumps: [jump(1690)] })).toEqual([1150, 1690]);
    // The start is not counted again when a span or step is within the time margin of it.
    expect(hardTimes({ ...edge, spans: [1040] })).toEqual([1040]);
    // Fast change near 2: both readings.
    const near = { ...r, fastRatio: HARD_RATIO / RATIO_MARGIN };
    expect(hardTimes({ ...near, jumps: [jump(1400)] })).toEqual([1000, 1150, 1400]);
    expect(
      hardTimes({ ...near, fastRatio: HARD_RATIO * RATIO_MARGIN, jumps: [jump(1400)] }),
    ).toEqual([1150, 1400]);
    // A run smaller than a leg has none.
    expect(hardTimes({ ...r, to: 0.1005, jumps: [jump(1200)] })).toEqual([]);
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
    // An instant step: 1.98 is not a hard step, 2 is.
    const step = (r: number) => events(tr([0, 1], [100, 1], [100.001, r], [500, r])).hard;
    expect(step(edge)).toEqual([]);
    expect(step(2)).toEqual([100]);
    // A fade sampled every 10 ms: fast change above 2 within 0.7 s is a hard step from its start,
    // and a fade the gear ran for 0.7 s or longer (marked slow) never is (ADR 0016).
    const fade = (to: number, took: number, slow = false) => {
      const pts: Sample[] = [
        { t: 0, v: 0.1 },
        { t: 1000, v: 0.1 },
      ];
      for (let k = 1; k * 10 <= took; k++)
        pts.push({ t: 1000 + k * 10, v: 0.1 * (to / 0.1) ** ((k * 10) / took), slow });
      pts.push({ t: 4000, v: to });
      return events(pts).hard;
    };
    expect(fade(0.1 * edge * 0.9999, 300)).toEqual([]);
    expect(fade(0.1 * edge * 1.0001, 300)).toEqual([1000]);
    expect(fade(0.2, 300)).toEqual([1000]);
    expect(fade(0.3, 400, true)).toEqual([]);
    // Fast change by 3 over 1 s is above 2 within 0.7 s, and over 2 s it is not.
    expect(fade(0.3, 1000)).toEqual([1000]);
    expect(fade(0.3, 2000)).toEqual([]);
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
  it('a turn after a run on the leg border counts as a small reversal (rate-runs counterexample)', () => {
    // A slow fall of 1.095, then a rise of 1.27: the rule sees no leg before the rise, so the turn is a
    // small reversal. The guard used to call the fall a leg, by its margin, and missed the turn.
    const turn = (fall: number) => directedEvents(tr([0, fall], [1000, 1], [1001, 1.27])).reversals;
    expect(turn(1.095)).toEqual([1000]);
    expect(turn(LEG_RATIO * RATIO_MARGIN)).toEqual([1000]);
    expect(turn(LEG_RATIO / RATIO_MARGIN - 1e-6)).toEqual([1000]);
    expect(turn(LEG_RATIO / RATIO_MARGIN)).toEqual([]);
    expect(isSurelyLeg(run({ from: 1, to: LEG_RATIO / RATIO_MARGIN }))).toBe(true);
    expect(isSurelyLeg(run({ from: 1, to: LEG_RATIO }))).toBe(false);
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
  it('keeps opposite events apart unless they are at one moment (S6-P11)', () => {
    // A swap between colours: one channel up, another down, at once.
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1000.001, dir: -1 }]])).toEqual([1000]);
    // A step up, then a fade down starting 4 ms later: two.
    expect(mergeDirected([[{ t: 31, dir: 1 }], [{ t: 35, dir: -1 }]])).toEqual([31, 35]);
    // Within 5 ms, the same way or with no direction: one.
    expect(mergeDirected([[{ t: 1000, dir: 1 }], [{ t: 1004, dir: 0 }]])).toEqual([1000]);
  });
  it('keeps a border date whatever the merge (S6-D17-1)', () => {
    const span = { t: 1050, dir: 1 as const };
    const early = { t: 1000, dir: 1 as const, border: true };
    expect(mergeDirected([[early, span]], 60)).toEqual([1000, 1050]);
    expect(mergeDirected([[early], [{ t: 1003, dir: 1 }]], 60)).toEqual([1000]);
  });
  it('merges times within 5 ms, after sorting', () => {
    expect(mergeTimes([[10], [0]])).toEqual([0, 10]);
    expect(mergeTimes([[0, 5, 11]])).toEqual([0, 11]);
    expect(mergeTimes([[30, 20], [10]])).toEqual([10, 20, 30]);
  });
});

describe('uniting the faded and instant predictions', () => {
  it('counts an event both predictions have once', () => {
    expect(uniteTimes([100], [102])).toEqual([100]);
    expect(uniteTimes([100], [106])).toEqual([100, 106]);
    expect(uniteTimes([], [5])).toEqual([5]);
  });
  it('keeps two legs of one prediction at the same moment (Stage 4 property counterexample)', () => {
    expect(uniteTimes([100, 100], [100])).toEqual([100, 100]);
    expect(uniteTimes([100], [100, 101])).toEqual([100, 101]);
    expect(uniteTimes([0, 3, 4], [1])).toEqual([0, 3, 4]);
    expect(uniteTimes([10, 20], [30])).toEqual([10, 20, 30]);
  });
});

describe('the limits at their edges', () => {
  it('an event within 2 ms of the prediction without the transaction is not new', () => {
    expect(scopeViolations('a0', ev({ hard: [0, 102] }), ev({ hard: [0, 100] }), 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [0, 103] }), ev({ hard: [0, 100] }), 1)).toHaveLength(
      1,
    );
  });
  it('an old event stands for one new event at most (rate-runs counterexample)', () => {
    // A rise was old, and the change turned the slow fall straight after it into a leg 1 ms later.
    // The fall is new, so three legs in a second break the one-swing limit.
    const base = ev({ legs: [0, 549] });
    expect(scopeViolations('a0', ev({ legs: [0, 549, 550] }), base, 1)).toHaveLength(1);
    expect(scopeViolations('a0', ev({ legs: [0, 549] }), base, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [0, 1, 2] }), ev({ hard: [0, 1, 2] }), 1)).toEqual([]);
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
    // Legs 990 ms apart: each leg and the one two before it are 1980 ms apart, inside the 2 s window
    // less the margin, so they are one pattern.
    const slow = Array.from({ length: 7 }, (_, i) => i * 990);
    expect(scopeViolations('a0', ev({ legs: slow }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'a fast repeating pattern ran for 5 s', retryAt: 4950 + 2040 },
    ]);
    // A pattern that pauses for more than 2 s counts its 5 s again from the restart.
    const twice = [0, 500, 1000, 1500, ...Array.from({ length: 10 }, (_, i) => 4000 + i * 500)];
    expect(scopeViolations('a0', ev({ legs: twice }), EMPTY, 3)).toEqual([]);
    expect(scopeViolations('a0', ev({ legs: [...twice, 9000] }), EMPTY, 3)).toEqual([
      { scope: 'a0', rule: 'a fast repeating pattern ran for 5 s', retryAt: 8500 + 2040 },
    ]);
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
    // A segment that is not a whole number of 10 ms steps is still sampled every 10 ms at most (S6-S18-4).
    const odd = sampleTimes(g, 503, 1000, false);
    for (let i = 1; i < odd.length; i++)
      expect((odd[i] ?? 0) - (odd[i - 1] ?? 0)).toBeLessThanOrEqual(10 + 1e-9);
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
