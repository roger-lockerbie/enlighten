import { describe, expect, it } from 'vitest';
import {
  ADAPT_MAX_K,
  D65,
  DEFAULT_FALSE_SCALE,
  PALETTE,
  PRESET_EV,
  PRIMARIES,
  SHOULDER,
  XYZ_TO_P3,
  XYZ_TO_SRGB,
  adaptation,
  adaptedWhite,
  cct,
  clampEv,
  decodeSrgb,
  diag,
  displayMatrix,
  encodeSrgb,
  falsePosition,
  inGamut,
  inverse,
  locusXy,
  mapToGamut,
  mapToGamutOklch,
  matMul,
  matteLuminance,
  mccamy,
  mul,
  oklabToXyz,
  paletteAt,
  ticks,
  tone,
  toneFactor,
  uvToXy,
  whiteLuminance,
  xyToUv,
  xyToXyz,
  xyzToOklab,
  xyzToXy,
} from './index.ts';
import type { Vec3 } from './index.ts';

const RED = { x: 0.7, y: 0.3 };
const GREEN = { x: 0.17, y: 0.7 };
const BLUE = { x: 0.13, y: 0.06 };

describe('XYZ and the display matrices', () => {
  it('takes a chromaticity and Y to XYZ and back', () => {
    const v = xyToXyz({ x: 0.4, y: 0.35 }, 12);
    expect(v[1]).toBe(12);
    const c = xyzToXy(v);
    expect(c.x).toBeCloseTo(0.4, 12);
    expect(c.y).toBeCloseTo(0.35, 12);
  });

  it('gives black for a chromaticity with no y, and D65 for the chromaticity of black', () => {
    expect(xyToXyz({ x: 0.3, y: 0 }, 5)).toEqual([0, 0, 0]);
    expect(xyzToXy([0, 0, 0])).toEqual(D65);
  });

  it('maps D65 to equal red, green and blue on both displays', () => {
    for (const m of [XYZ_TO_SRGB, XYZ_TO_P3]) {
      const rgb = mul(m, xyToXyz(D65, 1));
      for (const c of rgb) expect(c).toBeCloseTo(1, 3);
    }
  });

  it('maps each display primary to its own channel alone', () => {
    for (const display of ['srgb', 'p3'] as const) {
      PRIMARIES[display].forEach((p, i) => {
        const rgb = mul(displayMatrix(display), xyToXyz(p, 1));
        rgb.forEach((c, k) => {
          if (k === i) expect(c).toBeGreaterThan(0.5);
          else expect(Math.abs(c)).toBeLessThan(2e-3 * Math.max(...rgb));
        });
      });
    }
  });

  it('inverts a matrix', () => {
    const id = matMul(XYZ_TO_SRGB, inverse(XYZ_TO_SRGB));
    id.forEach((row, i) => {
      row.forEach((v, j) => {
        expect(v).toBeCloseTo(i === j ? 1 : 0, 12);
      });
    });
    expect(() => inverse(diag([1, 0, 1]))).toThrow(RangeError);
  });

  it('round trips the transfer curve and clamps it', () => {
    for (const v of [0, 0.001, 0.0031308, 0.02, 0.18, 0.5, 1]) {
      expect(decodeSrgb(encodeSrgb(v))).toBeCloseTo(v, 10);
    }
    expect(encodeSrgb(-1)).toBe(0);
    expect(encodeSrgb(2)).toBeCloseTo(1, 12);
    expect(encodeSrgb(0.18)).toBeCloseTo(0.4614, 3);
  });
});

