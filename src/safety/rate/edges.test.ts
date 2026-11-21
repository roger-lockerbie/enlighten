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
  CAUTIOUS,
  events,
  EXACT,
  FADE_MARGIN_MS,
  GRID_MS,
  HARD_FADE_MS,
  HARD_RATIO,
  hardSteps,
  JUMP_MS,
  isLeg,
  isSurelyLeg,
  LEG_RATIO,
  mergeRead,
  mergeTimes,
  unite,
  uniteAll,
  uniteHard,
  uniteTimes,
  RATIO_MARGIN,
  ratio,
  read,
  REVERSAL_MIN_RATIO,
  runs,
  SAME_STEP_MS,
  TIME_MARGIN_MS,
  touchesOff,
  type Directed,
  type Range,
  type Reading,
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
  jumps: [],
  fastRatio: 1,
  fastStart: undefined,
  spans: [],
  ...o,
});
/** Hard steps of one date each. */
const at = (...ts: number[]): Range[] => ts.map((t) => ({ lo: t, hi: t }));
const ev = (o: Partial<TraceEvents>): TraceEvents => ({ legs: [], hard: [], reversals: [], ...o });
const EMPTY = ev({});
/** The dates one reading gives a trace's hard steps, and a run's. */
const dates = (s: readonly Sample[], reading: Reading = CAUTIOUS) =>
  read(s, reading).hard.map((x) => x.t);
