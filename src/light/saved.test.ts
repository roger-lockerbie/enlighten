import { describe, expect, it } from 'vitest';
import { downHall } from './camera.ts';
import type { Saved } from './saved.ts';
import {
  defaultSaved,
  exportSetups,
  fromWorkspace,
  importSetups,
  parseSaved,
  setupChanges,
  toWorkspace,
} from './saved.ts';
import type { Edit, Setup } from './setup.ts';
import { applyPreset, defaultSetup, setHallway, setReflectance } from './setup.ts';

function ok(e: Edit): Setup {
  if (!e.ok) throw new Error(e.reason);
  return e.setup;
}

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;

describe('parseSaved', () => {
  it('takes the default back through JSON', () => {
    const d = defaultSaved();
    const r = parseSaved(json(d));
    expect(r).toEqual({ ok: true, value: d });
  });

  it('refuses what is not a plain object with the right keys', () => {
    expect(parseSaved(null).ok).toBe(false);
    expect(parseSaved([]).ok).toBe(false);
    expect(parseSaved(new Map()).ok).toBe(false);
    expect(parseSaved({ ...defaultSaved(), extra: 1 }).ok).toBe(false);
    const { a, b, compare, editing } = defaultSaved();
    expect(parseSaved({ a, b, compare, editing }).ok).toBe(false);
  });

  it('says which part is wrong', () => {
    const d = json(defaultSaved()) as Record<string, unknown>;
    expect(parseSaved({ ...d, a: 1 })).toMatchObject({ ok: false, error: /^Set-up A/ });
    expect(parseSaved({ ...d, b: 1 })).toMatchObject({ ok: false, error: /^Set-up B/ });
    expect(parseSaved({ ...d, compare: 'yes' })).toMatchObject({ error: /yes or no/ });
    expect(parseSaved({ ...d, editing: 'c' })).toMatchObject({ error: /A or B/ });
    expect(parseSaved({ ...d, view: { mode: 'fly' } })).toMatchObject({ error: /view/ });
  });
});

describe('the workspace form', () => {
  it('goes there and back', () => {
    const s = ok(applyPreset(defaultSetup(), 'mirrored'));
    const r = fromWorkspace(json(toWorkspace(s)));
    expect(r).toEqual({ ok: true, value: s });
  });

  it('needs exactly the hallway, mounts and links', () => {
    const w = json(toWorkspace(defaultSetup())) as Record<string, unknown>;
    expect(fromWorkspace(null).ok).toBe(false);
    expect(fromWorkspace([]).ok).toBe(false);
    expect(fromWorkspace({ ...w, extra: 1 }).ok).toBe(false);
    expect(fromWorkspace({ ...w, hallway: 3 }).ok).toBe(false);
    expect(fromWorkspace({ ...w, hallway: { ...(w['hallway'] as object), mounts: [] } })).toEqual({
      ok: false,
      error: 'The hallway has the wrong keys.',
    });
  });
});

describe('setupChanges', () => {
  const a = defaultSetup();

  it('says nothing when nothing changes', () => {
    expect(setupChanges('Set-up A', a, a)).toEqual([]);
  });

  it('lists the hallway, ends, finishes and mounts', () => {
    let b = ok(
      setHallway(a, { length: 3, endWalls: a.scene.endWalls === 'open' ? 'closed' : 'open' }),
    );
    b = ok(setReflectance(b, 'floor', 0.3));
    b = ok(applyPreset(b, 'mirrored'));
    const lines = setupChanges('Set-up A', a, b);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Set-up A: the hallway becomes 3 by/);
    expect(lines[1]).toMatch(/end walls/);
    expect(lines[2]).toMatch(/0\.3 floor/);
    expect(lines[3]).toMatch(/2 mounts, replacing/);
  });
});

describe('exportSetups and importSetups', () => {
  const present = defaultSaved();
  const mirrored = ok(applyPreset(defaultSetup(), 'mirrored'));

  it('leaves out B when it matches A', () => {
    expect(exportSetups(present)).not.toHaveProperty('compare');
    expect(exportSetups({ ...present, b: mirrored })).toHaveProperty('compare');
  });

  it('round trips A and B', () => {
    const s: Saved = { ...present, a: mirrored, b: present.a };
    const r = importSetups(defaultSaved(), json(exportSetups(s)) as object);
    expect(r.ok && r.value?.saved.a).toEqual(mirrored);
    expect(r.ok && r.value?.saved.b).toEqual(present.a);
    expect(r.ok && r.value?.changes).toEqual([expect.stringMatching(/^Set-up A: 2 mounts/)]);
  });

  it('makes B a copy of A when the file has no compare', () => {
    const now: Saved = { ...present, b: mirrored };
    const r = importSetups(now, json(exportSetups(present)) as object);
    expect(r.ok && r.value?.saved.b).toEqual(present.a);
    expect(r.ok && r.value?.changes).toEqual([expect.stringMatching(/^Set-up B:/)]);
  });

  it('has nothing to do when the file has no set-up', () => {
    expect(importSetups(present, {})).toEqual({ ok: true, value: undefined });
  });

  it('refuses B without A, and a part that does not check', () => {
    const w = json(toWorkspace(mirrored));
    expect(importSetups(present, { compare: w })).toMatchObject({ ok: false });
    expect(importSetups(present, { hallway: {} })).toMatchObject({ error: /^Set-up A/ });
    expect(importSetups(present, { ...(w as object), compare: 1 })).toMatchObject({
      error: /^Set-up B/,
    });
  });

  it('keeps the A/B setting, and leaves a close-up of a mount that has gone', () => {
    const one = ok(applyPreset(defaultSetup(), 'skirting'));
    const now: Saved = {
      ...present,
      a: mirrored,
      b: mirrored,
      compare: true,
      view: { mode: 'close', mount: 'm2' },
    };
    const r = importSetups(now, json(exportSetups({ ...present, a: one, b: one })) as object);
    expect(r.ok && r.value?.saved.compare).toBe(true);
    expect(r.ok && r.value?.saved.view).toEqual(downHall(one.scene));
    const kept = importSetups(
      { ...now, view: { mode: 'close', mount: 'm1' } },
      json(exportSetups({ ...present, a: one, b: one })) as object,
    );
    expect(kept.ok && kept.value?.saved.view).toEqual({ mode: 'close', mount: 'm1' });
  });
});
