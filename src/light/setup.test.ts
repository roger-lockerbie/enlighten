import { describe, expect, it } from 'vitest';
import { MAX_MOUNTS, MOUNT_DEFAULTS, parseScene } from './scene.ts';
import type { Mount } from './scene.ts';
import type { Edit, Setup } from './setup.ts';
import {
  HALL_LIMITS,
  MATERIALS,
  PRESETS,
  TAPE_CHOICES,
  addMount,
  applyPreset,
  defaultSetup,
  facingOf,
  group,
  isMirrored,
  linkHolds,
  materialFor,
  mirror,
  parseSetup,
  removeMount,
  section,
  setFacing,
  setHallway,
  setMountField,
  setReflectance,
} from './setup.ts';

function ok(e: Edit): Setup {
  if (!e.ok) throw new Error(e.reason);
  return e.setup;
}

function reason(e: Edit): string {
  if (e.ok) throw new Error('expected a refusal');
  return e.reason;
}

const byId = (s: Setup, id: string): Mount => {
  const m = s.scene.mounts.find((x) => x.id === id);
  if (m === undefined) throw new Error(`no mount ${id}`);
  return m;
};

const copy = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

/** One mount, a high reveal on the left. */
function reveal(): Setup {
  return ok(applyPreset(defaultSetup(), 'reveal-up'));
}

describe('the hallway', () => {
  it('changes size within its limits and refuses outside them, saying why', () => {
    const s = ok(setHallway(defaultSetup(), { width: 1.5, height: 3, endWalls: 'open' }));
    expect(s.scene.width).toBe(1.5);
    expect(s.scene.endWalls).toBe('open');
    expect(reason(setHallway(s, { width: 0.9 }))).toBe("The hallway's width must be 1 to 1.5 m.");
    expect(reason(setHallway(s, { height: 3.1 }))).toMatch(/height must be 2.4 to 3 m/);
    expect(reason(setHallway(s, { length: Number.NaN }))).toMatch(/length/);
    expect(HALL_LIMITS.length.max).toBe(12);
  });

  it('keeps full-length mounts full length, and fits others to a shorter hallway', () => {
    let s = ok(setHallway(defaultSetup(), { length: 8 }));
    expect(s.scene.mounts.every((m) => m.length === 8)).toBe(true);
    s = ok(setMountField(s, 'm1', 'length', 3));
    s = ok(setMountField(s, 'm1', 'start', 4));
    s = ok(setHallway(s, { length: 2 }));
    expect(byId(s, 'm1')).toMatchObject({ start: 0, length: 2 });
    expect(byId(s, 'm2').length).toBe(2);
  });

  it('lowers a reveal or channel that would no longer fit under a lower ceiling', () => {
    let s = ok(setHallway(reveal(), { height: 3 }));
    s = ok(setMountField(s, 'm1', 'height', 2.9));
    s = ok(setHallway(s, { height: 2.4 }));
    const m = byId(s, 'm1');
    expect(m.height + m.slotHeight).toBeLessThanOrEqual(2.4 + 1e-9);
    let c = ok(applyPreset(defaultSetup(), 'channel'));
    c = ok(setHallway(c, { height: 3 }));
    c = ok(setMountField(c, 'm1', 'height', 2.99));
    c = ok(setHallway(c, { height: 2.4 }));
    expect(byId(c, 'm1').height + byId(c, 'm1').aperture / 2).toBeLessThanOrEqual(2.4 + 1e-9);
  });

  it('sets each reflectance, and knows the preset a value matches', () => {
    const s = ok(setReflectance(defaultSetup(), 'floor', 0.6));
    expect(s.scene.reflectance.floor).toBe(0.6);
    expect(materialFor('floor', 0.6)?.name).toBe('Paler microcement');
    expect(materialFor('walls', 0.71)).toBeUndefined();
    expect(reason(setReflectance(s, 'walls', 0.99))).toBe('A reflectance must be 0 to 0.98.');
    expect(reason(setReflectance(s, 'walls', -0.1))).toMatch(/reflectance/);
  });

  it('has material presets that match the defaults, each with its basis', () => {
    const d = defaultSetup().scene.reflectance;
    expect(materialFor('ceiling', d.ceiling)?.name).toBe('Vivid White');
    expect(materialFor('walls', d.walls)?.name).toBe('Natural White');
    expect(materialFor('floor', d.floor)?.sourced).toBe(false);
    for (const list of Object.values(MATERIALS)) {
      for (const m of list) {
        expect(m.basis.length).toBeGreaterThan(10);
        expect(m.reflectance).toBeGreaterThan(0);
        expect(m.reflectance).toBeLessThanOrEqual(0.98);
      }
    }
  });
});