const hardTimes = (r: Run, reading: Reading = CAUTIOUS) => hardSteps(r, reading).map((x) => x.t);
/** One address's legs on several traces, merged in one reading. */
const merged = (lists: Directed[][], reading: Reading = CAUTIOUS) =>
  mergeRead(
    lists.map((legs) => ({ legs, hard: [], reversals: [] })),
    reading,
  ).legs.map((x) => x.t);

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
  it('counts a step within 50 ms (60 ms with margins) as instant, and a slower one not', () => {
    const jumps = (ms: number, reading: Reading) =>
      runs(tr([100, 0.1], [100 + ms, 0.5]), reading)[0]?.jumps.length;
    expect(jumps(50, EXACT)).toBe(1);
    expect(jumps(51, EXACT)).toBe(0);
    expect(jumps(60, CAUTIOUS)).toBe(1);
    expect(jumps(61, CAUTIOUS)).toBe(0);
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
    expect(dates(samples)).toEqual([990, 1790]);
    expect(dates(samples, EXACT)).toEqual([990, 1790]);
    // Were the fall fast, each drop would be a span too, from the same sample as its step.
    expect(dates(tr(...pts))).toEqual([990, 1790]);
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
    expect(dates(samples)).toHaveLength(2);
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
    // The rule counts steps up to 100 ms apart as one.
    const rule = (gap: number) =>
      runs(tr([0, 0.03], [10, 0.1], [10 + gap, 0.11], [20 + gap, 0.4]), EXACT)[0]?.jumps.length;
    expect(rule(SAME_STEP_MS)).toBe(1);
    expect(rule(SAME_STEP_MS + 1)).toBe(2);
  });
  it('the rule folds a step just under 2 into the hard step it follows, and a cautious reading does not', () => {
    // A step by 3, then one by 1.97 within 100 ms, then one by 2.5 within 100 ms of that.
    const s = tr([0, 0.05], [10, 0.15], [100, 0.15], [110, 0.2955], [200, 0.2955], [210, 0.73875]);
    expect(runs(s, EXACT)[0]?.jumps).toEqual([{ t: 0, endT: 210 }]);
    expect(runs(s, CAUTIOUS)[0]?.jumps.map((j) => j.t)).toEqual([0, 200]);
  });
  it('dates a fast leg where its fast movement began, and each span and instant step in a longer leg', () => {
    const jump = (t: number) => ({ t, endT: t + 10 });
    const span = (t: number) => ({ t, until: t + 100 });
    // A fast leg is one hard step, where its fast movement began, whatever steps it holds.
    const r = run({
      from: 0.1,
      to: 0.3,
      start: 1000,
      end: 1500,
      fastRatio: 3,
      fastStart: 1000,
      spans: [span(1150)],
    });
    expect(hardSteps(r)).toEqual([{ t: 1000, until: 1500, dir: 1 }]);
    expect(hardTimes({ ...r, jumps: [jump(1200)] })).toEqual([1000]);
    // Without a span, the fast change did not pass 2 within 0.7 s on the samples.
    expect(hardTimes({ ...r, spans: [] })).toEqual([]);
    // A longer leg: each span and step where it happened. A span and a step within 50 ms are one,
    // and within 100 ms in the rule.
    const slow = run({
      from: 0.1,
      to: 0.9,
      start: 1000,
      end: 3000,
      fastRatio: 9,
      spans: [span(1300)],
    });
    expect(hardTimes({ ...slow, jumps: [jump(1300), jump(2500)] })).toEqual([1300, 2500]);
    expect(hardSteps({ ...slow, jumps: [jump(1350)] })).toEqual([{ t: 1300, until: 1400, dir: 1 }]);
    expect(hardTimes({ ...slow, jumps: [jump(1351)] })).toEqual([1300, 1351]);
    expect(hardTimes({ ...slow, jumps: [jump(1400)] }, EXACT)).toEqual([1300]);
    expect(hardTimes({ ...slow, jumps: [jump(1401)] }, EXACT)).toEqual([1300, 1401]);
    // The rule measures from the one before, kept or not. A cautious reading from the last kept.
    const chain = { ...slow, jumps: [jump(1340), jump(1380)] };
    expect(hardTimes(chain)).toEqual([1300, 1380]);
    expect(hardTimes({ ...slow, jumps: [jump(1390), jump(1480)] }, EXACT)).toEqual([1300]);
    expect(hardTimes({ ...slow, spans: [] })).toEqual([]);
    // Ends far apart in under 0.7 s, but through a slow fade: not a hard step (ADR 0016).
    expect(hardTimes(run({ from: 0.1, to: 0.9, start: 1000, end: 1300 }))).toEqual([]);
    // On the border of 0.7 s the readings differ: under 0.7 s in the rule, and under 0.7 s and the
    // fade margin with margins (S6-P8). United, the two dates are one range.
    const edge = { ...r, end: 1000 + HARD_FADE_MS, jumps: [jump(1690)] };
    expect(hardTimes(edge, EXACT)).toEqual([1150, 1690]);
    expect(hardTimes({ ...edge, end: edge.end - 0.01 }, EXACT)).toEqual([1000]);
    expect(hardTimes(edge)).toEqual([1000]);
    const far = { ...edge, end: 1000 + HARD_FADE_MS + FADE_MARGIN_MS };
    expect(hardTimes({ ...far, end: far.end - 0.01 })).toEqual([1000]);
    expect(hardTimes(far)).toEqual([1150, 1690]);
    // Fast change near 2: above 2 in the rule, above 2 less the margin with margins.
    const near = { ...r, jumps: [jump(1400)] };
    expect(hardTimes({ ...near, fastRatio: HARD_RATIO }, EXACT)).toEqual([1150, 1400]);
    expect(hardTimes({ ...near, fastRatio: HARD_RATIO + 1e-9 }, EXACT)).toEqual([1000]);
    expect(hardTimes({ ...near, fastRatio: HARD_RATIO * RATIO_MARGIN })).toEqual([1150, 1400]);
    expect(hardTimes({ ...near, fastRatio: HARD_RATIO * RATIO_MARGIN + 1e-9 })).toEqual([1000]);
    // A run smaller than a leg has none.
    expect(hardTimes({ ...r, to: 0.1005, jumps: [jump(1200)] })).toEqual([]);
  });
});

