/**
 * Fast spans and the slow test at their edges (ADR 0016): fast change above 2 within 0.7 s is a hard
 * step from where it starts, and movement from a fade that ran 0.7 s or longer never is.
 */
import { describe, expect, it } from 'vitest';
import type { OutputPlan } from '../../sim/gear.ts';
import {
  events,
  EXACT,
  HARD_FADE_MS,
  read,
  READINGS,
  TIME_MARGIN_MS,
  unite,
  uniteHard,
  type Sample,
} from './legs.ts';
import { SLOW_RAN_MS, slowTest } from './trace.ts';

/** A trace from [time, value] points, each change marked slow or not. */
const tr = (...pts: [number, number, boolean?][]): Sample[] =>
  pts.map(([t, v, slow]) => (slow === undefined ? { t, v } : { t, v, slow }));

/** A fade sampled every 10 ms from `t0` over `ms`, by `ratio`, starting at `v0`. */
function fade(
  t0: number,
  v0: number,
  ratio: number,
  ms: number,
  slow = false,
): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  for (let k = 1; k * 10 <= ms; k++) out.push([t0 + k * 10, v0 * ratio ** ((k * 10) / ms), slow]);
  return out;
}

/** The dates one cautious reading gives a trace's hard steps. */
const hard = (s: Sample[]) => events(s).hard.map((r) => r.lo);
/** The dates the rule itself gives them. */
const exact = (s: Sample[]) => events(s, EXACT).hard.map((r) => r.lo);

