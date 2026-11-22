import { describe, expect, it } from 'vitest';
import { broadcast, short } from '../dali/address.ts';
import {
  clearSlot,
  lookFits,
  MAX_LOOKS,
  putLook,
  readCommands,
  recallCommands,
  recallFadeCommands,
  removeCommands,
  removeLook,
  renameLook,
  setSlot,
  slotState,
  storeCommands,
  type Library,
  type Look,
} from './look.ts';

const warm: Look = { name: 'Warm', arc: 120, colour: { kind: 'tc', mirek: 370 } };
const rose: Look = {
  name: 'Rose',
  arc: 100,
  colour: { kind: 'rgbwaf', channels: [200, 40, 60, 0, 0, 255] },
};
const plain: Look = { name: 'Plain', arc: 90, colour: { kind: 'none' } };
const empty: Library = { looks: [], slots: [] };
const ids = (cmds: readonly { id: string }[]) => cmds.map((c) => c.id);

describe('a look and a driver', () => {
  it('fits when the driver takes its kind of colour, or it has none', () => {
    expect(lookFits(warm, 'tc')).toBeUndefined();
    expect(lookFits(rose, 'rgbwaf')).toBeUndefined();
    for (const d of ['tc', 'rgbwaf', 'level'] as const) expect(lookFits(plain, d)).toBeUndefined();
    expect(lookFits(warm, 'rgbwaf')).toMatch(/colour temperature/);
    expect(lookFits(warm, 'level')).toMatch(/colour temperature/);
    expect(lookFits(rose, 'tc')).toMatch(/RGBWAF/);
  });
});

describe('the commands for a slot', () => {
  it('stores the colour as the temporary colour, then the level, and ends on the read-back', () => {
    expect(ids(storeCommands(short(0), 3, warm, 'tc'))).toEqual([
      'DTR0',
      'DTR1',
      'DT8_SET_TEMPORARY_TC',
      'DTR0',
      'SET_SCENE',
      'QUERY_SCENE_LEVEL',
      // And the temporary colour is left as "no change", in the same transaction.
      'DTR0',
      'DTR1',
      'DT8_SET_TEMPORARY_TC',
    ]);
    const cmds = storeCommands(short(0), 3, warm, 'tc');
    expect(cmds.slice(-3, -1)).toEqual([
      { id: 'DTR0', value: 0xff },
      { id: 'DTR1', value: 0xff },
    ]);
    expect(cmds[0]).toEqual({ id: 'DTR0', value: 370 & 0xff });
    expect(cmds[1]).toEqual({ id: 'DTR1', value: 370 >> 8 });
    expect(cmds[3]).toEqual({ id: 'DTR0', value: 120 });
    expect(cmds[4]).toEqual({ id: 'SET_SCENE', address: short(0), value: 3 });
    expect(ids(storeCommands(short(1), 0, rose, 'rgbwaf'))).toEqual([
      'DTR0',
      'DTR1',
      'DTR2',
      'DT8_SET_TEMPORARY_RGB',
      'DTR0',
      'DTR1',
      'DTR2',
      'DT8_SET_TEMPORARY_WAF',
      'DTR0',
      'SET_SCENE',
      'QUERY_SCENE_LEVEL',
      'DTR0',
      'DTR1',
      'DTR2',
      'DT8_SET_TEMPORARY_RGB',
      'DTR0',
      'DTR1',
      'DTR2',
      'DT8_SET_TEMPORARY_WAF',
    ]);
    // Only the read-back expects a reply, so it is the one answer the store gets.
    const asks = storeCommands(short(1), 0, rose, 'rgbwaf').filter((c) => c.id.startsWith('QUERY'));
    expect(asks).toEqual([{ id: 'QUERY_SCENE_LEVEL', address: short(1), value: 0 }]);
  });

  it('stores "no change" for a look with no colour on colour gear, and nothing extra on plain gear', () => {
    const tc = storeCommands(short(0), 1, plain, 'tc');
    expect(tc.slice(0, 2)).toEqual([
      { id: 'DTR0', value: 0xff },
      { id: 'DTR1', value: 0xff },
    ]);
    const rgb = storeCommands(short(1), 1, plain, 'rgbwaf');
    expect(
      rgb
        .filter((c) => c.id.startsWith('DTR'))
        .slice(0, 6)
        .every((c) => c.value === 255),
    ).toBe(true);
    expect(ids(storeCommands(short(2), 1, plain, 'level'))).toEqual([
      'DTR0',
      'SET_SCENE',
      'QUERY_SCENE_LEVEL',
    ]);
  });

  it('never activates anything', () => {
    for (const cmds of [
      storeCommands(short(0), 1, warm, 'tc'),
      storeCommands(short(1), 1, rose, 'rgbwaf'),
      storeCommands(short(0), 1, plain, 'tc'),
    ])
      expect(ids(cmds)).not.toContain('DT8_ACTIVATE');
  });

  it('removes, reads all sixteen, and recalls with the fade first', () => {
    expect(ids(removeCommands(short(0), 2))).toEqual(['REMOVE_FROM_SCENE', 'QUERY_SCENE_LEVEL']);
    const read = readCommands(short(4));
    expect(read).toHaveLength(16);
    expect(read[15]).toEqual({ id: 'QUERY_SCENE_LEVEL', address: short(4), value: 15 });
    expect(recallCommands(broadcast, 9)).toEqual([
      { id: 'GO_TO_SCENE', address: broadcast, value: 9 },
    ]);
    expect(recallFadeCommands(broadcast, undefined)).toEqual([]);
    expect(ids(recallFadeCommands(broadcast, { kind: 'standard', value: 4 }))).toEqual([
      'DTR0',
      'SET_FADE_TIME',
    ]);
    expect(ids(recallFadeCommands(short(0), { kind: 'extended', value: 0x4f }))).toEqual([
      'DTR0',
      'SET_FADE_TIME',
      'DTR0',
      'SET_EXTENDED_FADE_TIME',
    ]);
  });
});