describe('the black-body locus', () => {
  it('round trips CIE 1960 coordinates', () => {
    const c = uvToXy(xyToUv({ x: 0.31, y: 0.33 }));
    expect(c.x).toBeCloseTo(0.31, 12);
    expect(c.y).toBeCloseTo(0.33, 12);
  });

  it('matches published points on the locus', () => {
    // Illuminant A is a black body at 2,856 K: (0.4476, 0.4074).
    const a = locusXy(2856);
    expect(a.x).toBeCloseTo(0.4476, 3);
    expect(a.y).toBeCloseTo(0.4074, 3);
    const d = locusXy(6500);
    expect(d.x).toBeCloseTo(0.3135, 3);
    expect(d.y).toBeCloseTo(0.3237, 3);
  });

  it('finds the temperature of points on the locus, with no Duv', () => {
    for (const k of [1500, 2000, 2700, 2856, 4000, 5000, 6500, 9000, 12000]) {
      const r = cct(locusXy(k));
      expect(r.kelvin / k).toBeCloseTo(1, 4);
      expect(Math.abs(r.duv)).toBeLessThan(1e-6);
    }
  });

  it("agrees with McCamy's cubic on the locus from 2,856 to 6,504 K", () => {
    for (let k = 2856; k <= 6504; k += 152) {
      const c = locusXy(k);
      expect(Math.abs(mccamy(c) - cct(c).kelvin)).toBeLessThan(12);
    }
  });

  it('signs Duv: D65 sits above the locus, and a point moved toward magenta sits below', () => {
    const d65 = cct(D65);
    expect(d65.kelvin).toBeGreaterThan(6400);
    expect(d65.kelvin).toBeLessThan(6600);
    expect(d65.duv).toBeGreaterThan(0.002);
    expect(d65.duv).toBeLessThan(0.005);
    const on = xyToUv(locusXy(4000));
    expect(cct(uvToXy({ u: on.u, v: on.v - 0.01 })).duv).toBeLessThan(-0.008);
    expect(cct(uvToXy({ u: on.u, v: on.v + 0.01 })).duv).toBeGreaterThan(0.008);
  });

  it('puts an even mix of 2,700 K and 6,500 K below the locus, toward pink', () => {
    const warm = xyToXyz(locusXy(2700), 1);
    const cool = xyToXyz(locusXy(6500), 1);
    const mix: Vec3 = [warm[0] + cool[0], warm[1] + cool[1], warm[2] + cool[2]];
    const r = cct(xyzToXy(mix));
    expect(r.kelvin).toBeGreaterThan(3300);
    expect(r.kelvin).toBeLessThan(4300);
    expect(r.duv).toBeLessThan(-0.003);
  });

  it('clamps outside the range of the fit', () => {
    expect(locusXy(100)).toEqual(locusXy(1000));
    expect(locusXy(1e6)).toEqual(locusXy(15000));
    expect(cct(BLUE).kelvin).toBeCloseTo(15000, 0);
  });
});

describe('white balance', () => {
  it('leaves daylight alone', () => {
    const m = adaptation(adaptedWhite({ mode: 'daylight' }, [1, 1, 1]));
    expect(mul(m, [0.2, 0.5, 0.7])).toEqual([0.2, 0.5, 0.7]);
  });

  it('takes the chosen white to D65', () => {
    const white = adaptedWhite({ mode: 'kelvin', kelvin: 2700 }, [0, 0, 0]);
    const out = xyzToXy(mul(adaptation(white), xyToXyz(white, 1)));
    expect(out.x).toBeCloseTo(D65.x, 6);
    expect(out.y).toBeCloseTo(D65.y, 6);
  });

  it('adapts to the scene along the locus, so a warm room reads as white', () => {
    const light = xyToXyz(locusXy(3000), 40);
    const white = adaptedWhite({ mode: 'scene' }, light);
    const out = xyzToXy(mul(adaptation(white), light));
    expect(out.x).toBeCloseTo(D65.x, 4);
    expect(out.y).toBeCloseTo(D65.y, 4);
  });

  it('does not turn a saturated blue room white', () => {
    const light = xyToXyz(BLUE, 5);
    const white = adaptedWhite({ mode: 'scene' }, light);
    expect(white).toEqual(locusXy(ADAPT_MAX_K));
    const out = xyzToXy(mul(adaptation(white), light));
    expect(out.y).toBeLessThan(0.12);
  });

  it('reads a dark room as daylight, and clamps a chosen temperature', () => {
    expect(adaptedWhite({ mode: 'scene' }, [0, 0, 0])).toEqual(D65);
    expect(adaptedWhite({ mode: 'kelvin', kelvin: 500 }, [0, 0, 0])).toEqual(locusXy(2000));
  });
});

describe('gamut mapping', () => {
  it('leaves colours a display can show, and black', () => {
    const v = xyToXyz(locusXy(2700), 3);
    expect(mapToGamut(v, 'srgb')).toEqual({ xyz: v, moved: false });
    expect(mapToGamut([0, 0, 0], 'srgb')).toEqual({ xyz: [0, 0, 0], moved: false });
    expect(mapToGamutOklch(v, 'srgb')).toEqual({ xyz: v, moved: false });
  });

  it('brings LED primaries into gamut, holding luminance and moving toward white', () => {
    for (const display of ['srgb', 'p3'] as const) {
      for (const led of [RED, GREEN, BLUE]) {
        const v = xyToXyz(led, 7);
        expect(inGamut(v, display)).toBe(false);
        const m = mapToGamut(v, display);
        expect(m.moved).toBe(true);
        expect(m.xyz[1]).toBe(7);
        expect(inGamut(m.xyz, display, 0)).toBe(true);
        // On the edge of the gamut: one channel is at, or a hair above, zero.
        const rgb = mul(displayMatrix(display), m.xyz);
        expect(Math.min(...rgb)).toBeLessThan(1e-6);
        // Between the LED and white, on the line through both.
        const c = xyzToXy(m.xyz);
        const along = (c.x - led.x) / (D65.x - led.x);
        expect(along).toBeGreaterThan(0);
        expect(along).toBeLessThan(1);
        expect(c.y).toBeCloseTo(led.y + along * (D65.y - led.y), 6);
      }
    }
  });

  it('moves a colour less on the wider display', () => {
    const v = xyToXyz(GREEN, 1);
    const s = xyzToXy(mapToGamut(v, 'srgb').xyz);
    const p = xyzToXy(mapToGamut(v, 'p3').xyz);
    expect(Math.abs(p.x - GREEN.x)).toBeLessThan(Math.abs(s.x - GREEN.x));
  });

  it('round trips Oklab, and the OkLCh method ends in gamut with its hue held', () => {
    const v: Vec3 = [0.3, 0.4, 0.2];
    const back = oklabToXyz(xyzToOklab(v));
    back.forEach((c, i) => {
      expect(c).toBeCloseTo(v[i] ?? 0, 10);
    });
    const led = xyToXyz(GREEN, 0.5);
    const m = mapToGamutOklch(led, 'srgb');
    expect(m.moved).toBe(true);
    expect(inGamut(m.xyz, 'srgb', 1e-6)).toBe(true);
    const a = xyzToOklab(led);
    const b = xyzToOklab(m.xyz);
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(Math.atan2(b[2], b[1])).toBeCloseTo(Math.atan2(a[2], a[1]), 6);
  });
});