describe('fast spans', () => {
  it('a fast fade inside a longer run is a hard step from where it starts (S6-R4)', () => {
    // A one-step nudge keeps the run going, then a 200 ms fade by 8.9 after 0.9 s. No 50 ms of it
    // changes by 2, and the run takes over 0.7 s, so neither old reading found it.
    const pts = tr(
      [0, 0.05],
      [100, 0.05],
      [100.001, 0.052],
      [1000, 0.052],
      ...fade(1000, 0.052, 8.9, 200),
      [3000, 0.4628],
    );
    expect(hard(pts)).toEqual([1000]);
    // The same fade from a fade the gear ran for 0.7 s or longer is not a hard step.
    const slow = tr(
      [0, 0.05],
      [100, 0.05],
      [100.001, 0.052],
      [1000, 0.052],
      ...fade(1000, 0.052, 8.9, 200, true),
      [3000, 0.4628],
    );
    expect(hard(slow)).toEqual([]);
  });

  it('steps under 2 that add up to more than 2 within 0.7 s are a hard step at the first', () => {
    const pts = tr(
      [0, 0.05],
      [100, 0.05],
      [100.001, 0.052],
      [1000, 0.052],
      [1000.001, 0.0988],
      [1070, 0.0988],
      [1070.001, 0.1877],
      [1140, 0.1877],
      [1140.001, 0.3566],
      [3000, 0.3566],
    );
    expect(hard(pts)).toEqual([1000]);
  });

  it('a staircase that keeps changing fast is one hard step, and two apart are two', () => {
    // Steps of 1.5 every 300 ms for 1.5 s: each 0.7 s holds more than 2, so the spans follow on.
    const stairs: [number, number][] = [[0, 0.04]];
    let v = 0.04;
    for (let k = 0; k < 6; k++) {
      stairs.push([1000 + k * 300, v]);
      v *= 1.5;
      stairs.push([1000 + k * 300 + 0.001, v]);
    }
    stairs.push([4000, v]);
    expect(hard(tr(...stairs))).toEqual([1000]);
    // Two bursts 5 s apart, in one run kept going by small steps every 0.9 s: two hard steps.
    const two: [number, number][] = [
      [0, 0.04],
      [1000, 0.04],
      [1000.001, 0.09],
    ];
    let w = 0.09;
    for (let t = 1900; t < 6000; t += 900) {
      two.push([t, w]);
      w *= 1.01;
      two.push([t + 0.001, w]);
    }
    two.push([6000, w], [6000.001, w * 2.5], [9000, w * 2.5]);
    expect(hard(tr(...two))).toEqual([1000, 6000]);
  });

  it('measures a span within 0.7 s in the rule, and over the time margin more with margins', () => {
    // Two steps of 1.45 (2.1 together) this far apart.
    const pair = (gap: number) =>
      hard(
        tr(
          [0, 0.1],
          [1000, 0.1],
          [1000.001, 0.145],
          [1000 + gap, 0.145],
          [1000 + gap + 0.001, 0.21025],
          [4000, 0.21025],
        ),
      );
    expect(hard(tr([0, 0.1], [1000, 0.1], [1000.001, 0.145], [4000, 0.145]))).toEqual([]);
    expect(pair(HARD_FADE_MS - 1)).toEqual([1000]);
    expect(pair(HARD_FADE_MS + TIME_MARGIN_MS - 0.001)).toEqual([1000]);
    expect(pair(HARD_FADE_MS + TIME_MARGIN_MS)).toEqual([]);
    // The rule's 0.7 s leaves out its far end.
    const rule = (gap: number) =>
      exact(
        tr(
          [0, 0.1],
          [1000, 0.1],
          [1000.001, 0.145],
          [1000 + gap, 0.145],
          [1000 + gap + 0.001, 0.21025],
          [4000, 0.21025],
        ),
      );
    expect(rule(HARD_FADE_MS - 0.002)).toEqual([1000]);
    expect(rule(HARD_FADE_MS)).toEqual([]);
  });

  it('a span on the border never carries a movement on to join a later one', () => {
    // 1.42 twice is 2.016: a cautious reading sees a span, but is not sure of it. A second movement
    // 0.8 s later is a hard step of its own. The rule, sure of every span it sees, joins a second
    // movement that starts within 0.7 s of the first.
    const pts = tr(
      [0, 0.1],
      [1000, 0.1],
      [1000.001, 0.142],
      [1100, 0.142],
      [1100.001, 0.20164],
      [1800, 0.20164],
      [1800.001, 0.3227],
      [1850, 0.3227],
      [1850.001, 0.5163],
      [4000, 0.5163],
    );
    expect(hard(pts)).toEqual([1000, 1800]);
  });

  it('dates a fast fade from off at its start on every channel, not where it passes 2%', () => {
    // From the gear's minimum (under the 2% floor) to 6% in 200 ms.
    const pts = tr(
      [0, 0],
      [1000, 0],
      [1000.001, 0.001],
      ...fade(1000.001, 0.001, 60, 200),
      [3000, 0.06],
    );
    expect(hard(pts)).toEqual([1000]);
  });

  it('an instant step above 2 is a hard step even inside a slow fade (S6-D16-5)', () => {
    // The slow flag leaves out fade change from spans and fast legs, not from the 50 ms step test.
    const pts = tr(
      [0, 0.01],
      [1000, 0.01],
      [1000.001, 0.01, true],
      [1040, 0.05, true],
      [3000, 0.05],
    );
    expect(hard(pts)).toEqual([1000.001]);
  });

  it('a run that a slow fade makes is not a hard step, however short (P-rate-slow)', () => {
    // Another driver's step splits the room's run, leaving the tail of a slow fade under 0.7 s.
    const pts = tr(
      [0, 0.3],
      [1000, 0.3],
      [1000.001, 0.02],
      ...fade(1000.001, 0.02, 3, 600, true),
      [3000, 0.06],
    );
    expect(hard(pts)).toEqual([1000]);
  });
});

/** An output plan with the parts a test sets. */
function plan(o: {
  since: number;
  level?: Partial<OutputPlan['level']>;
  colour?: { start: number; end: number; tc?: number };
  identifyUntil?: number;
}): OutputPlan {
  const c = { tc: 370, ch: [0, 0, 0, 0, 0, 0] };
  return {
    since: o.since,
    level: { from: 0, to: 0, start: o.since, end: o.since, offAtEnd: false, ...o.level },
    colour: {
      from: c,
      to: { ...c, tc: o.colour?.tc ?? 370 },
      start: o.colour?.start ?? 0,
      end: o.colour?.end ?? 0,
    },
    linear: false,
    identifyUntil: o.identifyUntil ?? -Infinity,
    identifyMin: 0,
    identifyMax: 0,
  };
}

/** Samples of a piecewise-linear trace every `step` ms, with each breakpoint and a sample 0.001 ms before. */
function sampled(pts: readonly [number, number][], step: number, shift = 0): Sample[] {
  const at = (t: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i] ?? [0, 0];
      const [t0, v0] = pts[i - 1] ?? [0, 0];
      if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return pts[pts.length - 1]?.[1] ?? 0;
  };
  const ts = new Set<number>();
  for (const [t] of pts) ts.add(t).add(t - 0.001);
  for (let t = shift; t < (pts[pts.length - 1]?.[0] ?? 0); t += step) ts.add(t);
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, v: at(t) }));
}

