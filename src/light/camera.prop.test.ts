import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { View } from './camera.ts';
import { cameraFor, keepInside, turnBy, walkBy, zoomBy } from './camera.ts';
import { defaultScene } from './scene.ts';
import type { Scene } from './scene.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

const scene: fc.Arbitrary<Scene> = fc
  .record({
    length: fc.double({ min: 1, max: 12, noNaN: true }),
    width: fc.double({ min: 1, max: 1.5, noNaN: true }),
    height: fc.double({ min: 2.4, max: 3, noNaN: true }),
  })
  .map((h) => ({ ...defaultScene(), ...h, mounts: [] }));

const finite = (lo: number, hi: number): fc.Arbitrary<number> =>
  fc.double({ min: lo, max: hi, noNaN: true });

const view: fc.Arbitrary<View> = fc.oneof(
  fc.record({
    mode: fc.constant('walk' as const),
    x: finite(-5, 20),
    z: finite(-5, 5),
    yaw: finite(-720, 720),
    pitch: finite(-200, 200),
  }),
  fc.record({
    mode: fc.constant('orbit' as const),
    yaw: finite(-720, 720),
    pitch: finite(-200, 200),
    distance: finite(-1, 30),
  }),
);

describe('every view', () => {
  it('keeps the eye inside the room, however it is moved', () => {
    fc.assert(
      fc.property(
        scene,
        view,
        fc.array(
          fc.tuple(finite(-3, 3), finite(-3, 3), finite(-90, 90), fc.integer({ min: -5, max: 5 })),
          {
            maxLength: 10,
          },
        ),
        (s, start, moves) => {
          let v = start;
          for (const [f, r, t, z] of moves) {
            v = turnBy(v, t, t / 2);
            v = zoomBy(s, v, z);
            if (v.mode === 'walk') v = walkBy(s, v, f, r);
          }
          const c = cameraFor(s, v);
          const p = c.position;
          expect(keepInside(s, p)).toEqual(p);
          const d = Math.hypot(...c.target.map((t, i) => t - (p[i] ?? 0)));
          expect(d).toBeGreaterThan(1e-6);
          expect(p.every(Number.isFinite)).toBe(true);
        },
      ),
      { numRuns: runs },
    );
  });
});