describe('exposure and tone', () => {
  it('follows the photographic convention', () => {
    expect(whiteLuminance(0)).toBeCloseTo(1.2, 12);
    expect(whiteLuminance(5.4)).toBeCloseTo(50.7, 1);
    expect(PRESET_EV.night).toBeLessThan(PRESET_EV.evening);
    expect(PRESET_EV.evening).toBeLessThan(PRESET_EV.day);
  });

  it('gives 25.5 cd/m² for 100 lux on a wall of reflectance 0.8', () => {
    expect(matteLuminance(0.8, 100)).toBeCloseTo(25.5, 1);
  });

  it('clamps the manual setting and replaces a value that is not a number', () => {
    expect(clampEv(99)).toBe(12);
    expect(clampEv(-99)).toBe(-4);
    expect(clampEv(Number.NaN)).toBe(PRESET_EV.evening);
  });

  it('is one to one up to the shoulder, then rolls off below 1 without a jump', () => {
    expect(toneFactor(0)).toBe(1);
    expect(toneFactor(SHOULDER)).toBe(1);
    expect(toneFactor(Number.NaN)).toBe(1);
    const just = (SHOULDER + 1e-6) * toneFactor(SHOULDER + 1e-6);
    expect(just).toBeCloseTo(SHOULDER, 5);
    let last = 0;
    for (const peak of [0.9, 1, 1.2, 2, 10, 1000]) {
      const mapped = peak * toneFactor(peak);
      // Far above the shoulder the curve reaches 1 to the last bit, so the rise is not strict there.
      if (peak <= 2) expect(mapped).toBeGreaterThan(last);
      else expect(mapped).toBeGreaterThanOrEqual(last);
      expect(mapped).toBeLessThanOrEqual(1);
      last = mapped;
    }
  });

  it('keeps the ratios between channels, so hue holds', () => {
    const out = tone([4, 2, 1]);
    expect(out[0] / out[1]).toBeCloseTo(2, 12);
    expect(out[1] / out[2]).toBeCloseTo(2, 12);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(tone([-1, 0.5, 0.2])).toEqual([0, 0.5, 0.2]);
  });
});

describe('false colour', () => {
  it('places values on a log scale and clamps both ends', () => {
    const s = DEFAULT_FALSE_SCALE;
    expect(falsePosition(0, s)).toBe(0);
    expect(falsePosition(-3, s)).toBe(0);
    expect(falsePosition(1, s)).toBe(0);
    expect(falsePosition(10, s)).toBeCloseTo(1 / 3, 12);
    expect(falsePosition(1000, s)).toBe(1);
    expect(falsePosition(1e9, s)).toBe(1);
  });

  it('reads the palette at its stops and between them', () => {
    expect(paletteAt(0)).toEqual(PALETTE[0]);
    expect(paletteAt(1)).toEqual(PALETTE[PALETTE.length - 1]);
    expect(paletteAt(-1)).toEqual(PALETTE[0]);
    const mid = paletteAt(0.5 / (PALETTE.length - 1));
    const a = PALETTE[0] ?? [0, 0, 0];
    const b = PALETTE[1] ?? [0, 0, 0];
    expect(mid[2]).toBeCloseTo((a[2] + b[2]) / 2, 12);
  });

  it('labels 1, 2 and 5 in each decade and the top', () => {
    const t = ticks({ quantity: 'luminance', min: 0.1, decades: 2 });
    expect(t.map((x) => Number(x.value.toPrecision(3)))).toEqual([0.1, 0.2, 0.5, 1, 2, 5, 10]);
    expect(t[0]?.position).toBe(0);
    expect(t[t.length - 1]?.position).toBe(1);
  });
});
