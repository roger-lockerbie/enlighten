/**
 * Radiosity (ADR 0008, docs/research/rendering.md section 3). Solves for the illuminance on each
 * patch, E = E direct + F (ρ E), and keeps only the indirect part: the shader supplies the direct
 * part per pixel.
 *
 * Form factors: far pairs use the point-to-point kernel. Near pairs, and every pair that looks
 * through an opening, use the exact point-to-polygon integral from sample points on each patch.
 * Each pair is made reciprocal by averaging both directions, and the rows are then closed.
 */
import type { Emitter, Face, Geometry } from './geometry.ts';
import { portalsBetween, throughPortal } from './geometry.ts';
import type { Mesh } from './mesh.ts';
import type { Quad } from './polygon.ts';
import { edgeIntegral, factor, illuminance } from './polygon.ts';
import type { V3 } from './vec.ts';

/** Pairs closer than this many patch diagonals use the exact integral. */
const NEAR = 2.5;
/** Pairs closer than this many diagonals sample each patch at four points, not one. */
const VERY_NEAR = 1;

const GAUSS = 0.5 / Math.sqrt(3);
const ONE: readonly (readonly [number, number])[] = [[0.5, 0.5]];
const FOUR: readonly (readonly [number, number])[] = [
  [0.5 - GAUSS, 0.5 - GAUSS],
  [0.5 + GAUSS, 0.5 - GAUSS],
  [0.5 - GAUSS, 0.5 + GAUSS],
  [0.5 + GAUSS, 0.5 + GAUSS],
];
const NINE: readonly (readonly [number, number])[] = [1 / 6, 0.5, 5 / 6].flatMap((a) =>
  [1 / 6, 0.5, 5 / 6].map((b) => [a, b] as const),
);

function corners(mesh: Mesh, faces: readonly Face[], i: number): Quad {
  const f = faces[mesh.face[i] ?? 0];
  if (f === undefined) throw new RangeError('A patch names no face.');
  const a = mesh.s0[i] ?? 0;
  const b = mesh.s1[i] ?? 0;
  const c = mesh.t0[i] ?? 0;
  const d = mesh.t1[i] ?? 0;
  const p = (s: number, t: number): V3 => [
    f.origin[0] + s * f.u[0] + t * f.v[0],
    f.origin[1] + s * f.u[1] + t * f.v[1],
    f.origin[2] + s * f.u[2] + t * f.v[2],
  ];
  return [p(a, c), p(b, c), p(b, d), p(a, d)];
}

function samplePoint(q: Quad, a: number, b: number): V3 {
  const [p0, p1, , p3] = q;
  return [
    p0[0] + a * (p1[0] - p0[0]) + b * (p3[0] - p0[0]),
    p0[1] + a * (p1[1] - p0[1]) + b * (p3[1] - p0[1]),
    p0[2] + a * (p1[2] - p0[2]) + b * (p3[2] - p0[2]),
  ];
}

/** The mean form factor from sample points on one patch to another patch's polygon. */
function patchFactor(
  from: Quad,
  n: V3,
  to: Quad,
  samples: readonly (readonly [number, number])[],
  portals: readonly Quad[],
): number {
  let sum = 0;
  for (const [a, b] of samples) {
    const p = samplePoint(from, a, b);
    sum += portals.length === 0 ? edgeIntegral(p, n, to) : factor(p, n, to, portals);
  }
  return sum / samples.length;
}

/**
 * Area times form factor for a pair, the same number seen from either side. The integral is exact
 * over the patch looked at and sampled over the patch looked from, so when one patch is much the
 * smaller the samples go on it. Otherwise both directions are averaged.
 */
function pairExchange(
  qi: Quad,
  ni: V3,
  ai: number,
  di: number,
  qj: Quad,
  nj: V3,
  aj: number,
  dj: number,
  samples: readonly (readonly [number, number])[],
  portals: readonly Quad[],
): number {
  if (di < dj / 2) return ai * patchFactor(qi, ni, qj, samples, portals);
  if (dj < di / 2) return aj * patchFactor(qj, nj, qi, samples, portals);
  return (
    (ai * patchFactor(qi, ni, qj, samples, portals) +
      aj * patchFactor(qj, nj, qi, samples, portals)) /
    2
  );
}