describe('legs, hard steps and reversals at their edges', () => {
  it('a leg is a ratio of 1.10 or more, less the margin in a cautious reading', () => {
    const edge = LEG_RATIO * RATIO_MARGIN;
    expect(isLeg(run({ from: 1, to: edge }))).toBe(true);
    expect(isLeg(run({ from: 1, to: edge - 1e-6 }))).toBe(false);
    expect(isLeg(run({ from: 1, to: LEG_RATIO }), EXACT)).toBe(true);
    expect(isLeg(run({ from: 1, to: LEG_RATIO - 1e-6 }), EXACT)).toBe(false);
  });
  it('a hard step is an instant step or a short fade above 2 less the margin', () => {
    const edge = HARD_RATIO * RATIO_MARGIN;
    // An instant step: 1.98 is not a hard step, 2 is.
    const step = (r: number, reading: Reading = CAUTIOUS) =>
      dates(tr([0, 1], [100, 1], [100.001, r], [500, r]), reading);
    expect(step(edge)).toEqual([]);
    expect(step(2)).toEqual([100]);
    expect(step(2, EXACT)).toEqual([]);
    expect(step(2.0001, EXACT)).toEqual([100]);
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
      return dates(pts);
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
    const small = (lo: number) => read(tr([0, 1], [10, 1.5], [20, 1.5 / lo])).reversals;
    expect(small(edge)).toEqual([10]);
    expect(small(1.001)).toEqual([]);
    expect(small(1.006)).toEqual([10]);
    // Two legs that turn are not a small reversal.
    expect(read(tr([0, 1], [10, 1.5], [20, 1])).reversals).toEqual([]);
    expect(events(tr([0, 1], [10, 1.5], [20, edge * 1.5])).reversals).toEqual([]);
  });
  it('a turn after a run on the leg border counts as a small reversal (rate-runs counterexample)', () => {
    // A slow fall of 1.095, then a rise of 1.27: the rule sees no leg before the rise, so the turn is a
    // small reversal. The guard used to call the fall a leg, by its margin, and missed the turn.
    const turn = (fall: number, reading: Reading = CAUTIOUS) =>
      read(tr([0, fall], [1000, 1], [1001, 1.27]), reading).reversals;
    expect(turn(1.095)).toEqual([1000]);
    expect(turn(LEG_RATIO * RATIO_MARGIN)).toEqual([1000]);
    expect(turn(LEG_RATIO / RATIO_MARGIN - 1e-6)).toEqual([1000]);
    expect(turn(LEG_RATIO / RATIO_MARGIN)).toEqual([]);
    expect(isSurelyLeg(run({ from: 1, to: LEG_RATIO / RATIO_MARGIN }))).toBe(true);
    expect(isSurelyLeg(run({ from: 1, to: LEG_RATIO }))).toBe(false);
    // In the rule a leg is a leg.
    expect(turn(LEG_RATIO - 1e-6, EXACT)).toEqual([1000]);
    expect(turn(LEG_RATIO, EXACT)).toEqual([]);
    expect(isSurelyLeg(run({ from: 1, to: LEG_RATIO }), EXACT)).toBe(true);
  });
});

describe('merging events from several traces', () => {
  const up = (t: number): Directed => ({ t, dir: 1 });
  const down = (t: number): Directed => ({ t, dir: -1 });
  it('sorts before merging same-direction legs within the tolerance, and keeps opposite ones', () => {
    expect(merged([[up(60)], [up(0)]])).toEqual([0]);
    // The rule merges within 100 ms of the first. A cautious reading merges less.
    expect(merged([[up(1000)], [up(1100)]], EXACT)).toEqual([1000]);
    expect(merged([[up(1000)], [up(1101)]], EXACT)).toEqual([1000, 1101]);
    expect(merged([[up(1000)], [up(1100 - TIME_MARGIN_MS)]])).toEqual([1000]);
    expect(merged([[up(1000)], [up(1101 - TIME_MARGIN_MS)]])).toEqual([1000, 1061]);
    expect(merged([[up(1000)], [down(1050)]])).toEqual([1000, 1050]);
    // Within the tolerance of the first, not of the last: a chain does not become one leg.
    expect(merged([[up(0), up(50), up(100), up(150)]], EXACT)).toEqual([0, 150]);
  });
  it('keeps opposite events apart unless they are at one moment (S6-P11)', () => {
    // A swap between colours: one channel up, another down, at once.
    expect(merged([[up(1000)], [down(1000.001)]])).toEqual([1000]);
    // A step up, then a fade down starting 4 ms later: two to a cautious reading. The rule counts
    // events within 5 ms as one whatever their directions.
    expect(merged([[up(31)], [down(35)]])).toEqual([31, 35]);
    expect(merged([[up(31)], [down(35)]], EXACT)).toEqual([31]);
    expect(merged([[up(31)], [down(37)]], EXACT)).toEqual([31, 37]);
    // Within 5 ms, the same way or with no direction: one.
    expect(merged([[up(1000)], [{ t: 1004, dir: 0 }]])).toEqual([1000]);
  });
  it('a merged hard step lasts as long as the longest of its parts, and a saturated red change is a leg', () => {
    const m = mergeRead(
      [
        { legs: [up(1000)], hard: [{ t: 1000, until: 1100, dir: 1 }], reversals: [1500] },
        { legs: [up(1010)], hard: [{ t: 1010, until: 1300, dir: 1 }], reversals: [1503] },
      ],
      CAUTIOUS,
      [{ t: 2000, dir: 0 }],
    );
    expect(m.hard).toEqual([{ t: 1000, until: 1300, dir: 1 }]);
    expect(m.legs.map((x) => x.t)).toEqual([1000, 2000]);
    expect(m.reversals).toEqual([1500]);
  });
  it('merges times within 5 ms, after sorting', () => {
    expect(mergeTimes([[10], [0]])).toEqual([0, 10]);
    expect(mergeTimes([[0, 5, 11]])).toEqual([0, 11]);
    expect(mergeTimes([[30, 20], [10]])).toEqual([10, 20, 30]);
  });
});

