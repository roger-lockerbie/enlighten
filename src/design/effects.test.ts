import { describe, expect, it } from 'vitest';
import {
  defaultParams,
  EFFECT_IDS,
  EFFECTS,
  effectSpec,
  paramsProblem,
  planEffect,
  type EffectDef,
  type EffectId,
} from './effects.ts';
import { arcToFraction } from '../dali/curve.ts';
import type { Driver, Plan } from './plan.ts';
import { effect as effectSchema } from './schema.ts';

const A: Driver = {
  address: 0,
  drive: 'tc',
  groups: 0,
  minArc: 85,
  auto: true,
  arc: 150,
  colour: { kind: 'tc', mirek: 250 },
};
const B: Driver = {
  address: 1,
  drive: 'rgbwaf',
  groups: 0,
  minArc: 85,
  auto: true,
  arc: 150,
  colour: { kind: 'rgbwaf', channels: [100, 100, 100, 50, 0, 255] },
};
const C: Driver = { ...A, address: 5 };
const CEILING = 220;

const def = (
  type: EffectId,
  targets: number[],
  params: Record<string, number> = {},
): EffectDef => ({
  name: 'Test',
  type,
  params: { ...defaultParams(type), ...params },
  targets,
});
const plan = (d: EffectDef, drivers: Driver[] = [A, B, C]): Plan => {
  const r = planEffect(d, drivers, CEILING);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const why = (d: EffectDef, drivers: Driver[] = [A, B, C]): string => {
  const r = planEffect(d, drivers, CEILING);
  return r.ok ? 'planned' : r.reason;
};
const levels = (p: Plan, address: number) =>
  p.rows.filter((r) => r.address === address).map((r) => [r.atMs, r.arc]);

describe('the list of effects', () => {
  it('has the ten of SPEC R4.1, each with settings in a range and a default inside it', () => {
    expect(EFFECTS.map((e) => e.id)).toEqual([...EFFECT_IDS]);
    expect(EFFECTS).toHaveLength(10);
    for (const e of EFFECTS) {
      expect(e.params.length).toBeGreaterThan(0);
      for (const x of e.params) {
        expect(x.min).toBeLessThan(x.max);
        expect(x.default).toBeGreaterThanOrEqual(x.min);
        expect(x.default).toBeLessThanOrEqual(x.max);
      }
      expect(paramsProblem(e.id, defaultParams(e.id))).toBeUndefined();
    }
    expect(EFFECTS.filter((e) => e.repeating).map((e) => e.id)).toEqual([
      'breathe',
      'tc-drift',
      'hue-drift',
      'two-tone',
    ]);
    expect(() => effectSpec('nope' as EffectId)).toThrow();
  });

  it('turns away a setting out of range, missing, not a number or not its own', () => {
    expect(paramsProblem('breathe', { depth: 3, period: 12 })).toBe(
      'Depth is from 4 to 12 levels.',
    );
    expect(paramsProblem('breathe', { depth: 8, period: 17 })).toBe('Period is from 8 to 16 s.');
    expect(paramsProblem('breathe', { depth: 8 })).toBe('Period is from 8 to 16 s.');
    expect(paramsProblem('breathe', { depth: NaN, period: 12 })).toBe(
      'Depth is from 4 to 12 levels.',
    );
    expect(paramsProblem('breathe', { depth: 8, period: 12, hue: 1 })).toBe(
      'Breathe has no setting "hue".',
    );
    expect(paramsProblem('notification', { pulses: 3, depth: 8, rise: 0.7, fall: 1.5 })).toBe(
      'Pulses is from 1 to 2.',
    );
  });
});

describe('planning an effect', () => {
  it('checks its settings and its targets first', () => {
    expect(why(def('breathe', [0], { depth: 99 }))).toBe('Depth is from 4 to 12 levels.');
    expect(why(def('breathe', []))).toBe('Choose at least one driver.');
    expect(why(def('breathe', [0, 0]))).toBe('A driver is listed twice.');
    expect(why(def('breathe', [40, 41]))).toBe('None of the drivers chosen is there.');
    expect(
      why(
        def(
          'breathe',
          Array.from({ length: 17 }, (_, i) => i),
        ),
      ),
    ).toBe('An effect is aimed at no more than 16 drivers.');
    expect(plan(def('breathe', [0, 40])).notes).toEqual(['No driver at A40, so it is left out.']);
  });

  it('breathe rises by the depth and comes back, each over half the period, and repeats', () => {
    const p = plan(def('breathe', [0], { depth: 8, period: 12 }));
    expect(levels(p, 0)).toEqual([
      [0, 158],
      [6000, 150],
    ]);
    expect(p.rows.map((r) => r.fadeMs)).toEqual([6000, 6000]);
    expect(p.periodMs).toBe(12_000);
    // The fade is set once a pass.
    expect(p.rows.map((r) => r.setFade)).toEqual([true, false]);
  });

  it('breathe goes down and back when the light is at the ceiling, and needs room and light', () => {
    expect(levels(plan(def('breathe', [0]), [{ ...A, arc: 218 }]), 0)).toEqual([
      [0, 210],
      [6000, 218],
    ]);
    expect(why(def('breathe', [0]), [{ ...A, arc: 100, minArc: 96 }])).toBe('planned');
    expect(why(def('breathe', [0], { depth: 12 }), [{ ...A, arc: 215, minArc: 210 }])).toBe(
      'A0 has no room for a depth of 12 levels between its minimum and the ceiling.',
    );
    expect(why(def('breathe', [0]), [{ ...A, arc: 0 }])).toMatch(/^A0 is off\. Set a level first/);
  });

  it('two-tone moves a pair opposite ways by the same amount of light, so their sum stays the same', () => {
    const p = plan(def('two-tone', [0, 1], { depth: 6, period: 10 }));
    expect(levels(p, 0)).toEqual([
      [0, 156],
      [5000, 150],
    ]);
    // Seven levels down gives up what six levels up gains: the curve is logarithmic.
    expect(levels(p, 1)).toEqual([
      [0, 143],
      [5000, 150],
    ]);
    expect(p.periodMs).toBe(10_000);
    const sum = (a: number, b: number) => arcToFraction(a) + arcToFraction(b);
    expect(sum(156, 143) / sum(150, 150)).toBeCloseTo(1, 2);
    // Drivers at different levels: the dimmer one moves further to match.
    const uneven = plan(def('two-tone', [0, 1], { depth: 8, period: 10 }), [{ ...A, arc: 170 }, B]);
    const down = levels(uneven, 1)[0]?.[1] ?? 0;
    expect(down).toBeLessThan(142);
    expect(sum(178, down) / sum(170, 150)).toBeCloseTo(1, 1);
    // A much brighter driver gains more than a dim one has to give.
    expect(why(def('two-tone', [0, 1]), [{ ...A, arc: 200 }, B])).toBe(
      'A1 has no room to give up what A0 gains. Set it a little higher first.',
    );
    expect(why(def('two-tone', [0]))).toBe('Two-tone needs at least two drivers.');
    expect(why(def('two-tone', [0, 1, 5]))).toBe(
      'Two-tone works on pairs of drivers. Choose an even number.',
    );
    expect(why(def('two-tone', [0, 1]), [A, { ...B, arc: 88 }])).toBe(
      'A1 has no room to give up what A0 gains. Set it a little higher first.',
    );
    expect(why(def('two-tone', [0, 1]), [{ ...A, arc: 219 }, B])).toBe(
      'A0 has no room to go up by 8 levels. Set it a little lower first.',
    );
    expect(why(def('two-tone', [0, 1]), [A, { ...B, arc: 0 }])).toMatch(/^A1 is off/);
  });

  it('keeps colour temperatures inside what the driver reports', () => {
    const narrow: Driver = { ...A, tc: { coolest: 200, warmest: 300 } };
    const drift = plan(def('tc-drift', [0], { step: 30, interval: 30 }), [
      { ...narrow, colour: { kind: 'tc', mirek: 290 } },
    ]);
    expect(drift.rows.map((r) => (r.colour.kind === 'tc' ? r.colour.mirek : 0))).toEqual([
      300, 290, 260, 290,
    ]);
    // Warm shift asked for 1800 K on a tape that stops at 300 mirek.
    const shift = plan(def('warm-shift', [0], { warmest: 1800, curve: 0 }), [narrow]);
    expect(shift.rows.at(-1)?.colour).toEqual({ kind: 'tc', mirek: 300 });
    const rise = plan(def('sunrise', [0], { kelvin: 5000 }), [{ ...narrow, arc: 0 }]);
    expect(rise.rows[0]?.colour).toEqual({ kind: 'tc', mirek: 300 });
    expect(rise.rows.at(-1)?.colour).toEqual({ kind: 'tc', mirek: 200 });
  });

  it('swell rises once and settles back, and does not repeat', () => {
    const p = plan(def('swell', [0], { overshoot: 7, rise: 1, settle: 3 }));
    expect(levels(p, 0)).toEqual([
      [0, 157],
      [1000, 150],
    ]);
    expect(p.periodMs).toBeUndefined();
    expect(p.endMs).toBe(4000);
    expect(why(def('swell', [0]), [{ ...A, arc: 216 }])).toBe(
      'A0 is too near the ceiling to rise by 7 levels.',
    );
    expect(why(def('swell', [0]), [{ ...A, arc: 0 }])).toMatch(/is off/);
  });

  it('notification makes one or two pulses, never more', () => {
    const one = plan(def('notification', [0], { pulses: 1, depth: 8, rise: 0.7, fall: 1.5 }));
    expect(levels(one, 0)).toEqual([
      [0, 158],
      [700, 150],
    ]);
    const two = plan(def('notification', [0], { pulses: 2, depth: 8, rise: 0.7, fall: 1.5 }));
    expect(levels(two, 0)).toEqual([
      [0, 158],
      [700, 150],
      [2200, 158],
      [2900, 150],
    ]);
    expect(why(def('notification', [0]), [{ ...A, arc: 215 }])).toMatch(/too near the ceiling/);
    expect(why(def('notification', [0]), [{ ...A, arc: 0 }])).toMatch(/is off/);
  });

  it('colour temperature drift goes warmer, back, cooler and back, and keeps the level', () => {
    const p = plan(def('tc-drift', [0], { step: 20, interval: 30 }));
    expect(p.rows.map((r) => [r.atMs, r.arc, r.colour])).toEqual([
      [0, 150, { kind: 'tc', mirek: 270 }],
      [30_000, 150, { kind: 'tc', mirek: 250 }],
      [60_000, 150, { kind: 'tc', mirek: 230 }],
      [90_000, 150, { kind: 'tc', mirek: 250 }],
    ]);
    expect(p.rows.every((r) => r.fadeMs === 30_000)).toBe(true);
    expect(p.periodMs).toBe(120_000);
    // At the warm end of the range it only goes cooler.
    const warm = plan(def('tc-drift', [0]), [{ ...A, colour: { kind: 'tc', mirek: 370 } }]);
    expect(warm.rows.map((r) => (r.colour.kind === 'tc' ? r.colour.mirek : 0))).toEqual([350, 370]);
    expect(why(def('tc-drift', [1]))).toBe('A1 does not take a colour temperature.');
    expect(why(def('tc-drift', [0]), [{ ...A, arc: 0 }])).toMatch(/is off/);
    // A driver whose colour is not known drifts around 4000 K.
    expect(
      plan(def('tc-drift', [0]), [{ ...A, colour: { kind: 'none' } }]).rows[0]?.colour,
    ).toEqual({
      kind: 'tc',
      mirek: 270,
    });
  });

  it('hue drift wanders in tint without raising red alone, and leaves the whites as they are', () => {
    const p = plan(def('hue-drift', [1], { amount: 20, interval: 30 }));
    const ch = p.rows.map((r) => (r.colour.kind === 'rgbwaf' ? r.colour.channels : []));
    expect(ch).toEqual([
      [100, 120, 100, 50, 0, 255],
      [100, 100, 120, 50, 0, 255],
      [110, 110, 100, 50, 0, 255],
      [100, 100, 100, 50, 0, 255],
    ]);
    expect(p.periodMs).toBe(120_000);
    expect(why(def('hue-drift', [0]))).toBe('A0 does not take RGBWAF channel levels.');
    // Channels stay in range, and a driver with no known colour starts from none.
    const high = plan(def('hue-drift', [1], { amount: 40 }), [
      { ...B, colour: { kind: 'rgbwaf', channels: [250, 250, 250, 0, 0, 255] } },
    ]);
    for (const r of high.rows)
      if (r.colour.kind === 'rgbwaf')
        expect(Math.max(...r.colour.channels.slice(0, 3))).toBeLessThanOrEqual(254);
    expect(
      plan(def('hue-drift', [1]), [{ ...B, colour: { kind: 'none' } }]).rows[0]?.colour,
    ).toEqual({
      kind: 'rgbwaf',
      channels: [0, 20, 0, 255, 255, 255],
    });
  });

  it('accent tint adds a small offset in the hue asked for', () => {
    const red = plan(def('accent-tint', [1], { strength: 5, hue: 0, time: 2 }));
    expect(red.rows[0]?.colour).toEqual({ kind: 'rgbwaf', channels: [130, 100, 100, 50, 0, 255] });
    expect(red.rows[0]?.fadeMs).toBe(2000);
    const green = plan(def('accent-tint', [1], { strength: 3, hue: 120, time: 2 }));
    expect(green.rows[0]?.colour).toEqual({
      kind: 'rgbwaf',
      channels: [100, 118, 100, 50, 0, 255],
    });
    expect(red.periodMs).toBeUndefined();
    expect(why(def('accent-tint', [0]))).toBe('A0 does not take RGBWAF channel levels.');
  });

  it('warm shift dims and warms: evenly on the linear curve, late on the filament curve', () => {
    const linear = plan(def('warm-shift', [0], { level: 5, time: 9, warmest: 2700, curve: 0 }));
    expect(linear.rows).toHaveLength(1);
    expect(linear.rows[0]).toMatchObject({
      arc: 144,
      colour: { kind: 'tc', mirek: 370 },
      fadeMs: 9000,
    });
    const filament = plan(def('warm-shift', [0], { level: 5, time: 9, warmest: 2700, curve: 1 }));
    expect(
      filament.rows.map((r) => [r.atMs, r.arc, r.colour.kind === 'tc' && r.colour.mirek]),
    ).toEqual([
      [0, 148, 263],
      [3000, 146, 303],
      [6000, 144, 370],
    ]);
    expect(why(def('warm-shift', [0], { level: 30 }), [{ ...A, arc: 100 }])).toBe(
      'A0 is at or below 30% already. Warm shift dims.',
    );
    expect(why(def('warm-shift', [1]))).toBe('A1 does not take a colour temperature.');
    // Already warmer than the warmest asked for: the colour stays.
    const warm = plan(def('warm-shift', [0], { warmest: 3000, curve: 0 }), [
      { ...A, colour: { kind: 'tc', mirek: 370 } },
    ]);
    expect(warm.rows[0]?.colour).toEqual({ kind: 'none' });
    expect(
      plan(def('warm-shift', [0], { curve: 0 }), [{ ...A, colour: { kind: 'none' } }]).rows,
    ).toHaveLength(1);
  });

  it('presence follow brightens each driver in turn and eases it back', () => {
    const p = plan(def('presence', [0, 1, 5], { pace: 2, boost: 20, rise: 1, hold: 3 }));
    expect(levels(p, 0)).toEqual([
      [0, 170],
      [4000, 150],
    ]);
    expect(levels(p, 1)).toEqual([
      [2000, 170],
      [6000, 150],
    ]);
    expect(levels(p, 5)).toEqual([
      [4000, 170],
      [8000, 150],
    ]);
    expect(p.endMs).toBe(10_000);
    // The order given is the order walked.
    expect(levels(plan(def('presence', [5, 0])), 0)[0]?.[0]).toBe(2000);
    expect(why(def('presence', [0]), [{ ...A, arc: 210 }])).toBe(
      'A0 is too near the ceiling to brighten by 20 levels.',
    );
    expect(why(def('presence', [0]), [{ ...A, arc: 0 }])).toMatch(/is off/);
  });

  it('sunrise starts from off and warm, and rises to the level and colour asked for', () => {
    const p = plan(def('sunrise', [0, 1, 5], { minutes: 30, level: 30, kelvin: 4000 }), [
      { ...A, arc: 0 },
      { ...B, arc: 0 },
      { ...C, arc: 0, drive: 'level', colour: { kind: 'none' } },
    ]);
    // On a light that is on, its first step would switch the light off at once.
    expect(why(def('sunrise', [0, 1]), [{ ...A, arc: 0 }, B])).toBe(
      'A1 is on. Sunrise starts from off: switch it off first.',
    );
    expect(p.endMs).toBe(30 * 60_000);
    const a = p.rows.filter((r) => r.address === 0);
    expect(a[0]).toMatchObject({ atMs: 0, arc: 0, colour: { kind: 'tc', mirek: 370 } });
    expect(a.at(-1)).toMatchObject({ arc: 210, colour: { kind: 'tc', mirek: 250 } });
    // 30 minutes is 16 and 14: the colour moves with the level in each.
    expect(a.slice(1).map((r) => r.fadeMs)).toEqual([16 * 60_000, 14 * 60_000]);
    expect(p.rows.find((r) => r.address === 1)?.colour).toEqual({
      kind: 'rgbwaf',
      channels: [0, 0, 0, 254, 0, 255],
    });
    expect(p.rows.filter((r) => r.address === 5).every((r) => r.colour.kind === 'none')).toBe(true);
    expect(p.periodMs).toBeUndefined();
  });
});

describe('a saved effect from outside', () => {
  const good = { name: 'Slow', type: 'breathe', params: { depth: 8, period: 12 }, targets: [0, 1] };
  it('is accepted when its settings are in range', () => {
    expect(effectSchema(good, 'effect')).toEqual({ ok: true, value: good });
  });
  it('is refused otherwise', () => {
    for (const bad of [
      { ...good, type: 'strobe' },
      { ...good, params: { depth: 99, period: 12 } },
      { ...good, params: { depth: 8 } },
      { ...good, params: { depth: '8', period: 12 } },
      { ...good, params: [8, 12] },
      { ...good, params: null },
      {
        ...good,
        params: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${String(i)}`, 1])),
      },
      { ...good, params: { depth: 8, period: 12, ['x'.repeat(41)]: 1 } },
      { ...good, params: JSON.parse('{"depth":8,"period":12,"__proto__":1}') as unknown },
      { ...good, targets: [0, 0] },
      { ...good, targets: [64] },
      { ...good, targets: Array.from({ length: 17 }, (_, i) => i) },
      { ...good, name: '' },
      { ...good, extra: 1 },
    ])
      expect(effectSchema(bad, 'effect').ok).toBe(false);
  });
});
