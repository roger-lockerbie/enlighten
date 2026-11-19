import { describe, expect, it } from 'vitest';
import { buildGeometry } from './geometry.ts';
import { MAX_PATCHES, buildMesh, lines } from './mesh.ts';
import { defaultScene, mount } from './scene.ts';
import type { Scene } from './scene.ts';

const base = defaultScene();

const six: Scene = {
  ...base,
  mounts: [
    mount('a', 'skirting', 'left', 5),
    mount('b', 'channel', 'left', 5),
    mount('c', 'reveal', 'left', 5),
    mount('d', 'skirting', 'right', 5),
    mount('e', 'channel', 'right', 5),
    mount('f', 'reveal', 'right', 5, { facing: 'down' }),
  ],
};

describe('grid lines', () => {
  it('steps evenly and ends on the size', () => {
    expect(lines(1, () => 0.25, [])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const odd = lines(1, () => 0.3, []);
    expect(odd[0]).toBe(0);
    expect(odd[odd.length - 1]).toBe(1);
    // No sliver at the end: the last cell absorbs a short remainder.
    expect(Math.min(...odd.slice(1).map((v, i) => v - (odd[i] ?? 0)))).toBeGreaterThan(0.07);
  });

  it('lands on forced lines and ignores ones outside the face', () => {
    const l = lines(1, () => 0.25, [0.4, -1, 2, 0, 1]);
    expect(l).toContain(0.4);
    expect(l[0]).toBe(0);
    expect(l[l.length - 1]).toBe(1);
    expect([...l].sort((a, b) => a - b)).toEqual(l);
  });

  it('follows a step that changes along the way', () => {
    const l = lines(1, (p) => (p < 0.5 ? 0.25 : 0.05), [0.5]);
    expect(l.filter((v) => v <= 0.5)).toEqual([0, 0.25, 0.5]);
    expect(l.filter((v) => v > 0.5).length).toBe(10);
  });
});

describe('the mesh', () => {
  it('covers every face exactly, less the openings', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    expect(mesh.coarsening).toBe(1);
    for (const f of g.faces) {
      let area = 0;
      for (let i = 0; i < mesh.count; i++) if (mesh.face[i] === f.index) area += mesh.area[i] ?? 0;
      const holes = f.holes.reduce((a, h) => a + (h.s1 - h.s0) * (h.t1 - h.t0), 0);
      expect(area).toBeCloseTo(f.su * f.sv - holes, 9);
    }
  });

  it('puts no patch in an opening, and marks those cells', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    const left = mesh.grids[2];
    expect(left?.t).toContain(0.025);
    const cols = (left?.s.length ?? 1) - 1;
    // The rows of the left wall up to 25 mm are the slot's mouth.
    const rows = (left?.t.length ?? 1) - 1;
    for (let j = 0; j < rows; j++) {
      const inMouth = (left?.t[j + 1] ?? 0) <= 0.025 + 1e-12;
      for (let i = 0; i < cols; i++) {
        const cell = left?.cells[j * cols + i] ?? 0;
        if (inMouth) expect(cell).toBe(-1);
        else expect(cell).toBeGreaterThanOrEqual(0);
      }
    }
    for (let i = 0; i < mesh.count; i++) {
      if (mesh.face[i] === 2) expect(mesh.t0[i]).toBeGreaterThanOrEqual(0.025 - 1e-12);
    }
  });

  it('is fine beside a mount and coarse away from it', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    const heights = (face: number): number[] => {
      const t = mesh.grids[face]?.t ?? [];
      return t.slice(1).map((v, i) => v - (t[i] ?? 0));
    };
    // The right wall has a channel at 600 mm: 12.5 mm rows beside it, 150 mm rows near the ceiling.
    const right = mesh.grids[3]?.t ?? [];
    const rows = heights(3);
    const at = (y: number): number =>
      rows[right.findIndex((v, i) => v <= y && (right[i + 1] ?? 9) > y)] ?? 0;
    expect(at(0.62)).toBeCloseTo(0.0125, 6);
    expect(at(0.7)).toBeCloseTo(0.025, 6);
    expect(at(0.85)).toBeCloseTo(0.05, 6);
    expect(at(2)).toBeCloseTo(0.15, 6);
    // The floor is fine beside the skirting slot on the left, and coarse in the middle.
    const floor = heights(0);
    expect(floor[0]).toBeCloseTo(0.0125, 6);
    expect(Math.max(...floor)).toBeGreaterThan(0.1);
    // The ceiling has no mount near it.
    expect(Math.min(...heights(1))).toBeGreaterThan(0.1);
  });

  it('keeps patch centres on their faces', () => {
    const g = buildGeometry(base);
    const mesh = buildMesh(g);
    for (let i = 0; i < mesh.count; i++) {
      const f = g.faces[mesh.face[i] ?? -1];
      if (f === undefined) throw new Error('no face');
      const d =
        ((mesh.cx[i] ?? 0) - f.origin[0]) * f.normal[0] +
        ((mesh.cy[i] ?? 0) - f.origin[1]) * f.normal[1] +
        ((mesh.cz[i] ?? 0) - f.origin[2]) * f.normal[2];
      expect(Math.abs(d)).toBeLessThan(1e-12);
    }
  });

  it('stays under the cap with six mounts, and coarsens when told to fit fewer', () => {
    const g = buildGeometry(six);
    const full = buildMesh(g);
    expect(full.count).toBeLessThanOrEqual(MAX_PATCHES);
    const small = buildMesh(g, 1500);
    expect(small.count).toBeLessThanOrEqual(1500);
    expect(small.coarsening).toBeGreaterThan(1);
  });

  it('gives up coarsening in the end', () => {
    const tiny = buildMesh(buildGeometry(six), 10);
    expect(tiny.count).toBeGreaterThan(10);
    expect(tiny.coarsening).toBeGreaterThan(8);
  });
});
