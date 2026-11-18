import { describe, expect, it } from 'vitest';
import { layout, rasterise, sample } from './atlas.ts';
import { buildGeometry, faceAt } from './geometry.ts';
import { buildMesh } from './mesh.ts';
import { directOnPatches, formFactors, patchReflectance, solve } from './radiosity.ts';
import { directAt, solveScene } from './response.ts';
import { defaultScene, mount, sixMountScene } from './scene.ts';
import type { Scene } from './scene.ts';

const base = defaultScene();

function box(
  length: number,
  width: number,
  height: number,
  rho: number,
  mounts: Scene['mounts'] = [],
): Scene {
  return {
    length,
    width,
    height,
    endWalls: 'closed',
    reflectance: { ceiling: rho, walls: rho, floor: rho },
    mounts,
  };
}

/** The form factor from one whole face to another, from the patch matrix. */
function faceFactor(scene: Scene, from: string, to: string): number {
  const g = buildGeometry(scene);
  const mesh = buildMesh(g);
  const F = formFactors(g, mesh);
  const n = mesh.count;
  const a = g.faces.find((f) => f.name === from)?.index;
  const b = g.faces.find((f) => f.name === to)?.index;
  let exchange = 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    if (mesh.face[i] !== a) continue;
    area += mesh.area[i] ?? 0;
    for (let j = 0; j < n; j++) {
      if (mesh.face[j] === b) exchange += (mesh.area[i] ?? 0) * (F[i * n + j] ?? 0);
    }
  }
  return exchange / area;
}

describe('form factors', () => {
  it('matches the closed forms for a unit cube', () => {
    // docs/research/rendering.md section 6: opposite 0.199825, adjacent 0.200044.
    const cube = box(1, 1, 1, 0.5);
    expect(faceFactor(cube, 'floor', 'ceiling')).toBeCloseTo(0.199825, 2);
    expect(faceFactor(cube, 'floor', 'left')).toBeCloseTo(0.200044, 2);
    expect(faceFactor(cube, 'floor', 'end0')).toBeCloseTo(0.200044, 2);
  });

  it('matches the closed forms for a 5 by 1.2 by 2.4 m box', () => {
    const hall = box(5, 1.2, 2.4, 0.5);
    expect(faceFactor(hall, 'floor', 'ceiling') / 0.16772).toBeCloseTo(1, 1);
    expect(faceFactor(hall, 'floor', 'left') / 0.33554).toBeCloseTo(1, 1);
    expect(faceFactor(hall, 'floor', 'end0') / 0.0806).toBeCloseTo(1, 1);
    const sum =
      faceFactor(hall, 'floor', 'ceiling') +
      2 * faceFactor(hall, 'floor', 'left') +
      2 * faceFactor(hall, 'floor', 'end0');
    expect(sum).toBeCloseTo(1, 1);
  });

  it('has rows that sum to 1 and is reciprocal, openings included', () => {
    const scene: Scene = {
      ...base,
      mounts: [mount('a', 'skirting', 'left', 5), mount('b', 'reveal', 'right', 5)],
    };
    const g = buildGeometry(scene);
    const mesh = buildMesh(g);
    const F = formFactors(g, mesh);
    const n = mesh.count;
    let total = 0;
    for (let i = 0; i < n; i++) {
      let row = 0;
      for (let j = 0; j < n; j++) row += F[i * n + j] ?? 0;
      expect(Math.abs(row - 1)).toBeLessThan(1e-3);
      total += row;
      expect(F[i * n + i]).toBe(0);
    }
    expect(total / n).toBeCloseTo(1, 4);
    for (let k = 0; k < 4000; k++) {
      const i = (k * 7919) % n;
      const j = (k * 104729 + 13) % n;
      const a = (mesh.area[i] ?? 0) * (F[i * n + j] ?? 0);
      const b = (mesh.area[j] ?? 0) * (F[j * n + i] ?? 0);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(a, b));
    }
  });

  it('lets a patch inside an opening see the room only through its mouth', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    const F = formFactors(g, mesh);
    const n = mesh.count;
    const top = g.faces.find((f) => f.name === 'm1.top')?.index;
    const ceiling = 1;
    const leftWall = 2;
    for (let i = 0; i < n; i++) {
      if (mesh.face[i] !== top) continue;
      for (let j = 0; j < n; j++) {
        // The top of the slot faces down, and its own wall is behind the mouth.
        if (mesh.face[j] === ceiling || mesh.face[j] === leftWall) expect(F[i * n + j]).toBe(0);
      }
    }
  });
});

