import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Facing, MountKind, Side } from './scene.ts';
import { MAX_MOUNTS, parseScene } from './scene.ts';
import type { Edit, PresetId, Setup, Surface } from './setup.ts';
import {
  addMount,
  applyPreset,
  defaultSetup,
  linkHolds,
  mirror,
  parseSetup,
  removeMount,
  setFacing,
  setHallway,
  setMountField,
  setReflectance,
} from './setup.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

const kind = fc.constantFrom<MountKind>('skirting', 'reveal', 'channel');
const side = fc.constantFrom<Side>('left', 'right');
const facing = fc.constantFrom<Facing | 'both'>('up', 'down', 'both');
const surface = fc.constantFrom<Surface>('ceiling', 'walls', 'floor');
const preset = fc.constantFrom<PresetId>(
  'skirting',
  'channel',
  'reveal-up',
  'reveal-down',
  'mirrored',
);
/** Which mount an edit is aimed at, as an index into the mounts there are when it runs. */
const pick = fc.nat({ max: 7 });

type Step = (s: Setup) => Edit;

const step: fc.Arbitrary<Step> = fc.oneof(
  fc
    .record({
      length: fc.double({ min: 0.5, max: 13, noNaN: true }),
      width: fc.double({ min: 0.9, max: 1.6, noNaN: true }),
      height: fc.double({ min: 2.3, max: 3.1, noNaN: true }),
    })
    .map((c) => (s: Setup) => setHallway(s, c)),
  fc.tuple(surface, fc.double({ min: -0.1, max: 1, noNaN: true })).map(
    ([w, v]) =>
      (s: Setup) =>
        setReflectance(s, w, v),
  ),
  fc.tuple(kind, side, fc.nat({ max: 63 })).map(
    ([k, sd, a]) =>
      (s: Setup) =>
        addMount(s, k, sd, a),
  ),
  pick.map((i) => (s: Setup) => removeMount(s, idAt(s, i))),
  fc.tuple(pick, kind).map(
    ([i, k]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'kind', k),
  ),
  fc.tuple(pick, side).map(
    ([i, sd]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'side', sd),
  ),
  fc.tuple(pick, fc.double({ min: 0, max: 3, noNaN: true })).map(
    ([i, h]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'height', h),
  ),
  fc.tuple(pick, fc.double({ min: 0, max: 12, noNaN: true })).map(
    ([i, v]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'start', v),
  ),
  fc.tuple(pick, fc.double({ min: 0, max: 12, noNaN: true })).map(
    ([i, v]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'length', v),
  ),
  fc.tuple(pick, fc.double({ min: 0, max: 0.06, noNaN: true })).map(
    ([i, v]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'aperture', v),
  ),
  fc.tuple(pick, fc.integer({ min: -2, max: 66 })).map(
    ([i, a]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'address', a),
  ),
  fc.tuple(pick, fc.constantFrom('none', 'clear', 'frosted', 'opal-market', 'opal-linear-lux')).map(
    ([i, d]) =>
      (s: Setup) =>
        setMountField(s, idAt(s, i), 'diffuser', d),
  ),
  fc.tuple(pick, facing).map(
    ([i, f]) =>
      (s: Setup) =>
        setFacing(s, idAt(s, i), f),
  ),
  fc.tuple(pick, fc.boolean()).map(
    ([i, on]) =>
      (s: Setup) =>
        mirror(s, idAt(s, i), on),
  ),
  preset.map((p) => (s: Setup) => applyPreset(s, p)),
);

function idAt(s: Setup, i: number): string {
  const ms = s.scene.mounts;
  return ms.length === 0 ? 'none' : (ms[i % ms.length]?.id ?? 'none');
}

/** What every set-up the editor makes must be. */
function sound(s: Setup): void {
  expect(parseScene(s.scene)).toEqual({ ok: true, value: s.scene });
  expect(s.scene.mounts.length).toBeLessThanOrEqual(MAX_MOUNTS);
  for (const l of s.links) expect(linkHolds(s.scene, l)).toBe(true);
  // At most one link of each kind for each mount.
  const seen = new Set<string>();
  for (const l of s.links) {
    for (const id of [l.a, l.b]) {
      const key = `${l.kind}:${id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }
  expect(parseSetup(JSON.parse(JSON.stringify(s)))).toEqual({ ok: true, value: s });
}

describe('the mount editor', () => {
  it('only ever makes valid set-ups, whose links hold, and refuses with a reason', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        let s = defaultSetup();
        for (const st of steps) {
          const e = st(s);
          if (e.ok) {
            sound(e.setup);
            s = e.setup;
          } else {
            expect(e.reason).toMatch(/^[A-Z].*\.$/);
          }
        }
      }),
      { numRuns: runs },
    );
  });

  it('fits mounts to a smaller hallway, refusing only when two would overlap', () => {
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 15 }),
        fc.double({ min: 1, max: 12, noNaN: true }),
        fc.double({ min: 2.4, max: 3, noNaN: true }),
        (steps, length, height) => {
          let s = defaultSetup();
          for (const st of steps) {
            const e = st(s);
            if (e.ok) s = e.setup;
          }
          const e = setHallway(s, { length, height });
          if (e.ok) {
            sound(e.setup);
            expect(e.setup.scene.mounts).toHaveLength(s.scene.mounts.length);
          } else {
            expect(e.reason).toMatch(/overlap|same place/);
          }
        },
      ),
      { numRuns: runs },
    );
  });
});
