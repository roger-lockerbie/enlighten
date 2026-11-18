/**
 * The light core against the reference path tracer (docs/research/rendering.md section 6, item 8).
 * The fixtures are written by `pnpm reference`, which shares only the scene description with the
 * core. This test reads them and runs nothing from the tool.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sample } from './atlas.ts';
import { buildGeometry, faceAt } from './geometry.ts';
import { directAt, solveScene } from './response.ts';
import { parseScene } from './scene.ts';

interface RefProbe {
  readonly name: string;
  readonly point: [number, number, number];
  readonly normal: [number, number, number];
  readonly direct: number;
  readonly indirect: number;
  readonly directError: number;
  readonly indirectError: number;
}
interface RefSetup {
  readonly name: string;
  readonly scene: unknown;
  readonly probes: readonly RefProbe[];
}

const file = resolve(import.meta.dirname, '..', '..', 'tests', 'golden', 'light', 'reference.json');
const reference = JSON.parse(readFileSync(file, 'utf8')) as { setups: RefSetup[] };

/**
 * Bounced light just outside an opening has a sharp edge: the part of the floor that cannot see
 * into the opening. The mesh smooths that edge over one 12.5 mm patch (ADR 0017), so these points
 * are held to a looser bound.
 */
const SHADOW_EDGE = new Set(['open-ends: floor z=0.03']);

describe('the core against the reference path tracer', () => {
  it('has the four set-ups', () => {
    expect(reference.setups.map((s) => s.name)).toEqual([
      'channel',
      'skirting',
      'reveal-up',
      'open-ends',
    ]);
  });

  for (const setup of reference.setups) {
    it(`agrees on ${setup.name}`, () => {
      const parsed = parseScene(setup.scene);
      if (!parsed.ok) throw new Error(parsed.error);
      const g = buildGeometry(parsed.value);
      const response = solveScene(parsed.value);
      const layer = response.layers[0];
      if (layer === undefined) throw new Error('no layer');
      let worstDirect = 0;
      let worstIndirect = 0;
      for (const p of setup.probes) {
        const at = faceAt(g, p.point, p.normal);
        if (at === undefined) throw new Error(`${p.name} is on no face`);
        const direct = directAt(g, 0, p.point, p.normal, at.face.cell);
        const indirect = sample(response.atlas, layer, at.face, at.s, at.t);
        // Direct light is exact: the tolerance is the reference's own noise.
        const directSlack = Math.max(0.01 * p.direct, 5 * p.directError, 1e-9);
        expect(Math.abs(direct - p.direct), `${p.name} direct`).toBeLessThanOrEqual(directSlack);
        const loose = SHADOW_EDGE.has(`${setup.name}: ${p.name}`);
        const indirectSlack = Math.max((loose ? 0.25 : 0.1) * p.indirect, 5 * p.indirectError);
        expect(Math.abs(indirect - p.indirect), `${p.name} indirect`).toBeLessThanOrEqual(
          indirectSlack,
        );
        if (p.direct > 0) worstDirect = Math.max(worstDirect, Math.abs(direct / p.direct - 1));
        if (!loose) worstIndirect = Math.max(worstIndirect, Math.abs(indirect / p.indirect - 1));
      }
      expect(worstDirect).toBeLessThan(0.02);
      expect(worstIndirect).toBeLessThan(0.1);
    });
  }
});
