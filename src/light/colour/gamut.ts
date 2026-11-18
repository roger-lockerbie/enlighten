/**
 * Fitting LED colours to a display (docs/research/rendering.md section 5). Each channel's colour
 * is mapped once, on the CPU. A sum of in-gamut colours is in gamut, so nothing is mapped per pixel.
 * Luminance is held, because the viewer is photometric, and the colour moves toward white.
 */
import type { Display, Mat3, Vec3 } from './xyz.ts';
import { D65, displayMatrix, inverse, mul, xyToXyz } from './xyz.ts';

export interface Mapped {
  readonly xyz: Vec3;
  /** True when the colour was outside the display's gamut and had to move. */
  readonly moved: boolean;
}

/** True when a display can show this colour's chromaticity (at some brightness). */
export function inGamut(xyz: Vec3, display: Display, slack = 1e-9): boolean {
  const rgb = mul(displayMatrix(display), xyz);
  const floor = -slack * Math.max(1, Math.abs(xyz[1]));
  return rgb[0] >= floor && rgb[1] >= floor && rgb[2] >= floor;
}

/**
 * Move a colour toward the display's white, at the same luminance, by the least amount that brings
 * it into gamut. Mixing with white is linear in the display's RGB, so the amount has a closed form.
 */
export function mapToGamut(xyz: Vec3, display: Display): Mapped {
  const y = xyz[1];
  if (!(y > 0)) return { xyz: [0, 0, 0], moved: false };
  const m = displayMatrix(display);
  const rgb = mul(m, xyz);
  const white = xyToXyz(D65, y);
  const w = mul(m, white);
  let t = 0;
  for (const k of [0, 1, 2] as const) {
    if (rgb[k] < 0) t = Math.max(t, -rgb[k] / (w[k] - rgb[k]));
  }
  if (t === 0) return { xyz, moved: false };
  // A hair past the edge, so rounding cannot leave a negative component.
  t = Math.min(1, t * (1 + 1e-12) + 1e-12);
  return {
    xyz: [xyz[0] + t * (white[0] - xyz[0]), y, xyz[2] + t * (white[2] - xyz[2])],
    moved: true,
  };
}

// Oklab, from Björn Ottosson's published matrices, as CSS Color 4 uses them.
const XYZ_TO_LMS: Mat3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_LAB: Mat3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ = inverse(XYZ_TO_LMS);
const LAB_TO_LMS = inverse(LMS_TO_LAB);

export function xyzToOklab(xyz: Vec3): Vec3 {
  const lms = mul(XYZ_TO_LMS, xyz);
  return mul(LMS_TO_LAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

export function oklabToXyz(lab: Vec3): Vec3 {
  const l = mul(LAB_TO_LMS, lab);
  return mul(LMS_TO_XYZ, [l[0] ** 3, l[1] ** 3, l[2] ** 3]);
}

/**
 * The CSS Color 4 approach, for interface swatches and as a reference in tests: hold lightness and
 * hue in OkLCh and reduce chroma until the colour fits. It holds perceived lightness, not luminance,
 * so the renderer does not use it.
 */
export function mapToGamutOklch(xyz: Vec3, display: Display): Mapped {
  if (inGamut(xyz, display)) return { xyz, moved: false };
  const lab = xyzToOklab(xyz);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToXyz([lab[0], lab[1] * mid, lab[2] * mid]), display, 0)) lo = mid;
    else hi = mid;
  }
  return { xyz: oklabToXyz([lab[0], lab[1] * lo, lab[2] * lo]), moved: true };
}
