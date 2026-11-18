/**
 * The radiosity mesh (docs/research/rendering.md section 3): each face is a grid of rectangles,
 * coarse where indirect light is smooth and fine beside the mounts, where it is not. Grid lines run
 * the whole face, so a value anywhere on a face is a bilinear blend of patch centres.
 */
import type { Face, Geometry } from './geometry.ts';
import { inHole } from './geometry.ts';
import type { Mount } from './scene.ts';
import { span } from './scene.ts';

/** The dense form factor matrix grows with the square of this (100 MB at 5,000). */
export const MAX_PATCHES = 5000;

/** Patch sizes before any coarsening, in metres. */
export const STEP_ALONG = 0.25;
export const STEP_BASE = 0.15;
const FINE: readonly { readonly within: number; readonly step: number }[] = [
  { within: 0.05, step: 0.0125 },
  { within: 0.15, step: 0.025 },
  { within: 0.3, step: 0.05 },
];
/** Cells across each inside face of an opening. */
const POCKET_CELLS = 4;

export interface Grid {
  readonly face: number;
  /** Grid lines along the face's u and v, from 0 to the face's size. */
  readonly s: readonly number[];
  readonly t: readonly number[];
  /** The patch in each cell, row by row along t, or -1 for a cell in an opening. */
  readonly cells: Int32Array;
}

export interface Mesh {
  readonly count: number;
  readonly grids: readonly Grid[];
  /** Per patch: its face, centre, area and extent on the face. */
  readonly face: Int32Array;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly cz: Float64Array;
  readonly area: Float64Array;
  readonly s0: Float64Array;
  readonly s1: Float64Array;
  readonly t0: Float64Array;
  readonly t1: Float64Array;
  /** How far the step sizes were stretched to stay under the cap. 1 is not at all. */
  readonly coarsening: number;
}

interface Zone {
  /** The stretch of the axis the mount covers. Steps are fine near it. */
  readonly from: number;
  readonly to: number;
}

/** Grid lines from 0 to `size`, stepping by what `stepAt` gives, and landing on each forced line. */
export function lines(
  size: number,
  stepAt: (pos: number) => number,
  forced: readonly number[],
): number[] {
  const marks = [...new Set(forced.filter((f) => f > 1e-9 && f < size - 1e-9))].sort(
    (a, b) => a - b,
  );
  const out = [0];
  let pos = 0;
  while (pos < size - 1e-9) {
    const step = stepAt(pos + 1e-9);
    let next = pos + step;
    const mark = marks.find((m) => m > pos + 1e-9);
    if (mark !== undefined && next > mark - step * 0.25) next = mark;
    if (next > size - step * 0.25) next = size;
    out.push(next);
    pos = next;
  }
  return out;
}

function stepNear(pos: number, zones: readonly Zone[], base: number, k: number): number {
  let step = base;
  for (const z of zones) {
    const d = pos < z.from ? z.from - pos : pos > z.to ? pos - z.to : 0;
    for (const f of FINE) {
      if (d <= f.within) {
        step = Math.min(step, f.step * k);
        break;
      }
    }
  }
  return step;
}

function zoneMarks(zones: readonly Zone[], size: number): number[] {
  const out: number[] = [];
  for (const z of zones) {
    out.push(z.from, z.to);
    for (const f of FINE) out.push(z.from - f.within, z.to + f.within);
  }
  return out.filter((v) => v > 0 && v < size);
}

/** The fine zones along the across-the-hall axis of a room face. */
function zonesFor(f: Face, mounts: readonly Mount[], width: number, height: number): Zone[] {
  const zones: Zone[] = [];
  // A mount this close to the floor or ceiling throws a sharp edge of bounced light onto it.
  const reach = 0.6;
  for (const m of mounts) {
    const sp = span(m);
    if (f.name === 'left' || f.name === 'right') {
      if (f.name === m.side) zones.push({ from: sp.y0, to: sp.y1 });
    } else if (f.name === 'floor' || f.name === 'ceiling') {
      const gap = f.name === 'floor' ? sp.y0 : height - sp.y1;
      if (gap < reach) {
        const z = m.side === 'left' ? 0 : width;
        zones.push({ from: z, to: z });
      }
    }
  }
  return zones;
}