describe('uniting readings', () => {
  it('never has fewer events than any one reading, across any number of them', () => {
    expect(uniteAll([[100], [104], [108]], 10)).toEqual([100]);
    expect(uniteAll([[100, 104], [102], []], 10)).toEqual([100, 104]);
    expect(uniteAll([[100], [100 + GRID_MS + 6]], GRID_MS + 5)).toHaveLength(2);
    expect(events(tr([0, 1], [10, 1.5], [20, 1])).legs).toEqual([0, 10]);
  });
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
    expect(scopeViolations('a0', ev({ hard: at(0, 102) }), ev({ hard: at(0, 100) }), 1)).toEqual(
      [],
    );
    expect(
      scopeViolations('a0', ev({ hard: at(0, 103) }), ev({ hard: at(0, 100) }), 1),
    ).toHaveLength(1);
  });
  it('an old event stands for one new event at most (rate-runs counterexample)', () => {
    // A rise was old, and the change turned the slow fall straight after it into a leg 1 ms later.
    // The fall is new, so three legs in a second break the one-swing limit.
    const base = ev({ legs: [0, 549] });
    expect(scopeViolations('a0', ev({ legs: [0, 549, 550] }), base, 1)).toHaveLength(1);
    expect(scopeViolations('a0', ev({ legs: [0, 549] }), base, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: at(0, 1, 2) }), ev({ hard: at(0, 1, 2) }), 1)).toEqual(
      [],
    );
  });
  it('windows are open at their end', () => {
    expect(scopeViolations('a0', ev({ hard: at(0, 2040) }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: at(0, 2039) }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'more than one hard step in 2 s', retryAt: 2040 },
    ]);
  });
  it('a hard step with a range of dates counts once, and is judged from its nearest end (ADR 0019)', () => {
    const wide = { lo: 1000, hi: 1600 };
    // One hard step is never too close to itself, however wide its range.
    expect(scopeViolations('a0', ev({ hard: [wide] }), EMPTY, 1)).toEqual([]);
    // After it: 2 s and the margin from its latest date. The retry time counts from there too.
    expect(scopeViolations('a0', ev({ hard: [wide, ...at(3640)] }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [wide, ...at(3639)] }), EMPTY, 1)).toEqual([
      { scope: 'a0', rule: 'more than one hard step in 2 s', retryAt: 3640 },
    ]);
    // Before it: 2 s and the margin to its earliest date.
    expect(scopeViolations('a0', ev({ hard: [...at(-1040), wide] }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations('a0', ev({ hard: [...at(-1039), wide] }), EMPTY, 1)).toHaveLength(1);
    // A hard step inside another's range is too close to it.
    expect(scopeViolations('a0', ev({ hard: [wide, ...at(1300)] }), EMPTY, 1)).toHaveLength(1);
    // Old when the prediction without the transaction has a range that overlaps it.
    const base = ev({ hard: [{ lo: 1500, hi: 1700 }, ...at(1300)] });
    expect(scopeViolations('a0', ev({ hard: [wide, ...at(1300)] }), base, 1)).toEqual([]);
    expect(
      scopeViolations('a0', ev({ hard: [wide, ...at(1300)] }), ev({ hard: at(1300) }), 1),
    ).toHaveLength(1);
    expect(
      scopeViolations('a0', ev({ hard: [wide, ...at(1300)] }), ev({ hard: at(1603, 1300) }), 1),
    ).toHaveLength(1);
  });
  it('an old hard step stands only for a new one that goes the same way (S8b-L4)', () => {
    // The prediction had a switch off at 1000. The change cancels it and steps up there, 0.5 s after
    // a hard step that was already counted.
    const base = ev({
      hard: [
        { lo: 500, hi: 500, dir: 1 },
        { lo: 1000, hi: 1000, dir: -1 },
      ],
    });
    const up = ev({
      hard: [
        { lo: 500, hi: 500, dir: 1 },
        { lo: 1000, hi: 1000, dir: 1 },
      ],
    });
    expect(scopeViolations('a0', up, base, 1)).toHaveLength(1);
    expect(scopeViolations('a0', base, base, 1)).toEqual([]);
    // A range with no direction, as an extra event has, matches either way.
    const extra = ev({
      hard: [
        { lo: 500, hi: 500, dir: 1 },
        { lo: 1000, hi: 1000 },
      ],
    });
    expect(scopeViolations('a0', extra, base, 1)).toEqual([]);
  });
  it('the room allows one hard step a second, an address one in 2 s', () => {
    expect(scopeViolations(ROOM, ev({ hard: at(0, 1500) }), EMPTY, 1)).toEqual([]);
    expect(scopeViolations(ROOM, ev({ hard: at(0, 1000) }), EMPTY, 1)).toEqual([
      { scope: ROOM, rule: 'more than one hard step in 1 s', retryAt: 1040 },
    ]);
    expect(scopeViolations('a0', ev({ hard: at(0, 2000) }), EMPTY, 1)).toHaveLength(1);
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
    const v = violations(new Map([['a0', ev({ hard: at(0, 10) })]]), new Map(), 1);
    expect(v.map((x) => x.scope)).toEqual(['a0']);
  });
});

