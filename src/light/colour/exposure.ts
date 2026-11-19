/**
 * Fixed exposure and the tone curve (ADR 0008). Exposure never adapts by itself: automatic exposure
 * would hide the dimming this tool exists to show.
 */
import type { Vec3 } from './xyz.ts';

export type ExposurePreset = 'night' | 'evening' | 'day';

/** EV100 for each preset. Starting points of ours, not sourced (rendering.md section 5). */
export const PRESET_EV: Readonly<Record<ExposurePreset, number>> = {
  night: 0,
  evening: 4,
  day: 7,
};

/** The range of the manual setting. */
export const EV_MIN = -4;
export const EV_MAX = 12;

export const clampEv = (ev: number): number =>
  Number.isFinite(ev) ? Math.min(EV_MAX, Math.max(EV_MIN, ev)) : PRESET_EV.evening;

/** The luminance, in cd/m², that shows as display white: the photographic 1.2 × 2^EV100. */
export function whiteLuminance(ev: number): number {
  return 1.2 * Math.pow(2, ev);
}

/** Where the tone curve leaves the straight line, as a fraction of display white. */
export const SHOULDER = 0.8;

/**
 * The factor that brings a linear display colour inside 0 to 1. It is 1 up to the shoulder. Above
 * that the largest channel rolls off toward 1, and all three are scaled alike, so hue holds.
 */
export function toneFactor(peak: number): number {
  if (!(peak > SHOULDER)) return 1;
  const room = 1 - SHOULDER;
  const mapped = SHOULDER + room * (1 - Math.exp(-(peak - SHOULDER) / room));
  return mapped / peak;
}

/** A linear display colour after the tone curve. Negative components are cut to 0. */
export function tone(rgb: Vec3): Vec3 {
  const r = Math.max(0, rgb[0]);
  const g = Math.max(0, rgb[1]);
  const b = Math.max(0, rgb[2]);
  const k = toneFactor(Math.max(r, g, b));
  return [r * k, g * k, b * k];
}

/** Luminance of a matte surface, in cd/m², from the illuminance on it in lux. */
export function matteLuminance(reflectance: number, lux: number): number {
  return (reflectance * lux) / Math.PI;
}
