import { describe, expect, it } from 'vitest';
import { cct, locusXy, xyzToXy } from './colour/index.ts';
import { DIFFUSERS, RIPPLE_SAMPLES, contrast, ripple } from './diffuser.ts';
import { TAPES, channelDrives, channelFor, emitted } from './emitter.ts';
import type { Drive } from './emitter.ts';
import { buildFrame, rippleTables, roomLight, shade } from './frame.ts';
import { buildGeometry } from './geometry.ts';
import { probe } from './probe.ts';
import { solveScene } from './response.ts';
import { defaultScene, mount } from './scene.ts';
import type { Scene } from './scene.ts';

const tcDrive = (warm: number, cool: number): Drive => ({
  terminals: [warm, cool, warm, cool, 0],
  labels: ['WW', 'CW', 'WW', 'CW', 'unused'],
});
const rgbDrive = (r: number, g: number, b: number, ww = 0, cw = 0): Drive => ({
  terminals: [r, g, b, ww, cw],
  labels: ['R', 'G', 'B', 'WW', 'CW'],
});

describe('tape profiles', () => {
  it('carries the research figures, each with where it came from', () => {
    expect(TAPES.B.channels.map((c) => c.flux)).toEqual([50, 270, 38, 342, 396]);
    expect(TAPES.B.channels.reduce((a, c) => a + c.flux, 0)).toBe(1096);
    expect(TAPES.A.channels.map((c) => c.flux)).toEqual([900, 900]);
    expect(TAPES.COB.channels.reduce((a, c) => a + c.flux, 0)).toBe(2200);
    for (const tape of Object.values(TAPES)) {
      for (const c of tape.channels) {
        expect(c.fluxBasis.length).toBeGreaterThan(5);
        expect(c.colourBasis.length).toBeGreaterThan(5);
        expect(Math.abs(c.offset)).toBeLessThan(tape.period);
      }
      expect(tape.layoutBasis.length).toBeGreaterThan(5);
    }
    // Tape A: 120 LEDs a metre, so one colour every 16.67 mm, the other half way between.
    expect(TAPES.A.period).toBeCloseTo(0.016667, 6);
    expect(TAPES.A.channels[1]?.offset).toBeCloseTo(0.008333, 6);
    expect(TAPES.COB.period * 608).toBeCloseTo(2, 9);
    expect(TAPES.A.channels[0]?.fluxStanding).toBe('estimated');
    expect(TAPES.B.channels[0]?.fluxStanding).toBe('datasheet');
  });

  it('maps output terminals to tape channels', () => {
    expect(channelFor('R')).toBe('R');
    expect(channelFor('CW')).toBe('CW');
    expect(channelFor('W')).toBe('WW');
    expect(channelFor('mono')).toBe('WW');
    expect(channelFor('unused')).toBeUndefined();
  });

  it('reads the drive on each channel, averaging terminals that carry the same colour', () => {
    expect(channelDrives(tcDrive(0.5, 0.25), TAPES.A)).toEqual([0.5, 0.25]);
    expect(channelDrives(rgbDrive(1, 0.5, 0, 0.2, 0.1), TAPES.B)).toEqual([1, 0.5, 0, 0.2, 0.1]);
    // A tunable-white tape on an RGB + CCT driver takes only the whites.
    expect(channelDrives(rgbDrive(1, 1, 1, 0.3, 0.4), TAPES.A)).toEqual([0.3, 0.4]);
    expect(channelDrives(undefined, TAPES.A)).toEqual([0, 0]);
    expect(
      channelDrives({ terminals: [2, -1, Number.NaN], labels: ['WW', 'CW', 'WW'] }, TAPES.A),
    ).toEqual([0.5, 0]);
    expect(channelDrives({ terminals: [1], labels: [] }, TAPES.A)).toEqual([0, 0]);
  });
});

