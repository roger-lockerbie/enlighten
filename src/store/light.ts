/**
 * The solved light kept for scenes seen before (ADR 0008, ADR 0009). It shares the store's backend
 * and lives in its own module, so the app's first page does not load the scene and cache code with
 * the rest of the store: only the visualiser does.
 */
import {
  CACHE_INDEX_KEY,
  CACHE_PREFIX,
  cacheKey,
  checkIndex,
  packCached,
  touch,
  unpackCached,
} from '../light/cache.ts';
import type { Response } from '../light/response.ts';
import type { Scene } from '../light/scene.ts';
import type { Backend } from './store.ts';

export class LightStore {
  private readonly backend: Backend;

  constructor(backend: Backend) {
    this.backend = backend;
  }

  /**
   * The solved light for a scene, if it is kept (ADR 0008). A record that is not this scene's, or
   * fails its checks, is deleted, not set aside: the cache is only ever a copy of what a solve gives.
   */
  async load(scene: Scene): Promise<Response | undefined> {
    const key = cacheKey(scene);
    let raw: unknown;
    try {
      raw = await this.backend.get(key);
    } catch {
      return undefined;
    }
    if (raw === undefined) return undefined;
    const response = unpackCached(raw, scene);
    try {
      if (response === undefined) await this.backend.delete(key);
      else await this.touch(key);
    } catch {
      // The cache is a convenience. A failure here costs a solve next time, no more.
    }
    return response;
  }

  /** Keep a scene's solved light, and drop the scenes used longest ago. */
  async save(scene: Scene, response: Response): Promise<void> {
    const key = cacheKey(scene);
    await this.backend.put(key, packCached(scene, response));
    await this.touch(key);
  }

  private async touch(key: string): Promise<void> {
    const { index, evict } = touch(checkIndex(await this.backend.get(CACHE_INDEX_KEY)), key);
    for (const old of evict) await this.backend.delete(old);
    await this.backend.put(CACHE_INDEX_KEY, index);
    // Records the index does not name are left over from a failed write. Remove them.
    for (const k of await this.backend.keys()) {
      if (k.startsWith(CACHE_PREFIX) && !index.includes(k)) await this.backend.delete(k);
    }
  }
}
