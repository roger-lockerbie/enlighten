import { describe, expect, it } from 'vitest';
import { channelsToHue, hueToChannels } from './hue.ts';
import { benchTape, encodeSrgb, previewColour, PREVIEW_WHITE } from './preview.ts';

describe('previewColour', () => {
  const TC = ['WW', 'CW', 'WW', 'CW', 'unused'] as const;
  const RGB = ['R', 'G', 'B', 'WW', 'CW'] as const;

  it('is black with nothing lit', () => {
    expect(previewColour([0, 0, 0, 0, 0], RGB)).toEqual({
      rgb: [0, 0, 0],
      luminance: 0,
      clipped: false,
      desaturated: false,
    });
  });

  it('takes the tape from what the terminals carry', () => {
    expect(benchTape(TC)).toBe('A');
    expect(benchTape(RGB)).toBe('B');
    expect(benchTape([])).toBe('A');
  });

  it('shows tape A at full as the top of the scale, rolled off just under white', () => {
    const c = previewColour([1, 1, 1, 1, 0], TC);
    expect(c.luminance).toBe(PREVIEW_WHITE);
    expect(PREVIEW_WHITE).toBe(1800);
    expect(Math.max(...c.rgb)).toBeGreaterThan(235);
    expect(c.clipped).toBe(true);
  });

  it('keeps warm white warm: more red than blue', () => {
    const c = previewColour([0.5, 0, 0.5, 0, 0], TC);
    expect(c.rgb[0]).toBeGreaterThan(c.rgb[2]);
    expect(c.luminance).toBeCloseTo(450, 9);
    expect(c.desaturated).toBe(false);
  });

  it('keeps both tapes on one scale: tape B at full is dimmer than tape A at full', () => {
    const a = previewColour([1, 1, 1, 1, 0], TC);
    const b = previewColour([1, 1, 1, 1, 1], RGB);
    expect(b.luminance).toBe(1096);
    expect(b.luminance).toBeLessThan(a.luminance);
    const half = previewColour([0.5, 0, 0.5, 0, 0], TC);
    const quarter = previewColour([0.25, 0, 0.25, 0, 0], TC);
    expect(quarter.luminance).toBeCloseTo(half.luminance / 2, 9);
    expect(quarter.rgb[0]).toBeLessThan(half.rgb[0]);
  });

  it('marks a colour the screen cannot show at full saturation, and keeps its hue', () => {
    const blue = previewColour([0, 0, 1, 0, 0], RGB);
    expect(blue.desaturated).toBe(true);
    expect(blue.rgb[2]).toBeGreaterThan(blue.rgb[0]);
    expect(blue.rgb[2]).toBeGreaterThan(blue.rgb[1]);
    expect(Math.min(...blue.rgb)).toBeGreaterThanOrEqual(0);
  });

  it('treats a missing label as unused and clamps drives to 0 to 1', () => {
    expect(previewColour([1], []).luminance).toBe(0);
    expect(previewColour([2], ['CW']).luminance).toBe(900);
    expect(previewColour([-1], ['CW']).luminance).toBe(0);
  });

  it('encodes sRGB at both ends and in the linear toe', () => {
    expect(encodeSrgb(0)).toBe(0);
    expect(encodeSrgb(1)).toBeCloseTo(1);
    expect(encodeSrgb(0.001)).toBeCloseTo(0.01292);
    expect(encodeSrgb(2)).toBeCloseTo(1);
  });
});

describe('hue', () => {
  it('maps the primaries and white', () => {
    expect(hueToChannels(0, 1)).toEqual([254, 0, 0]);
    expect(hueToChannels(120, 1)).toEqual([0, 254, 0]);
    expect(hueToChannels(240, 1)).toEqual([0, 0, 254]);
    expect(hueToChannels(60, 1)).toEqual([254, 254, 0]);
    expect(hueToChannels(180, 1)).toEqual([0, 254, 254]);
    expect(hueToChannels(300, 1)).toEqual([254, 0, 254]);
    expect(hueToChannels(42, 0)).toEqual([254, 254, 254]);
    expect(hueToChannels(-120, 1)).toEqual([0, 0, 254]);
  });

  it('reads hue and saturation back', () => {
    expect(channelsToHue(0, 0, 0)).toEqual({ hue: 0, saturation: 0 });
    expect(channelsToHue(100, 100, 100)).toEqual({ hue: 0, saturation: 0 });
    expect(channelsToHue(0, 0, 254).hue).toBe(240);
    expect(channelsToHue(254, 0, 127).hue).toBeCloseTo(330, 0);
  });
});