describe('extra events', () => {
  it('a new scope gets the event as a leg and a hard step, and the room too', () => {
    const m = withExtra(new Map(), [{ t: 5, scope: 'a0' }]);
    expect(Object.fromEntries(m)).toEqual({
      a0: { legs: [5], hard: at(5), reversals: [] },
      [ROOM]: { legs: [5], hard: at(5), reversals: [] },
    });
  });
  it('merges with a trace event from 5 ms before its start to 5 ms after its end', () => {
    const add = (x: number) =>
      withExtra(new Map([['a0', ev({ hard: at(x) })]]), [{ t: 100, scope: 'a0', until: 200 }]).get(
        'a0',
      )?.hard;
    expect(add(95)).toEqual(at(95));
    expect(add(205)).toEqual(at(205));
    expect(add(94)).toEqual(at(94, 100));
    expect(add(206)).toEqual(at(100, 206));
  });
  it('its hard step is a range until the gear may have stopped moving (ADR 0019, S6-P16)', () => {
    const m = withExtra(new Map([['a0', ev({ hard: at(100) })]]), [
      { t: 100, scope: 'a0', hardUntil: 3000 },
    ]);
    expect(m.get('a0')?.hard).toEqual([{ lo: 100, hi: 3000 }]);
    expect(m.get(ROOM)?.hard).toEqual([{ lo: 100, hi: 3000 }]);
    expect(m.get('a0')?.legs).toEqual([100]);
  });
  it('keeps hard steps in order of their earliest date', () => {
    const m = withExtra(new Map([['a0', ev({ hard: [{ lo: 100, hi: 400 }, ...at(900)] })]]), [
      { t: 900, scope: 'a0', hardUntil: 950 },
      { t: 100, scope: 'a1', hardUntil: 200 },
    ]);
    expect(m.get('a0')?.hard).toEqual([
      { lo: 100, hi: 400 },
      { lo: 900, hi: 950 },
    ]);
    // The room has its own range for each transaction, both from 100.
    expect(m.get(ROOM)?.hard).toEqual([
      { lo: 100, hi: 200 },
      { lo: 900, hi: 950 },
    ]);
  });
  it('does not merge with a trace range that began before its span (S8b-D9)', () => {
    const m = withExtra(new Map([['a0', ev({ hard: [{ lo: 50, hi: 400 }] })]]), [
      { t: 100, scope: 'a0', until: 200 },
    ]);
    expect(m.get('a0')?.hard).toEqual([{ lo: 50, hi: 400 }, ...at(100)]);
  });
  it('never merges with another transaction’s range that reaches past its time', () => {
    // The first change may make its hard step as late as 3000. A change at 2000 is its own hard step,
    // inside that range, so the two are too close.
    const m = withExtra(new Map(), [
      { t: 100, scope: 'a0', hardUntil: 3000 },
      { t: 2000, scope: 'a0' },
    ]);
    expect(m.get('a0')?.hard).toEqual([{ lo: 100, hi: 3000 }, ...at(2000)]);
    expect(scopeViolations('a0', m.get('a0') ?? EMPTY, EMPTY, 1)).toHaveLength(1);
    // Two scopes of one transaction share the room's event, and the later end counts.
    const two = withExtra(new Map(), [
      { t: 100, scope: 'a0', hardUntil: 900 },
      { t: 100, scope: 'a1', hardUntil: 3000 },
    ]);
    expect(two.get(ROOM)?.hard).toEqual([{ lo: 100, hi: 3000 }]);
    expect(two.get(ROOM)?.legs).toEqual([100]);
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
    return sim;
  };
  it('instant sampling takes each plan start, each with a sample just before', () => {
    const sim = gear();
    const times = sampleTimes(sim, 510, 4000, 0, true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // The first sample is the grid time at or before the start.
    expect(times[0]).toBe(500);
    expect(times).toContain(1000);
    expect(times).toContain(1000 - 0.001);
    expect(times.length).toBeLessThanOrEqual(5);
  });
  it('a breakpoint a moment after the first sample has no sample of its own before it', () => {
    // The fade starts at 1000, and the first sample is the grid time at or before 1000.0005.
    const times = sampleTimes(gear(), 1000.0005, 4000, 1000.0005 % GRID_MS, false);
    expect(times[0]).toBeCloseTo(1000.0005, 6);
    expect(times.filter((t) => t < 1000.0005)).toEqual([]);
  });
  it('identify is read on the whole grid for as long as it runs', () => {
    const sim = gear();
    new Rig(sim, 5000).to('IDENTIFY_DEVICE', 0);
    const times = sampleTimes(sim, 5000, 20_000, 0, false).filter((t) => t > 5100 && t < 14_000);
    for (let i = 1; i < times.length; i++)
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeLessThanOrEqual(GRID_MS);
    expect(times.length).toBeGreaterThan(300);
  });
  it('faded sampling is the rule’s grid: breakpoints, the moment before each, and every 25 ms in a fade', () => {
    const sim = gear();
    const times = sampleTimes(sim, 510, 4000, 0, false);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(500);
    // The fade runs from 1000 to 3000.
    for (const b of [1000, 3000]) {
      expect(times).toContain(b);
      expect(times).toContain(b - 0.001);
    }
    const inFade = times.filter((t) => t > 1000 && t < 3000 - 0.001);
    expect(inFade).toEqual(Array.from({ length: 79 }, (_, k) => 1025 + k * GRID_MS));
    // Nothing moves outside the fade, so no grid time is read there, apart from the one after each
    // breakpoint, where a change that lands a moment late would show.
    expect(times.filter((t) => t > 500 && t < 1000 - 0.001)).toEqual([]);
    expect(times.filter((t) => t > 3000)).toEqual([3025]);
    // A reading on a shifted grid keeps the breakpoints and moves the rest.
    const shifted = sampleTimes(sim, 510, 4000, 8, false);
    expect(shifted[0]).toBe(508);
    expect(shifted).toContain(1000);
    expect(shifted).toContain(1033);
    expect(shifted).not.toContain(1025);
    // A fade of up to 20 s is read on the whole grid, as the rule reads it. A longer one at every
    // k-th grid time, 800 times at most.
    const r = new Rig(sim, 5000);
    r.set('SET_FADE_TIME', 0, 10);
    r.to('DAPC', 0, 100);
    const whole = sampleTimes(sim, 5000, 60_000, 0, false).filter((t) => t > 6000 && t < 20_000);
    for (let i = 1; i < whole.length; i++)
      expect((whole[i] ?? 0) - (whole[i - 1] ?? 0)).toBeLessThanOrEqual(GRID_MS);
    r.t = 100_000;
    r.set('SET_FADE_TIME', 0, 13);
    r.to('DAPC', 0, 200);
    const long = sampleTimes(sim, 100_000, 200_000, 8, false).filter(
      (t) => t > 101_000 && t < 140_000,
    );
    expect(long.length).toBeLessThanOrEqual(800);
    expect(long.length).toBeGreaterThan(400);
    for (const t of long) expect((t - 8) % GRID_MS).toBe(0);
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

describe('corners mutation testing found unpinned', () => {
  const gear = () => {
    const sim = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const r = new Rig(sim, 0);
    r.to('DAPC', 0, 100);
    r.set('SET_FADE_TIME', 0, 4);
    r.t = 1000 - r.step;
    r.to('DAPC', 0, 200);
    return sim;
  };
  const viol = (cand: Partial<TraceEvents>, base: Partial<TraceEvents>, scope = 'a0') =>
    scopeViolations(scope, ev(cand), ev(base), 1).map((v) => v.rule);

  describe('sample times', () => {
    it('a shifted reading starts at its own grid time at or before the start', () => {
      expect(sampleTimes(gear(), 520, 4000, 8, false)[0]).toBe(508);
    });
    it('a shifted reading reads its own grid inside a fade and after each breakpoint', () => {
      const shifted = sampleTimes(gear(), 510, 4000, 8, false);
      expect(shifted).toContain(1008);
      expect(shifted.filter((t) => t > 3000)).toEqual([3008]);
    });
    it('the grid time after a breakpoint is read only inside the span, and never by an instant reading', () => {
      const sim = gear();
      expect(Math.max(...sampleTimes(sim, 510, 3010, 0, false))).toBe(3000);
      expect(Math.max(...sampleTimes(sim, 510, 3025, 0, false))).toBe(3025);
      expect(sampleTimes(sim, 510, 4000, 0, true)).toEqual([500, 1000 - 0.001, 1000]);
    });
    it('a breakpoint within a moment after the first sample adds no sample before it', () => {
      const from = 999.9995;
      const times = sampleTimes(gear(), from, 4000, from % GRID_MS, false);
      expect(times[0]).toBeCloseTo(from, 6);
      expect(times[1]).toBe(1000);
    });
    it('identify that began before the span is read from the span’s start', () => {
      const sim = gear();
      new Rig(sim, 5000).to('IDENTIFY_DEVICE', 0);
      expect(sampleTimes(sim, 8000, 12_000, 0, false)[0]).toBe(8000);
    });
  });

  it('a fade of exactly 0.7 s is slow in the rule and fast in a cautious reading', () => {
    const sim = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const r = new Rig(sim, 0);
    r.to('DAPC', 0, 100);
    r.set('SET_EXTENDED_FADE_TIME', 0, 0x16);
    r.t = 1000 - r.step;
    r.to('DAPC', 0, 254);
    expect(sim.all[0]?.gear.fadeMs()).toBe(HARD_FADE_MS);
    const hard = (reading: Reading) =>
      predictEvents(sim, 500, 4000, false, [reading])
        .get('a0')
        ?.hard.map((x) => x.lo);
    expect(hard(EXACT)).toEqual([]);
    expect(hard(CAUTIOUS)).toEqual([1000]);
  });

  describe('which events are new', () => {
    it('an old leg stands for the leg at its own time, not for any leg', () => {
      // Two new legs early, then three old ones close together: only old ones share a window.
      expect(viol({ legs: [0, 400, 5000, 5400, 5800] }, { legs: [5000, 5400, 5800] })).toEqual([]);
    });
    it('a leg within 2 ms of an old one is that leg', () => {
      expect(viol({ legs: [102, 502, 902] }, { legs: [100, 500, 900] })).toEqual([]);
    });
    it('the first old leg stands for one leg only', () => {
      expect(viol({ legs: [100, 101, 900] }, { legs: [100, 900] })).toHaveLength(1);
    });
    it('a hard step whose range ends 2 ms before an old one begins is that hard step', () => {
      expect(viol({ hard: at(100, 500) }, { hard: at(102, 500) })).toEqual([]);
      expect(viol({ hard: at(100, 500) }, { hard: at(103, 500) })).toHaveLength(1);
    });
  });

  describe('extra events', () => {
    const legs = (old: number[], e: { t: number; until?: number }) =>
      withExtra(new Map([['a0', ev({ legs: old })]]), [{ ...e, scope: 'a0' }]).get('a0')?.legs;
    const hard = (old: Range[], e: { t: number; until?: number; hardUntil?: number }) =>
      withExtra(new Map([['a0', ev({ hard: old })]]), [{ ...e, scope: 'a0' }]).get('a0')?.hard;
    it('its leg is one the trace has from 5 ms before it to 5 ms after its span, and no other', () => {
      expect(legs([50], { t: 100 })).toEqual([50, 100]);
      expect(legs([94], { t: 100 })).toEqual([94, 100]);
      expect(legs([95], { t: 100 })).toEqual([95]);
      expect(legs([205], { t: 100, until: 200 })).toEqual([205]);
      expect(legs([206], { t: 100, until: 200 })).toEqual([100, 206]);
      expect(legs([300], { t: 100, until: 200 })).toEqual([100, 300]);
    });
    it('its hard step is one the trace dates from 5 ms before it to 5 ms after its span', () => {
      expect(hard(at(95), { t: 100 })).toEqual(at(95));
      expect(hard(at(94), { t: 100 })).toEqual(at(94, 100));
      expect(hard(at(205), { t: 100, until: 200 })).toEqual(at(205));
      expect(hard(at(206), { t: 100, until: 200 })).toEqual(at(100, 206));
    });
    it('a hard step that can come late keeps the trace’s earlier date', () => {
      expect(hard(at(98), { t: 100, hardUntil: 900 })).toEqual([{ lo: 98, hi: 900 }]);
    });
  });

  describe('merging an address’s traces', () => {
    const step = (t: number, dir: 1 | -1 | 0, until = t) => ({ t, dir, until });
    const hardOf = (lists: ReturnType<typeof step>[][], reading: Reading) =>
      mergeRead(
        lists.map((h) => ({ legs: [], hard: h as never, reversals: [] })),
        reading,
      ).hard;
    it('a red change within 5 ms before a leg is that leg, in a cautious reading', () => {
      expect(merged([[{ t: 0, dir: 0 }], [{ t: 3, dir: 1 }]])).toEqual([0]);
      expect(merged([[{ t: 0, dir: -1 }], [{ t: 3, dir: 1 }]])).toEqual([0, 3]);
    });
    it('events merged within 5 ms keep the later end', () => {
      for (const reading of [EXACT, CAUTIOUS]) {
        const h = hardOf([[step(0, 1, 10)], [step(0, -1, 300)]], reading);
        expect(h).toHaveLength(1);
        expect(h[0]?.until).toBe(300);
        const back = hardOf([[step(0, 1, 300)], [step(0, -1, 10)]], reading);
        expect(back[0]?.until).toBe(300);
      }
    });
  });

  describe('uniting readings', () => {
    it('legs one grid step apart in two readings are one leg', () => {
      const one = (t: number) => ({ legs: [{ t, dir: 1 as const }], hard: [], reversals: [t] });
      const u = unite([one(1000), one(1000 + GRID_MS)]);
      expect(u.legs).toEqual([1000]);
      expect(u.reversals).toEqual([1000]);
      expect(unite([one(1000), one(1000 + GRID_MS + 6)]).legs).toHaveLength(2);
    });
    it('a hard step joins a group for as long as its longest member runs', () => {
      const s = (t: number, until: number) => ({ t, until, dir: 1 as const });
      expect(uniteHard([[s(0, 500)], [s(10, 20)], [s(400, 400)]])).toEqual([
        { lo: 0, hi: 400, dir: 1 },
      ]);
    });
  });
});
