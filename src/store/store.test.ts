/** U-store: the validator, the schemas, migrations, set-aside on failure, and workspace files. */
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate.ts';
import { DEFAULT_PREFERENCES, type Preferences } from './schema.ts';
import { exportWorkspace, MemoryBackend, readWorkspace, Store } from './store.ts';
import {
  arrayOf,
  checkTree,
  int,
  MAX_BYTES,
  MAX_DEPTH,
  MAX_NODES,
  object,
  oneOf,
  opt,
  parseText,
  req,
  str,
  utf8Bytes,
} from './validate.ts';

const stamp = () => '2026-11-16T09-00-00';

describe('the validator', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Bytes('a')).toBe(1);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('€')).toBe(3);
    expect(utf8Bytes('😀')).toBe(4);
    expect(utf8Bytes('\ud800')).toBe(3);
  });

  it('refuses a text over 2 MB before parsing it', () => {
    expect(parseText(' '.repeat(MAX_BYTES + 1))).toEqual({
      ok: false,
      error: 'The file is larger than 2 MB.',
    });
    expect(parseText(`"${'€'.repeat(MAX_BYTES / 3)}"`).ok).toBe(true);
    expect(parseText(`"${'€'.repeat(MAX_BYTES / 3)}é"`).ok).toBe(false);
  });

  it('refuses text that is not JSON', () => {
    expect(parseText('{')).toEqual({ ok: false, error: 'The file is not valid JSON.' });
  });

  it('refuses nesting deeper than the limit, and forbidden keys anywhere', () => {
    const deep = (n: number): unknown => (n === 0 ? 1 : { a: deep(n - 1) });
    expect(checkTree(deep(MAX_DEPTH))).toBeUndefined();
    expect(checkTree(deep(MAX_DEPTH + 1))).toMatch(/nested more than 8 deep/);
    expect(checkTree([[[[[[[[[1]]]]]]]]])).toMatch(/nested/);
    for (const k of ['__proto__', 'constructor', 'prototype'])
      expect(parseText(`{"a":[{"${k}":1}]}`)).toEqual({
        ok: false,
        error: `a[0]: the key ${k} is not allowed.`,
      });
  });

  it('refuses a tree with too many values, and shortens long keys in its messages', () => {
    expect(checkTree(new Array(MAX_NODES + 1).fill(0))).toMatch(/more than 100000 values/);
    expect(checkTree(new Array(MAX_NODES - 1).fill(0))).toBeUndefined();
    const long = 'k'.repeat(500);
    const msg = checkTree({ [long]: { __proto__x: 1, constructor: 1 } }) ?? '';
    expect(msg.length).toBeLessThan(120);
  });

  it('refuses what JSON cannot carry', () => {
    expect(checkTree(Number.NaN)).toMatch(/finite/);
    expect(checkTree({ a: () => 1 })).toMatch(/not a JSON value/);
    expect(checkTree({ a: new Date(0) })).toMatch(/plain object/);
    expect(checkTree(Object.create(null))).toBeUndefined();
  });

  it('checks schemas and builds fresh objects', () => {
    const s = object({
      n: req(int(1, 3)),
      t: opt(str(2)),
      e: opt(oneOf('x', 'y')),
      l: opt(arrayOf(int(0, 1), 2)),
    });
    const input = { n: 2, l: [0, 1] };
    const r = s(input, '');
    expect(r).toEqual({ ok: true, value: { n: 2, l: [0, 1] } });
    if (r.ok) {
      expect(r.value).not.toBe(input);
      expect(r.value.l).not.toBe(input.l);
    }
    expect(s({}, '')).toEqual({ ok: false, error: 'n: missing.' });
    expect(s({ n: 4 }, '')).toEqual({ ok: false, error: 'n: a whole number from 1 to 3.' });
    expect(s({ n: 1.5 }, '').ok).toBe(false);
    expect(s({ n: 1, t: 'abc' }, '')).toEqual({
      ok: false,
      error: 't: text of at most 2 characters.',
    });
    expect(s({ n: 1, e: 'z' }, '')).toEqual({ ok: false, error: 'e: one of "x", "y".' });
    expect(s({ n: 1, l: [0, 1, 0] }, '')).toEqual({ ok: false, error: 'l: at most 2 items.' });
    expect(s({ n: 1, l: 'x' }, '')).toEqual({ ok: false, error: 'l: a list.' });
    expect(s({ n: 1, l: [2] }, '')).toEqual({
      ok: false,
      error: 'l[0]: a whole number from 0 to 1.',
    });
    expect(s({ n: 1, z: 1 }, '')).toEqual({ ok: false, error: 'The file: unknown key "z".' });
    expect(s([], '')).toEqual({ ok: false, error: 'The file: an object.' });
    expect(s(JSON.parse('{"n":1,"__proto__":{}}'), '').ok).toBe(false);
  });
});

