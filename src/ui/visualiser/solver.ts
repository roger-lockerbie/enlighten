/**
 * Getting a scene's solved light: from the store if it is kept, otherwise from the light worker,
 * which then gets kept (ADR 0008, ADR 0010). A newer request ends a solve in flight by ending the
 * worker and starting another (ADR 0017). Replies are checked before use.
 */
import type { Atlas } from '../../light/atlas.ts';
import { parseReply } from '../../light/protocol.ts';
import type { Response } from '../../light/response.ts';
import type { Scene } from '../../light/scene.ts';
import type { LightStore } from '../../store/light.ts';

export type SolveState =
  | { readonly state: 'solving'; readonly done: number; readonly total: number }
  | { readonly state: 'ready'; readonly response: Response; readonly cached: boolean }
  | { readonly state: 'failed'; readonly reason: string };

export class LightSolver {
  private readonly store: LightStore;
  private readonly start: () => Worker;
  private readonly atlas: Atlas;
  private worker: Worker | undefined;
  private busy = false;
  private id = 0;

  /** `atlas` is the page's own lightmap layout: a response laid out otherwise is not used. */
  constructor(store: LightStore, start: () => Worker, atlas: Atlas) {
    this.store = store;
    this.start = start;
    this.atlas = atlas;
  }

  /** Solve a scene, reporting as it goes. A later call makes this one stop reporting. */
  async solve(scene: Scene, report: (s: SolveState) => void): Promise<void> {
    const id = ++this.id;
    const total = scene.mounts.length;
    report({ state: 'solving', done: 0, total });
    const kept = await this.store.load(scene);
    if (id !== this.id) return;
    if (kept !== undefined && this.fits(kept)) {
      report({ state: 'ready', response: kept, cached: true });
      return;
    }
    if (this.busy) this.stop();
    let worker: Worker;
    try {
      worker = this.worker ??= this.start();
    } catch {
      report({ state: 'failed', reason: 'The light worker could not start.' });
      return;
    }
    this.busy = true;
    const finish = (s: SolveState): void => {
      if (id !== this.id) return;
      this.busy = false;
      report(s);
    };
    worker.onmessage = (ev: MessageEvent) => {
      if (id !== this.id) return;
      const reply = parseReply(ev.data, total);
      if (reply === undefined) {
        // A reply that fails its checks: the worker is not to be trusted with another.
        this.stop();
        finish({
          state: 'failed',
          reason: 'The light worker gave an answer that did not check out.',
        });
        return;
      }
      if (reply.id !== id) return;
      if (reply.op === 'progress') {
        report({ state: 'solving', done: reply.done, total: reply.total });
      } else if (reply.op === 'failed') {
        finish({ state: 'failed', reason: reply.error });
      } else if (!this.fits(reply.response)) {
        finish({ state: 'failed', reason: 'The solved light does not fit this hallway.' });
      } else {
        const response = reply.response;
        finish({ state: 'ready', response, cached: false });
        // Keeping it is a convenience. If the store refuses, the next visit solves again.
        this.store.save(scene, response).catch(() => undefined);
      }
    };
    worker.onerror = () => {
      this.stop();
      finish({ state: 'failed', reason: 'The light worker stopped.' });
    };
    // A plain copy: the scene may be a reactive proxy, which cannot be posted.
    worker.postMessage({ op: 'solve', id, scene: JSON.parse(JSON.stringify(scene)) as unknown });
  }

  /** True when a response's lightmap is laid out face for face as the page's is. */
  private fits(response: Response): boolean {
    const a = response.atlas;
    const b = this.atlas;
    return (
      a.width === b.width &&
      a.height === b.height &&
      a.rects.length === b.rects.length &&
      a.rects.every((r, i) => {
        const o = b.rects[i];
        return r.x === o?.x && r.y === o.y && r.w === o.w && r.h === o.h;
      })
    );
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.busy = false;
  }

  dispose(): void {
    this.id++;
    this.stop();
  }
}
