import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LightStore } from '../store/light.ts';
import { MemoryBackend } from '../store/store.ts';
import {
  CACHE_INDEX_KEY,
  MAX_CACHED,
  cacheKey,
  cacheText,
  checkIndex,
  checkResponse,
  hashText,
  packCached,
  touch,
  unpackCached,
} from './cache.ts';
import type { LightReply } from './protocol.ts';
import { answer, parseReply, parseRequest } from './protocol.ts';
import type { Response } from './response.ts';
import { SOLVER_VERSION, solveScene } from './response.ts';
import { defaultScene, mount } from './scene.ts';
import type { Scene } from './scene.ts';

const scene = defaultScene();
const solved = solveScene(scene, { maxPatches: 700 });
const fresh = (): Response => structuredClone(solved);

describe('the cache key', () => {
  it('hashes text to 16 hex digits, the same every time', () => {
    expect(hashText('')).toBe('811c9dc59747b28c');
    expect(hashText('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashText('a')).toBe(hashText('a'));
    expect(hashText('a')).not.toBe(hashText('b'));
  });

  it('names the solver and the geometry, and ignores what is only a weight', () => {
    expect(cacheText(scene).startsWith(`v${String(SOLVER_VERSION)}|`)).toBe(true);
    expect(cacheKey(scene)).toMatch(/^light:[0-9a-f]{16}$/);
    const first = scene.mounts[0];
    if (first === undefined) throw new Error('no mount');
    const retaped: Scene = {
      ...scene,
      mounts: [{ ...first, tape: 'COB' }, ...scene.mounts.slice(1)],
    };
    expect(cacheKey(retaped)).toBe(cacheKey(scene));
    expect(cacheKey({ ...scene, height: 2.5 })).not.toBe(cacheKey(scene));
  });
});

describe('checking a response', () => {
  it('accepts what the solver gives', () => {
    const r = checkResponse(fresh(), 2);
    expect(typeof r).not.toBe('string');
    expect(r).toEqual(solved);
  });

  it('refuses the wrong shape, version, counts and sizes', () => {
    const bad = (change: (r: Record<string, unknown>) => void, mounts = 2): string => {
      const r = fresh() as unknown as Record<string, unknown>;
      change(r);
      const out = checkResponse(r, mounts);
      return typeof out === 'string' ? out : 'accepted';
    };
    expect(checkResponse(null, 2)).toMatch(/wrong keys/);
    expect(checkResponse([], 2)).toMatch(/wrong keys/);
    expect(checkResponse(new Map(), 2)).toMatch(/wrong keys/);
    expect(bad((r) => (r['extra'] = 1))).toMatch(/wrong keys/);
    expect(bad((r) => (r['version'] = 99))).toMatch(/another version/);
    expect(bad((r) => (r['patches'] = -1))).toMatch(/patch count/);
    expect(bad((r) => (r['patches'] = 1.5))).toMatch(/patch count/);
    expect(bad((r) => (r['coarsening'] = 0))).toMatch(/coarsening/);
    expect(bad((r) => (r['coarsening'] = Number.NaN))).toMatch(/coarsening/);
    expect(bad((r) => (r['coarsening'] = 'x'))).toMatch(/coarsening/);
    expect(bad(() => undefined, 3)).toMatch(/number of layers/);
    expect(bad((r) => (r['layers'] = 'x'))).toMatch(/number of layers/);
    expect(bad((r) => (r['layers'] = [new Float32Array(3), new Float32Array(3)]))).toMatch(
      /wrong size/,
    );
    expect(bad((r) => (r['layers'] = [[], []]))).toMatch(/wrong size/);
    expect(bad((r) => (r['atlas'] = 3))).toMatch(/lightmap is not one/);
    expect(bad((r) => (r['atlas'] = { width: 9999, height: 10, rects: [] }))).toMatch(/bad size/);
    expect(bad((r) => (r['atlas'] = { width: 16, height: 0, rects: [] }))).toMatch(/bad size/);
    expect(bad((r) => (r['atlas'] = { width: 16, height: 16, rects: 'x' }))).toMatch(
      /too many faces/,
    );
    expect(
      bad((r) => (r['atlas'] = { width: 16, height: 16, rects: new Array(60).fill(0) })),
    ).toMatch(/too many faces/);
    expect(bad((r) => (r['atlas'] = { width: 16, height: 16, rects: [7] }))).toMatch(
      /a face is not one/,
    );
    for (const rect of [
      { face: 1, x: 1, y: 1, w: 2, h: 2 },
      { face: 0, x: 0, y: 1, w: 2, h: 2 },
      { face: 0, x: 1, y: 15, w: 2, h: 2 },
      { face: 0, x: 1, y: 1, w: 15, h: 2 },
      { face: 0, x: 1, y: 1, w: 2, h: 15 },
      { face: 0, x: 1.5, y: 1, w: 2, h: 2 },
    ]) {
      expect(bad((r) => (r['atlas'] = { width: 16, height: 16, rects: [rect] }))).toMatch(
        /outside the lightmap/,
      );
    }
  });

  it('refuses a layer with a value that is not a sane amount of light', () => {
    for (const value of [Number.NaN, -1, Infinity, 1e9]) {
      const r = fresh();
      const layer = r.layers[1];
      if (layer === undefined) throw new Error('no layer');
      layer[100] = value;
      expect(checkResponse(r, 2)).toMatch(/value out of range/);
    }
  });

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), fc.integer({ min: 0, max: 8 }), (v, mounts) => {
        expect(typeof checkResponse(v, mounts)).toBe('string');
      }),
      { numRuns: Number(process.env['PROP_RUNS'] ?? 100) },
    );
  });
});

