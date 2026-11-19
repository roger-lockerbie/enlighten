/**
 * CIE XYZ, chromaticity and the display matrices (ADR 0008, docs/research/rendering.md section 5).
 * Light is carried as XYZ with Y in photometric units, and turns into display colour only at the end.
 */

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

/** A CIE 1931 chromaticity. */
export interface Xy {
  readonly x: number;
  readonly y: number;
}

/** The white of both displays, D65. */
export const D65: Xy = { x: 0.3127, y: 0.329 };

/** The displays the renderer can target. */
export type Display = 'srgb' | 'p3';

/** XYZ to linear sRGB, from CSS Color 4's sample code. */
export const XYZ_TO_SRGB: Mat3 = [
  [3.2409699, -1.5373832, -0.4986108],
  [-0.9692436, 1.8759675, 0.0415551],
  [0.0556301, -0.203977, 1.0569715],
];

/** XYZ to linear Display P3, from CSS Color 4's sample code. */
export const XYZ_TO_P3: Mat3 = [
  [2.4934969, -0.9313836, -0.4027108],
  [-0.829489, 1.7626641, 0.0236247],
  [0.0358458, -0.0761724, 0.9568845],
];

/** The primaries of each display, for tests and for the note on what a screen can show. */
export const PRIMARIES: Readonly<Record<Display, readonly [Xy, Xy, Xy]>> = {
  srgb: [
    { x: 0.64, y: 0.33 },
    { x: 0.3, y: 0.6 },
    { x: 0.15, y: 0.06 },
  ],
  p3: [
    { x: 0.68, y: 0.32 },
    { x: 0.265, y: 0.69 },
    { x: 0.15, y: 0.06 },
  ],
};

export function mul(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const col = (j: 0 | 1 | 2): Vec3 => mul(a, [b[0][j], b[1][j], b[2][j]]);
  const c0 = col(0);
  const c1 = col(1);
  const c2 = col(2);
  return [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ];
}

/** The inverse of a 3 by 3 matrix. Throws on a singular one, which no matrix here is. */
export function inverse(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new RangeError('Singular matrix.');
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export function diag(v: Vec3): Mat3 {
  return [
    [v[0], 0, 0],
    [0, v[1], 0],
    [0, 0, v[2]],
  ];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** The matrix from XYZ to a display's linear RGB. */
export function displayMatrix(display: Display): Mat3 {
  return display === 'p3' ? XYZ_TO_P3 : XYZ_TO_SRGB;
}

/** XYZ for a chromaticity and a luminous quantity Y. A chromaticity with no y gives black. */
export function xyToXyz(c: Xy, Y: number): Vec3 {
  if (!(c.y > 0)) return [0, 0, 0];
  return [(Y * c.x) / c.y, Y, (Y * (1 - c.x - c.y)) / c.y];
}

/** The chromaticity of an XYZ. Black has none, and reads as D65. */
export function xyzToXy(v: Vec3): Xy {
  const sum = v[0] + v[1] + v[2];
  if (!(sum > 0)) return D65;
  return { x: v[0] / sum, y: v[1] / sum };
}

/** Linear light to the sRGB transfer curve, which Display P3 shares. Clamped to 0 to 1. */
export function encodeSrgb(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** The sRGB transfer curve back to linear light. */
export function decodeSrgb(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
