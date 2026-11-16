import { describe, expect, it } from 'vitest';
import { arcToFraction, percentText, percentToArcFloor, percentToArcNearest } from './curve.ts';
import { extendedFadeMs, extendedFades, fadeInUse, fadeTimeMs, standardFades } from './fade.ts';

describe('percentToArcNearest', () => {
  it('gives off for zero or less, and full for 100 or more', () => {
    expect(percentToArcNearest(0)).toBe(0);
    expect(percentToArcNearest(-1)).toBe(0);
    expect(percentToArcNearest(Number.NaN)).toBe(0);
    expect(percentToArcNearest(100)).toBe(254);
    expect(percentToArcNearest(150)).toBe(254);
  });

  it('gives at least level 1 for any output above zero', () => {
    expect(percentToArcNearest(0.0001)).toBe(1);
  });

  it('is the closest level, and never below the floor', () => {
    for (let arc = 1; arc <= 254; arc++) {
      const pct = arcToFraction(arc) * 100;
      expect(percentToArcNearest(pct)).toBe(arc);
      expect(percentToArcNearest(pct * 1.001)).toBeGreaterThanOrEqual(percentToArcFloor(pct));
    }
    expect(percentToArcNearest(10.1)).toBe(170);
  });
});

describe('percentText', () => {
  it('gives one decimal and drops a trailing .0', () => {
    expect([0, 1, 148, 170, 220, 254].map(percentText)).toEqual([
      '0',
      '0.1',
      '5.5',
      '10.1',
      '39.5',
      '100',
    ]);
  });
});

describe('fade lists', () => {
  it('lists the 15 standard fade times, 0.7 s to 90.5 s', () => {
    const s = standardFades();
    expect(s).toHaveLength(15);
    expect(s[0]).toEqual({ value: 1, ms: fadeTimeMs(1) });
    expect(s[14]?.ms).toBeCloseTo(90_510, -1);
  });

  it('lists each extended time once, shortest first, from 0.1 s to 16 minutes', () => {
    const e = extendedFades();
    expect(e[0]).toEqual({ value: 0x10, ms: 100 });
    expect(e.at(-1)?.ms).toBe(960_000);
    for (const o of e) expect(extendedFadeMs(o.value)).toBe(o.ms);
    const ms = e.map((o) => o.ms);
    expect(new Set(ms).size).toBe(ms.length);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });

  it('picks the smaller multiplier where two bytes give the same time', () => {
    expect(extendedFades().find((o) => o.ms === 1000)?.value).toBe(0x19);
  });

  it('marks the gaps where the step grows', () => {
    expect(
      extendedFades()
        .filter((o) => o.gapBefore === true)
        .map((o) => o.ms),
    ).toEqual([2000, 20_000, 180_000]);
  });
});

describe('fadeInUse', () => {
  it('uses the standard fade time when it is set', () => {
    expect(fadeInUse(4, 0x21)).toMatchObject({ kind: 'standard', ms: 2000 });
  });

  it('uses the fast fade when the fade time is 0 and a fast fade is set', () => {
    expect(fadeInUse(0, 0x21, 4)).toMatchObject({ kind: 'fast', ms: 100 });
    expect(fadeInUse(0, 0x21, 27, 700)).toMatchObject({ kind: 'fast', ms: 700 });
    expect(fadeInUse(0, 0x21, 27)).toMatchObject({ kind: 'fast', ms: 675 });
  });

  it('uses the extended fade otherwise, or none', () => {
    expect(fadeInUse(0, 0x21)).toMatchObject({ kind: 'extended', ms: 2000 });
    expect(fadeInUse(0, 0x10)).toMatchObject({ kind: 'extended', ms: 100 });
    expect(fadeInUse(0, 0)).toMatchObject({ kind: 'none', ms: 0 });
    expect(fadeInUse(0, 0x50)).toMatchObject({ kind: 'none', ms: 0 });
  });
});
