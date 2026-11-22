import { describe, expect, it } from 'vitest';
import { MemoryBackend, Store } from '../store/store.ts';
import { defaultDesign, parseDesign, type Design } from './saved.ts';

const design: Design = {
  looks: [{ name: 'Warm', arc: 120, colour: { kind: 'tc', mirek: 370 } }],
  slots: [{ address: 0, slot: 3, look: 'Warm', arc: 120 }],
};

describe('the stored design', () => {
  it('accepts a library and its slot map, and starts empty', () => {
    expect(parseDesign(design)).toEqual({ ok: true, value: design });
    expect(parseDesign(defaultDesign()).ok).toBe(true);
  });

  it('refuses a slot that names no look, unknown keys and missing parts', () => {
    expect(parseDesign({ looks: [], slots: design.slots })).toEqual({
      ok: false,
      error: 'slots: A0 slot 3 names a look the library does not have.',
    });
    expect(parseDesign({ ...design, extra: 1 }).ok).toBe(false);
    expect(parseDesign({ looks: [] }).ok).toBe(false);
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
      store.saveDesign(parseDesign, { looks: [], slots: design.slots }),
    ).rejects.toThrow();
    await b.put('design', { version: 1, data: { looks: 'x', slots: [] } });
    const r = await store.loadDesign(parseDesign, defaultDesign());
    expect(r.value).toEqual(defaultDesign());
    expect(r.problem).toMatch(/set aside/);
    expect(await store.setAside()).toEqual(['set-aside:design:2026-11-22T09-00-00']);
  });
});
