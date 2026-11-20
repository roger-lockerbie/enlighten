/**
 * The checks on stored and imported set-ups (S8-I3): on any value, `parseSetup`, `parseSaved`,
 * `parseView` and `importSetups` return a result and never throw, and what they accept is checked
 * again the same way after a trip through JSON.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseView } from './camera.ts';
import { defaultSaved, exportSetups, importSetups, parseSaved, toWorkspace } from './saved.ts';
import { parseScene } from './scene.ts';
import { applyPreset, defaultSetup, parseSetup } from './setup.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;

/** Arbitrary JSON, with the keys a hostile file would try, minus zero and long strings. */
const hostile = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.jsonValue(),
    fc.constantFrom(-0, Number.MAX_VALUE, 'x'.repeat(20_000), '__proto__'),
    fc.dictionary(
      fc.oneof(
        fc.constantFrom('__proto__', 'constructor', 'prototype', 'a', 'b', 'scene', 'links'),
        fc.string(),
      ),
      tie('value'),
      { maxKeys: 6 },
    ),
    fc.array(tie('value'), { maxLength: 8 }),
  ),
})).value;

/** A valid set-up with some of its values swapped for hostile ones. */
const spoiled = fc
  .tuple(
    fc.constantFrom('skirting', 'channel', 'reveal-up', 'reveal-down', 'mirrored'),
    fc.array(fc.tuple(fc.nat(), fc.string({ maxLength: 12 }), hostile), { maxLength: 3 }),
  )
  .map(([preset, swaps]) => {
    const r = applyPreset(defaultSetup(), preset);
    const w = json(toWorkspace(r.ok ? r.setup : defaultSetup())) as Record<string, unknown>;
    for (const [i, key, value] of swaps) {
      const mounts = w['mounts'] as Record<string, unknown>[];
      const target = mounts[i % mounts.length] ?? w;
      target[key] = value;
    }
    return w;
  });

describe('checking set-ups from outside', () => {
  it('never throws, and what it accepts survives a JSON round trip', () => {
    fc.assert(
      fc.property(fc.oneof(hostile, spoiled), (v) => {
        const setup = parseSetup(v);
        if (setup.ok) {
          expect(parseSetup(json(setup.value))).toEqual(setup);
          expect(parseScene(json(setup.value.scene)).ok).toBe(true);
        }
        const saved = parseSaved(v);
        if (saved.ok) expect(parseSaved(json(saved.value))).toEqual(saved);
        const view = parseView(v);
        if (view !== undefined) expect(parseView(json(view))).toEqual(view);
        const imported = importSetups(defaultSaved(), {
          hallway: (v as Record<string, unknown> | null)?.['hallway'],
          mounts: (v as Record<string, unknown> | null)?.['mounts'],
          links: (v as Record<string, unknown> | null)?.['links'],
        });
        if (imported.ok && imported.value !== undefined) {
          const again = importSetups(
            defaultSaved(),
            json(exportSetups(imported.value.saved)) as object,
          );
          expect(again.ok && again.value?.saved.a).toEqual(imported.value.saved.a);
        }
      }),
      { numRuns: runs },
    );
  });
});
