import { describe, expect, it } from 'vitest';
import {
  GRADIENT_SEGMENTS,
  buildGeometry,
  faceAt,
  facePoint,
  inHole,
  pick,
  portalsBetween,
  throughPortal,
} from './geometry.ts';
import { defaultScene, mount } from './scene.ts';
import type { Scene } from './scene.ts';
import { cross, dot, sub } from './vec.ts';

const base = defaultScene();

describe('geometry', () => {
  it('builds the room, one opening for the skirting slot, and no opening for a channel', () => {
    const g = buildGeometry(base);
    expect(g.faces.map((f) => f.name)).toEqual([
      'floor',
      'ceiling',
      'left',
      'right',
      'end0',
      'end1',
      'm1.back',
      'm1.bottom',
      'm1.top',
      'm1.end0',
      'm1.end1',
    ]);
    expect(g.portals).toHaveLength(1);
    expect(g.cellOf).toEqual([1, 0]);
    expect(g.faces[2]?.holes).toEqual([{ s0: 0, s1: 5, t0: 0, t1: 0.025 }]);
    expect(g.faces[3]?.holes).toEqual([]);
    expect(g.faces.find((f) => f.name === 'm1.bottom')?.material).toBe('floor');
  });

  it('points every normal into its cell, at right angles to the face', () => {
    const scene: Scene = {
      ...base,
      mounts: [
        mount('a', 'skirting', 'left', 5),
        mount('b', 'reveal', 'right', 5, { facing: 'up' }),
      ],
    };
    const g = buildGeometry(scene);
    const centres: Record<number, [number, number, number]> = {
      0: [2.5, 1.35, 0.6],
      1: [2.5, 0.0125, -0.0095],
      2: [2.5, 2.415, 1.2125],
    };
    for (const f of g.faces) {
      const mid = facePoint(f, f.su / 2, f.sv / 2);
      const centre = centres[f.cell];
      if (centre === undefined) throw new Error('unexpected cell');
      expect(dot(f.normal, sub(centre, mid))).toBeGreaterThan(0);
      expect(dot(f.normal, f.u)).toBe(0);
      expect(dot(f.normal, f.v)).toBe(0);
      expect(Math.abs(dot(cross(f.u, f.v), f.normal))).toBe(1);
    }
  });

  it('puts each tape where its kind says', () => {
    const scene: Scene = {
      ...base,
      mounts: [
        mount('a', 'skirting', 'left', 5),
        mount('b', 'channel', 'right', 5),
        mount('c', 'reveal', 'right', 5, { facing: 'up' }),
        mount('d', 'reveal', 'right', 5, { facing: 'down' }),
      ],
    };
    const g = buildGeometry(scene);
    const [a, b, c, d] = g.emitters;
    // Skirting: on the top of the slot, facing down, set back into the left wall.
    expect(a?.normal).toEqual([0, -1, 0]);
    expect(a?.corners[0][1]).toBe(0.025);
    expect(a?.corners[0][2]).toBeCloseTo(-0.0095 - 0.006, 12);
    // Channel: on the right wall's plane, facing into the room.
    expect(b?.normal).toEqual([0, 0, -1]);
    expect(b?.corners[0][2]).toBe(1.2);
    expect(b?.cell).toBe(0);
    // A reveal lit both ways is one opening with two tapes.
    expect(c?.cell).toBe(d?.cell);
    expect(g.portals).toHaveLength(2);
    expect(c?.normal).toEqual([0, 1, 0]);
    expect(c?.corners[0][1]).toBe(2.4);
    expect(d?.normal).toEqual([0, -1, 0]);
    expect(d?.corners[0][1]).toBeCloseTo(2.43, 12);
    expect(c?.corners[0][2]).toBeCloseTo(1.2 + 0.015 - 0.006, 12);
  });

  it('cuts a tape with voltage drop into pieces that dim toward the far end', () => {
    const scene: Scene = { ...base, mounts: [mount('a', 'channel', 'left', 5, { gradient: 0.2 })] };
    const e = buildGeometry(scene).emitters[0];
    expect(e?.segments).toHaveLength(GRADIENT_SEGMENTS);
    expect(e?.segments.map((s) => s.weight)).toEqual([0.975, 0.925, 0.875, 0.825]);
    expect(e?.segments[1]?.corners[0][0]).toBe(1.25);
    expect(buildGeometry(base).emitters[0]?.segments).toHaveLength(1);
  });

  it('opens the ends by making them black', () => {
    const g = buildGeometry({ ...base, endWalls: 'open' });
    expect(g.faces[4]?.material).toBe('open');
    expect(g.faces[4]?.reflectance).toBe(0);
  });

  it('names the openings between two cells', () => {
    const scene: Scene = {
      ...base,
      mounts: [mount('a', 'skirting', 'left', 5), mount('b', 'skirting', 'right', 5)],
    };
    const g = buildGeometry(scene);
    expect(portalsBetween(g, 0, 0)).toEqual([]);
    expect(portalsBetween(g, 1, 1)).toEqual([]);
    expect(portalsBetween(g, 0, 2)).toEqual([g.portals[1]]);
    expect(portalsBetween(g, 1, 2)).toEqual([g.portals[0], g.portals[1]]);
  });

  it('tests a line against an opening', () => {
    const portal = buildGeometry(base).portals[0];
    if (portal === undefined) throw new Error('no portal');
    expect(throughPortal([2, 0.5, 0.5], [2, 0.01, -0.01], portal)).toBe(true);
    expect(throughPortal([2, 2, 0.5], [2, 0.01, -0.01], portal)).toBe(false);
    expect(throughPortal([2, 2, 0.5], [2, 0.01, -0.01], portal, 0.1)).toBe(true);
    expect(throughPortal([2, 0.5, 0.5], [2, 0.5, 0.2], portal)).toBe(false);
    expect(throughPortal([2, 0.5, 0.5], [3, 0.6, 0.5], portal)).toBe(false);
  });
});

