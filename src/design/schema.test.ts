import { describe, expect, it } from 'vitest';
import { looks, parseFade, parseLook, parseTarget, slots } from './schema.ts';

describe('a look from outside', () => {
  it('accepts each kind of colour and an optional fade', () => {
    for (const l of [
      { name: 'Plain', arc: 0, colour: { kind: 'none' } },
      { name: 'Warm', arc: 254, colour: { kind: 'tc', mirek: 370 } },
      {
        name: 'Rose',
        arc: 100,
        colour: { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 255] },
        fade: { kind: 'extended', value: 0x4f },
      },
      { name: 'F', arc: 1, colour: { kind: 'none' }, fade: { kind: 'standard', value: 15 } },
    ])
      expect(parseLook(l)).toEqual({ ok: true, value: l });
  });

  it('refuses anything else', () => {
    const base = { name: 'Warm', arc: 100, colour: { kind: 'none' } };
    for (const bad of [
      null,
      { ...base, arc: 255 },
      { ...base, arc: 1.5 },
      { ...base, name: '' },
      { ...base, name: ' Warm' },
      { ...base, name: 'x'.repeat(61) },
      { ...base, name: 3 },
      { ...base, extra: 1 },
      { ...base, colour: { kind: 'tc', mirek: 0 } },
      { ...base, colour: { kind: 'tc', mirek: 0xffff } },
      { ...base, colour: { kind: 'tc' } },
      { ...base, colour: { kind: 'rgbwaf', channels: [1, 2, 3] } },
      { ...base, colour: { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 256] } },
      { ...base, colour: { kind: 'rgbwaf', channels: 'x' } },
      { ...base, colour: { kind: 'xy' } },
      { ...base, colour: 'red' },
      { ...base, fade: { kind: 'standard', value: 16 } },
      { ...base, fade: { kind: 'extended', value: 0x50 } },
      { ...base, fade: { kind: 'slow', value: 1 } },
      JSON.parse('{"name":"Warm","arc":1,"colour":{"kind":"none"},"__proto__":{}}') as unknown,
    ])
      expect(parseLook(bad).ok).toBe(false);
  });
});

describe('lists', () => {
  it('refuses two looks with one name, and two entries for one slot', () => {
    const l = { name: 'Warm', arc: 100, colour: { kind: 'none' } };
    expect(looks([l, { ...l, name: 'Other' }], 'looks').ok).toBe(true);
    expect(looks([l, l], 'looks')).toEqual({
      ok: false,
      error: 'looks: the look Warm appears twice.',
    });
    const s = { address: 0, slot: 3, look: 'Warm', arc: 100 };
    expect(slots([s, { ...s, slot: 4 }], 'slots').ok).toBe(true);
    expect(slots([s, s], 'slots').ok).toBe(false);
    expect(slots([{ ...s, slot: 16 }], 'slots').ok).toBe(false);
    expect(slots([{ ...s, address: 64 }], 'slots').ok).toBe(false);
  });
});

describe('a target and a fade', () => {
  it('accepts a short address, a group and broadcast', () => {
    expect(parseTarget({ kind: 'short', n: 63 })).toEqual({
      ok: true,
      value: { kind: 'short', n: 63 },
    });
    expect(parseTarget({ kind: 'group', n: 15 })).toEqual({
      ok: true,
      value: { kind: 'group', n: 15 },
    });
    expect(parseTarget({ kind: 'broadcast' })).toEqual({ ok: true, value: { kind: 'broadcast' } });
  });

  it('refuses the rest', () => {
    for (const bad of [
      null,
      [],
      'all',
      { kind: 'short', n: 64 },
      { kind: 'short', n: -1 },
      { kind: 'short' },
      { kind: 'group', n: 16 },
      { kind: 'group', n: 1.5 },
      { kind: 'broadcast', n: 1 },
      { kind: 'unaddressed' },
      { kind: 'short', n: 1, x: 2 },
    ])
      expect(parseTarget(bad).ok).toBe(false);
    expect(parseFade({ kind: 'standard', value: 3 }).ok).toBe(true);
    expect(parseFade(7).ok).toBe(false);
  });
});
