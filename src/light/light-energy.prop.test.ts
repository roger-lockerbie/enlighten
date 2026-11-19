import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from './geometry.ts';
import { buildMesh } from './mesh.ts';
import { directOnPatches, formFactors, patchReflectance, solve } from './radiosity.ts';
import { mount, parseScene } from './scene.ts';
import type { Scene } from './scene.ts';

// Each case builds and solves a mesh, so fewer runs than the cheap properties.
const runs = Math.max(5, Math.min(60, Math.floor(Number(process.env['PROP_RUNS'] ?? 25) / 4)));

const boxWithChannel = fc
  .record({
    length: fc.double({ min: 2, max: 7, noNaN: true }),
    width: fc.double({ min: 1, max: 1.5, noNaN: true }),
    height: fc.double({ min: 2.4, max: 3, noNaN: true }),
    rho: fc.double({ min: 0.05, max: 0.9, noNaN: true }),
    side: fc.constantFrom('left' as const, 'right' as const),
    at: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
    startAt: fc.double({ min: 0, max: 0.4, noNaN: true }),
    span: fc.double({ min: 0.3, max: 1, noNaN: true }),
  })
  .map((c): Scene => {
    const start = c.startAt * c.length;
    const length = Math.max(0.2, (c.length - start) * c.span);
    return {
      length: c.length,
      width: c.width,
      height: c.height,
      endWalls: 'closed',
      reflectance: { ceiling: c.rho, walls: c.rho, floor: c.rho },
      mounts: [mount('a', 'channel', c.side, c.length, { height: c.at * c.height, start, length })],
    };
  });

describe('P-light: energy and superposition', () => {
  it('balances energy in a closed box, for any size, reflectance and tape position', () => {
    fc.assert(
      fc.property(boxWithChannel, (scene) => {
        expect(parseScene(JSON.parse(JSON.stringify(scene))).ok).toBe(true);
        const g = buildGeometry(scene);
        const mesh = buildMesh(g, 1100);
        const emitter = g.emitters[0];
        if (emitter === undefined) throw new Error('no emitter');
        const direct = directOnPatches(g, mesh, emitter);
        const rho = patchReflectance(g, mesh);
        const { indirect } = solve(formFactors(g, mesh), rho, direct);
        let area = 0;
        let arrived = 0;
        let bounced = 0;
        for (let i = 0; i < mesh.count; i++) {
          const a = mesh.area[i] ?? 0;
          area += a;
          arrived += a * (direct[i] ?? 0);
          bounced += a * (indirect[i] ?? 0);
        }
        const flux = emitter.length;
        // Every lumen the tape gives out lands on a surface.
        expect(Math.abs(arrived / flux - 1)).toBeLessThan(0.015);
        // Mean indirect illuminance is flux × ρ ÷ (area × (1 − ρ)).
        const r = scene.reflectance.walls;
        const want = (flux * r) / (area * (1 - r));
        expect(Math.abs(bounced / area / want - 1)).toBeLessThan(0.02);
      }),
      { numRuns: runs },
    );
  });

  it('is linear in the light put in', () => {
    fc.assert(
      fc.property(
        boxWithChannel,
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (scene, a, b) => {
          const second = mount(
            'b',
            'channel',
            scene.mounts[0]?.side === 'left' ? 'right' : 'left',
            scene.length,
            {
              height: scene.height / 2,
            },
          );
          const g = buildGeometry({ ...scene, mounts: [...scene.mounts, second] });
          const mesh = buildMesh(g, 700);
          const F = formFactors(g, mesh);
          const rho = patchReflectance(g, mesh);
          const [e0, e1] = g.emitters;
          if (e0 === undefined || e1 === undefined) throw new Error('no emitters');
          const d0 = directOnPatches(g, mesh, e0);
          const d1 = directOnPatches(g, mesh, e1);
          const mixed = d0.map((v, i) => a * v + b * (d1[i] ?? 0));
          const s0 = solve(F, rho, d0, 1e-10, 3000).indirect;
          const s1 = solve(F, rho, d1, 1e-10, 3000).indirect;
          const sum = solve(F, rho, mixed, 1e-10, 3000).indirect;
          for (let i = 0; i < mesh.count; i += 11) {
            const want = a * (s0[i] ?? 0) + b * (s1[i] ?? 0);
            expect(Math.abs((sum[i] ?? 0) - want)).toBeLessThanOrEqual(1e-6 * Math.max(1, want));
          }
        },
      ),
      { numRuns: runs },
    );
  });

  it('never throws on any value offered as a scene', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = parseScene(v);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: Number(process.env['PROP_RUNS'] ?? 100) },
    );
  });
});