describe('readings united into ranges (ADR 0019)', () => {
  const step = (t: number, until = t, dir: 1 | -1 = 1) => ({ t, until, dir });
  /** The ranges, without their directions. */
  const ranges = (lists: Parameters<typeof uniteHard>[0], slack?: number) =>
    uniteHard(lists, slack).map(({ lo, hi }) => ({ lo, hi }));

  it('a hard step every reading dates alike is a range of one date', () => {
    expect(ranges([[step(1000, 1200)], [step(1000, 1200)]])).toEqual([{ lo: 1000, hi: 1000 }]);
  });

  it('readings that date one hard step apart give it a range, and it counts once', () => {
    // Their extents overlap: the same movement, found from different samples.
    expect(ranges([[step(1000, 1300)], [step(1250, 1300)], [step(1100, 1290)]])).toEqual([
      { lo: 1000, hi: 1250 },
    ]);
  });

  it('extents within the time margin are one hard step, and further apart are two', () => {
    expect(ranges([[step(1000, 1100)], [step(1100 + TIME_MARGIN_MS)]])).toHaveLength(1);
    expect(ranges([[step(1000, 1100)], [step(1101 + TIME_MARGIN_MS)]])).toHaveLength(2);
  });

  it('each range keeps its direction', () => {
    expect(uniteHard([[step(1000, 1100, -1)], [step(1010, 1100, -1)]])).toEqual([
      { lo: 1000, hi: 1010, dir: -1 },
    ]);
  });

  it('opposite directions are never one hard step', () => {
    expect(ranges([[step(1000, 1300)], [step(1100, 1300, -1)]])).toHaveLength(2);
  });

  it('lists ranges by their earliest date, then their latest', () => {
    // Up and down from one moment, and a reading that dates the fall later.
    expect(ranges([[step(1000, 1100, -1), step(1000, 1050)], [step(1040, 1100, -1)]])).toEqual([
      { lo: 1000, hi: 1000 },
      { lo: 1000, hi: 1040 },
    ]);
  });

  it('two hard steps of one reading stay two, each with the nearest dates of the others', () => {
    // One reading joined what another counts as two. The count is the larger one.
    expect(
      ranges([
        [step(1000, 1100), step(1800, 1900)],
        [step(990, 1900)],
        [step(1010, 1100), step(1830, 1900)],
      ]),
    ).toEqual([
      { lo: 990, hi: 1010 },
      { lo: 1800, hi: 1830 },
    ]);
  });

  it('two hard steps of one reading never share a range, whichever reading has the most (S8b-D6)', () => {
    // One reading has two hard steps 0.8 s apart. Another has three, with the two nearest one of its
    // own. The pair stays two ranges, 0.8 s apart at most.
    const h = ranges([
      [step(2600), step(3400)],
      [step(0, 3000), step(3000, 6000), step(6000)],
    ]);
    expect(h).toEqual([
      { lo: 0, hi: 0 },
      { lo: 2600, hi: 3000 },
      { lo: 3400, hi: 3400 },
      { lo: 6000, hi: 6000 },
    ]);
  });

  it('a movement a cautious reading joins and the rule counts apart is two hard steps (S6-P12)', () => {
    // From off to 3.6% at 900, a fade by 1.11 over 600 ms, a pause, then a doubling by 2.000008 in
    // 122 ms. The rule first finds the doubling at 1745.999 and dates it at 1624, 724 ms after 900: a
    // span of its own. A cautious reading finds it earlier and joins it to the span at 900.
    const a = 0.0363766647;
    const b = a * 1.1107131659143774;
    const c = b * 2.000008196788498;
    const pts: [number, number][] = [
      [0, 0],
      [900, 0],
      [900.001, a],
      [961, a],
      [1561, b],
      [1624, b],
      [1746, c],
      [4746, c],
    ];
    expect(exact(sampled(pts, 25))).toEqual([900, 1624]);
    const h = unite(READINGS.map((r) => read(sampled(pts, 25, r.shift), r))).hard;
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual({ lo: 900, hi: 900, dir: 1 });
    expect(h[1]?.lo).toBeLessThanOrEqual(1624);
    expect(h[1]?.hi).toBeGreaterThanOrEqual(1624);
  });
});

