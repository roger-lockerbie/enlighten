/**
 * A scene as surfaces: the six faces of the hallway, the five inside faces of each opening behind
 * a wall, the opening itself as a portal, and each mount's emitting strip. Cell 0 is the room, and
 * each opening is a cell of its own. Every cell is convex, which is what makes portals exact.
 */
import type { Quad } from './polygon.ts';
import type { Mount, Scene } from './scene.ts';
import { sharesPocket, span } from './scene.ts';
import type { V3 } from './vec.ts';
import { at } from './vec.ts';

export type Material = 'ceiling' | 'walls' | 'floor' | 'open';

/** A rectangle cut from a face, in the face's own coordinates: an opening in a wall. */
export interface Hole {
  readonly s0: number;
  readonly s1: number;
  readonly t0: number;
  readonly t1: number;
}

export interface Face {
  readonly index: number;
  readonly name: string;
  readonly cell: number;
  readonly origin: V3;
  /** Unit axes. A point on the face is origin + s u + t v, with s in 0 to su and t in 0 to sv. */
  readonly u: V3;
  readonly v: V3;
  readonly su: number;
  readonly sv: number;
  /** Points into the face's cell. */
  readonly normal: V3;
  readonly material: Material;
  readonly reflectance: number;
  readonly holes: readonly Hole[];
}

export interface Segment {
  readonly corners: Quad;
  /** Output relative to the feed end of the tape. */
  readonly weight: number;
}

export interface Emitter {
  readonly mount: number;
  readonly cell: number;
  /** The way the strip faces. */
  readonly normal: V3;
  readonly corners: Quad;
  /** The strip in pieces along its length, each even. One piece unless the mount has a gradient. */
  readonly segments: readonly Segment[];
  readonly width: number;
  readonly length: number;
}

export interface Geometry {
  readonly scene: Scene;
  readonly faces: readonly Face[];
  /** The opening of cell k is portals[k - 1]. */
  readonly portals: readonly Quad[];
  readonly emitters: readonly Emitter[];
  /** For each mount, the cell its tape sits in. */
  readonly cellOf: readonly number[];
}

/** Pieces a tape with a gradient is cut into. */
export const GRADIENT_SEGMENTS = 4;

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
const Z: V3 = [0, 0, 1];
/** The opposite direction, without negative zeros. */
const neg = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];

