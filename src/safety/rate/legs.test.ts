/** U-safety: legs, hard steps and reversals on hand-made traces. */
import { describe, expect, it } from 'vitest';
import {
  events as readEvents,
  hardSteps,
  isLeg,
  mergeTimes,
  ratio,
  runs,
  touchesOff,
  type Sample,
} from './legs.ts';

const tr = (...pts: [number, number][]): Sample[] => pts.map(([t, v]) => ({ t, v }));
/** One cautious reading, with each hard step as its one date. */
const events = (s: readonly Sample[]) => {
  const e = readEvents(s);
  return { ...e, hard: e.hard.map((r) => r.lo) };
};
const hardTimes = (r: Parameters<typeof hardSteps>[0]) => hardSteps(r).map((x) => x.t);

describe('legs', () => {
  it('ratio treats off as infinitely far from on', () => {
    expect(ratio(0, 0)).toBe(1);
    expect(ratio(0, 0.1)).toBe(Infinity);
    expect(ratio(0.2, 0.1)).toBe(2);
  });
  it('flat stretches do not end a run, and small steps one way add up to one leg', () => {
    const s = tr([0, 0.1], [100, 0.104], [200, 0.104], [300, 0.108], [400, 0.112], [500, 0.116]);
    const r = runs(s);
    expect(r).toHaveLength(1);
    expect(
      isLeg(
        r[0] ?? {
          start: 0,
          end: 0,
          dir: 1,
          from: 1,
          to: 1,
          jumps: [],
          fastRatio: 1,
          fastStart: undefined,
          spans: [],
        },
      ),
    ).toBe(true);
  });
  it('a change under 1.10 is not a leg', () => {
    expect(events(tr([0, 0.1], [10, 0.105])).legs).toEqual([]);
  });
  it('an instant step to or from off is a hard step, and a long fade is not', () => {
    const on = events(tr([0, 0], [0.001, 0.3]));
    expect(on.legs).toEqual([0]);
    expect(on.hard).toEqual([0]);
    // A fade from off: the gear jumps to its minimum, then fades over 2 s, which is slow (ADR 0016).
    const fade = events(
      tr([0, 0], [0.001, 0.01], [500, 0.05], [1000, 0.1], [2000, 0.4]).map((x) => ({
        ...x,
        slow: x.t >= 500,
      })),
    );
    expect(fade.legs).toEqual([0]);
    expect(fade.hard).toEqual([]);
  });
  it('a fade under 0.7 s with a ratio above 2 is a hard step', () => {
    expect(events(tr([0, 0.1], [300, 0.3])).hard).toEqual([0]);
    expect(events(tr([0, 0.1], [800, 0.3])).hard).toEqual([]);
  });
  it('a big instant jump inside a long leg makes it hard', () => {
    expect(events(tr([0, 0.01], [0.001, 0.2], [1000, 0.4])).hard).toEqual([0]);
  });
  it('counts reversals that involve a run smaller than a leg', () => {
    const s = tr([0, 0.1], [10, 0.102], [20, 0.1], [30, 0.102], [40, 0.1]);
    expect(events(s).reversals).toEqual([10, 20, 30]);
    const big = tr([0, 0.1], [10, 0.2], [20, 0.1]);
    expect(events(big).reversals).toEqual([]);
  });
  it('touchesOff and hardTimes agree on the definition', () => {
    const r = {
      start: 0,
      end: 1000,
      dir: 1 as const,
      from: 0,
      to: 0.5,
      jumps: [{ t: 0, endT: 10 }],
      fastRatio: 25,
      fastStart: 0,
      spans: [],
    };
    expect(touchesOff(r)).toBe(true);
    expect(hardTimes(r)).toEqual([0]);
    expect(hardTimes({ ...r, jumps: [] })).toEqual([]);
    expect(hardTimes({ ...r, from: 0.1, to: 0.105 })).toEqual([]);
  });
  it('merges event times from several traces', () => {
    expect(mergeTimes([[0, 100], [2, 300], [100]])).toEqual([0, 100, 300]);
  });
});
