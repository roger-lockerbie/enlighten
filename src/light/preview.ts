/**
 * The bench preview's colour (SPEC R13.6): a 2D estimate of what a tape shows, from the drive on
 * each terminal. Placeholder data, labelled "estimated" in the UI. Each terminal kind has an assumed
 * colour in linear sRGB, scaled so its luminance matches `LUMINANCE_WEIGHT`: each white gives a
 * luminance of 1 at full drive, and red, green and blue together give the same as one white. Stage 7 replaces this with ADR 0008's XYZ path.
 */
import type { Terminal } from '../sim/profile.ts';
import { LUMINANCE_WEIGHT } from '../sim/profile.ts';

type Rgb = readonly [number, number, number];

/** Linear sRGB with a luminance of 1 for each kind of terminal. Assumed, not measured. */
const UNIT_COLOUR: Readonly<Record<Terminal, Rgb>> = {
  R: [1 / 0.2126, 0, 0],
  G: [0, 1 / 0.7152, 0],
  B: [0, 0, 1 / 0.0722],
  // 2700 K, 4000 K and 6500 K on the Planckian locus (Kim et al. cubic fit to xy, then the sRGB
  // matrix), in linear sRGB scaled to a luminance of 1. Which white each terminal carries is assumed.
  WW: unit([1, 0.4173, 0.1]),
  CW: unit([1, 0.9436, 0.9928]),
  W: unit([1, 0.653, 0.377]),
  mono: unit([1, 0.653, 0.377]),
  unused: [0, 0, 0],
};

function unit(c: Rgb): Rgb {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / y, c[1] / y, c[2] / y];
}

/**
 * The luminance that shows as display white. Two white terminals at full drive, so a tape lit to the
 * top of its range reads as full brightness on screen and both tapes share one scale.
 */
export const PREVIEW_WHITE = 2;

export interface PreviewColour {
  /** Display sRGB, 0 to 255 each. */
  readonly rgb: Rgb;
  /** Relative luminance of the tape, in terminal-equivalents at full drive. */
  readonly luminance: number;
  /** True when the colour had to be scaled down to fit the display. */
  readonly clipped: boolean;
}

/** Linear light to the sRGB transfer curve, 0 to 1. */
export function encodeSrgb(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** The preview colour for one tape, from each terminal's drive (0 to 1) and what it carries. */
export function previewColour(
  terminals: readonly number[],
  labels: readonly Terminal[],
): PreviewColour {
  const sum = [0, 0, 0];
  let luminance = 0;
  terminals.forEach((drive, i) => {
    const label = labels[i] ?? 'unused';
    const d = Math.min(1, Math.max(0, drive));
    const y = d * LUMINANCE_WEIGHT[label];
    const c = UNIT_COLOUR[label];
    luminance += y;
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + y * (c[k] ?? 0);
  });
  const lin = sum.map((v) => v / PREVIEW_WHITE);
  // Scale all three together, so a colour too bright for the screen keeps its hue.
  const peak = Math.max(...lin);
  const clipped = peak > 1;
  const scaled = clipped ? lin.map((v) => v / peak) : lin;
  const rgb = scaled.map((v) => Math.round(encodeSrgb(v) * 255)) as unknown as Rgb;
  return { rgb, luminance, clipped };
}
