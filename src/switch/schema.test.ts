import { describe, expect, it } from 'vitest';
import { presetPlate } from './presets.ts';
import { parsePlates } from './schema.ts';
import type { Family, Layout } from './plate.ts';

describe('plate schema', () => {
  it('accepts every preset', () => {
    for (const f of ['zencontrol', 'coupler', 'knx'] as Family[])
      for (const l of [1, 2, 4] as Layout[]) {
        const r = parsePlates([JSON.parse(JSON.stringify(presetPlate('p1', f, l)))]);
        expect(r.ok, `${f} ${String(l)}`).toBe(true);
      }
  });

  it('refuses unknown keys, bad timers, three buttons and repeated ids', () => {
    const p = JSON.parse(JSON.stringify(presetPlate('p1', 'zencontrol', 2))) as Record<
      string,
      unknown
    >;
    expect(parsePlates([{ ...p, extra: 1 }]).ok).toBe(false);
    expect(parsePlates([{ ...p, timers: { ...(p['timers'] as object), shortMs: 30 } }]).ok).toBe(
      false,
    );
    expect(
      parsePlates([
        { ...p, buttons: [...(p['buttons'] as unknown[]), (p['buttons'] as unknown[])[0]] },
      ]).ok,
    ).toBe(false);
    expect(parsePlates([p, p]).ok).toBe(false);
    expect(parsePlates([{ ...p, id: 'BAD ID' }]).ok).toBe(false);
  });

  it('refuses an action that is not one', () => {
    const p = JSON.parse(JSON.stringify(presetPlate('p1', 'zencontrol', 1))) as {
      buttons: { mapping: Record<string, unknown> }[];
    };
    const mapping = p.buttons[0]?.mapping ?? {};
    mapping['short'] = { kind: 'reset' };
    expect(parsePlates([p]).ok).toBe(false);
    mapping['short'] = {
      kind: 'toggle',
      target: { kind: 'short', n: 64 },
      on: 'max',
    };
    expect(parsePlates([p]).ok).toBe(false);
  });
});
