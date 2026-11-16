import { describe, expect, it } from 'vitest';
import { channelsToHue, hueToChannels } from './hue.ts';
import { encodeSrgb, previewColour, PREVIEW_WHITE } from './preview.ts';

describe('previewColour', () => {
  it('is black with nothing lit', () => {
    expect(previewColour([0, 0, 0, 0, 0], ['R', 'G', 'B', 'WW', 'CW'])).toEqual({
      rgb: [0, 0, 0],
      luminance: 0,
      clipped: false,
    });
  });

  it('shows two cool whites at full as near display white', () => {
    const c = previewColour([1, 1], ['CW', 'CW']);
    expect(c.luminance).toBe(PREVIEW_WHITE);
    expect(Math.max(...c.rgb)).toBe(255);
    expect(Math.min(...c.rgb)).toBeGreaterThan(240);
  });

  it('keeps warm white warm: more red than blue', () => {
    const c = previewColour([0.5, 0, 0.5, 0, 0], ['WW', 'CW', 'WW', 'CW', 'unused']);
    expect(c.rgb[0]).toBeGreaterThan(c.rgb[2]);
  });

  it('keeps both tapes on one scale: half the drive is half the luminance', () => {
    const full = previewColour([1, 0], ['WW', 'CW']);
    const half = previewColour([0.5, 0], ['WW', 'CW']);
    expect(half.luminance).toBeCloseTo(full.luminance / 2);
    expect(half.rgb[0]).toBeLessThan(full.rgb[0]);
  });

  it('scales a colour too bright for the screen down as a whole, keeping its hue', () => {
    const c = previewColour([1, 1, 1, 1, 1], ['R', 'G', 'B', 'WW', 'CW']);
    expect(c.clipped).toBe(true);
    expect(Math.max(...c.rgb)).toBe(255);
  });

  it('treats a missing label as unused and clamps drives to 0 to 1', () => {
    expect(previewColour([1], []).luminance).toBe(0);
    expect(previewColour([2], ['CW']).luminance).toBe(1);
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
