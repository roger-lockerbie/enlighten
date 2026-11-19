/** Small vector helpers for the light core. Metres, x along the hallway, y up, z across it. */

export type V3 = readonly [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mulS = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.sqrt(dot(a, a));

/** A point on a rectangle: origin + s u + t v. */
export const at = (origin: V3, u: V3, v: V3, s: number, t: number): V3 => [
  origin[0] + s * u[0] + t * v[0],
  origin[1] + s * u[1] + t * v[1],
  origin[2] + s * u[2] + t * v[2],
];
