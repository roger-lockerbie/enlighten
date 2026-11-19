/**
 * The false-colour view (ADR 0008), after Radiance's falsecolor: the logarithm of illuminance or
 * luminance through a palette, three decades by default, with a legend.
 */
import type { Vec3 } from './xyz.ts';

export type FalseQuantity = 'illuminance' | 'luminance';

export interface FalseScale {
  readonly quantity: FalseQuantity;
  /** The value at the bottom of the scale: lux, or cd/m². */
  readonly min: number;
  readonly decades: number;
}

export const DEFAULT_FALSE_SCALE: FalseScale = { quantity: 'illuminance', min: 1, decades: 3 };

/** Palette stops as display colours (encoded, 0 to 1), evenly spaced from the bottom of the scale. */
export const PALETTE: readonly Vec3[] = [
  [0.05, 0.03, 0.2],
  [0.1, 0.25, 0.75],
  [0.0, 0.65, 0.75],
  [0.2, 0.75, 0.25],
  [0.95, 0.85, 0.15],
  [0.95, 0.35, 0.1],
  [1.0, 0.95, 0.95],
];

/** Where a value sits on the scale, 0 to 1. Zero and below sit at the bottom. */
export function falsePosition(value: number, s: FalseScale): number {
  if (!(value > 0)) return 0;
  return Math.min(1, Math.max(0, Math.log10(value / s.min) / s.decades));
}

/** The palette colour at a position 0 to 1. */
export function paletteAt(t: number): Vec3 {
  const x = Math.min(1, Math.max(0, t)) * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(x));
  const f = x - i;
  const a = PALETTE[i] ?? [0, 0, 0];
  const b = PALETTE[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export interface Tick {
  readonly value: number;
  readonly position: number;
}

/** Legend ticks at 1, 2 and 5 in each decade, and at the top. */
export function ticks(s: FalseScale): Tick[] {
  const out: Tick[] = [];
  for (let d = 0; d < s.decades; d++) {
    for (const k of [1, 2, 5]) {
      const value = s.min * k * 10 ** d;
      out.push({ value, position: falsePosition(value, s) });
    }
  }
  out.push({ value: s.min * 10 ** s.decades, position: 1 });
  return out;
}
