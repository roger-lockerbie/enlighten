/**
 * The bench preview's colour (SPEC R13.6): a 2D estimate of what a tape shows, from the drive on
 * each terminal. It uses the same tape data and colour path as the visualiser (ADR 0008): each
 * channel's flux and chromaticity as XYZ, fitted to the screen, on one scale for both tapes. The
 * data is placeholder and the UI labels it "estimated".
 */
import type { Terminal } from '../sim/profile.ts';
import { toneFactor } from './colour/exposure.ts';
import { mapToGamut } from './colour/gamut.ts';
import type { Vec3 } from './colour/xyz.ts';
import { XYZ_TO_SRGB, encodeSrgb, mul } from './colour/xyz.ts';
import { TAPES, emitted } from './emitter.ts';
import type { TapeId } from './scene.ts';

export { encodeSrgb };

type Rgb = readonly [number, number, number];

/**
 * The flux per metre that shows as display white: tape A with both channels at full. Tape B at
 * its brightest gives about 60% of this, and the preview shows it so.
 */
export const PREVIEW_WHITE = TAPES.A.channels.reduce((a, c) => a + c.flux, 0);

export interface PreviewColour {
  /** Display sRGB, 0 to 255 each. */
  readonly rgb: Rgb;
  /** The tape's output in lumens per metre, with no cover. */
  readonly luminance: number;
  /** True when the colour was brighter than the screen's white and rolled off. */
  readonly clipped: boolean;
  /** True when a channel is more saturated than the screen can show. */
  readonly desaturated: boolean;
}

/** The tape on a bench driver, from what its terminals carry: RGB + CCT is tape B (SPEC R14.1). */
export function benchTape(labels: readonly Terminal[]): TapeId {
  return labels.includes('R') ? 'B' : 'A';
}

/** The preview colour for one tape, from each terminal's drive (0 to 1) and what it carries. */
export function previewColour(
  terminals: readonly number[],
  labels: readonly Terminal[],
  tape: TapeId = benchTape(labels),
): PreviewColour {
  const e = emitted({ terminals, labels }, tape, 'none');
  let sum: Vec3 = [0, 0, 0];
  let desaturated = false;
  for (const c of e.channels) {
    const m = mapToGamut(c, 'srgb');
    desaturated ||= m.moved;
    sum = [sum[0] + m.xyz[0], sum[1] + m.xyz[1], sum[2] + m.xyz[2]];
  }
  const lin = mul(XYZ_TO_SRGB, [
    sum[0] / PREVIEW_WHITE,
    sum[1] / PREVIEW_WHITE,
    sum[2] / PREVIEW_WHITE,
  ]);
  const r = Math.max(0, lin[0]);
  const g = Math.max(0, lin[1]);
  const b = Math.max(0, lin[2]);
  const peak = Math.max(r, g, b);
  // One factor for all three, so a colour too bright for the screen keeps its hue.
  const k = toneFactor(peak);
  const rgb: Rgb = [
    Math.round(encodeSrgb(r * k) * 255),
    Math.round(encodeSrgb(g * k) * 255),
    Math.round(encodeSrgb(b * k) * 255),
  ];
  return { rgb, luminance: e.xyz[1], clipped: peak > 1, desaturated };
}
