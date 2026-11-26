import { describe, expect, it } from 'vitest';
import { presetPlate } from '../switch/presets.ts';
import { MemoryBackend, Store } from '../store/store.ts';
import { defaultDesign, exportDesign, importDesign, parseDesign, type Design } from './stored.ts';

const design: Design = {
  plates: [presetPlate('p1', 'zencontrol', 2)],
  looks: [{ name: 'Warm', arc: 120, colour: { kind: 'tc', mirek: 370 } }],
  slots: [{ address: 0, slot: 3, look: 'Warm', arc: 120 }],
  sequences: [
    {
      name: 'Up',
      steps: [
        { target: { kind: 'broadcast' }, arc: 150, colour: { kind: 'none' }, durationMs: 2000 },
        {
          target: { kind: 'short', n: 1 },
          arc: 0,
          colour: { kind: 'none' },
          durationMs: 0,
          together: true,
        },
      ],
    },
  ],
  effects: [
    { name: 'Slow breath', type: 'breathe', params: { depth: 8, period: 12 }, targets: [0, 1] },
  ],
};

describe('the stored design', () => {
  it('accepts a library and its slot map, and starts empty', () => {
    expect(parseDesign(design)).toEqual({ ok: true, value: design });
    expect(parseDesign(defaultDesign()).ok).toBe(true);
  });

  it('refuses a slot that names no look, unknown keys and missing parts', () => {
    expect(parseDesign({ looks: [], slots: design.slots, sequences: [], effects: [] })).toEqual({
      ok: false,
      error: 'slots: A0 slot 3 names a look the library does not have.',
    });
    expect(parseDesign({ ...design, extra: 1 }).ok).toBe(false);
    expect(parseDesign({ looks: [] }).ok).toBe(false);
    const twice = { ...design, sequences: [...design.sequences, ...design.sequences] };
    expect(parseDesign(twice).ok).toBe(false);
    const step = {
      target: { kind: 'broadcast' },
      arc: 1,
      colour: { kind: 'none' },
      durationMs: -1,
    };
    expect(parseDesign({ ...design, sequences: [{ name: 'Bad', steps: [step] }] }).ok).toBe(false);
    expect(parseDesign(null).ok).toBe(false);
  });

  it('is saved and loaded by the store, and set aside when it cannot be used', async () => {
    const b = new MemoryBackend();
    const store = new Store(b, () => '2026-11-22T09-00-00');
    expect(await store.loadDesign(parseDesign, defaultDesign())).toEqual({
      value: defaultDesign(),
    });
    await store.saveDesign(parseDesign, design);
    expect(b.map.get('design')).toEqual({ version: 1, data: design });
    expect(await store.loadDesign(parseDesign, defaultDesign())).toEqual({ value: design });
    await expect(
      store.saveDesign(parseDesign, {
        looks: [],
        slots: design.slots,
        sequences: [],
        effects: [],
        plates: [],
      }),
    ).rejects.toThrow();
    await b.put('design', {
      version: 1,
      data: { looks: 'x', slots: [], sequences: [], effects: [] },
    });
    const r = await store.loadDesign(parseDesign, defaultDesign());
    expect(r.value).toEqual(defaultDesign());
    expect(r.problem).toMatch(/set aside/);
    expect(await store.setAside()).toEqual(['set-aside:design:2026-11-22T09-00-00']);
  });
});

describe('the design in a workspace file', () => {
  it('exports only the parts that hold something', () => {
    expect(exportDesign(defaultDesign())).toEqual({});
    expect(exportDesign(design)).toEqual(design);
    expect(Object.keys(exportDesign({ ...defaultDesign(), looks: design.looks }))).toEqual([
      'looks',
    ]);
  });

  it('does nothing for a file with none of its parts', () => {
    expect(importDesign(design, {})).toEqual({ ok: true, value: undefined });
  });

  it('puts each part the file has in place of the stored one, and says so', () => {
    const file = {
      looks: [
        { name: 'Cool', arc: 100, colour: { kind: 'tc', mirek: 200 } },
        { name: 'Warm', arc: 60, colour: { kind: 'none' } },
      ],
      sequences: [],
      effects: [],
    };
    const r = importDesign(design, file);
    if (!r.ok || r.value === undefined) throw new Error('not imported');
    expect(r.value.design.looks.map((l) => l.name)).toEqual(['Cool', 'Warm']);
    // The stored slot still names a look the file has, so it stays.
    expect(r.value.design.slots).toEqual(design.slots);
    expect(r.value.design.sequences).toEqual([]);
    expect(r.value.changes).toEqual([
      "Looks: the file's 2 looks take the place of the 1 stored.",
      "Sequences: the file's 0 sequences take the place of the 1 stored. None runs until you run it.",
      "Effects: the file's 0 effects take the place of the 1 stored. None runs until you run it.",
    ]);
  });

  it('drops stored slots that name a look the file does not have', () => {
    const r = importDesign(design, {
      looks: [{ name: 'Other', arc: 1, colour: { kind: 'none' } }],
    });
    if (!r.ok || r.value === undefined) throw new Error('not imported');
    expect(r.value.design.slots).toEqual([]);
    expect(r.value.changes).toEqual([
      "Looks: the file's 1 look takes the place of the 1 stored.",
      'Slots: 1 entry names a look the file does not have, and will be dropped from the map.',
    ]);
  });

  it('takes a slot map from the file, and writes nothing to any driver', () => {
    const r = importDesign(defaultDesign(), { looks: design.looks, slots: design.slots });
    if (!r.ok || r.value === undefined) throw new Error('not imported');
    expect(r.value.design.slots).toEqual(design.slots);
    expect(r.value.changes[1]).toBe(
      "Slots: the file's map of 1 slot takes the place of the stored one. Nothing is written to any driver.",
    );
  });

  it('refuses a file whose parts do not pass the checks', () => {
    for (const file of [
      { looks: [{ name: 'Bad', arc: 999, colour: { kind: 'none' } }] },
      { looks: 'x' },
      { slots: [{ address: 0, slot: 3, look: 'Nobody', arc: 1 }] },
      { sequences: [{ name: 'S', steps: [{ target: { kind: 'short', n: 99 } }] }] },
      {
        effects: [{ name: 'E', type: 'breathe', params: { depth: 99, period: 12 }, targets: [0] }],
      },
      { effects: [{ name: 'E', type: 'strobe', params: {}, targets: [0] }] },
    ]) {
      const r = importDesign(design, file);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^The file's looks, sequences or effects: /);
    }
  });
});
