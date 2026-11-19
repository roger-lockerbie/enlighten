import { describe, expect, it } from 'vitest';
import type { View } from './camera.ts';
import {
  atWall,
  cameraFor,
  defaultCamera,
  defaultOrbit,
  downHall,
  keepInside,
  litCentre,
  orbitCentre,
  parseView,
  project,
  ray,
  turnBy,
  walkBy,
  zoomBy,
} from './camera.ts';
import { buildGeometry, pick } from './geometry.ts';
import { defaultScene, mount } from './scene.ts';
import type { Scene } from './scene.ts';

const scene = defaultScene();
const camera = defaultCamera(scene);

describe('the camera', () => {
  it('stands inside the hallway at eye level and looks down it', () => {
    expect(camera.position).toEqual([0.35, 1.6, 0.6]);
    expect(camera.target[0]).toBe(5);
    expect(defaultCamera({ ...scene, height: 1.7 }).position[1]).toBeCloseTo(1.4, 12);
  });

  it('sends the middle of the picture at the target', () => {
    const r = ray(camera, 1.6, 0, 0);
    expect(r.origin).toEqual(camera.position);
    expect(Math.hypot(...r.direction)).toBeCloseTo(1, 12);
    const hit = pick(buildGeometry(scene), r.origin, r.direction);
    expect(hit?.point[0]).toBeCloseTo(5, 9);
    expect(hit?.point[1]).toBeCloseTo(0.9, 9);
    expect(hit?.point[2]).toBeCloseTo(0.6, 9);
  });

  it('opens by its field of view', () => {
    const top = ray(camera, 1.6, 0, 1).direction;
    const mid = ray(camera, 1.6, 0, 0).direction;
    const angle = Math.acos(top[0] * mid[0] + top[1] * mid[1] + top[2] * mid[2]);
    expect((angle * 180) / Math.PI).toBeCloseTo(31, 9);
    // Left of the picture is the left wall, at z = 0.
    expect(ray(camera, 1.6, -1, 0).direction[2]).toBeLessThan(0);
    expect(ray(camera, 1.6, 1, 0).direction[2]).toBeGreaterThan(0);
  });

  it('projects a point back to where its ray came from', () => {
    const g = buildGeometry(scene);
    for (const [x, y] of [
      [0, 0],
      [-0.7, -0.6],
      [0.5, 0.8],
      [0.9, -0.9],
    ] as const) {
      const r = ray(camera, 1.6, x, y);
      const hit = pick(g, r.origin, r.direction);
      if (hit === undefined) throw new Error('no hit');
      const back = project(camera, 1.6, hit.point);
      expect(back?.x).toBeCloseTo(x, 9);
      expect(back?.y).toBeCloseTo(y, 9);
    }
    expect(project(camera, 1.6, [-1, 1.6, 0.6])).toBeUndefined();
  });
});

const unit = (v: readonly number[]): number[] => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const looking = (c: { position: readonly number[]; target: readonly number[] }): number[] =>
  unit(c.target.map((t, i) => t - (c.position[i] ?? 0)));