describe('the slow test', () => {
  const longFade = { from: 10, to: 200, start: 1000, end: 3800, offAtEnd: false };

  it('marks a fade that ran 0.7 s or longer slow, and a plan start fast', () => {
    const slow = slowTest([plan({ since: 0 }), plan({ since: 1000, level: longFade })]);
    expect(slow(1500, 1510)).toBe(true);
    expect(slow(999.999, 1000)).toBe(false);
    expect(slow(3790, 3800)).toBe(true);
    // Nothing moves after the fade: slow, since there is nothing fast in it.
    expect(slow(4000, 4010)).toBe(true);
  });

  it('counts a fade by the time it ran, so one cut short is fast', () => {
    const cut = [
      plan({ since: 0 }),
      plan({ since: 1000, level: longFade }),
      plan({ since: 1000 + SLOW_RAN_MS - 1, level: { from: 50, to: 50 } }),
    ];
    expect(slowTest(cut)(1500, 1510)).toBe(false);
    const ran = [
      plan({ since: 0 }),
      plan({ since: 1000, level: longFade }),
      plan({ since: 1000 + SLOW_RAN_MS, level: { from: 50, to: 50 } }),
    ];
    expect(slowTest(ran)(1500, 1510)).toBe(true);
    // A colour change does not end the level's fade.
    const colour = [
      plan({ since: 0 }),
      plan({ since: 1000, level: longFade }),
      { ...plan({ since: 1200, level: longFade }), colour: plan({ since: 0 }).colour },
    ];
    expect(slowTest(colour)(1500, 1510)).toBe(true);
  });

  it('a fade of 0.7 s and the 5 ms margin is slow, and 1 ms less is fast', () => {
    const at = (ms: number) =>
      slowTest([plan({ since: 0 }), plan({ since: 1000, level: { ...longFade, end: 1000 + ms } })])(
        1100,
        1110,
      );
    expect(at(SLOW_RAN_MS)).toBe(true);
    expect(at(SLOW_RAN_MS - 1)).toBe(false);
    // The rule itself has no margin: 0.7 s is slow.
    const rule = (ms: number) =>
      slowTest(
        [plan({ since: 0 }), plan({ since: 1000, level: { ...longFade, end: 1000 + ms } })],
        HARD_FADE_MS,
      )(1100, 1110);
    expect(rule(HARD_FADE_MS)).toBe(true);
    expect(rule(HARD_FADE_MS - 1)).toBe(false);
    // Fade time 1 is 707 ms.
    expect(at(707)).toBe(true);
  });

  it('the switch off at the end of a fade to off, identify, and a fast colour fade are fast', () => {
    const off = slowTest([
      plan({ since: 0 }),
      plan({ since: 1000, level: { ...longFade, offAtEnd: true } }),
    ]);
    expect(off(3799.999, 3800)).toBe(false);
    expect(off(3700, 3710)).toBe(true);
    expect(
      slowTest([plan({ since: 0 }), plan({ since: 1000, level: longFade, identifyUntil: 5000 })])(
        1500,
        1510,
      ),
    ).toBe(false);
    const both = slowTest([
      plan({ since: 0 }),
      plan({ since: 1000, level: longFade, colour: { start: 1000, end: 1300, tc: 200 } }),
    ]);
    expect(both(1100, 1110)).toBe(false);
    expect(both(1400, 1410)).toBe(true);
  });
});