describe('the solve', () => {
  it('balances energy in a closed box', () => {
    // Mean indirect illuminance is flux × ρ ÷ (area × (1 − ρ)): rendering.md section 6.
    for (const rho of [0.3, 0.7]) {
      const scene = box(5, 1.2, 2.4, rho, [mount('a', 'channel', 'left', 5, { height: 1.2 })]);
      const g = buildGeometry(scene);
      const mesh = buildMesh(g);
      const emitter = g.emitters[0];
      if (emitter === undefined) throw new Error('no emitter');
      const direct = directOnPatches(g, mesh, emitter);
      const { indirect } = solve(formFactors(g, mesh), patchReflectance(g, mesh), direct);
      let area = 0;
      let flux = 0;
      let bounced = 0;
      for (let i = 0; i < mesh.count; i++) {
        area += mesh.area[i] ?? 0;
        flux += (mesh.area[i] ?? 0) * (direct[i] ?? 0);
        bounced += (mesh.area[i] ?? 0) * (indirect[i] ?? 0);
      }
      // All the tape's light arrives: 1 lm per metre over 5 m.
      expect(flux / 5).toBeCloseTo(1, 2);
      expect(area).toBeCloseTo(41.76, 9);
      const want = (5 * rho) / (area * (1 - rho));
      expect(Math.abs(bounced / area / want - 1)).toBeLessThan(0.01);
    }
  });

  it('gives the research figure: 1,000 lm, 41.76 m², ρ 0.7 is 55.9 lux indirect', () => {
    const scene = box(5, 1.2, 2.4, 0.7, [mount('a', 'channel', 'right', 5, { height: 0.6 })]);
    const g = buildGeometry(scene);
    const mesh = buildMesh(g);
    const emitter = g.emitters[0];
    if (emitter === undefined) throw new Error('no emitter');
    const direct = directOnPatches(g, mesh, emitter);
    const { indirect } = solve(formFactors(g, mesh), patchReflectance(g, mesh), direct);
    let area = 0;
    let bounced = 0;
    for (let i = 0; i < mesh.count; i++) {
      area += mesh.area[i] ?? 0;
      bounced += (mesh.area[i] ?? 0) * (indirect[i] ?? 0);
    }
    // 200 lm per metre of tape.
    expect(Math.abs((200 * bounced) / area - 55.9)).toBeLessThan(0.5);
  });

  it('gives no indirect light with black surfaces, and none at all with no light', () => {
    const scene = box(5, 1.2, 2.4, 0, [mount('a', 'channel', 'left', 5)]);
    const r = solveScene(scene);
    expect(Math.max(...(r.layers[0] ?? []))).toBe(0);
    const dark = solve(new Float32Array(4), new Float64Array(2).fill(0.5), new Float64Array(2));
    expect(dark.iterations).toBe(0);
    expect([...dark.indirect]).toEqual([0, 0]);
  });

  it('still converges with reflectance near 1', () => {
    const scene = box(3, 1.2, 2.4, 0.97, [mount('a', 'channel', 'left', 3)]);
    const g = buildGeometry(scene);
    const mesh = buildMesh(g, 900);
    const emitter = g.emitters[0];
    if (emitter === undefined) throw new Error('no emitter');
    const direct = directOnPatches(g, mesh, emitter);
    const s = solve(formFactors(g, mesh), patchReflectance(g, mesh), direct, 1e-5, 2000);
    expect(s.iterations).toBeLessThan(2000);
    for (const v of s.indirect) expect(Number.isFinite(v)).toBe(true);
    // Light that is hardly absorbed builds up to many times the direct light.
    let area = 0;
    let bounced = 0;
    for (let i = 0; i < mesh.count; i++) {
      area += mesh.area[i] ?? 0;
      bounced += (mesh.area[i] ?? 0) * (s.indirect[i] ?? 0);
    }
    const want = (3 * 0.97) / (area * 0.03);
    expect(Math.abs(bounced / area / want - 1)).toBeLessThan(0.02);
  });

  it('stops at the iteration limit', () => {
    const scene = box(3, 1.2, 2.4, 0.9, [mount('a', 'channel', 'left', 3)]);
    const g = buildGeometry(scene);
    const mesh = buildMesh(g, 600);
    const emitter = g.emitters[0];
    if (emitter === undefined) throw new Error('no emitter');
    const direct = directOnPatches(g, mesh, emitter);
    expect(solve(formFactors(g, mesh), patchReflectance(g, mesh), direct, 0, 3).iterations).toBe(3);
  });

  it('is linear: the response to a sum is the sum of the responses', () => {
    const scene: Scene = {
      ...base,
      mounts: [mount('a', 'channel', 'left', 5), mount('b', 'skirting', 'right', 5)],
    };
    const g = buildGeometry(scene);
    const mesh = buildMesh(g, 1200);
    const F = formFactors(g, mesh);
    const rho = patchReflectance(g, mesh);
    const [e0, e1] = g.emitters;
    if (e0 === undefined || e1 === undefined) throw new Error('no emitters');
    const d0 = directOnPatches(g, mesh, e0);
    const d1 = directOnPatches(g, mesh, e1);
    const both = d0.map((v, i) => 3 * v + 0.25 * (d1[i] ?? 0));
    const s0 = solve(F, rho, d0, 1e-9).indirect;
    const s1 = solve(F, rho, d1, 1e-9).indirect;
    const sum = solve(F, rho, both, 1e-9).indirect;
    for (let i = 0; i < mesh.count; i += 7) {
      const want = 3 * (s0[i] ?? 0) + 0.25 * (s1[i] ?? 0);
      expect(Math.abs((sum[i] ?? 0) - want)).toBeLessThan(1e-6 * Math.max(1, want));
    }
  });
});