describe('stored records', () => {
  it('round trips a response for its own scene only', () => {
    const packed = structuredClone(packCached(scene, solved));
    expect(unpackCached(packed, scene)).toEqual(solved);
    expect(unpackCached(packed, { ...scene, height: 2.5 })).toBeUndefined();
    expect(unpackCached({ ...packed, extra: 1 }, scene)).toBeUndefined();
    expect(unpackCached('x', scene)).toBeUndefined();
    expect(unpackCached({ text: cacheText(scene), response: {} }, scene)).toBeUndefined();
  });

  it('reads an index as cache keys and nothing else', () => {
    expect(checkIndex(['light:0123456789abcdef', 'light:0123456789abcdef', 'other', 3])).toEqual([
      'light:0123456789abcdef',
    ]);
    expect(checkIndex('x')).toEqual([]);
    expect(checkIndex(new Array(100).fill('light:0123456789abcdef'))).toEqual([]);
  });

  it('keeps the newest keys and names the ones that fall off', () => {
    let index: string[] = [];
    const key = (i: number): string => `light:${String(i).padStart(16, '0')}`;
    for (let i = 0; i < MAX_CACHED; i++) {
      const t = touch(index, key(i));
      expect(t.evict).toEqual([]);
      index = t.index;
    }
    // Using the oldest again makes it the newest.
    index = touch(index, key(0)).index;
    const t = touch(index, key(9));
    expect(t.evict).toEqual([key(1)]);
    expect(t.index).toEqual([key(2), key(3), key(0), key(9)]);
  });
});

describe('the store keeps solved light', () => {
  it('saves, loads and reuses a scene', async () => {
    const b = new MemoryBackend();
    const store = new LightStore(b);
    expect(await store.load(scene)).toBeUndefined();
    await store.save(scene, solved);
    expect(await store.load(scene)).toEqual(solved);
    expect(b.map.get(CACHE_INDEX_KEY)).toEqual([cacheKey(scene)]);
    expect(await store.load({ ...scene, width: 1.4 })).toBeUndefined();
  });

  it('deletes a record that fails its checks, and one that is another scene', async () => {
    const b = new MemoryBackend();
    const store = new LightStore(b);
    await store.save(scene, solved);
    const key = cacheKey(scene);
    const stored = b.map.get(key) as { response: { layers: Float32Array[] } };
    const layer = stored.response.layers[0];
    if (layer === undefined) throw new Error('no layer');
    layer[5] = Number.NaN;
    expect(await store.load(scene)).toBeUndefined();
    expect(b.map.has(key)).toBe(false);
    await b.put(key, { text: 'another scene', response: solved });
    expect(await store.load(scene)).toBeUndefined();
    expect(b.map.has(key)).toBe(false);
  });

  it('keeps only the scenes used most recently, and clears strays', async () => {
    const b = new MemoryBackend();
    const store = new LightStore(b);
    const scenes = [2.4, 2.5, 2.6, 2.7, 2.8, 2.9].map((height) => ({ ...scene, height }));
    await b.put('light:ffffffffffffffff', { stray: true });
    for (const s of scenes) await store.save(s, solved);
    const kept = [...b.map.keys()].filter((k) => k.startsWith('light:'));
    expect(kept.sort()).toEqual(scenes.slice(2).map(cacheKey).sort());
    expect(await store.load(scenes[0] ?? scene)).toBeUndefined();
    expect(await store.load(scenes[5] ?? scene)).toEqual(solved);
  });

  it('treats a backend that fails as an empty cache', async () => {
    const broken = new MemoryBackend();
    broken.get = () => Promise.reject(new Error('no'));
    expect(await new LightStore(broken).load(scene)).toBeUndefined();
    const half = new MemoryBackend();
    await new LightStore(half).save(scene, solved);
    half.put = () => Promise.reject(new Error('no'));
    expect(await new LightStore(half).load(scene)).toEqual(solved);
  });
});

