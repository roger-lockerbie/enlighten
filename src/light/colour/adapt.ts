/**
 * White balance (ADR 0008): the light is shown as an eye adapted to a chosen white would see it.
 * A Bradford transform moves that white to the display's D65.
 */
import { cct, locusXy } from './locus.ts';
import type { Mat3, Vec3, Xy } from './xyz.ts';
import { D65, diag, inverse, matMul, mul, xyToXyz, xyzToXy } from './xyz.ts';

export type WhiteBalance =
  | { readonly mode: 'scene' }
  | { readonly mode: 'daylight' }
  | { readonly mode: 'kelvin'; readonly kelvin: number };

/** The limits of "adapted to the scene", and of a chosen colour temperature. */
export const ADAPT_MIN_K = 2000;
export const ADAPT_MAX_K = 10000;

const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const BRADFORD_INVERSE = inverse(BRADFORD);

const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const clampK = (k: number): number => Math.min(ADAPT_MAX_K, Math.max(ADAPT_MIN_K, k));

/**
 * The white the viewer is adapted to. For "scene" it is the point on the black-body locus nearest
 * the room's mixed light, not the mix itself: an eye in a saturated blue room does not come to see
 * it as white (ADR 0017). A dark room reads as daylight.
 */
export function adaptedWhite(balance: WhiteBalance, sceneLight: Vec3): Xy {
  switch (balance.mode) {
    case 'daylight':
      return D65;
    case 'kelvin':
      return locusXy(clampK(balance.kelvin));
    case 'scene':
      if (!(sceneLight[1] > 0)) return D65;
      return locusXy(clampK(cct(xyzToXy(sceneLight)).kelvin));
  }
}

/** The matrix that takes XYZ seen under `white` to XYZ under the display's D65. */
export function adaptation(white: Xy): Mat3 {
  if (white.x === D65.x && white.y === D65.y) return IDENTITY;
  const from = mul(BRADFORD, xyToXyz(white, 1));
  const to = mul(BRADFORD, xyToXyz(D65, 1));
  const gain: Vec3 = [to[0] / from[0], to[1] / from[1], to[2] / from[2]];
  return matMul(BRADFORD_INVERSE, matMul(diag(gain), BRADFORD));
}