describe('the lightmap', () => {
  it('lays faces out without overlap, each with its border', () => {
    const g = buildGeometry({
      ...base,
      mounts: [mount('a', 'skirting', 'left', 5), mount('b', 'reveal', 'right', 5)],
    });
    const atlas = layout(g);
    expect(atlas.rects).toHaveLength(g.faces.length);
    const used = new Uint8Array(atlas.width * atlas.height);
    for (const r of atlas.rects) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w + 1).toBeLessThanOrEqual(atlas.width);
      expect(r.y + r.h + 1).toBeLessThanOrEqual(atlas.height);
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          expect(used[y * atlas.width + x]).toBe(0);
          used[y * atlas.width + x] = 1;
        }
      }
    }
  });

  it('refuses a scene too large for it', () => {
    const g = buildGeometry(base);
    const tall = { ...g, faces: g.faces.map((f) => ({ ...f, sv: 40 })) };
    expect(() => layout(tall)).toThrow(RangeError);
  });

  it('reproduces a field that varies evenly across a face, and holds its edge values', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    const atlas = layout(g);
    // A value per patch equal to its height on the right wall.
    const values = new Float64Array(mesh.count);
    for (let i = 0; i < mesh.count; i++) {
      if (mesh.face[i] === 3) values[i] = ((mesh.t0[i] ?? 0) + (mesh.t1[i] ?? 0)) / 2;
    }
    const layer = rasterise(g, mesh, atlas, values);
    const right = g.faces[3];
    if (right === undefined) throw new Error('no face');
    for (const y of [0.2, 0.61, 1.3, 2.2]) {
      expect(sample(atlas, layer, right, 2.5, y)).toBeCloseTo(y, 2);
    }
    // Past the outermost patch centres the value is held, not extrapolated.
    expect(sample(atlas, layer, right, 2.5, 0)).toBeGreaterThan(0);
    expect(sample(atlas, layer, right, 2.5, 0)).toBeCloseTo(0.075, 6);
    // Another face is untouched.
    expect(sample(atlas, layer, g.faces[0] ?? right, 2.5, 0.6)).toBe(0);
    expect(sample({ ...atlas, rects: [] }, layer, right, 1, 1)).toBe(0);
  });

  it('does not let an opening darken the wall beside it', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    const atlas = layout(g);
    const values = new Float64Array(mesh.count).fill(1);
    const layer = rasterise(g, mesh, atlas, values);
    const left = g.faces[2];
    if (left === undefined) throw new Error('no face');
    // Just above the skirting slot's mouth.
    expect(sample(atlas, layer, left, 2.5, 0.03)).toBeCloseTo(1, 6);
    expect(sample(atlas, layer, left, 2.5, 0.01)).toBeCloseTo(1, 6);
  });
});