export function buildGeometry(scene: Scene): Geometry {
  const { length: L, width: W, height: H } = scene;
  const rho = scene.reflectance;
  const endMaterial: Material = scene.endWalls === 'open' ? 'open' : 'walls';
  const endRho = scene.endWalls === 'open' ? 0 : rho.walls;
  const faces: Face[] = [];
  const holes: Record<'left' | 'right', Hole[]> = { left: [], right: [] };
  const portals: Quad[] = [];
  const pocketMounts: Mount[] = [];
  const cellOf: number[] = [];

  for (const m of scene.mounts) {
    if (m.kind === 'channel') {
      cellOf.push(0);
      continue;
    }
    const existing = pocketMounts.findIndex((p) => sharesPocket(p, m));
    if (existing >= 0) {
      cellOf.push(existing + 1);
      continue;
    }
    pocketMounts.push(m);
    cellOf.push(pocketMounts.length);
    const sp = span(m);
    holes[m.side].push({ s0: sp.x0, s1: sp.x1, t0: sp.y0, t1: sp.y1 });
  }

  const push = (f: Omit<Face, 'index'>): void => {
    faces.push({ ...f, index: faces.length });
  };
  const room = (
    name: string,
    origin: V3,
    u: V3,
    v: V3,
    su: number,
    sv: number,
    normal: V3,
    material: Material,
    reflectance: number,
    cut: readonly Hole[] = [],
  ): void => {
    push({ name, cell: 0, origin, u, v, su, sv, normal, material, reflectance, holes: cut });
  };
  room('floor', [0, 0, 0], X, Z, L, W, Y, 'floor', rho.floor);
  room('ceiling', [0, H, 0], X, Z, L, W, neg(Y), 'ceiling', rho.ceiling);
  room('left', [0, 0, 0], X, Y, L, H, Z, 'walls', rho.walls, holes.left);
  room('right', [0, 0, W], X, Y, L, H, neg(Z), 'walls', rho.walls, holes.right);
  room('end0', [0, 0, 0], Z, Y, W, H, X, endMaterial, endRho);
  room('end1', [L, 0, 0], Z, Y, W, H, neg(X), endMaterial, endRho);

  pocketMounts.forEach((m, k) => {
    const cell = k + 1;
    const sp = span(m);
    const zw = m.side === 'left' ? 0 : W;
    const into: V3 = m.side === 'left' ? neg(Z) : Z;
    const D = m.slotDepth;
    const lx = sp.x1 - sp.x0;
    const ly = sp.y1 - sp.y0;
    const base = { cell, holes: [] as Hole[] };
    const name = (part: string): string => `${m.id}.${part}`;
    const bottomMaterial: Material = m.kind === 'skirting' ? 'floor' : 'walls';
    const bottomRho = m.kind === 'skirting' ? rho.floor : rho.walls;
    push({
      ...base,
      name: name('back'),
      origin: [sp.x0, sp.y0, zw + into[2] * D],
      u: X,
      v: Y,
      su: lx,
      sv: ly,
      normal: neg(into),
      material: 'walls',
      reflectance: rho.walls,
    });
    push({
      ...base,
      name: name('bottom'),
      origin: [sp.x0, sp.y0, zw],
      u: X,
      v: into,
      su: lx,
      sv: D,
      normal: Y,
      material: bottomMaterial,
      reflectance: bottomRho,
    });
    push({
      ...base,
      name: name('top'),
      origin: [sp.x0, sp.y1, zw],
      u: X,
      v: into,
      su: lx,
      sv: D,
      normal: neg(Y),
      material: 'walls',
      reflectance: rho.walls,
    });
    push({
      ...base,
      name: name('end0'),
      origin: [sp.x0, sp.y0, zw],
      u: into,
      v: Y,
      su: D,
      sv: ly,
      normal: X,
      material: 'walls',
      reflectance: rho.walls,
    });
    push({
      ...base,
      name: name('end1'),
      origin: [sp.x1, sp.y0, zw],
      u: into,
      v: Y,
      su: D,
      sv: ly,
      normal: neg(X),
      material: 'walls',
      reflectance: rho.walls,
    });
    portals.push([
      [sp.x0, sp.y0, zw],
      [sp.x1, sp.y0, zw],
      [sp.x1, sp.y1, zw],
      [sp.x0, sp.y1, zw],
    ]);
  });

  const emitters = scene.mounts.map((m, i): Emitter => {
    const zw = m.side === 'left' ? 0 : W;
    const dir = m.side === 'left' ? -1 : 1;
    const x0 = m.start;
    const x1 = m.start + m.length;
    const half = m.aperture / 2;
    let quad: (a: number, b: number) => Quad;
    let normal: V3;
    if (m.kind === 'channel') {
      normal = [0, 0, -dir];
      quad = (a, b) => [
        [a, m.height - half, zw],
        [b, m.height - half, zw],
        [b, m.height + half, zw],
        [a, m.height + half, zw],
      ];
    } else {
      const sp = span(m);
      const up = m.kind === 'reveal' && m.facing === 'up';
      const y = up ? sp.y0 : sp.y1;
      const zc = zw + dir * m.setback;
      normal = up ? Y : neg(Y);
      quad = (a, b) => [
        [a, y, zc - half],
        [b, y, zc - half],
        [b, y, zc + half],
        [a, y, zc + half],
      ];
    }
    const pieces = m.gradient > 0 ? GRADIENT_SEGMENTS : 1;
    const segments: Segment[] = [];
    for (let s = 0; s < pieces; s++) {
      const a = x0 + ((x1 - x0) * s) / pieces;
      const b = x0 + ((x1 - x0) * (s + 1)) / pieces;
      segments.push({ corners: quad(a, b), weight: 1 - (m.gradient * (s + 0.5)) / pieces });
    }
    return {
      mount: i,
      cell: cellOf[i] ?? 0,
      normal,
      corners: quad(x0, x1),
      segments,
      width: m.aperture,
      length: m.length,
    };
  });

  return { scene, faces, portals, emitters, cellOf };
}

