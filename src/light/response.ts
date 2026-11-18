/**
 * The unit response of each mount (ADR 0008): the indirect illuminance everywhere for 1 lm per
 * metre of tape, as one layer of the lightmap. A frame is these layers weighted by what each tape
 * is giving out, plus the direct term.
 */
import type { Atlas } from './atlas.ts';
import { layout, rasterise } from './atlas.ts';
import type { Geometry } from './geometry.ts';
import { buildGeometry, portalsBetween } from './geometry.ts';
import { SOLVER_VERSION } from './limits.ts';
import { buildMesh } from './mesh.ts';
import { illuminance } from './polygon.ts';
import { directOnPatches, formFactors, patchReflectance, solve } from './radiosity.ts';
import type { Scene } from './scene.ts';
import type { V3 } from './vec.ts';

export { SOLVER_VERSION };

export interface Response {
  readonly version: number;
  readonly atlas: Atlas;
  /** One layer per mount, in the scene's order: lux of indirect light per lm/m. */
  readonly layers: readonly Float32Array[];
  readonly patches: number;
  readonly coarsening: number;
}

export interface SolveOptions {
  /** Called as each mount is solved, with the number done so far. */
  readonly progress?: (done: number, total: number) => void;
  readonly maxPatches?: number;
}

export function solveScene(scene: Scene, options: SolveOptions = {}): Response {
  const g = buildGeometry(scene);
  const mesh = buildMesh(g, options.maxPatches);
  const atlas = layout(g);
  const layers: Float32Array[] = [];
  if (g.emitters.length > 0) {
    const F = formFactors(g, mesh);
    const rho = patchReflectance(g, mesh);
    g.emitters.forEach((emitter, i) => {
      const direct = directOnPatches(g, mesh, emitter);
      const { indirect } = solve(F, rho, direct);
      layers.push(rasterise(g, mesh, atlas, indirect));
      options.progress?.(i + 1, g.emitters.length);
    });
  }
  return {
    version: SOLVER_VERSION,
    atlas,
    layers,
    patches: mesh.count,
    coarsening: mesh.coarsening,
  };
}

/**
 * Direct illuminance at a point from one mount at 1 lm per metre, in lux. `cell` is the cell the
 * point's face belongs to.
 */
export function directAt(g: Geometry, mount: number, p: V3, n: V3, cell: number): number {
  const emitter = g.emitters[mount];
  if (emitter === undefined) return 0;
  const portals = portalsBetween(g, cell, emitter.cell);
  const exitance = 1 / emitter.width;
  let sum = 0;
  for (const seg of emitter.segments) {
    sum += seg.weight * illuminance(p, n, seg.corners, emitter.normal, exitance, portals);
  }
  return sum;
}