describe('what a mount gives out', () => {
  it("is flux times drive times the cover, with the channel's colour", () => {
    const e = emitted(tcDrive(1, 0), 'A', 'none');
    expect(e.xyz[1]).toBeCloseTo(900, 9);
    expect(cct(xyzToXy(e.xyz)).kelvin).toBeCloseTo(2700, -1);
    expect(emitted(tcDrive(1, 1), 'A', 'opal-linear-lux').xyz[1]).toBeCloseTo(1800 * 0.35, 9);
    expect(emitted(tcDrive(0.5, 0), 'A', 'clear').xyz[1]).toBeCloseTo(450 * 0.9, 9);
    expect(emitted(undefined, 'B', 'none').xyz).toEqual([0, 0, 0]);
    expect(emitted(rgbDrive(1, 1, 1, 1, 1), 'B', 'none').xyz[1]).toBeCloseTo(1096, 9);
  });

  it('puts a warm and cool mix below the locus, as two-channel tunable white does', () => {
    const e = emitted(tcDrive(0.5, 0.5), 'A', 'none');
    const c = cct(xyzToXy(e.xyz));
    expect(c.kelvin).toBeGreaterThan(3300);
    expect(c.kelvin).toBeLessThan(4300);
    expect(c.duv).toBeLessThan(-0.003);
  });
});