describe('the library', () => {
  it('adds a look, replaces one by name, and trims the name', () => {
    const one = putLook(empty, { ...warm, name: '  Warm ' });
    expect(one.ok && one.value.looks).toEqual([warm]);
    const two = one.ok ? putLook(one.value, { ...warm, arc: 60 }) : one;
    expect(two.ok && two.value.looks).toEqual([{ ...warm, arc: 60 }]);
    expect(putLook(empty, { ...warm, name: '  ' })).toEqual({
      ok: false,
      reason: 'A look needs a name.',
    });
  });

  it('holds at most 200 looks', () => {
    const full: Library = {
      looks: Array.from({ length: MAX_LOOKS }, (_, i) => ({ ...plain, name: `L${String(i)}` })),
      slots: [],
    };
    expect(putLook(full, warm)).toEqual({
      ok: false,
      reason: 'The library holds at most 200 looks.',
    });
    // Replacing one that is there is still allowed.
    expect(putLook(full, { ...plain, name: 'L3', arc: 5 }).ok).toBe(true);
  });

  it('renames a look and its slots, and refuses a name in use', () => {
    const lib: Library = {
      looks: [warm, rose],
      slots: [{ address: 0, slot: 2, look: 'Warm', arc: 120 }],
    };
    const r = renameLook(lib, 'Warm', ' Evening ');
    expect(r.ok && r.value.looks[0]?.name).toBe('Evening');
    expect(r.ok && r.value.slots[0]?.look).toBe('Evening');
    expect(renameLook(lib, 'Warm', 'Rose')).toEqual({
      ok: false,
      reason: 'Another look has that name.',
    });
    expect(renameLook(lib, 'Gone', 'New')).toEqual({ ok: false, reason: 'No look has that name.' });
    expect(renameLook(lib, 'Warm', '')).toEqual({ ok: false, reason: 'A look needs a name.' });
    expect(renameLook(lib, 'Warm', 'Warm')).toEqual({ ok: true, value: lib });
  });

  it('removes a look with its slots, and sets and clears a slot', () => {
    let lib: Library = { looks: [warm, rose], slots: [] };
    lib = setSlot(lib, { address: 1, slot: 0, look: 'Rose', arc: 100 });
    lib = setSlot(lib, { address: 0, slot: 5, look: 'Warm', arc: 120 });
    lib = setSlot(lib, { address: 0, slot: 2, look: 'Warm', arc: 120 });
    expect(lib.slots.map((s) => `${String(s.address)}/${String(s.slot)}`)).toEqual([
      '0/2',
      '0/5',
      '1/0',
    ]);
    // A second look in the same slot takes the first one's place.
    lib = setSlot(lib, { address: 0, slot: 2, look: 'Rose', arc: 100 });
    expect(lib.slots.filter((s) => s.address === 0 && s.slot === 2)).toEqual([
      { address: 0, slot: 2, look: 'Rose', arc: 100 },
    ]);
    expect(clearSlot(lib, 0, 2).slots).toHaveLength(2);
    expect(removeLook(lib, 'Rose')).toEqual({
      looks: [warm],
      slots: [{ address: 0, slot: 5, look: 'Warm', arc: 120 }],
    });
  });
});

describe("a slot's state", () => {
  const entry = { address: 0, slot: 1, look: 'Warm', arc: 120 };
  it('is pending until the driver has been read', () => {
    expect(slotState(entry, warm, undefined)).toBe('pending');
    expect(slotState(undefined, undefined, undefined)).toBe('pending');
  });
  it('is empty or unlisted when the map has nothing', () => {
    expect(slotState(undefined, undefined, 255)).toBe('empty');
    expect(slotState(undefined, undefined, 80)).toBe('unlisted');
  });
  it('is a mismatch when the look has a different colour from the one written', () => {
    const wrote = { ...entry, colour: warm.colour };
    expect(slotState(wrote, warm, 120)).toBe('verified');
    expect(slotState(wrote, { ...warm, colour: { kind: 'tc', mirek: 200 } }, 120)).toBe('mismatch');
    expect(slotState(wrote, { ...warm, colour: { kind: 'none' } }, 120)).toBe('mismatch');
    const channels = { ...entry, look: 'Rose', arc: 100, colour: rose.colour };
    expect(slotState(channels, rose, 100)).toBe('verified');
    expect(
      slotState(
        channels,
        { ...rose, colour: { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 255] } },
        100,
      ),
    ).toBe('mismatch');
    expect(
      slotState({ ...entry, colour: { kind: 'none' } }, { ...warm, colour: { kind: 'none' } }, 120),
    ).toBe('verified');
  });

  it('is verified only when the driver, the map and the look agree', () => {
    expect(slotState(entry, warm, 120)).toBe('verified');
    expect(slotState(entry, warm, 119)).toBe('mismatch');
    expect(slotState(entry, warm, 255)).toBe('mismatch');
    expect(slotState(entry, { ...warm, arc: 60 }, 120)).toBe('mismatch');
    expect(slotState(entry, undefined, 120)).toBe('mismatch');
  });
});