function gridFor(f: Face, g: Geometry, k: number): { s: number[]; t: number[] } {
  const scene = g.scene;
  if (f.cell === 0) {
    const zones = zonesFor(f, scene.mounts, scene.width, scene.height);
    const acrossStep = (pos: number): number => stepNear(pos, zones, STEP_BASE * k, k);
    const acrossMarks = zoneMarks(zones, f.sv);
    if (f.name === 'end0' || f.name === 'end1') {
      const base = (): number => STEP_BASE * k;
      return { s: lines(f.su, base, []), t: lines(f.sv, base, []) };
    }
    const along = scene.mounts.flatMap((m) => [m.start, m.start + m.length]);
    return {
      s: lines(f.su, () => STEP_ALONG * k, along),
      t: lines(f.sv, acrossStep, acrossMarks),
    };
  }
  // Inside an opening: a few cells across, and the hallway's step along it.
  const even = (size: number): number[] =>
    Array.from({ length: POCKET_CELLS + 1 }, (_, i) => (size * i) / POCKET_CELLS);
  const long = f.u[0] !== 0;
  return {
    s: long ? lines(f.su, () => STEP_ALONG * k, []) : even(f.su),
    t: even(f.sv),
  };
}

function build(g: Geometry, k: number): Mesh {
  const grids: Grid[] = [];
  const face: number[] = [];
  const cx: number[] = [];
  const cy: number[] = [];
  const cz: number[] = [];
  const area: number[] = [];
  const s0: number[] = [];
  const s1: number[] = [];
  const t0: number[] = [];
  const t1: number[] = [];
  for (const f of g.faces) {
    const { s, t } = gridFor(f, g, k);
    // An opening's edges are grid lines of its wall, so no patch straddles one.
    const sl =
      f.holes.length > 0
        ? merge(
            s,
            f.holes.flatMap((h) => [h.s0, h.s1]),
            f.su,
          )
        : s;
    const tl =
      f.holes.length > 0
        ? merge(
            t,
            f.holes.flatMap((h) => [h.t0, h.t1]),
            f.sv,
          )
        : t;
    const cells = new Int32Array((sl.length - 1) * (tl.length - 1)).fill(-1);
    for (let j = 0; j < tl.length - 1; j++) {
      for (let i = 0; i < sl.length - 1; i++) {
        const a = sl[i] ?? 0;
        const b = sl[i + 1] ?? 0;
        const c = tl[j] ?? 0;
        const d = tl[j + 1] ?? 0;
        const ms = (a + b) / 2;
        const mt = (c + d) / 2;
        if (inHole(f, ms, mt)) continue;
        cells[j * (sl.length - 1) + i] = face.length;
        face.push(f.index);
        cx.push(f.origin[0] + ms * f.u[0] + mt * f.v[0]);
        cy.push(f.origin[1] + ms * f.u[1] + mt * f.v[1]);
        cz.push(f.origin[2] + ms * f.u[2] + mt * f.v[2]);
        area.push((b - a) * (d - c));
        s0.push(a);
        s1.push(b);
        t0.push(c);
        t1.push(d);
      }
    }
    grids.push({ face: f.index, s: sl, t: tl, cells });
  }
  return {
    count: face.length,
    grids,
    face: Int32Array.from(face),
    cx: Float64Array.from(cx),
    cy: Float64Array.from(cy),
    cz: Float64Array.from(cz),
    area: Float64Array.from(area),
    s0: Float64Array.from(s0),
    s1: Float64Array.from(s1),
    t0: Float64Array.from(t0),
    t1: Float64Array.from(t1),
    coarsening: k,
  };
}

/** Add lines to a sorted set, dropping any that would leave a sliver. */
function merge(base: readonly number[], extra: readonly number[], size: number): number[] {
  const out = [...base];
  for (const e of extra) {
    if (e <= 1e-9 || e >= size - 1e-9) continue;
    const near = out.findIndex((v) => Math.abs(v - e) < 0.004);
    if (near >= 0) {
      // Move the nearby line onto the edge, unless it is the face's own border.
      if (near !== 0 && near !== out.length - 1) out[near] = e;
      else out.push(e);
    } else out.push(e);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The mesh for a scene, coarsened in steps until it fits under the cap. */
export function buildMesh(g: Geometry, cap = MAX_PATCHES): Mesh {
  let k = 1;
  for (;;) {
    const mesh = build(g, k);
    if (mesh.count <= cap || k > 8) return mesh;
    k *= 1.15;
  }
}