describe('mounts', () => {
  it('adds a mount with its kind defaults, up to six, and says why it refuses', () => {
    let s = defaultSetup();
    s = ok(addMount(s, 'reveal', 'left', 3));
    const added = byId(s, 'm3');
    expect(added).toMatchObject({ kind: 'reveal', side: 'left', address: 3, facing: 'up' });
    expect(added.height).toBe(MOUNT_DEFAULTS.reveal.height.value);
    expect(reason(addMount(s, 'channel', 'right'))).toBe('Two mounts would overlap on one wall.');
    s = ok(addMount(s, 'reveal', 'right'));
    s = ok(setMountField(s, 'm4', 'height', 1.5));
    s = ok(addMount(s, 'reveal', 'right'));
    s = ok(addMount(s, 'channel', 'left'));
    expect(reason(addMount(s, 'channel', 'left'))).toBe(
      `A hallway holds at most ${String(MAX_MOUNTS)} mounts.`,
    );
  });

  it('removes a mount, and refuses one that is not there', () => {
    const s = ok(removeMount(defaultSetup(), 'm1'));
    expect(s.scene.mounts.map((m) => m.id)).toEqual(['m2']);
    expect(reason(removeMount(s, 'm1'))).toBe('There is no such mount.');
  });

  it('changes one field and checks it', () => {
    let s = defaultSetup();
    s = ok(setMountField(s, 'm2', 'height', 1.2));
    expect(byId(s, 'm2').height).toBe(1.2);
    s = ok(setMountField(s, 'm2', 'tape', 'COB'));
    s = ok(setMountField(s, 'm2', 'diffuser', 'frosted'));
    s = ok(setMountField(s, 'm2', 'depth', 0.02));
    expect(byId(s, 'm2')).toMatchObject({ tape: 'COB', diffuser: 'frosted', depth: 0.02 });
    expect(reason(setMountField(s, 'm2', 'height', 2.699))).toBe(
      'The mount would not fit on the wall.',
    );
    expect(reason(setMountField(s, 'm2', 'height', 2.9))).toBe('Height must be 0 to 2700 mm.');
    expect(reason(setMountField(s, 'm2', 'length', 6))).toBe('Length must be 50 to 5000 mm.');
    expect(reason(setMountField(s, 'm2', 'gradient', 0.6))).toBe('Voltage drop must be 0 to 50%.');
    s = ok(setMountField(s, 'm2', 'length', 2));
    s = ok(setMountField(s, 'm2', 'start', 3));
    expect(reason(setMountField(s, 'm2', 'start', 3.5))).toBe(
      'The mount would run past the end of the hallway.',
    );
    expect(reason(setMountField(s, 'm2', 'height', Number.NaN))).toBe('That is not a number.');
    expect(reason(setMountField(s, 'zz', 'height', 1))).toBe('There is no such mount.');
    expect(reason(setMountField(s, 'm1', 'slotHeight', 0.004))).toBe(
      'Opening height must be 8 to 200 mm.',
    );
    expect(reason(setMountField(s, 'm1', 'aperture', 0.03))).toBe(
      'The tape would be wider than its opening is deep.',
    );
    expect(reason(setMountField(s, 'm1', 'setback', 0.001))).toBe(
      'The tape would sit outside its opening.',
    );
  });

  it('binds a mount to any address from 0 to 63', () => {
    const s = ok(setMountField(defaultSetup(), 'm1', 'address', 63));
    expect(byId(s, 'm1').address).toBe(63);
    for (const bad of [64, -1, 2.5]) {
      expect(reason(setMountField(s, 'm1', 'address', bad))).toBe(
        'An address must be a whole number from 0 to 63.',
      );
    }
  });

  it('gives a mount the new kind its defaults', () => {
    let s = ok(setMountField(defaultSetup(), 'm1', 'kind', 'reveal'));
    expect(byId(s, 'm1')).toMatchObject({
      kind: 'reveal',
      facing: 'up',
      height: MOUNT_DEFAULTS.reveal.height.value,
      depth: MOUNT_DEFAULTS.reveal.depth.value,
    });
    s = ok(setMountField(s, 'm1', 'kind', 'skirting'));
    expect(byId(s, 'm1')).toMatchObject({ kind: 'skirting', facing: 'down', height: 0 });
  });

  it('turns a reveal up, down, or both ways, and only a reveal', () => {
    let s = reveal();
    s = ok(setFacing(s, 'm1', 'down'));
    expect(byId(s, 'm1').facing).toBe('down');
    s = ok(setFacing(s, 'm1', 'both'));
    expect(s.scene.mounts).toHaveLength(2);
    expect(facingOf(s, 'm1')).toBe('both');
    expect(byId(s, 'm2')).toMatchObject({ facing: 'up', side: 'left', address: 0 });
    expect(ok(setFacing(s, 'm1', 'both'))).toBe(s);
    // A change to one is made to both.
    s = ok(setMountField(s, 'm2', 'height', 2));
    expect(byId(s, 'm1').height).toBe(2);
    // Back to one way: the tape facing the other way goes.
    const up = ok(setFacing(s, 'm1', 'up'));
    expect(up.scene.mounts.map((m) => [m.id, m.facing])).toEqual([['m1', 'up']]);
    expect(up.links).toEqual([]);
    expect(reason(setFacing(defaultSetup(), 'm1', 'up'))).toBe(
      'Only a reveal can face up or down.',
    );
    expect(reason(setFacing(s, 'zz', 'up'))).toBe('There is no such mount.');
    expect(facingOf(s, 'zz')).toBeUndefined();
  });

  it('drops the tape the other way when a reveal lit both ways becomes another kind', () => {
    let s = ok(setFacing(reveal(), 'm1', 'both'));
    s = ok(setMountField(s, 'm1', 'kind', 'channel'));
    expect(s.scene.mounts.map((m) => m.kind)).toEqual(['channel']);
    expect(s.links).toEqual([]);
  });
});