/** The openings a path between two cells passes through. */
export function portalsBetween(g: Geometry, a: number, b: number): Quad[] {
  if (a === b) return [];
  const out: Quad[] = [];
  for (const cell of [a, b]) {
    const portal = cell > 0 ? g.portals[cell - 1] : undefined;
    if (portal !== undefined) out.push(portal);
  }
  return out;
}

/** True when a point on a face, in the face's coordinates, falls in one of its openings. */
export function inHole(f: Face, s: number, t: number): boolean {
  return f.holes.some((h) => s > h.s0 && s < h.s1 && t > h.t0 && t < h.t1);
}

export const facePoint = (f: Face, s: number, t: number): V3 => at(f.origin, f.u, f.v, s, t);

export interface Hit {
  readonly face: number;
  readonly s: number;
  readonly t: number;
  readonly distance: number;
  readonly point: V3;
}

/**
 * The first surface a ray meets. A ray through a wall's opening carries on into the opening. Rays
 * start inside the room, where the camera is.
 */
export function pick(g: Geometry, origin: V3, direction: V3): Hit | undefined {
  let best: Hit | undefined;
  for (const f of g.faces) {
    const denom =
      direction[0] * f.normal[0] + direction[1] * f.normal[1] + direction[2] * f.normal[2];
    // Faces are seen from the side their normal points to.
    if (denom >= -1e-12) continue;
    const ox = f.origin[0] - origin[0];
    const oy = f.origin[1] - origin[1];
    const oz = f.origin[2] - origin[2];
    const distance = (ox * f.normal[0] + oy * f.normal[1] + oz * f.normal[2]) / denom;
    if (!(distance > 1e-9) || (best !== undefined && distance >= best.distance)) continue;
    const point: V3 = [
      origin[0] + distance * direction[0],
      origin[1] + distance * direction[1],
      origin[2] + distance * direction[2],
    ];
    const rx = point[0] - f.origin[0];
    const ry = point[1] - f.origin[1];
    const rz = point[2] - f.origin[2];
    const s = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
    const t = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
    if (s < 0 || s > f.su || t < 0 || t > f.sv || inHole(f, s, t)) continue;
    if (f.cell > 0) {
      // A face inside an opening is seen only through that opening.
      const portal = g.portals[f.cell - 1];
      if (portal === undefined || !throughPortal(origin, point, portal)) continue;
    }
    best = { face: f.index, s, t, distance, point };
  }
  return best;
}

/** True when the segment from a to b crosses the opening. Openings lie in planes of constant z. */
export function throughPortal(a: V3, b: V3, portal: Quad, margin = 0): boolean {
  const zw = portal[0][2];
  const da = a[2] - zw;
  const db = b[2] - zw;
  if (da === db) return false;
  const k = da / (da - db);
  if (k < 0 || k > 1) return false;
  const x = a[0] + k * (b[0] - a[0]);
  const y = a[1] + k * (b[1] - a[1]);
  return (
    x >= portal[0][0] - margin &&
    x <= portal[2][0] + margin &&
    y >= portal[0][1] - margin &&
    y <= portal[2][1] + margin
  );
}

/** The face a surface point lies on, given the way that surface faces, with its face coordinates. */
export function faceAt(
  g: Geometry,
  point: V3,
  normal: V3,
): { readonly face: Face; readonly s: number; readonly t: number } | undefined {
  for (const f of g.faces) {
    if (
      Math.abs(f.normal[0] - normal[0]) > 1e-9 ||
      Math.abs(f.normal[1] - normal[1]) > 1e-9 ||
      Math.abs(f.normal[2] - normal[2]) > 1e-9
    ) {
      continue;
    }
    const rx = point[0] - f.origin[0];
    const ry = point[1] - f.origin[1];
    const rz = point[2] - f.origin[2];
    if (Math.abs(rx * f.normal[0] + ry * f.normal[1] + rz * f.normal[2]) > 1e-9) continue;
    const s = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
    const t = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
    if (s < -1e-9 || s > f.su + 1e-9 || t < -1e-9 || t > f.sv + 1e-9 || inHole(f, s, t)) continue;
    return { face: f, s, t };
  }
  return undefined;
}
