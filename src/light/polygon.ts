/**
 * Light from an evenly emitting polygon to a point on a matte surface: Lambert's edge integral
 * (docs/research/rendering.md section 2). One function serves the direct term, the form factors
 * between nearby patches, and the probe. The shader carries a copy, checked against this one.
 *
 * Visibility is by portals (ADR 0017). The room is convex and so is each opening behind a wall, so a
 * point sees a polygon in another cell only through the opening between them. That is a clip of the
 * polygon against the four planes through the point and the opening's edges.
 */
import type { V3 } from './vec.ts';
import { cross, dot, len, sub } from './vec.ts';

/** A rectangle's corners in order. */
export type Quad = readonly [V3, V3, V3, V3];

/** Clip a convex polygon to the side of a plane where dot(normal, x - point) >= 0. */
export function clipPlane(poly: readonly V3[], point: V3, normal: V3): V3[] {
  const out: V3[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    const da = dot(normal, sub(a, point));
    const db = dot(normal, sub(b, point));
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
  }
  return out;
}

/** The part of a polygon a point can see through an opening. */
export function clipPortal(poly: readonly V3[], p: V3, portal: Quad): V3[] {
  const centre: V3 = [
    (portal[0][0] + portal[2][0]) / 2,
    (portal[0][1] + portal[2][1]) / 2,
    (portal[0][2] + portal[2][2]) / 2,
  ];
  const toCentre = sub(centre, p);
  let out: V3[] = [...poly];
  for (let k = 0; k < 4 && out.length > 0; k++) {
    const a = portal[k];
    const b = portal[(k + 1) % 4];
    if (a === undefined || b === undefined) continue;
    let m = cross(sub(a, p), sub(b, p));
    const size = len(m);
    // The point is in line with this edge, so the edge hides nothing.
    if (size < 1e-14) continue;
    if (dot(m, toCentre) < 0) m = [-m[0], -m[1], -m[2]];
    out = clipPlane(out, p, m);
  }
  return out;
}

/**
 * The form factor from a point with normal `n` to a polygon it can see in full: the share of the
 * hemisphere's cosine-weighted view the polygon fills. The polygon must be on the point's side of
 * its surface, which `factor` arranges.
 */
export function edgeIntegral(p: V3, n: V3, poly: readonly V3[]): number {
  const count = poly.length;
  if (count < 3) return 0;
  let sum = 0;
  const last = poly[count - 1];
  if (last === undefined) return 0;
  let ax = last[0] - p[0];
  let ay = last[1] - p[1];
  let az = last[2] - p[2];
  for (let i = 0; i < count; i++) {
    const cur = poly[i];
    if (cur === undefined) return 0;
    const bx = cur[0] - p[0];
    const by = cur[1] - p[1];
    const bz = cur[2] - p[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cl > 1e-300) {
      const angle = Math.atan2(cl, ax * bx + ay * by + az * bz);
      sum += (angle * (cx * n[0] + cy * n[1] + cz * n[2])) / cl;
    }
    ax = bx;
    ay = by;
    az = bz;
  }
  return Math.abs(sum) / (2 * Math.PI);
}

/**
 * The form factor from a point to a polygon, with the polygon cut to what the point's own surface
 * and any openings in the way let it see.
 */
export function factor(p: V3, n: V3, poly: readonly V3[], portals: readonly Quad[] = []): number {
  let seen = clipPlane(poly, p, n);
  for (const portal of portals) {
    if (seen.length < 3) return 0;
    seen = clipPortal(seen, p, portal);
  }
  return edgeIntegral(p, n, seen);
}

/**
 * Illuminance at a point, in lux, from a strip that emits evenly from one face. `emitterNormal` is
 * the way the strip faces, and `exitance` is its flux per unit area in lm/m².
 */
export function illuminance(
  p: V3,
  n: V3,
  emitter: readonly V3[],
  emitterNormal: V3,
  exitance: number,
  portals: readonly Quad[] = [],
): number {
  const first = emitter[0];
  if (first === undefined) return 0;
  // Behind the strip, or in its plane: it gives nothing this way.
  if (dot(emitterNormal, sub(p, first)) <= 1e-12) return 0;
  return exitance * factor(p, n, emitter, portals);
}
