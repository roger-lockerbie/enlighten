import { describe, expect, it } from 'vitest';
import {
  MAX_MOUNTS,
  MOUNT_DEFAULTS,
  defaultScene,
  geometryText,
  mount,
  parseScene,
  sharesPocket,
  sixMountScene,
  span,
} from './scene.ts';
import type { Scene } from './scene.ts';

const copy = (s: Scene): Record<string, unknown> =>
  JSON.parse(JSON.stringify(s)) as Record<string, unknown>;

function withMount(over: Record<string, unknown>, index = 0): unknown {
  const s = copy(defaultScene());
  const mounts = s['mounts'] as Record<string, unknown>[];
  mounts[index] = { ...mounts[index], ...over };
  return s;
}

describe('the scene', () => {
  it('has a default that passes its own check and comes back equal', () => {
    const s = defaultScene();
    const r = parseScene(copy(s));
    expect(r).toEqual({ ok: true, value: s });
    expect(s.mounts.map((m) => [m.kind, m.side, m.tape, m.unit])).toEqual([
      ['skirting', 'left', 'A', 'A'],
      ['channel', 'right', 'B', 'B'],
    ]);
  });

  it('has a full scene for timing that passes the check', () => {
    const six = sixMountScene();
    expect(six.mounts).toHaveLength(MAX_MOUNTS);
    expect(parseScene(copy(six))).toEqual({ ok: true, value: six });
  });

  it('says where each default came from', () => {
    expect(MOUNT_DEFAULTS.channel.height).toEqual({
      value: 0.6,
      basis: 'The brief',
      sourced: true,
    });
    expect(MOUNT_DEFAULTS.reveal.slotHeight.sourced).toBe(false);
  });

  it('refuses values that are not scenes', () => {
    for (const bad of [null, 3, 'x', [], new Date(0)]) {
      expect(parseScene(bad).ok).toBe(false);
    }
    expect(parseScene({ ...copy(defaultScene()), extra: 1 }).ok).toBe(false);
    expect(parseScene({ ...copy(defaultScene()), length: 100 }).ok).toBe(false);
    expect(parseScene({ ...copy(defaultScene()), endWalls: 'ajar' }).ok).toBe(false);
    expect(
      parseScene({ ...copy(defaultScene()), reflectance: { ceiling: 1, walls: 0.5, floor: 0.5 } })
        .ok,
    ).toBe(false);
    expect(
      parseScene({ ...copy(defaultScene()), reflectance: { ceiling: 0.5, walls: 0.5 } }).ok,
    ).toBe(false);
    expect(parseScene({ ...copy(defaultScene()), mounts: 'none' }).ok).toBe(false);
    const many = Array.from({ length: 7 }, (_, i) =>
      mount(`m${String(i)}`, 'channel', 'left', 5, { height: 0.2 + i * 0.3 }),
    );
    expect(parseScene({ ...copy(defaultScene()), mounts: many }).ok).toBe(false);
  });

  it('refuses a mount with wrong keys, a bad name or a value out of range', () => {
    expect(parseScene(withMount({ colour: 'red' })).ok).toBe(false);
    expect(parseScene(withMount({ id: 'Not OK' })).ok).toBe(false);
    expect(parseScene(withMount({ unit: 'a b' })).ok).toBe(false);
    expect(parseScene(withMount({ kind: 'cove' })).ok).toBe(false);
    expect(parseScene(withMount({ aperture: 0.5 })).ok).toBe(false);
    expect(parseScene(withMount({ gradient: Number.NaN })).ok).toBe(false);
    expect(parseScene(withMount({ start: 1, length: 4.5 })).ok).toBe(false);
    expect(parseScene(withMount({ slotDepth: 0.004 })).ok).toBe(false);
    expect(parseScene(withMount({ aperture: 0.03 })).ok).toBe(false);
    expect(parseScene(withMount({ setback: 0.019 })).ok).toBe(false);
    expect(parseScene(withMount({ height: 2.699 }, 1)).ok).toBe(false);
    expect(parseScene(withMount({ kind: 'reveal', height: 2.69 })).ok).toBe(false);
    expect(parseScene([1]).ok).toBe(false);
  });

  it('settles the fields a kind does not use', () => {
    const r = parseScene(withMount({ height: 1, facing: 'up' }));
    expect(r.ok && r.value.mounts[0]?.height).toBe(0);
    expect(r.ok && r.value.mounts[0]?.facing).toBe('down');
    const c = parseScene(withMount({ slotDepth: 0.1, setback: 0.05 }, 1));
    expect(c.ok && c.value.mounts[1]?.slotDepth).toBe(0);
    expect(c.ok && c.value.mounts[1]?.setback).toBe(0);
  });

  it('refuses mounts that overlap or share an id, and allows a reveal lit both ways', () => {
    const base = defaultScene();
    const up = mount('r1', 'reveal', 'left', 5, { facing: 'up' });
    const down = mount('r2', 'reveal', 'left', 5, { facing: 'down' });
    expect(sharesPocket(up, down)).toBe(true);
    expect(parseScene(copy({ ...base, mounts: [up, down] })).ok).toBe(true);
    expect(parseScene(copy({ ...base, mounts: [up, { ...down, facing: 'up' }] })).ok).toBe(false);
    expect(parseScene(copy({ ...base, mounts: [up, { ...down, id: 'r1' }] })).ok).toBe(false);
    const clash = mount('c1', 'channel', 'left', 5, { height: 2.41 });
    expect(parseScene(copy({ ...base, mounts: [up, clash] })).ok).toBe(false);
    const clear = mount('c1', 'channel', 'right', 5, { height: 2.41 });
    expect(parseScene(copy({ ...base, mounts: [up, clear] })).ok).toBe(true);
    const beside = [
      mount('a', 'channel', 'left', 5, { start: 0, length: 2 }),
      mount('b', 'channel', 'left', 5, { start: 2, length: 3 }),
    ];
    expect(parseScene(copy({ ...base, mounts: beside })).ok).toBe(true);
  });

  it('gives each kind its place on the wall', () => {
    expect(span(mount('a', 'skirting', 'left', 5))).toEqual({ y0: 0, y1: 0.025, x0: 0, x1: 5 });
    const r = span(mount('a', 'reveal', 'left', 5));
    expect(r.y0).toBe(2.4);
    expect(r.y1).toBeCloseTo(2.43, 12);
    const c = span(mount('a', 'channel', 'left', 5));
    expect(c.y0).toBeCloseTo(0.594, 12);
    expect(c.y1).toBeCloseTo(0.606, 12);
  });

  it('keys the geometry on what changes the paths of light, and nothing else', () => {
    const s = defaultScene();
    const first = s.mounts[0];
    const rest = s.mounts.slice(1);
    if (first === undefined) throw new Error('no mount');
    const same: Scene = {
      ...s,
      mounts: [
        { ...first, tape: 'COB', diffuser: 'none', depth: 0.005, unit: 'B', id: 'zz' },
        ...rest,
      ],
    };
    expect(geometryText(same)).toBe(geometryText(s));
    for (const change of [
      { ...s, width: 1.3 },
      { ...s, endWalls: 'open' as const },
      { ...s, reflectance: { ...s.reflectance, floor: 0.4 } },
      { ...s, mounts: [{ ...first, slotHeight: 0.03 }, ...rest] },
      { ...s, mounts: [{ ...first, gradient: 0.1 }, ...rest] },
      { ...s, mounts: rest },
    ]) {
      expect(geometryText(change)).not.toBe(geometryText(s));
    }
  });
});
