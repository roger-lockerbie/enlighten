import { describe, expect, it } from 'vitest';
import { defaultCamera, project, ray } from './camera.ts';
import { buildGeometry, pick } from './geometry.ts';
import { defaultScene } from './scene.ts';

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
