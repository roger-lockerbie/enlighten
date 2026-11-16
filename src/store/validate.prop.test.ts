/**
 * P-validator: the workspace validator never throws on any JSON value, never returns an object with a
 * forbidden key, and accepts everything `exportWorkspace` produces.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkPreferences, checkWorkspace } from './schema.ts';
import { exportWorkspace, readWorkspace } from './store.ts';
import { SETTING_EDIT } from '../sim/settings.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

function hasForbidden(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  for (const k of Object.keys(v)) {
    if (FORBIDDEN.includes(k)) return true;
    if (hasForbidden((v as Record<string, unknown>)[k])) return true;
  }
  return false;
}

/** JSON values that look like workspace files, so the schema is reached and not just the header. */
const nearWorkspace = fc.record(
  {
    format: fc.oneof(fc.constant('enlighten-workspace'), fc.jsonValue()),
    version: fc.oneof(fc.constant(1), fc.jsonValue()),
    ceiling: fc.oneof(fc.integer({ min: -5, max: 300 }), fc.jsonValue()),
    preferences: fc.oneof(
      fc.record(
        { playgroundMode: fc.jsonValue(), reducedMotion: fc.jsonValue() },
        { requiredKeys: [] },
      ),
      fc.jsonValue(),
    ),
    devices: fc.oneof(
      fc.array(
        fc.record(
          {
            address: fc.oneof(fc.integer({ min: -1, max: 64 }), fc.jsonValue()),
            alias: fc.oneof(fc.string({ maxLength: 70 }), fc.jsonValue()),
            presentation: fc.oneof(fc.constantFrom('tc', 'rgbwaf', 'xy'), fc.jsonValue()),
            settings: fc.oneof(fc.dictionary(fc.string(), fc.jsonValue()), fc.jsonValue()),
          },
          { requiredKeys: [] },
        ),
        { maxLength: 70 },
      ),
      fc.jsonValue(),
    ),
    __proto__: fc.jsonValue(),
    looks: fc.jsonValue(),
  },
  { requiredKeys: [] },
);

const settingsArb = fc
  .subarray(
    Object.entries(SETTING_EDIT).filter(([, e]) => e.kind !== 'fixed'),
    { maxLength: 6 },
  )
  .chain((entries) =>
    fc.tuple(
      ...entries.map(([k, e]) =>
        (e.kind === 'choice'
          ? fc.constantFrom(...e.values)
          : e.kind === 'range'
            ? fc.integer({ min: e.min, max: e.max })
            : fc.constant(0)
        ).map((v) => [k, v] as const),
      ),
    ),
  )
  .map((pairs) => Object.fromEntries(pairs) as Record<string, unknown>)
  // A factory MAX LEVEL under the physical minimum is refused on its own.
  .filter(
    (o) =>
      ((o['factoryMaxLevel'] as number | undefined) ?? 254) >=
      ((o['physicalMinimum'] as number | undefined) ?? 85),
  );

const validContent = fc.record(
  {
    ceiling: fc.integer({ min: 1, max: 254 }),
    preferences: fc.record(
      {
        playgroundMode: fc.constantFrom('live' as const, 'commit' as const),
        reducedMotion: fc.constantFrom('system' as const, 'always' as const),
      },
      { requiredKeys: [] },
    ),
    devices: fc.uniqueArray(
      fc.record(
        {
          address: fc.integer({ min: 0, max: 63 }),
          alias: fc.string({ maxLength: 60 }),
          presentation: fc.constantFrom('tc' as const, 'rgbwaf' as const),
          settings: settingsArb,
        },
        { requiredKeys: ['address'] },
      ),
      { maxLength: 64, selector: (d) => d.address },
    ),
  },
  { requiredKeys: [] },
);

describe('P-validator', () => {
  it('never throws on any JSON value or text, and never returns a forbidden key', () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), nearWorkspace), (v) => {
        const w = checkWorkspace(v);
        const p = checkPreferences(v);
        const r = readWorkspace(JSON.stringify(v), { ceilingArc: 220 });
        for (const x of [w, p]) if (x.ok && hasForbidden(x.value)) return false;
        if (r.ok && hasForbidden(r.value.workspace)) return false;
        return true;
      }),
      { numRuns: runs * 5 },
    );
  });

  it('never throws on any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (t) => {
        readWorkspace(t, { ceilingArc: 220 });
      }),
      { numRuns: runs * 5 },
    );
  });

  it('accepts everything exportWorkspace produces, unchanged', () => {
    fc.assert(
      fc.property(validContent, (content) => {
        const text = exportWorkspace(content);
        const r = readWorkspace(text, { ceilingArc: 220 });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.lowerCeiling === undefined || r.value.lowerCeiling < 220).toBe(true);
          expect(JSON.parse(exportWorkspace(r.value.workspace))).toEqual(JSON.parse(text));
        }
      }),
      { numRuns: runs },
    );
  });
});
