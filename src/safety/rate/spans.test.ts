/**
 * Fast spans and the slow test at their edges (ADR 0016): fast change above 2 within 0.7 s is a hard
 * step from where it starts, and movement from a fade that ran 0.7 s or longer never is.
 */
import { describe, expect, it } from 'vitest';
import type { OutputPlan } from '../../sim/gear.ts';
import { events, HARD_FADE_MS, SPAN_WINDOW_MS, type Sample } from './legs.ts';
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

const hard = (s: Sample[]) => events(s).hard;

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

  it('measures a span over 0.7 s and the margin of both samplings', () => {
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
    expect(pair(SPAN_WINDOW_MS - 1)).toEqual([1000]);
    expect(pair(SPAN_WINDOW_MS + 1)).toEqual([]);
  });

  it('a span on the border never carries a movement on to join a later one', () => {
    // 1.42 twice is 2.016: the guard might see a span, but is not sure of it. A second movement 0.8 s
    // later is a hard step of its own.
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

describe('the earliest date the rule could give a span (S6-P10, S6-S17-1)', () => {
  // A fast creep of 0.01% every 10 ms, a nudge by 1.015 at 0, then a change by 2.0 at 300.
  const trace = (fade: boolean): Sample[] => {
    const pts: Sample[] = [];
    let v = 0.1;
    for (let t = -1000; t < 0; t += 10) {
      pts.push({ t, v });
      v *= 1.0001;
    }
    pts.push({ t: -0.001, v }, { t: 0, v: (v *= 1.015) });
    for (let t = 10; t < 300; t += 10) pts.push({ t, v });
    if (fade) for (let k = 1; k <= 5; k++) pts.push({ t: 300 + k * 10, v: v * 2 ** (k / 5) });
    else pts.push({ t: 299.999, v }, { t: 300, v: v * 2 });
    const top = v * 2;
    for (let t = 400; t <= 2000; t += 10) pts.push({ t, v: top });
    return pts;
  };
  it('after an instant step, 25 ms before the latest sample the change is surely above 2 from', () => {
    // The step alone is 2, so the guard dates the span just before it. The rule may date it at its own
    // last sample before the nudge, which can be up to 25 ms before the guard's (S6-S18-1).
    expect(hard(trace(false))).toEqual([-25.001, 299.999]);
  });
  it('after a fade, the last sample at the lowest fast level in the window', () => {
    // A sample can fall partway through the fade, as the change from the creep's oldest sample in the
    // window passes 2: the rule dates the span there.
    const h = hard(trace(true));
    expect(h).toHaveLength(2);
    expect(h[0]).toBeLessThan(-300);
    expect(h[1]).toBe(290);
  });
});

/** Samples of a piecewise-linear trace every `step` ms, with each breakpoint and a sample 0.001 ms before. */
function sampled(pts: readonly [number, number][], step: number): Sample[] {
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
  for (let t = 0; t < (pts[pts.length - 1]?.[0] ?? 0); t += step) ts.add(t);
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, v: at(t) }));
}

describe('a movement the guard joins to the last span (S6-P12)', () => {
  it('counts the dates the rule could give it as a span of its own', () => {
    // From off to 3.6% at 900, a fade by 1.11 over 600 ms, a pause, then a doubling by 2.000008 in
    // 122 ms. The guard finds the doubling early and joins it to the span at 900. The checker, every
    // 25 ms, first finds it at 1745.999 and dates it at 1624, 724 ms after 900: a span of its own.
    const a = 0.0363766647;
    const b = a * 1.1107131659143774;
    const c = b * 2.000008196788498;
    const s = sampled(
      [
        [0, 0],
        [900, 0],
        [900.001, a],
        [961, a],
        [1561, b],
        [1624, b],
        [1746, c],
        [4746, c],
      ],
      10,
    );
    const h = hard(s);
    expect(h[0]).toBe(900);
    // Both ends of the range: the low end, 0.66 s after the span and after the last place the rule
    // must have found one, and the high end, the checker's own date (S6-S18-2).
    expect(h.some((t) => t >= 1560 && t < 1600)).toBe(true);
    expect(h).toContain(1624);
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