describe('the response', () => {
  it('gives one layer per mount, and none for an empty scene', () => {
    let calls = 0;
    const r = solveScene(base, {
      maxPatches: 900,
      progress: (done, total) => {
        calls++;
        expect(total).toBe(2);
        expect(done).toBe(calls);
      },
    });
    expect(calls).toBe(2);
    expect(r.layers).toHaveLength(2);
    expect(r.layers[0]?.length).toBe(r.atlas.width * r.atlas.height);
    expect(r.patches).toBeLessThanOrEqual(900);
    const empty = solveScene({ ...base, mounts: [] });
    expect(empty.layers).toEqual([]);
  });

  it('refuses a scene that cannot be meshed within the cap', () => {
    expect(() => solveScene(sixMountScene(), { maxPatches: 10 })).toThrow(RangeError);
    // A cap above the limit is held to the limit.
    expect(solveScene(base, { maxPatches: 1e9 }).patches).toBeLessThanOrEqual(5000);
  });

  it('changes little when the mesh is made coarser', () => {
    const scene: Scene = { ...base, mounts: [mount('a', 'channel', 'right', 5)] };
    const g = buildGeometry(scene);
    const fine = solveScene(scene);
    const coarse = solveScene(scene, { maxPatches: Math.floor(fine.patches / 2) });
    expect(coarse.coarsening).toBeGreaterThan(1);
    const points: [number, number, number][] = [
      [2.5, 0, 0.3],
      [2.5, 0, 0.9],
      [2.5, 2.7, 0.6],
      [2.5, 1.2, 0],
      [1, 2, 0],
    ];
    const normals: [number, number, number][] = [
      [0, 1, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, 1],
    ];
    points.forEach((p, i) => {
      const at = faceAt(g, p, normals[i] ?? [0, 1, 0]);
      if (at === undefined) throw new Error('no face');
      const a = sample(fine.atlas, fine.layers[0] ?? new Float32Array(), at.face, at.s, at.t);
      const b = sample(coarse.atlas, coarse.layers[0] ?? new Float32Array(), at.face, at.s, at.t);
      expect(Math.abs(b / a - 1)).toBeLessThan(0.04);
    });
  });

  it('gives no direct light from a mount that is not there', () => {
    const g = buildGeometry(base);
    expect(directAt(g, 9, [1, 0, 0.5], [0, 1, 0], 0)).toBe(0);
    expect(directAt(g, 1, [2.5, 0, 0.6], [0, 1, 0], 0)).toBeGreaterThan(0);
  });

  it('dims the far end of a tape with voltage drop', () => {
    const scene: Scene = { ...base, mounts: [mount('a', 'channel', 'left', 5, { gradient: 0.4 })] };
    const g = buildGeometry(scene);
    const near = directAt(g, 0, [0.6, 0.6, 1.2], [0, 0, -1], 0);
    const far = directAt(g, 0, [4.4, 0.6, 1.2], [0, 0, -1], 0);
    expect(far).toBeLessThan(near * 0.85);
  });
});