describe('mirroring', () => {
  it('copies a mount to the other wall, and keeps the two in step', () => {
    let s = ok(applyPreset(defaultSetup(), 'channel'));
    s = ok(mirror(s, 'm1', true));
    expect(isMirrored(s, 'm1')).toBe(true);
    expect(isMirrored(s, 'm2')).toBe(true);
    expect(byId(s, 'm2')).toMatchObject({ side: 'right', kind: 'channel', address: 0 });
    s = ok(setMountField(s, 'm2', 'height', 1));
    expect(byId(s, 'm1').height).toBe(1);
    s = ok(setMountField(s, 'm1', 'diffuser', 'clear'));
    expect(byId(s, 'm2').diffuser).toBe('clear');
    // The address is each mount's own.
    s = ok(setMountField(s, 'm2', 'address', 5));
    expect(byId(s, 'm1').address).toBe(0);
    // A change of side swaps them.
    s = ok(setMountField(s, 'm1', 'side', 'right'));
    expect([byId(s, 'm1').side, byId(s, 'm2').side]).toEqual(['right', 'left']);
    expect(s.links.every((l) => linkHolds(s.scene, l))).toBe(true);
    expect(ok(mirror(s, 'm1', true))).toBe(s);
  });

  it('stops mirroring by removing the copy, from either side', () => {
    const s = ok(mirror(ok(applyPreset(defaultSetup(), 'channel')), 'm1', true));
    // The mounts on the other wall from the one asked about go.
    expect(ok(mirror(s, 'm2', false)).scene.mounts.map((m) => m.id)).toEqual(['m2']);
    const off = ok(mirror(s, 'm1', false));
    expect(off.scene.mounts.map((m) => m.id)).toEqual(['m1']);
    expect(off.links).toEqual([]);
    expect(ok(mirror(off, 'm1', false))).toBe(off);
    expect(reason(mirror(off, 'zz', true))).toBe('There is no such mount.');
  });

  it('mirrors a reveal lit both ways as four tapes, and turns all four together', () => {
    let s = ok(setFacing(reveal(), 'm1', 'both'));
    s = ok(mirror(s, 'm1', true));
    expect(s.scene.mounts).toHaveLength(4);
    expect(group(s, 'm1')).toHaveLength(4);
    expect(s.links.every((l) => linkHolds(s.scene, l))).toBe(true);
    s = ok(setMountField(s, 'm3', 'length', 3));
    s = ok(setMountField(s, 'm3', 'start', 1));
    expect(s.scene.mounts.every((m) => m.start === 1 && m.length === 3)).toBe(true);
    s = ok(setFacing(s, 'm1', 'down'));
    expect(s.scene.mounts.map((m) => [m.side, m.facing])).toEqual([
      ['left', 'down'],
      ['right', 'down'],
    ]);
  });

  it('refuses a mirror where the other wall is taken, or the hallway is full', () => {
    let s = ok(addMount(ok(applyPreset(defaultSetup(), 'skirting')), 'skirting', 'right'));
    expect(reason(mirror(s, 'm1', true))).toBe('Two mounts would take the same place on one wall.');
    s = ok(setMountField(s, 'm2', 'length', 2));
    expect(reason(mirror(s, 'm1', true))).toBe('Two mounts would overlap on one wall.');
    s = ok(removeMount(s, 'm2'));
    for (const h of [1.8, 1.2, 0.6]) {
      s = ok(addMount(s, 'channel', 'left'));
      const id = s.scene.mounts.at(-1)?.id ?? '';
      s = ok(setMountField(s, id, 'height', h));
    }
    s = ok(addMount(s, 'channel', 'right'));
    s = ok(addMount(s, 'skirting', 'right'));
    expect(reason(mirror(s, 'm1', true))).toMatch(/at most 6 mounts/);
  });
});