/**
 * The form factor matrix, row by row: F[i * n + j] is the share of the light leaving patch i that
 * reaches patch j. Reciprocal by construction: area i times F i j equals area j times F j i.
 */
export function formFactors(g: Geometry, mesh: Mesh): Float32Array {
  const n = mesh.count;
  const F = new Float32Array(n * n);
  const faces = g.faces;
  const quads: Quad[] = [];
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    quads.push(corners(mesh, faces, i));
    const w = (mesh.s1[i] ?? 0) - (mesh.s0[i] ?? 0);
    const h = (mesh.t1[i] ?? 0) - (mesh.t0[i] ?? 0);
    diag[i] = Math.sqrt(w * w + h * h);
  }
  const { cx, cy, cz, area, face } = mesh;
  for (let i = 0; i < n; i++) {
    const fi = faces[face[i] ?? 0];
    const qi = quads[i];
    if (fi === undefined || qi === undefined) continue;
    const ni = fi.normal;
    const xi = cx[i] ?? 0;
    const yi = cy[i] ?? 0;
    const zi = cz[i] ?? 0;
    const ai = area[i] ?? 0;
    const di = diag[i] ?? 0;
    for (let j = i + 1; j < n; j++) {
      const fj = faces[face[j] ?? 0];
      if (fj === undefined || fj === fi) continue;
      const nj = fj.normal;
      const dx = (cx[j] ?? 0) - xi;
      const dy = (cy[j] ?? 0) - yi;
      const dz = (cz[j] ?? 0) - zi;
      const ci = dx * ni[0] + dy * ni[1] + dz * ni[2];
      const cj = -(dx * nj[0] + dy * nj[1] + dz * nj[2]);
      const dj = diag[j] ?? 0;
      const reach = (di + dj) / 2;
      // Each patch wholly behind the other's surface: they exchange nothing.
      if (ci <= -reach || cj <= -reach) continue;
      const r2 = dx * dx + dy * dy + dz * dz;
      const aj = area[j] ?? 0;
      const big = Math.max(di, dj);
      let G: number;
      if (fi.cell === fj.cell) {
        if (r2 > NEAR * NEAR * big * big) {
          if (ci <= 0 || cj <= 0) continue;
          G = (ai * aj * ci * cj) / (Math.PI * r2 * r2);
        } else {
          const qj = quads[j];
          if (qj === undefined) continue;
          const samples = r2 < VERY_NEAR * VERY_NEAR * big * big ? FOUR : ONE;
          G = pairExchange(qi, ni, ai, di, qj, nj, aj, dj, samples, []);
        }
      } else {
        const portals = portalsBetween(g, fi.cell, fj.cell);
        const a: V3 = [xi, yi, zi];
        const b: V3 = [cx[j] ?? 0, cy[j] ?? 0, cz[j] ?? 0];
        if (!portals.every((p) => throughPortal(a, b, p, reach))) continue;
        const qj = quads[j];
        if (qj === undefined) continue;
        const samples = r2 < 16 * big * big ? FOUR : ONE;
        G = pairExchange(qi, ni, ai, di, qj, nj, aj, dj, samples, portals);
      }
      if (G > 0) {
        F[i * n + j] = G / ai;
        F[j * n + i] = G / aj;
      }
    }
  }
  close(F, n);
  return F;
}

/**
 * Make every row sum to 1, as it must in a closed scene, without breaking reciprocity. The
 * sampling above leaves rows a few percent out, and a room with pale surfaces multiplies that
 * error by 1 ÷ (1 − ρ). Scaling F i j by d i and d j keeps area times F symmetric, and the d that
 * closes every row is found by repeated square-root steps.
 */
