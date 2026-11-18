import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adaptation,
  cct,
  displayMatrix,
  inGamut,
  locusXy,
  mapToGamut,
  mul,
  tone,
  xyToXyz,
} from './index.ts';
import type { Vec3 } from './index.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 100);

// Chromaticities inside the spectral locus, roughly: a triangle that contains every LED colour.
const chroma = fc
  .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }))
  .map(([a, b]) => {
    const [s, t] = a + b > 1 ? [1 - a, 1 - b] : [a, b];
    return { x: 0.12 + s * 0.6 + t * 0.05, y: 0.05 + s * 0.22 + t * 0.68 };
  });
const lum = fc.double({ min: 1e-6, max: 1e5, noNaN: true });

describe('P-light: colour', () => {
  it('maps any colour into gamut at the same luminance', () => {
    fc.assert(
      fc.property(chroma, lum, fc.constantFrom('srgb' as const, 'p3' as const), (c, y, display) => {
        const m = mapToGamut(xyToXyz(c, y), display);
        expect(m.xyz[1]).toBe(y);
        expect(inGamut(m.xyz, display, 1e-9)).toBe(true);
      }),
      { numRuns: runs },
    );
  });

  it('keeps a sum of mapped colours in gamut', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(chroma, lum), { minLength: 1, maxLength: 30 }),
        fc.constantFrom('srgb' as const, 'p3' as const),
        (lights, display) => {
          let sum: Vec3 = [0, 0, 0];
          for (const [c, y] of lights) {
            const m = mapToGamut(xyToXyz(c, y), display).xyz;
            sum = [sum[0] + m[0], sum[1] + m[1], sum[2] + m[2]];
          }
          const rgb = mul(displayMatrix(display), sum);
          for (const v of rgb) expect(v).toBeGreaterThanOrEqual(-1e-9 * sum[1]);
        },
      ),
      { numRuns: runs },
    );
  });

  it('never throws on a colour temperature search, and stays in range', () => {
    fc.assert(
      fc.property(chroma, (c) => {
        const r = cct(c);
        expect(r.kelvin).toBeGreaterThanOrEqual(1000 - 1e-6);
        expect(r.kelvin).toBeLessThanOrEqual(15000 + 1e-6);
        expect(Number.isFinite(r.duv)).toBe(true);
      }),
      { numRuns: runs },
    );
  });

  it('adapts a white on the locus to a finite matrix that holds luminance order', () => {
    fc.assert(
      fc.property(fc.double({ min: 2000, max: 10000, noNaN: true }), (k) => {
        const m = adaptation(locusXy(k));
        for (const row of m) for (const v of row) expect(Number.isFinite(v)).toBe(true);
        const dim = mul(m, xyToXyz(locusXy(k), 1));
        const bright = mul(m, xyToXyz(locusXy(k), 2));
        expect(bright[1]).toBeGreaterThan(dim[1]);
      }),
      { numRuns: runs },
    );
  });

  it('tones any colour into 0 to 1 with its channel order kept', () => {
    const ch = fc.double({ min: 0, max: 1e6, noNaN: true });
    fc.assert(
      fc.property(ch, ch, ch, (r, g, b) => {
        const out = tone([r, g, b]);
        for (const v of out) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        if (r >= g) expect(out[0]).toBeGreaterThanOrEqual(out[1]);
        if (g >= b) expect(out[1]).toBeGreaterThanOrEqual(out[2]);
      }),
      { numRuns: runs },
    );
  });
});