describe('presets', () => {
  it('cover the five set-ups of R11.4, each valid in every hallway', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'skirting',
      'channel',
      'reveal-up',
      'reveal-down',
      'mirrored',
    ]);
    for (const length of [1, 5, 12]) {
      for (const height of [2.4, 2.7, 3]) {
        const hall = ok(setHallway(defaultSetup(), { length, height }));
        for (const p of PRESETS) {
          const s = ok(applyPreset(hall, p.id));
          expect(s.scene.length).toBe(length);
          expect(s.scene.mounts.every((m) => m.length === length)).toBe(true);
          expect(s.links.every((l) => linkHolds(s.scene, l))).toBe(true);
        }
      }
    }
    expect(reason(applyPreset(defaultSetup(), 'nope' as 'skirting'))).toBe(
      'There is no such preset.',
    );
  });

  it('draw as marks on a cross-section', () => {
    const marks = section(ok(applyPreset(defaultSetup(), 'reveal-down')).scene);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ side: 'left', kind: 'reveal', facing: 'down' });
    expect(marks[0]?.y).toBeCloseTo(2.4 / 2.7, 9);
    const both = section(ok(applyPreset(defaultSetup(), 'mirrored')).scene);
    expect(both.map((m) => [m.side, m.y])).toEqual([
      ['left', 0],
      ['right', 0],
    ]);
  });

  it('name the researched tapes by density', () => {
    expect(TAPE_CHOICES.map((t) => t.id)).toEqual(['A', 'B', 'COB']);
    expect(TAPE_CHOICES[0]?.label).toContain('120');
    expect(TAPE_CHOICES[1]?.label).toContain('60');
  });
});

describe('parseSetup', () => {
  it('accepts what the editor makes, and gives back an equal set-up', () => {
    let s = ok(setFacing(reveal(), 'm1', 'both'));
    s = ok(mirror(s, 'm1', true));
    expect(parseSetup(copy(s))).toEqual({ ok: true, value: s });
    expect(parseSetup(copy(defaultSetup()))).toEqual({ ok: true, value: defaultSetup() });
  });

  it('refuses wrong shapes, links that do not hold, and doubled links', () => {
    const s = ok(mirror(ok(applyPreset(defaultSetup(), 'channel')), 'm1', true));
    const raw = copy(s) as { scene: { mounts: Record<string, unknown>[] }; links: unknown[] };
    expect(parseSetup(null).ok).toBe(false);
    expect(parseSetup([]).ok).toBe(false);
    expect(parseSetup({ ...raw, extra: 1 }).ok).toBe(false);
    expect(parseSetup({ ...raw, scene: { length: 5 } }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: 'x' }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: Array.from({ length: 7 }, () => raw.links[0]) }).ok).toBe(
      false,
    );
    expect(parseSetup({ ...raw, links: [{ kind: 'mirror', a: 'm1' }] }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: [{ kind: 'twin', a: 'm1', b: 'm2' }] }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: [{ kind: 'mirror', a: 'm1', b: 'm9' }] }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: [{ kind: 'mirror', a: 'm1', b: 'm1' }] }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: [{ kind: 'both', a: 'm1', b: 'm2' }] }).ok).toBe(false);
    expect(parseSetup({ ...raw, links: [raw.links[0], raw.links[0]] })).toMatchObject({
      ok: false,
      error: 'Mount m1 has two mirror links.',
    });
    const drift = copy(raw) as typeof raw;
    const second = drift.scene.mounts[1];
    if (second !== undefined) second['height'] = 1;
    expect(parseSetup(drift)).toMatchObject({ ok: false, error: /does not hold/ });
    // A Map or class instance is not a plain object.
    expect(parseSetup(new Map()).ok).toBe(false);
    expect(parseScene(copy(s.scene)).ok).toBe(true);
  });
});