describe('finding surfaces', () => {
  const g = buildGeometry(base);

  it('finds the face a point lies on', () => {
    const floor = faceAt(g, [1, 0, 0.4], [0, 1, 0]);
    expect(floor?.face.name).toBe('floor');
    expect(floor?.s).toBe(1);
    expect(floor?.t).toBe(0.4);
    expect(faceAt(g, [1, 0.5, 0], [0, 0, 1])?.face.name).toBe('left');
    // In the slot's mouth there is no wall.
    expect(faceAt(g, [1, 0.01, 0], [0, 0, 1])).toBeUndefined();
    expect(faceAt(g, [1, 0.01, -0.019], [0, 0, 1])?.face.name).toBe('m1.back');
    expect(faceAt(g, [1, 0, -0.01], [0, 1, 0])?.face.name).toBe('m1.bottom');
    expect(faceAt(g, [1, 9, 0.4], [0, 1, 0])).toBeUndefined();
    const left = g.faces[2];
    expect(left !== undefined && inHole(left, 1, 0.01)).toBe(true);
  });

  it('picks the first surface along a ray', () => {
    const down = pick(g, [2, 1.5, 0.6], [0, -1, 0]);
    expect(down?.face).toBe(0);
    expect(down?.distance).toBeCloseTo(1.5, 12);
    expect(down?.s).toBeCloseTo(2, 12);
    expect(down?.t).toBeCloseTo(0.6, 12);
    expect(g.faces[pick(g, [2, 1.5, 0.6], [0, 0, -1])?.face ?? -1]?.name).toBe('left');
    expect(g.faces[pick(g, [2, 1.5, 0.6], [-1, 0, 0])?.face ?? -1]?.name).toBe('end0');
  });

  it('follows a ray through the slot to the surface inside', () => {
    // Level with the slot, straight at the left wall: through the mouth to the back.
    const back = pick(g, [2, 0.012, 0.6], [0, 0, -1]);
    expect(g.faces[back?.face ?? -1]?.name).toBe('m1.back');
    expect(back?.distance).toBeCloseTo(0.619, 9);
    // From higher up, aimed down into the mouth: the floor of the slot.
    const dir = [0, -0.5, -0.61] as const;
    const inside = pick(g, [2, 0.5, 0.6], dir);
    expect(g.faces[inside?.face ?? -1]?.name).toBe('m1.bottom');
    // Aimed at the wall above the mouth: the wall, not the slot behind it.
    const wall = pick(g, [2, 0.5, 0.6], [0, -0.3, -0.6]);
    expect(g.faces[wall?.face ?? -1]?.name).toBe('left');
  });

  it('finds nothing for a ray that leaves no hit', () => {
    expect(pick(g, [2, 1.5, 0.6], [0, 0, 0])).toBeUndefined();
  });
});
