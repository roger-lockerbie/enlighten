/** U-store: the validator, the schemas, migrations, set-aside on failure, and workspace files. */
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate.ts';
import { preferencesTo4 } from './migrations/preferences-4.ts';
import { workspaceTo4 } from './migrations/workspace-4.ts';
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
    expect(b.map.get('preferences')).toEqual({ version: 4, data: p });
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
    expect(r.value.workspace).toEqual({ format: 'enlighten-workspace', version: 4, ...content });
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
    expect(readWorkspace('{"format":"enlighten-workspace","version":5}', at).ok).toBe(false);
    expect(readWorkspace('{"format":"enlighten-workspace","version":1,"plates":[]}', at)).toEqual({
      ok: false,
      error: 'The file: unknown key "plates".',
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

describe('Stage 6 records (ADR 0014)', () => {
  const v1Preferences = {
    ceilingArc: 200,
    playgroundMode: 'commit',
    page: 'devices',
    inspectorOpen: false,
    drawerOpen: true,
    drawerHeight: 300,
    reducedMotion: 'always',
    aliases: [{ address: 0, alias: 'warm' }],
    bench: {},
  };

  const visualiserDefaults = {
    exposure: 'evening',
    exposureEv: 4,
    whiteBalance: 'scene',
    whiteBalanceKelvin: 4000,
    falseColour: 'off',
  };

  it('migrates version 1 preferences, with the history settings at their defaults', async () => {
    const b = new MemoryBackend();
    await b.put('preferences', { version: 1, data: v1Preferences });
    const r = await new Store(b, stamp).loadPreferences();
    expect(r.problem).toBeUndefined();
    expect(r.value).toEqual({
      ...v1Preferences,
      historyLength: 1000,
      historyIgnoreSpace: false,
      verifyMode: true,
      ...visualiserDefaults,
      extras: [],
    });
  });

  it('migrates version 2 preferences, with the visualiser settings at their defaults', async () => {
    // The shape Stage 6 stored.
    const v2Preferences = {
      ...v1Preferences,
      historyLength: 500,
      historyIgnoreSpace: true,
      verifyMode: false,
    };
    const b = new MemoryBackend();
    await b.put('preferences', { version: 2, data: v2Preferences });
    const r = await new Store(b, stamp).loadPreferences();
    expect(r.problem).toBeUndefined();
    expect(r.value).toEqual({ ...v2Preferences, ...visualiserDefaults, extras: [] });
    expect(migrate('text', 2, 3, [{ to: 3, run: (d) => d }])).toEqual({ ok: true, value: 'text' });
  });

  it('migrates version 3 preferences, with no extra simulated drivers', async () => {
    // The shape Stage 7 stored.
    const v3Preferences = {
      ...v1Preferences,
      historyLength: 500,
      historyIgnoreSpace: true,
      verifyMode: false,
      ...visualiserDefaults,
    };
    const b = new MemoryBackend();
    await b.put('preferences', { version: 3, data: v3Preferences });
    const r = await new Store(b, stamp).loadPreferences();
    expect(r.problem).toBeUndefined();
    expect(r.value).toEqual({ ...v3Preferences, extras: [] });
    expect(preferencesTo4.run('text')).toBe('text');
  });

  it('refuses extra drivers that share an address or sit on the bench', async () => {
    const store = new Store(new MemoryBackend(), stamp);
    for (const extras of [
      [{ address: 1, lightType: 'C2' }],
      [
        { address: 5, lightType: 'C2' },
        { address: 5, lightType: 'C5' },
      ],
      [{ address: 5, lightType: 'C1' }],
      [2, 3, 4, 5, 6].map((address) => ({ address, lightType: 'C2' })),
    ])
      await expect(
        store.savePreferences({ ...DEFAULT_PREFERENCES, extras } as never),
      ).rejects.toThrow();
  });

  it('refuses visualiser settings out of range', async () => {
    const store = new Store(new MemoryBackend(), stamp);
    for (const bad of [
      { exposure: 'auto' },
      { exposureEv: 40 },
      { exposureEv: Number.NaN },
      { whiteBalance: 'tungsten' },
      { whiteBalanceKelvin: 500 },
      { whiteBalanceKelvin: 3000.5 },
      { falseColour: 'on' },
    ]) {
      await expect(
        store.savePreferences({ ...DEFAULT_PREFERENCES, ...bad } as Preferences),
      ).rejects.toThrow();
    }
    await store.savePreferences({
      ...DEFAULT_PREFERENCES,
      page: 'visualiser',
      exposure: 'manual',
      exposureEv: 2.5,
      whiteBalance: 'kelvin',
      whiteBalanceKelvin: 3000,
      falseColour: 'luminance',
    });
    expect((await store.loadPreferences()).value.exposureEv).toBe(2.5);
  });

  it('stores history, merges what another tab added, and keeps the limit', async () => {
    const b = new MemoryBackend();
    const one = new Store(b, stamp);
    const two = new Store(b, stamp);
    expect((await one.loadHistory()).value).toEqual([]);
    await one.appendHistory({ line: 'level 0 50%', at: 1 }, 3);
    await two.appendHistory({ line: 'off 0', at: 2 }, 3);
    await one.appendHistory({ line: 'off 0', at: 3 }, 3);
    await one.appendHistory({ line: 'on 0', at: 4 }, 3);
    await two.appendHistory({ line: 'query 0', at: 5 }, 3);
    expect((await one.loadHistory()).value.map((l) => l.line)).toEqual([
      'off 0',
      'on 0',
      'query 0',
    ]);
    await one.saveHistory([]);
    expect((await two.loadHistory()).value).toEqual([]);
  });

  it('sets aside history that does not check, and keeps going', async () => {
    const b = new MemoryBackend();
    await b.put('history', { version: 1, data: { lines: [{ line: 'x'.repeat(501), at: 0 }] } });
    const s = new Store(b, stamp);
    const r = await s.loadHistory();
    expect(r.value).toEqual([]);
    expect(r.problem).toMatch(/^Stored history lines were set aside/);
    expect(await s.setAside()).toEqual(['set-aside:history:2026-11-16T09-00-00']);
    await s.appendHistory({ line: 'off 0', at: 1 }, 100);
    expect((await s.loadHistory()).value).toEqual([{ line: 'off 0', at: 1 }]);
  });

  it('stores scripts, and refuses bad names, built-in names, doubles and oversized text', async () => {
    const b = new MemoryBackend();
    const s = new Store(b, stamp);
    expect((await s.loadScripts()).value).toEqual([]);
    await s.saveScripts([{ name: 'warm up', text: 'level 0 50%\n' }]);
    expect((await s.loadScripts()).value).toEqual([{ name: 'warm up', text: 'level 0 50%\n' }]);
    for (const bad of [
      [{ name: '../x', text: '' }],
      [{ name: 'First-Light', text: '' }],
      [
        { name: 'a', text: '' },
        { name: 'A', text: '' },
      ],
      [{ name: 'a', text: 'x'.repeat(64 * 1024 + 1) }],
      [{ name: 'a', text: '\n'.repeat(2000) }],
      [{ name: 'a', text: 1 }],
      Array.from({ length: 101 }, (_, i) => ({ name: `s${String(i)}`, text: '' })),
    ])
      await expect(s.saveScripts(bad as never)).rejects.toThrow();
    await b.put('scripts', { version: 1, data: { scripts: [{ name: 'x', text: 3 }] } });
    const r = await s.loadScripts();
    expect(r.value).toEqual([]);
    expect(r.problem).toMatch(/^Stored scripts were set aside/);
  });

  it('reads a version 1 workspace file', () => {
    const r = readWorkspace(
      '{"format":"enlighten-workspace","version":1,"ceiling":100,"preferences":{"playgroundMode":"live"}}',
      { ceilingArc: 220 },
    );
    expect(r.ok && r.value.workspace.version).toBe(4);
  });

  it('carries scripts and the history settings, and an import cannot turn verify mode off', () => {
    const text = exportWorkspace({
      preferences: { historyLength: 500, historyIgnoreSpace: true, verifyMode: false },
      scripts: [
        { name: 'warm up', text: 'level 0 50%' },
        { name: 'new one', text: 'off all' },
      ],
    });
    const r = readWorkspace(text, { ceilingArc: 220, scripts: ['Warm Up'] });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.changes).toEqual([
      'Console history: keeps 500 lines.',
      'Console history: lines that start with a space are left out.',
      'Verify mode: the file turns it off. An import cannot, so it stays on.',
      'Script "warm up": replaces the stored one. It runs only when you type run.',
      'Script "new one": added. It runs only when you type run.',
    ]);
    expect(
      readWorkspace(
        '{"format":"enlighten-workspace","version":2,"scripts":[{"name":"first-light","text":""}]}',
        { ceilingArc: 220 },
      ).ok,
    ).toBe(false);
  });
});

describe('Stage 8 records (ADR 0018)', () => {
  const check = (x: unknown) =>
    typeof x === 'object' && x !== null && 'n' in x && typeof x.n === 'number'
      ? { ok: true as const, value: { n: x.n } }
      : { ok: false as const, error: 'Not a set-up.' };

  it('stores the visualiser record with the check it is given, and sets aside one that fails', async () => {
    const b = new MemoryBackend();
    const s = new Store(b, stamp);
    expect((await s.loadVisualiser(check, { n: 0 })).value).toEqual({ n: 0 });
    await s.saveVisualiser(check, { n: 2 });
    expect(await b.get('visualiser')).toEqual({ version: 1, data: { n: 2 } });
    expect((await s.loadVisualiser(check, { n: 0 })).value).toEqual({ n: 2 });
    await b.put('visualiser', { version: 1, data: { n: 'x' } });
    const r = await s.loadVisualiser(check, { n: 0 });
    expect(r.value).toEqual({ n: 0 });
    expect(r.problem).toMatch(/visualiser set-ups/);
    expect(await s.setAside()).toEqual(['set-aside:visualiser:2026-11-16T09-00-00']);
  });

  it('reads a version 2 workspace file as the present version', () => {
    const r = readWorkspace('{"format":"enlighten-workspace","version":2,"scripts":[]}', {
      ceilingArc: 220,
    });
    expect(r.ok && r.value.workspace.version).toBe(4);
  });

  it('carries the view settings, and lists them', () => {
    const text = exportWorkspace({
      preferences: {
        exposure: 'manual',
        exposureEv: 2,
        whiteBalance: 'kelvin',
        whiteBalanceKelvin: 3000,
        falseColour: 'illuminance',
      },
    });
    const r = readWorkspace(text, { ceilingArc: 220 });
    expect(r.ok && r.value.changes).toEqual([
      'Visualiser exposure: manual at 2 EV.',
      'Visualiser white balance: 3000 K.',
      'Visualiser false colour: illuminance.',
    ]);
    const scene = readWorkspace(exportWorkspace({ preferences: { whiteBalance: 'scene' } }), {
      ceilingArc: 220,
    });
    expect(scene.ok && scene.value.changes).toEqual([
      'Visualiser white balance: adapted to the scene.',
    ]);
  });

  it('checks only the shape of the set-up keys, and refuses more than six mounts', () => {
    const at = { ceilingArc: 220 };
    const head = '"format":"enlighten-workspace","version":3';
    expect(readWorkspace(`{${head},"hallway":{},"mounts":[],"links":[]}`, at).ok).toBe(true);
    expect(readWorkspace(`{${head},"hallway":[]}`, at).ok).toBe(false);
    expect(readWorkspace(`{${head},"compare":3}`, at).ok).toBe(false);
    expect(readWorkspace(`{${head},"mounts":[1,2,3,4,5,6,7]}`, at).ok).toBe(false);
    expect(readWorkspace(`{${head},"links":{}}`, at).ok).toBe(false);
  });
});

describe('Stage 9 records (ADR 0020)', () => {
  const at = { ceilingArc: 220 };
  const file = (o: object) => JSON.stringify({ format: 'enlighten-workspace', version: 4, ...o });

  it('reads a version 3 workspace file, which says nothing about simulated drivers', () => {
    const r = readWorkspace(
      '{"format":"enlighten-workspace","version":3,"devices":[{"address":0,"alias":"Left"}]}',
      { ...at, extras: [{ address: 5, lightType: 'C2' }] },
    );
    expect(r.ok && r.value.workspace.version).toBe(4);
    expect(r.ok && r.value.extras).toBeUndefined();
    expect(r.ok && r.value.changes).toEqual(['A0: name "Left".']);
    expect(workspaceTo4.run('text')).toBe('text');
  });

  it('lists the simulated drivers a version 4 file adds and removes', () => {
    const r = readWorkspace(
      file({
        devices: [
          { address: 7, simulated: 'C5', alias: 'Far end' },
          { address: 3, simulated: 'C2' },
        ],
      }),
      {
        ...at,
        extras: [
          { address: 5, lightType: 'C2' },
          { address: 3, lightType: 'C2' },
        ],
      },
    );
    expect(r.ok && r.value.extras).toEqual([
      { address: 3, lightType: 'C2' },
      { address: 7, lightType: 'C5' },
    ]);
    expect(r.ok && r.value.changes).toEqual([
      'Simulated driver: a C5 is added at A7.',
      'Simulated driver: the C2 at A5 is removed.',
      'A7: name "Far end".',
    ]);
  });

  it('leaves the simulated drivers alone when a version 4 file has the same ones', () => {
    const same = readWorkspace(file({ devices: [{ address: 5, simulated: 'C2' }] }), {
      ...at,
      extras: [{ address: 5, lightType: 'C2' }],
    });
    expect(same.ok && same.value.extras).toBeUndefined();
    expect(same.ok && same.value.changes).toEqual([]);
    // A file with none takes away the ones there are.
    const none = readWorkspace(file({}), { ...at, extras: [{ address: 5, lightType: 'C2' }] });
    expect(none.ok && none.value.extras).toEqual([]);
    const empty = readWorkspace(file({}), at);
    expect(empty.ok && empty.value.extras).toBeUndefined();
  });

  it('refuses a simulated driver on a bench address, and more than four', () => {
    expect(readWorkspace(file({ devices: [{ address: 1, simulated: 'C2' }] }), at)).toEqual({
      ok: false,
      error: "devices: An extra driver's address is from 2 to 63.",
    });
    const five = [2, 3, 4, 5, 6].map((address) => ({ address, simulated: 'C2' }));
    expect(readWorkspace(file({ devices: five }), at)).toEqual({
      ok: false,
      error: 'devices: At most 4 simulated drivers can be added.',
    });
    expect(readWorkspace(file({ devices: [{ address: 5, simulated: 'C1' }] }), at).ok).toBe(false);
  });

  it('takes the design parts as lists of a sensible length, to be checked in full later', () => {
    const r = readWorkspace(
      file({ looks: [{ any: 1 }], slots: [], sequences: [], effects: [] }),
      at,
    );
    expect(r.ok && r.value.workspace.looks).toEqual([{ any: 1 }]);
    expect(readWorkspace(file({ looks: {} }), at).ok).toBe(false);
    expect(readWorkspace(file({ sequences: Array.from({ length: 101 }, () => ({})) }), at)).toEqual(
      {
        ok: false,
        error: 'sequences: a list of at most 100.',
      },
    );
    expect(readWorkspace(file({ effects: 'x' }), at).ok).toBe(false);
    expect(readWorkspace(file({ slots: Array.from({ length: 1025 }, () => 0) }), at).ok).toBe(
      false,
    );
  });

  it('exports the simulated drivers and the design parts', () => {
    const text = exportWorkspace({
      devices: [{ address: 5, simulated: 'C2' }],
      looks: [{ name: 'Warm', arc: 120, colour: { kind: 'none' } }],
    });
    const r = readWorkspace(text, at);
    expect(r.ok && r.value.extras).toEqual([{ address: 5, lightType: 'C2' }]);
    expect(r.ok && r.value.workspace.looks).toHaveLength(1);
  });
});