describe('covers and dots', () => {
  it('carries the research transmissions', () => {
    expect(Object.values(DIFFUSERS).map((d) => d.transmission)).toEqual([1, 0.9, 0.75, 0.6, 0.35]);
    for (const d of Object.values(DIFFUSERS)) {
      expect(d.haze).toBeGreaterThanOrEqual(0);
      expect(d.haze).toBeLessThanOrEqual(1);
      expect(d.transmissionBasis.length).toBeGreaterThan(5);
    }
  });

  it('never changes how much light there is: the mean is 1', () => {
    for (const haze of [0, 0.05, 0.6, 1]) {
      for (const depth of [0.003, 0.011, 0.03]) {
        for (const tape of Object.values(TAPES)) {
          for (const c of tape.channels) {
            const p = ripple(tape.period, tape.chip, c.offset, depth, haze);
            expect(p).toHaveLength(RIPPLE_SAMPLES);
            expect(p.reduce((a, v) => a + v, 0) / p.length).toBeCloseTo(1, 5);
            for (const v of p) expect(v).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('follows the rule of thumb: dots show when the cover is closer than the pitch', () => {
    // optics.md section 3. One colour of tape A repeats every 16.67 mm.
    const at = (period: number, depth: number): number =>
      contrast(ripple(period, 0.0028, 0, depth, 1));
    // Both colours on: 8.33 mm pitch behind an opal cover at 11.5 mm. No dots expected.
    expect(at(1 / 120, 0.0115)).toBeLessThan(0.05);
    // One colour only: 16.67 mm pitch, the same cover. Dots likely.
    expect(at(1 / 60, 0.0115)).toBeGreaterThan(0.1);
    // A shallow profile: dots certain.
    expect(at(1 / 60, 0.007)).toBeGreaterThan(0.4);
    // COB: no dots at any depth a profile has.
    expect(at(2 / 608, 0.007)).toBeLessThan(0.001);
    // Deeper is always smoother.
    expect(at(1 / 60, 0.02)).toBeLessThan(at(1 / 60, 0.0115));
  });

  it('shows the LEDs themselves with no cover, where each colour sits', () => {
    const tape = TAPES.A;
    const warm = ripple(tape.period, tape.chip, 0, 0.011, 0);
    const cool = ripple(tape.period, tape.chip, tape.channels[1]?.offset ?? 0, 0.011, 0);
    expect(contrast(warm)).toBe(1);
    // The warm LED is at the start of the repeat and the cool one half way along.
    expect(warm[0]).toBeGreaterThan(1);
    expect(warm[RIPPLE_SAMPLES / 2]).toBe(0);
    expect(cool[RIPPLE_SAMPLES / 2]).toBeGreaterThan(1);
    expect(cool[0]).toBe(0);
  });

  it('still lights one sample for an emitter narrower than a sample', () => {
    const p = ripple(0.1, 0.0001, 0.0301, 0.01, 0);
    expect(p.filter((v) => v > 0)).toHaveLength(1);
    expect(p[19]).toBeGreaterThan(0);
    expect(contrast([])).toBe(0);
    expect(contrast([0, 0])).toBe(0);
  });
});

describe('the frame', () => {
  const scene = defaultScene();
  const drives = new Map<number, Drive>([
    [0, tcDrive(0.4, 0)],
    [1, rgbDrive(0, 0, 1)],
  ]);

  it('keeps the measured light and the shown light at the same luminance', () => {
    const f = buildFrame(scene, drives, { display: 'srgb', balance: { mode: 'daylight' } });
    expect(f.mounts).toHaveLength(2);
    const [a, b] = f.mounts;
    expect(a?.raw[1]).toBeCloseTo(900 * 0.4 * 0.35, 9);
    expect(a?.shown[1]).toBeCloseTo(a?.raw[1] ?? 0, 9);
    expect(b?.shown[1]).toBeCloseTo(b?.raw[1] ?? 0, 9);
    // Warm white fits the display. Saturated blue does not, and is moved toward white.
    expect(a?.desaturated).toBe(false);
    expect(b?.desaturated).toBe(true);
    expect(xyzToXy(b?.shown ?? [0, 0, 0]).y).toBeGreaterThan(0.06);
    expect(xyzToXy(b?.raw ?? [0, 0, 0]).y).toBeCloseTo(0.06, 9);
    expect(a?.channels).toHaveLength(2);
    expect(b?.channels).toHaveLength(5);
  });

  it('balances to the scene along the locus, so a warm room reads as white', () => {
    const warm = new Map<number, Drive>([[0, tcDrive(1, 0)]]);
    const adapted = buildFrame(scene, warm, { display: 'srgb', balance: { mode: 'scene' } });
    const fixed = buildFrame(scene, warm, { display: 'srgb', balance: { mode: 'daylight' } });
    expect(adapted.white.x).toBeCloseTo(locusXy(2700).x, 3);
    const shown = xyzToXy(adapted.mounts[0]?.shown ?? [0, 0, 0]);
    expect(shown.x).toBeCloseTo(0.3127, 2);
    expect(xyzToXy(fixed.mounts[0]?.shown ?? [0, 0, 0]).x).toBeGreaterThan(0.44);
    // The measured light is the same either way.
    expect(adapted.mounts[0]?.raw).toEqual(fixed.mounts[0]?.raw);
  });

  it('balances two set-ups side by side to one white, from the light of both', () => {
    const warm = new Map<number, Drive>([[0, tcDrive(1, 0)]]);
    const cool = new Map<number, Drive>([[0, tcDrive(1, 1)]]);
    const coolScene: Scene = {
      ...scene,
      mounts: [mount('c1', 'channel', 'left', 5, { address: 0 })],
    };
    const a = buildFrame(scene, warm, {
      display: 'srgb',
      balance: { mode: 'scene' },
      alongside: roomLight(coolScene, cool),
    });
    const b = buildFrame(coolScene, cool, {
      display: 'srgb',
      balance: { mode: 'scene' },
      alongside: roomLight(scene, warm),
    });
    expect(a.white.x).toBeCloseTo(b.white.x, 9);
    expect(a.white.y).toBeCloseTo(b.white.y, 9);
    // Warmer than the cool set-up alone, cooler than the warm one alone.
    const alone = buildFrame(scene, warm, { display: 'srgb', balance: { mode: 'scene' } });
    expect(a.white.x).toBeLessThan(alone.white.x);
    // A fixed balance ignores what is alongside.
    const fixed = { display: 'srgb', balance: { mode: 'daylight' } } as const;
    expect(buildFrame(scene, warm, { ...fixed, alongside: [5, 5, 5] }).white).toEqual(
      buildFrame(scene, warm, fixed).white,
    );
  });

  it('weighs the room light by each mount length, and leaves unbound mounts dark', () => {
    const one = new Map<number, Drive>([[0, tcDrive(1, 0)]]);
    const y = roomLight(scene, one)[1];
    expect(y).toBeCloseTo(900 * 0.35 * 5, 6);
    const elsewhere = new Map<number, Drive>([[9, tcDrive(1, 0)]]);
    expect(roomLight(scene, elsewhere)).toEqual([0, 0, 0]);
  });

  it('is dark, and balanced to daylight, with nothing lit or nothing bound', () => {
    const f = buildFrame(scene, new Map(), { display: 'p3', balance: { mode: 'scene' } });
    expect(f.white).toEqual({ x: 0.3127, y: 0.329 });
    for (const m of f.mounts) {
      expect(m.raw).toEqual([0, 0, 0]);
      expect(m.shown).toEqual([0, 0, 0]);
      expect(m.desaturated).toBe(false);
    }
  });

  it('gives each mount its dot pattern, one row per channel', () => {
    const tables = rippleTables(scene);
    expect(tables).toHaveLength(2);
    expect(tables[0]?.rows).toHaveLength(2);
    expect(tables[1]?.rows).toHaveLength(5);
    expect(tables[0]?.period).toBe(TAPES.A.period);
    // Linear Lux opal is all glow: an even line with a gentle ripple.
    expect(contrast(tables[0]?.rows[0] ?? [])).toBeLessThan(0.6);
    const bare: Scene = {
      ...scene,
      mounts: [mount('a', 'channel', 'left', 5, { diffuser: 'none' })],
    };
    expect(contrast(rippleTables(bare)[0]?.rows[0] ?? [])).toBe(1);
  });

  it('shades a surface as the shader does', () => {
    // 100 lux of D65 on reflectance 0.8 is 25.5 cd/m². At EV 5.4 white is about 50.7, so about half.
    const d65: [number, number, number] = [95.047, 100, 108.883];
    const c = shade(d65, 0.8, 5.4, 'srgb');
    for (const v of c) expect(v).toBeCloseTo(0.735, 2);
    expect(shade([0, 0, 0], 0.8, 0, 'srgb')).toEqual([0, 0, 0]);
    // Far too bright: rolls off below 1 with its hue held.
    const hot = shade([4000, 3000, 500], 0.8, 0, 'srgb');
    expect(Math.max(...hot)).toBeLessThanOrEqual(1);
    expect(hot[0]).toBeGreaterThan(hot[2]);
    // A colour outside the gamut is cut at zero, not wrapped.
    expect(shade([0, 100, 0], 0.8, 5, 'srgb')[0]).toBe(0);
  });
});

describe('the probe', () => {
  const scene = defaultScene();
  const g = buildGeometry(scene);
  const response = solveScene(scene, { maxPatches: 1500 });
  const drives = new Map<number, Drive>([[0, tcDrive(1, 0)]]);
  const frame = buildFrame(scene, drives, { display: 'srgb', balance: { mode: 'scene' } });
  const light = frame.mounts.map((m) => m.raw);

  it('reads lux, luminance and colour on the floor by the skirting slot', () => {
    const r = probe(g, response, light, 0, 2.5, 0.1);
    expect(r.surface).toBe('floor');
    expect(r.lux).toBeGreaterThan(50);
    expect(r.directLux).toBeGreaterThan(0);
    expect(r.directLux).toBeLessThan(r.lux);
    expect(r.luminance).toBeCloseTo((0.5 * r.lux) / Math.PI, 9);
    expect(r.colour?.kelvin).toBeCloseTo(2700, -1);
    expect(Math.abs(r.colour?.duv ?? 1)).toBeLessThan(1e-4);
  });

  it('reads only bounced light where the tape cannot be seen', () => {
    const r = probe(g, response, light, 1, 2.5, 0.6);
    expect(r.surface).toBe('ceiling');
    expect(r.directLux).toBe(0);
    expect(r.lux).toBeGreaterThan(1);
  });

  it('is close to the integrating-sphere estimate for the whole room', () => {
    // optics.md section 1.5: mean illuminance = flux ÷ (area × (1 − mean reflectance)).
    const flux = 900 * 0.35 * 5;
    const area = 2 * (5 * 1.2 + 5 * 2.7 + 1.2 * 2.7);
    const rho = (5 * 1.2 * (0.5 + 0.9) + 2 * (5 * 2.7 + 1.2 * 2.7) * 0.8) / area;
    const estimate = flux / (area * (1 - rho));
    // The ceiling and upper walls sit below that mean, lit only by bounces from a floor of 0.5.
    const ceiling = probe(g, response, light, 1, 2.5, 0.6).lux;
    expect(ceiling).toBeGreaterThan(estimate * 0.1);
    expect(ceiling).toBeLessThan(estimate);
  });

  it('reports no colour in the dark, and nothing for a face that is not there', () => {
    const dark = probe(
      g,
      response,
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      0,
      2.5,
      0.6,
    );
    expect(dark.lux).toBe(0);
    expect(dark.colour).toBeUndefined();
    const none = probe(g, response, light, 99, 0, 0);
    expect(none.lux).toBe(0);
    expect(none.surface).toBe('');
    expect(none.luminance).toBe(0);
  });

  it('reads direct light alone when a layer is missing', () => {
    const noLayers = { ...response, layers: [] };
    const r = probe(g, noLayers, light, 0, 2.5, 0.1);
    expect(r.lux).toBeCloseTo(r.directLux, 9);
  });
});