describe('views', () => {
  it('looks down the hallway as the Stage 7 camera did', () => {
    const c = cameraFor(scene, downHall(scene));
    const d = defaultCamera(scene);
    expect(c.position).toEqual(d.position);
    looking(c).forEach((v, i) => {
      expect(v).toBeCloseTo(looking(d)[i] ?? 0, 12);
    });
    expect(c.fovY).toBe(62);
    expect(c.near).toBe(0.02);
  });

  it('stands at the far side to look at a wall', () => {
    for (const side of ['left', 'right'] as const) {
      const c = cameraFor(scene, atWall(scene, side));
      const d = looking(c);
      expect(Math.sign(d[2] ?? 0)).toBe(side === 'left' ? -1 : 1);
      expect(d[1]).toBeLessThan(0);
      const g = buildGeometry(scene);
      const hit = pick(g, c.position, d as [number, number, number]);
      expect(g.faces[hit?.face ?? -1]?.name).toBe(side);
    }
  });

  it('walks along the floor the way it faces, and stays inside', () => {
    let v = downHall(scene);
    v = walkBy(scene, v, 1, 0);
    expect(v.x).toBeCloseTo(1.35, 12);
    v = walkBy(scene, turnBy(v, 90, 0), 0.2, 0);
    expect(v.z).toBeCloseTo(0.8, 12);
    v = walkBy(scene, v, 0, -0.5);
    expect(v.x).toBeCloseTo(1.85, 12);
    v = walkBy(scene, v, 50, 50);
    expect(v.x).toBeLessThanOrEqual(scene.length - 0.15);
    expect(v.z).toBeLessThanOrEqual(scene.width - 0.15);
    expect(zoomBy(scene, downHall(scene), 2).x).toBeCloseTo(0.85, 12);
  });

  it('turns within its limits, and keeps yaw in -180 to 180', () => {
    const v = turnBy(downHall(scene), 270, 200);
    expect(v.yaw).toBeCloseTo(-90, 9);
    expect(v.pitch).toBe(80);
    expect(turnBy(downHall(scene), 0, -500).pitch).toBe(-80);
    const close: View = { mode: 'close', mount: 'm1' };
    expect(turnBy(close, 10, 10)).toBe(close);
    expect(zoomBy(scene, close, 3)).toBe(close);
  });

  it('orbits the middle of the hallway, closer or further within limits', () => {
    const c = cameraFor(scene, defaultOrbit());
    expect(c.target).toEqual(orbitCentre(scene));
    let o = zoomBy(scene, defaultOrbit(), 3);
    expect(o.distance).toBeLessThan(3);
    o = zoomBy(scene, o, 100);
    expect(o.distance).toBe(0.3);
    o = zoomBy(scene, o, -200);
    expect(o.distance).toBe(12);
    // Held inside, it still looks at the middle.
    const far = cameraFor(scene, { ...o, distance: 12 });
    expect(far.target).toEqual(orbitCentre(scene));
  });

  it('comes close to a mount, at the middle of its run, looking at its lit surface', () => {
    const c = cameraFor(scene, { mode: 'close', mount: 'm2' });
    const m2 = scene.mounts[1];
    if (m2 === undefined) throw new Error('no mount');
    expect(c.target).toEqual(litCentre(scene, m2).point);
    expect(c.target).toEqual([2.5, 0.6, 1.2]);
    const away = Math.hypot(...c.position.map((p, i) => p - (c.target[i] ?? 0)));
    expect(away).toBeGreaterThan(0.1);
    expect(away).toBeLessThan(0.25);
    expect(c.fovY).toBe(30);
    expect(c.near).toBeLessThan(0.01);
    // A mount that is not there gives the view down the hallway.
    expect(cameraFor(scene, { mode: 'close', mount: 'gone' })).toEqual(
      cameraFor(scene, downHall(scene)),
    );
  });

  it('finds the lit surface of each kind of mount, and which way it faces', () => {
    const s: Scene = {
      ...scene,
      mounts: [
        mount('a', 'skirting', 'left', 5),
        mount('b', 'reveal', 'right', 5, { facing: 'up', height: 2 }),
        mount('c', 'reveal', 'right', 5, { facing: 'down', height: 2 }),
      ],
    };
    const [a, b, c] = s.mounts.map((m) => litCentre(s, m));
    expect(a?.normal).toEqual([0, -1, 0]);
    expect(a?.point[1]).toBeCloseTo(0.025, 12);
    expect(a?.point[2]).toBeLessThan(0);
    expect(b?.normal).toEqual([0, 1, 0]);
    expect(b?.point[1]).toBe(2);
    expect(b?.point[2]).toBeGreaterThan(1.2);
    expect(c?.point[1]).toBeCloseTo(2.03, 12);
    for (const id of ['a', 'b', 'c']) {
      const cam = cameraFor(s, { mode: 'close', mount: id });
      expect(keepInside(s, cam.position, 0.01)).toEqual(cam.position);
    }
  });

  it('sees a skirting slot from above, and a reveal from the side its light goes', () => {
    const s: Scene = {
      ...scene,
      mounts: [
        mount('a', 'skirting', 'left', 5),
        mount('b', 'reveal', 'right', 5, { facing: 'down', height: 2 }),
      ],
    };
    const [a, b] = ['a', 'b'].map((id) => cameraFor(s, { mode: 'close', mount: id }));
    expect(a?.position[1]).toBeGreaterThan(0.2);
    // 0.3 m out from the lit centre, which sits back in the slot.
    const slot = s.mounts[0];
    if (slot === undefined) throw new Error('no slot');
    const lit = litCentre(s, slot).point;
    expect((a?.position[2] ?? 0) - lit[2]).toBeCloseTo(0.3, 9);
    expect(b?.position[1]).toBeLessThan(2);
    expect(b?.position[2]).toBeLessThan(1);
  });

  it('checks a stored view', () => {
    for (const v of [downHall(scene), defaultOrbit(), { mode: 'close', mount: 'm1' }]) {
      expect(parseView(JSON.parse(JSON.stringify(v)))).toEqual(v);
    }
    for (const bad of [
      null,
      [],
      new Map(),
      { mode: 'fly' },
      { ...downHall(scene), extra: 1 },
      { ...downHall(scene), x: 13 },
      { ...downHall(scene), pitch: Number.NaN },
      { ...defaultOrbit(), distance: 0.1 },
      { ...defaultOrbit(), yaw: 'up' },
      { mode: 'close', mount: 'Bad id' },
      { mode: 'close' },
    ]) {
      expect(parseView(bad)).toBeUndefined();
    }
  });
});