describe('the light worker protocol', () => {
  it('accepts a solve request and checks its scene', () => {
    const plain = JSON.parse(JSON.stringify(scene)) as unknown;
    expect(parseRequest({ op: 'solve', id: 3, scene: plain })).toEqual({
      op: 'solve',
      id: 3,
      scene,
    });
    expect(parseRequest({ op: 'solve', id: 3, scene: { ...scene, width: 9 } })).toBeUndefined();
    expect(parseRequest({ op: 'solve', id: -1, scene: plain })).toBeUndefined();
    expect(parseRequest({ op: 'solve', id: 1.5, scene: plain })).toBeUndefined();
    expect(parseRequest({ op: 'solve', id: 1, scene: plain, extra: 1 })).toBeUndefined();
    expect(parseRequest({ op: 'stop', id: 1, scene: plain })).toBeUndefined();
    expect(parseRequest(null)).toBeUndefined();
    expect(parseRequest([1])).toBeUndefined();
    expect(parseRequest(new Date(0))).toBeUndefined();
  });

  it('accepts each reply and refuses anything else', () => {
    expect(parseReply({ op: 'progress', id: 1, done: 1, total: 2 }, 2)).toEqual({
      op: 'progress',
      id: 1,
      done: 1,
      total: 2,
    });
    expect(parseReply({ op: 'progress', id: 1, done: 3, total: 2 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'progress', id: 1, done: 1, total: 2, x: 1 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'failed', id: 1, error: 'x'.repeat(500) }, 2)).toEqual({
      op: 'failed',
      id: 1,
      error: 'x'.repeat(200),
    });
    expect(parseReply({ op: 'failed', id: 1, error: 5 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'failed', id: 1, error: 'x', more: 1 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'solved', id: 1, response: fresh() }, 2)?.op).toBe('solved');
    expect(parseReply({ op: 'solved', id: 1, response: fresh() }, 1)).toBeUndefined();
    expect(parseReply({ op: 'solved', id: 1, response: fresh(), x: 1 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'other', id: 1 }, 2)).toBeUndefined();
    expect(parseReply({ op: 'failed', id: 'a', error: 'x' }, 2)).toBeUndefined();
    expect(parseReply('x', 2)).toBeUndefined();
  });

  it('answers a request with progress and then the layers, handing their memory over', () => {
    const small: Scene = { ...scene, mounts: [mount('a', 'channel', 'left', 5)] };
    const replies: LightReply[] = [];
    const transfers: ArrayBuffer[][] = [];
    answer({ op: 'solve', id: 7, scene: JSON.parse(JSON.stringify(small)) as unknown }, (r, t) => {
      replies.push(r);
      transfers.push(t);
    });
    expect(replies.map((r) => r.op)).toEqual(['progress', 'solved']);
    const last = replies[1];
    if (last?.op !== 'solved') throw new Error('not solved');
    expect(last.id).toBe(7);
    expect(transfers[1]).toEqual(last.response.layers.map((l) => l.buffer));
    expect(parseReply(structuredClone(last), 1)?.op).toBe('solved');
  });

  it('drops what is not a request, and reports a solve that fails', () => {
    const replies: LightReply[] = [];
    answer({ op: 'nonsense' }, (r) => {
      replies.push(r);
    });
    expect(replies).toEqual([]);
    const plain = JSON.parse(JSON.stringify(scene)) as unknown;
    const post = (r: LightReply): void => {
      replies.push(r);
    };
    answer({ op: 'solve', id: 2, scene: plain }, post, () => {
      throw new RangeError('The lightmap is too large.');
    });
    expect(replies).toEqual([{ op: 'failed', id: 2, error: 'The lightmap is too large.' }]);
    replies.length = 0;
    answer({ op: 'solve', id: 3, scene: plain }, post, () => {
      // eslint would have this be an Error, and a worker can still meet anything.
      throw 'x' as unknown as Error;
    });
    expect(replies).toEqual([{ op: 'failed', id: 3, error: 'failed' }]);
  });
});