function close(F: Float32Array, n: number): void {
  const d = new Float64Array(n).fill(1);
  const row = new Float64Array(n);
  for (let sweep = 0; sweep < 12; sweep++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const at = i * n;
      for (let j = 0; j < n; j++) sum += (F[at + j] ?? 0) * (d[j] ?? 1);
      row[i] = sum * (d[i] ?? 1);
    }
    for (let i = 0; i < n; i++) {
      const r = row[i] ?? 0;
      if (!(r > 0)) continue;
      worst = Math.max(worst, Math.abs(r - 1));
      d[i] = (d[i] ?? 1) / Math.sqrt(r);
    }
    if (worst < 1e-5) break;
  }
  for (let i = 0; i < n; i++) {
    const at = i * n;
    const di = d[i] ?? 1;
    for (let j = 0; j < n; j++) F[at + j] = (F[at + j] ?? 0) * di * (d[j] ?? 1);
  }
}

/**
 * The mean direct illuminance on each patch from one mount at 1 lm per metre of tape, in lux.
 * Patches near the tape are sampled at nine points, because the light falls off sharply there.
 */
export function directOnPatches(g: Geometry, mesh: Mesh, emitter: Emitter): Float64Array {
  const n = mesh.count;
  const out = new Float64Array(n);
  const exitance = 1 / emitter.width;
  const [e0, , e2] = emitter.corners;
  const mid: V3 = [(e0[0] + e2[0]) / 2, (e0[1] + e2[1]) / 2, (e0[2] + e2[2]) / 2];
  for (let i = 0; i < n; i++) {
    const f = g.faces[mesh.face[i] ?? 0];
    if (f === undefined) continue;
    const q = corners(mesh, g.faces, i);
    const portals = portalsBetween(g, f.cell, emitter.cell);
    // Distance from the patch to the tape's centre line, which runs along x.
    const dy = (mesh.cy[i] ?? 0) - mid[1];
    const dz = (mesh.cz[i] ?? 0) - mid[2];
    const w = (mesh.s1[i] ?? 0) - (mesh.s0[i] ?? 0);
    const h = (mesh.t1[i] ?? 0) - (mesh.t0[i] ?? 0);
    const near = dy * dy + dz * dz < 9 * (w * w + h * h) || portals.length > 0;
    const samples = near ? NINE : ONE;
    let sum = 0;
    for (const [a, b] of samples) {
      const p = samplePoint(q, a, b);
      for (const seg of emitter.segments) {
        sum +=
          seg.weight * illuminance(p, f.normal, seg.corners, emitter.normal, exitance, portals);
      }
    }
    out[i] = sum / samples.length;
  }
  return out;
}

export interface Solved {
  /** Indirect illuminance on each patch, in lux per lm/m. */
  readonly indirect: Float64Array;
  readonly iterations: number;
}

/** Gauss-Seidel on E = E direct + F (ρ E). Converges because every reflectance is under 1. */
export function solve(
  F: Float32Array,
  reflectance: Float64Array,
  direct: Float64Array,
  tolerance = 1e-5,
  maxIterations = 400,
): Solved {
  const n = direct.length;
  const E = Float64Array.from(direct);
  // What each patch sends on: ρ E.
  const B = new Float64Array(n);
  for (let i = 0; i < n; i++) B[i] = (reflectance[i] ?? 0) * (E[i] ?? 0);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, direct[i] ?? 0);
  let iterations = 0;
  if (peak > 0) {
    for (; iterations < maxIterations; iterations++) {
      let change = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        const row = i * n;
        for (let j = 0; j < n; j++) sum += (F[row + j] ?? 0) * (B[j] ?? 0);
        const next = (direct[i] ?? 0) + sum;
        const delta = Math.abs(next - (E[i] ?? 0));
        if (delta > change) change = delta;
        E[i] = next;
        B[i] = (reflectance[i] ?? 0) * next;
      }
      if (change <= tolerance * peak) {
        iterations++;
        break;
      }
    }
  }
  const indirect = new Float64Array(n);
  for (let i = 0; i < n; i++) indirect[i] = (E[i] ?? 0) - (direct[i] ?? 0);
  return { indirect, iterations };
}

/** Each patch's reflectance, from its face. */
export function patchReflectance(g: Geometry, mesh: Mesh): Float64Array {
  const out = new Float64Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) out[i] = g.faces[mesh.face[i] ?? 0]?.reflectance ?? 0;
  return out;
}
