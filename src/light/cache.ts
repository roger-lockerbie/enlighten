/**
 * Solved responses are kept so a scene seen before needs no solve (ADR 0008). The key is a hash of
 * the scene's geometry text and the solver's version. The hash is not a security measure: the text
 * is stored beside the layers and compared on read, so a collision or an edited record cannot pass
 * for another scene. Everything read back is checked for shape, size and sane numbers, like any
 * other stored data (ADR 0009).
 */
import type { Atlas, AtlasRect } from './atlas.ts';
import { ATLAS_WIDTH, MAX_ATLAS_HEIGHT, MAX_PATCHES, SOLVER_VERSION } from './limits.ts';
import type { Response } from './response.ts';
import type { Scene } from './scene.ts';
import { MAX_MOUNTS, geometryText } from './scene.ts';

export const CACHE_PREFIX = 'light:';
export const CACHE_INDEX_KEY = 'light-index';
/** Scenes kept. Each is a megabyte or two. */
export const MAX_CACHED = 4;

/** The most faces a scene can have: six for the room and five for each of six openings. */
const MAX_FACES = 6 + 5 * MAX_MOUNTS;
/** No surface gets more than this from 1 lm per metre of tape: the tape's own cover gives 1 ÷ its width. */
const MAX_VALUE = 1000;

/** FNV-1a over UTF-16 code units, twice with different starts, as 16 hex digits. */
export function hashText(text: string): string {
  const run = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return run(0x811c9dc5) + run(0x9747b28c);
}

/** What identifies a scene's solved response: the solver and the paths light can take. */
export function cacheText(scene: Scene): string {
  return `v${String(SOLVER_VERSION)}|${geometryText(scene)}`;
}

export function cacheKey(scene: Scene): string {
  return CACHE_PREFIX + hashText(cacheText(scene));
}

function plain(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null ? (v as Record<string, unknown>) : undefined;
}

function hasKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

const whole = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function checkAtlas(v: unknown): Atlas | string {
  const o = plain(v);
  if (o === undefined || !hasKeys(o, ['width', 'height', 'rects']))
    return 'the lightmap is not one';
  const { width, height, rects } = o;
  if (!whole(width, 1, ATLAS_WIDTH) || !whole(height, 1, MAX_ATLAS_HEIGHT)) {
    return 'the lightmap has a bad size';
  }
  if (!Array.isArray(rects) || rects.length > MAX_FACES) return 'the lightmap has too many faces';
  const out: AtlasRect[] = [];
  for (const [i, item] of (rects as unknown[]).entries()) {
    const r = plain(item);
    if (r === undefined || !hasKeys(r, ['face', 'x', 'y', 'w', 'h'])) return 'a face is not one';
    const { face, x, y, w, h } = r;
    if (
      face !== i ||
      !whole(x, 1, width - 2) ||
      !whole(y, 1, height - 2) ||
      !whole(w, 1, width - 1 - x) ||
      !whole(h, 1, height - 1 - y)
    ) {
      return 'a face lies outside the lightmap';
    }
    out.push({ face, x, y, w, h });
  }
  return { width, height, rects: out };
}

/**
 * Check a value as a solved response for a scene with `mounts` mounts. The layers are not copied:
 * they come from a structured clone, so nothing else holds them.
 */
export function checkResponse(v: unknown, mounts: number): Response | string {
  const o = plain(v);
  if (o === undefined || !hasKeys(o, ['version', 'atlas', 'layers', 'patches', 'coarsening'])) {
    return 'the response has the wrong keys';
  }
  if (o['version'] !== SOLVER_VERSION) return 'the response is from another version of the solver';
  const atlas = checkAtlas(o['atlas']);
  if (typeof atlas === 'string') return atlas;
  const { layers, patches, coarsening } = o;
  if (!whole(patches, 0, 2 * MAX_PATCHES)) return 'the patch count is out of range';
  if (typeof coarsening !== 'number' || !(coarsening >= 1 && coarsening <= 100)) {
    return 'the coarsening is out of range';
  }
  if (!Array.isArray(layers) || layers.length !== mounts || mounts > MAX_MOUNTS) {
    return 'the response has the wrong number of layers';
  }
  const size = atlas.width * atlas.height;
  const out: Float32Array[] = [];
  for (const layer of layers as unknown[]) {
    if (!(layer instanceof Float32Array) || layer.length !== size)
      return 'a layer has the wrong size';
    for (const value of layer) {
      if (!(value >= 0 && value <= MAX_VALUE)) return 'a layer holds a value out of range';
    }
    out.push(layer);
  }
  return { version: SOLVER_VERSION, atlas, layers: out, patches, coarsening };
}

/** The record stored for a scene. */
export function packCached(scene: Scene, response: Response): Record<string, unknown> {
  return { text: cacheText(scene), response: { ...response, layers: [...response.layers] } };
}

/** A stored record as a response, or nothing when it is not this scene's or does not check out. */
export function unpackCached(v: unknown, scene: Scene): Response | undefined {
  const o = plain(v);
  if (o === undefined || !hasKeys(o, ['text', 'response'])) return undefined;
  if (o['text'] !== cacheText(scene)) return undefined;
  const r = checkResponse(o['response'], scene.mounts.length);
  return typeof r === 'string' ? undefined : r;
}

const KEY = /^light:[0-9a-f]{16}$/;

/** A stored index as a list of cache keys, oldest first. Anything else reads as empty. */
export function checkIndex(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 64) return [];
  const out: string[] = [];
  for (const k of v as unknown[]) {
    if (typeof k === 'string' && KEY.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Move a key to the newest end of the index, and name the keys that fall off the old end. */
export function touch(index: readonly string[], key: string): { index: string[]; evict: string[] } {
  const next = [...index.filter((k) => k !== key), key];
  const evict = next.slice(0, Math.max(0, next.length - MAX_CACHED));
  return { index: next.slice(evict.length), evict };
}
