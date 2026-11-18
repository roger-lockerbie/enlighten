/**
 * The lightmap: every face gets a rectangle of texels in one image, and each mount's indirect light
 * is one layer of that image. Values come from the patch centres by bilinear blending, so the
 * picture shows no patch edges.
 */
import type { Face, Geometry } from './geometry.ts';
import type { Grid, Mesh } from './mesh.ts';

/** Texel sizes in metres: coarse along the hallway, where light changes slowly, and fine across. */
export const TEXEL_ALONG = 0.1;
export const TEXEL_ACROSS = 0.0125;
/** The end walls carry no mounts, so their light is smooth both ways. */
export const TEXEL_END = 0.05;
/** Texels across each inside face of an opening. */
const POCKET_TEXELS = 8;
/** One texel of border around each face, a copy of its edge, so filtering never reads a neighbour. */
const PAD = 1;
const ATLAS_WIDTH = 256;
export const MAX_ATLAS_HEIGHT = 1024;

export interface AtlasRect {
  readonly face: number;
  /** The inner rectangle, in texels, not counting the border. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Atlas {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly AtlasRect[];
}

function texels(f: Face): { w: number; h: number } {
  const size = (length: number, along: boolean): number => {
    if (f.cell > 0 && !along) return POCKET_TEXELS;
    if (f.cell === 0 && f.normal[0] !== 0) return Math.max(2, Math.ceil(length / TEXEL_END));
    return Math.max(2, Math.ceil(length / (along ? TEXEL_ALONG : TEXEL_ACROSS)));
  };
  return { w: size(f.su, f.u[0] !== 0), h: size(f.sv, f.v[0] !== 0) };
}

/** Lay the faces out in rows. */
export function layout(g: Geometry): Atlas {
  const rects: AtlasRect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const f of g.faces) {
    const { w, h } = texels(f);
    const fw = Math.min(w, ATLAS_WIDTH - 2 * PAD);
    if (x + fw + 2 * PAD > ATLAS_WIDTH) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    rects.push({ face: f.index, x: x + PAD, y: y + PAD, w: fw, h });
    x += fw + 2 * PAD;
    rowHeight = Math.max(rowHeight, h + 2 * PAD);
  }
  const height = y + rowHeight;
  if (height > MAX_ATLAS_HEIGHT) throw new RangeError('The lightmap is too large.');
  return { width: ATLAS_WIDTH, height, rects };
}

/** Patch-centre values on one face's grid, with cells in an opening filled from their neighbours. */
function faceValues(grid: Grid, values: Float64Array): Float64Array {
  const cols = grid.s.length - 1;
  const rows = grid.t.length - 1;
  const out = new Float64Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      let patch = grid.cells[j * cols + i] ?? -1;
      // A cell in an opening takes the nearest real cell in its column, so the wall beside the
      // opening is not darkened by a zero.
      for (let d = 1; patch < 0 && d < rows; d++) {
        const below = j - d >= 0 ? (grid.cells[(j - d) * cols + i] ?? -1) : -1;
        const above = j + d < rows ? (grid.cells[(j + d) * cols + i] ?? -1) : -1;
        patch = below >= 0 ? below : above;
      }
      out[j * cols + i] = patch >= 0 ? (values[patch] ?? 0) : 0;
    }
  }
  return out;
}

/** The cell-centre interval a position falls in, and how far along it, clamped at the ends. */
function locate(linesAt: readonly number[], pos: number): { i: number; f: number } {
  const cells = linesAt.length - 1;
  const centre = (k: number): number => ((linesAt[k] ?? 0) + (linesAt[k + 1] ?? 0)) / 2;
  if (cells <= 1 || pos <= centre(0)) return { i: 0, f: 0 };
  if (pos >= centre(cells - 1)) return { i: cells - 1, f: 0 };
  let lo = 0;
  let hi = cells - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (centre(mid) <= pos) lo = mid;
    else hi = mid;
  }
  return { i: lo, f: (pos - centre(lo)) / (centre(hi) - centre(lo)) };
}

/** One layer of the lightmap from a value per patch. */
export function rasterise(
  g: Geometry,
  mesh: Mesh,
  atlas: Atlas,
  values: Float64Array,
): Float32Array {
  const layer = new Float32Array(atlas.width * atlas.height);
  for (const rect of atlas.rects) {
    const f = g.faces[rect.face];
    const grid = mesh.grids[rect.face];
    if (f === undefined || grid === undefined) continue;
    const cols = grid.s.length - 1;
    const vals = faceValues(grid, values);
    const value = (i: number, j: number): number => vals[j * cols + i] ?? 0;
    for (let ty = -PAD; ty < rect.h + PAD; ty++) {
      const cy = Math.min(rect.h - 1, Math.max(0, ty));
      const t = ((cy + 0.5) / rect.h) * f.sv;
      const lt = locate(grid.t, t);
      for (let tx = -PAD; tx < rect.w + PAD; tx++) {
        const cx = Math.min(rect.w - 1, Math.max(0, tx));
        const s = ((cx + 0.5) / rect.w) * f.su;
        const ls = locate(grid.s, s);
        const i1 = Math.min(cols - 1, ls.i + 1);
        const j1 = Math.min(grid.t.length - 2, lt.i + 1);
        const low = value(ls.i, lt.i) * (1 - ls.f) + value(i1, lt.i) * ls.f;
        const high = value(ls.i, j1) * (1 - ls.f) + value(i1, j1) * ls.f;
        layer[(rect.y + ty) * atlas.width + rect.x + tx] = low * (1 - lt.f) + high * lt.f;
      }
    }
  }
  return layer;
}

/** Read a layer at a point on a face, as the GPU's linear filter would. */
export function sample(
  atlas: Atlas,
  layer: Float32Array,
  face: Face,
  s: number,
  t: number,
): number {
  const rect = atlas.rects[face.index];
  if (rect === undefined) return 0;
  const x = rect.x + (s / face.su) * rect.w - 0.5;
  const y = rect.y + (t / face.sv) * rect.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const read = (ix: number, iy: number): number => {
    const cx = Math.min(atlas.width - 1, Math.max(0, ix));
    const cy = Math.min(atlas.height - 1, Math.max(0, iy));
    return layer[cy * atlas.width + cx] ?? 0;
  };
  return (
    (read(x0, y0) * (1 - fx) + read(x0 + 1, y0) * fx) * (1 - fy) +
    (read(x0, y0 + 1) * (1 - fx) + read(x0 + 1, y0 + 1) * fx) * fy
  );
}