describe('the slow test, at the edges mutation testing found unpinned', () => {
  const longFade = { from: 10, to: 200, start: 1000, end: 3800, offAtEnd: false };
  const longColour = { start: 1000, end: 3800, tc: 200 };

  it('counts a fade in the first plan, and one of exactly the margin', () => {
    expect(SLOW_RAN_MS).toBe(705);
    expect(slowTest([plan({ since: 1000, level: longFade })])(1500, 1510)).toBe(true);
    const colour = (ms: number) =>
      slowTest([
        plan({ since: 0 }),
        plan({ since: 1000, colour: { ...longColour, end: 1000 + ms } }),
      ])(1100, 1110);
    expect(colour(SLOW_RAN_MS)).toBe(true);
    expect(colour(SLOW_RAN_MS - 1)).toBe(false);
  });

  it('a fade carried into a later plan unchanged counts from its start, in the earlier plan too', () => {
    const base = plan({ since: 1000, level: longFade, colour: longColour });
    // The level fade goes on under a new colour, and the colour fade under a new level.
    const newColour = { ...base, since: 1200, colour: plan({ since: 1200 }).colour };
    const newLevel = { ...base, since: 1200, level: plan({ since: 1200 }).level };
    expect(
      slowTest([plan({ since: 0 }), plan({ since: 1000, level: longFade }), newColour])(1100, 1110),
    ).toBe(true);
    expect(
      slowTest([plan({ since: 0 }), plan({ since: 1000, colour: longColour }), newLevel])(
        1100,
        1110,
      ),
    ).toBe(true);
  });

  it('a later plan that differs in any one part of a fade ends it', () => {
    const first = plan({ since: 1000, level: longFade, colour: longColour });
    const cut = (next: OutputPlan) => slowTest([plan({ since: 0 }), first, next])(1100, 1110);
    const later = { ...first, since: 1200 };
    expect(cut(later)).toBe(true);
    const levels: Partial<OutputPlan['level']>[] = [
      { start: 1001 },
      { end: 3801 },
      { from: 11 },
      { to: 201 },
      { offAtEnd: true },
    ];
    for (const l of levels) expect(cut({ ...later, level: { ...first.level, ...l } })).toBe(false);
    const c = first.colour;
    const ch = (v: number) => [0, 0, v, 0, 0, 0];
    const colours: OutputPlan['colour'][] = [
      { ...c, start: 1001 },
      { ...c, end: 3801 },
      { ...c, to: { ...c.to, tc: 201 } },
      { ...c, from: { ...c.from, tc: 371 } },
      { ...c, to: { ...c.to, ch: ch(1) } },
      { ...c, from: { ...c.from, ch: ch(1) } },
    ];
    for (const colour of colours) expect(cut({ ...later, colour })).toBe(false);
  });

  it('an interval is judged by its own ends', () => {
    const slow = slowTest([plan({ since: 0 }), plan({ since: 1000, level: longFade })]);
    // From the plan's start on, the fade is all there is.
    expect(slow(1000, 1010)).toBe(true);
    // Identify ends at 5000, and the interval from there is not in it.
    const id = slowTest([
      plan({ since: 0 }),
      plan({ since: 1000, level: longFade, identifyUntil: 5000 }),
    ]);
    expect(id(5000, 5010)).toBe(true);
    expect(id(4990, 5000)).toBe(false);
    // The switch off at the end of a fade to off is in the interval that ends there, and no later one.
    const off = slowTest([
      plan({ since: 0 }),
      plan({ since: 1000, level: { ...longFade, offAtEnd: true } }),
    ]);
    expect(off(3800, 3810)).toBe(true);
    expect(off(3900, 3910)).toBe(true);
    // A fast fade is fast only while it runs: not before it starts and not from its end.
    const shortLevel = { ...longFade, start: 1000, end: 1300 };
    for (const fast of [
      slowTest([plan({ since: 500, level: shortLevel })]),
      slowTest([plan({ since: 500, colour: { start: 1000, end: 1300, tc: 200 } })]),
    ]) {
      expect(fast(1100, 1110)).toBe(false);
      expect(fast(600, 610)).toBe(true);
      expect(fast(990, 1000)).toBe(true);
      expect(fast(1300, 1310)).toBe(true);
      expect(fast(1400, 1410)).toBe(true);
    }
  });
});

describe('spans a cautious reading is not sure of', () => {
  it('two spans on the border, 1.2 s apart in one run, are two hard steps', () => {
    // Each fade doubles the output: above 2 with the margin, and not surely above it. A slow creep
    // between them keeps the run going.
    const pts = tr(
      [0, 0.1],
      ...fade(0, 0.1, 2, 300),
      ...fade(300, 0.2, 1.005, 900, true),
      ...fade(1200, 0.201, 2, 300),
      [3000, 0.402],
    );
    expect(hard(pts)).toEqual([0, 1200]);
  });
  it('a steady fast rise just under the sure rate is a new hard step every 0.66 s', () => {
    // Doubling every 690 ms for 2.4 s. The rule may or may not join it into one hard step, so a
    // cautious reading does not.
    const top = 0.03 * 2 ** (2400 / 690);
    const pts = tr([0, 0.03], ...fade(0, 0.03, 2 ** (2400 / 690), 2400), [5000, top]);
    expect(hard(pts)).toEqual([0, 660, 1320]);
    // Doubling every 665 ms is above 2 with the margin in 0.66 s (1.99), and still not surely above
    // it (2.02), so it is counted the same way.
    const top2 = 0.03 * 2 ** (2400 / 665);
    const pts2 = tr([0, 0.03], ...fade(0, 0.03, 2 ** (2400 / 665), 2400), [5000, top2]);
    expect(hard(pts2)).toEqual([0, 660, 1320]);
  });
});