describe('migrations', () => {
  const steps = [
    { to: 2, run: (d: unknown) => ({ ...(d as object), b: 2 }) },
    { to: 3, run: (d: unknown) => ({ ...(d as object), c: 3 }) },
  ];
  it('run each step from the stored version to the present one', () => {
    expect(migrate({ a: 1 }, 1, 3, steps)).toEqual({ ok: true, value: { a: 1, b: 2, c: 3 } });
    expect(migrate({ a: 1 }, 2, 3, steps)).toEqual({ ok: true, value: { a: 1, c: 3 } });
    expect(migrate({ a: 1 }, 3, 3, steps)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('refuse a newer version, a bad version, a missing step and a step that throws', () => {
    expect(migrate({}, 4, 3, steps).ok).toBe(false);
    expect(migrate({}, '1', 3, steps).ok).toBe(false);
    expect(migrate({}, 0, 3, steps).ok).toBe(false);
    expect(migrate({}, 1, 3, steps.slice(1))).toEqual({
      ok: false,
      error: 'No migration to version 2.',
    });
    const boom = [
      {
        to: 2,
        run: () => {
          throw new Error('x');
        },
      },
    ];
    expect(migrate({}, 1, 2, boom)).toEqual({
      ok: false,
      error: 'The migration to version 2 failed.',
    });
  });
});

describe('the store', () => {
  it('gives the defaults when nothing is stored, and loads what it saved', async () => {
    const b = new MemoryBackend();
    const store = new Store(b, stamp);
    expect(await store.loadPreferences()).toEqual({ value: DEFAULT_PREFERENCES });
    const p: Preferences = {
      ...DEFAULT_PREFERENCES,
      ceilingArc: 200,
      page: 'monitor',
      aliases: [{ address: 0, alias: 'Hall left' }],
      bench: { B: { presentation: 'tc', settings: { maxLowerPullsDown: false } } },
    };
    await store.savePreferences(p);
    expect(b.map.get('preferences')).toEqual({ version: 1, data: p });
    expect(await store.loadPreferences()).toEqual({ value: p });
  });

  it('refuses to save preferences that do not validate', async () => {
    const store = new Store(new MemoryBackend(), stamp);
    await expect(store.savePreferences({ ...DEFAULT_PREFERENCES, ceilingArc: 0 })).rejects.toThrow(
      /ceilingArc/,
    );
  });

  it('sets a bad record aside, uses the defaults and says so', async () => {
    for (const bad of [
      { version: 1, data: { ...DEFAULT_PREFERENCES, ceilingArc: 255 } },
      { version: 9, data: DEFAULT_PREFERENCES },
      { version: 1, data: DEFAULT_PREFERENCES, extra: 1 },
      { version: 1 },
      'text',
      [1],
      {
        version: 1,
        data: { ...DEFAULT_PREFERENCES, aliases: [{ address: 0, alias: 'x'.repeat(61) }] },
      },
    ]) {
      const b = new MemoryBackend();
      await b.put('preferences', bad);
      const store = new Store(b, stamp);
      const r = await store.loadPreferences();
      expect(r.value).toEqual(DEFAULT_PREFERENCES);
      expect(r.problem).toMatch(/^Stored preferences were set aside and defaults used\./);
      expect(await store.setAside()).toEqual(['set-aside:preferences:2026-11-16T09-00-00']);
      expect(b.map.get('set-aside:preferences:2026-11-16T09-00-00')).toEqual(bad);
      expect(b.map.has('preferences')).toBe(false);
      await store.discardSetAside();
      expect(await store.setAside()).toEqual([]);
    }
  });

  it('uses the defaults when the backend fails', async () => {
    const b = new MemoryBackend();
    b.get = () => Promise.reject(new Error('blocked'));
    expect(await new Store(b, stamp).loadPreferences()).toEqual({
      value: DEFAULT_PREFERENCES,
      problem: 'Stored preferences could not be read.',
    });
    const c = new MemoryBackend();
    await c.put('preferences', 'bad');
    c.put = () => Promise.reject(new Error('full'));
    expect((await new Store(c, stamp).loadPreferences()).value).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('workspace files (SPEC section 8)', () => {
  const content = {
    ceiling: 180,
    preferences: { playgroundMode: 'commit' as const, reducedMotion: 'always' as const },
    devices: [
      { address: 0, alias: 'Left' },
      { address: 1, presentation: 'tc' as const, settings: { autoActivation: false } },
    ],
  };

  it('round-trips an export', () => {
    const text = exportWorkspace(content);
    const r = readWorkspace(text, { ceilingArc: 220 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.workspace).toEqual({ format: 'enlighten-workspace', version: 1, ...content });
    expect(r.value.lowerCeiling).toBe(180);
    expect(r.value.changes).toEqual([
      'Ceiling: lowered from 39.5% (arc 220) to 13.3% (arc 180).',
      'Playground mode: Commit.',
      'Reduced motion: always on.',
      'A0: name "Left".',
      'A1: simulated as Tc, 1 simulator settings changed.',
    ]);
  });

  it('never applies a higher ceiling, and says so', () => {
    const r = readWorkspace(exportWorkspace({ ceiling: 240 }), { ceilingArc: 220 });
    expect(r.ok).toBe(true);
    expect(r.ok ? r.value.lowerCeiling : 0).toBeUndefined();
    expect(r.ok && r.value.changes[0]).toMatch(
      /higher than the present 39.5%, so it is not applied/,
    );
    const same = readWorkspace(exportWorkspace({ ceiling: 220 }), { ceilingArc: 220 });
    expect(same.ok && same.value.changes).toEqual([]);
  });

  it('refuses malformed, foreign, newer and oversized files', () => {
    const at = { ceilingArc: 220 };
    expect(readWorkspace('nope', at)).toEqual({ ok: false, error: 'The file is not valid JSON.' });
    expect(readWorkspace('[]', at)).toEqual({ ok: false, error: 'A workspace file is an object.' });
    expect(readWorkspace('{"format":"other"}', at)).toEqual({
      ok: false,
      error: 'This is not an Enlighten workspace file.',
    });
    expect(readWorkspace('{"format":"enlighten-workspace","version":2}', at).ok).toBe(false);
    expect(readWorkspace('{"format":"enlighten-workspace","version":1,"looks":[]}', at)).toEqual({
      ok: false,
      error: 'The file: unknown key "looks".',
    });
    expect(readWorkspace('{"format":"enlighten-workspace","version":1,"ceiling":0}', at).ok).toBe(
      false,
    );
    expect(
      readWorkspace(
        '{"format":"enlighten-workspace","version":1,"devices":[{"address":1,"settings":{"tcLimits":{}}}]}',
        at,
      ).ok,
    ).toBe(false);
    expect(
      readWorkspace(
        `{"format":"enlighten-workspace","version":1,"x":"${'a'.repeat(MAX_BYTES)}"}`,
        at,
      ),
    ).toEqual({
      ok: false,
      error: 'The file is larger than 2 MB.',
    });
  });

  it('refuses a device or a name listed twice for one address', () => {
    expect(
      readWorkspace(
        '{"format":"enlighten-workspace","version":1,"devices":[{"address":0,"alias":"x"},{"address":0,"alias":"x"}]}',
        { ceilingArc: 220 },
      ),
    ).toEqual({ ok: false, error: 'devices: address 0 appears twice.' });
  });

  it('lists a device with only settings at their defaults', () => {
    const r = readWorkspace(exportWorkspace({ devices: [{ address: 1, settings: {} }] }), {
      ceilingArc: 220,
    });
    expect(r.ok && r.value.changes).toEqual(['A1: simulator settings at their defaults.']);
  });

  it('refuses to export something it could not import', () => {
    expect(() => exportWorkspace({ ceiling: 0 })).toThrow();
  });
});
