/**
 * Getting a scene's solved light: from the store if it is kept, otherwise from the light worker,
 * which then gets kept (ADR 0008, ADR 0010). A newer request ends a solve in flight by ending the
 * worker and starting another (ADR 0017). Replies are checked before use.
 */
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
  private worker: Worker | undefined;
  private busy = false;
  private id = 0;

  constructor(store: LightStore, start: () => Worker) {
    this.store = store;
    this.start = start;
  }

  /** Solve a scene, reporting as it goes. A later call makes this one go quiet. */
  async solve(scene: Scene, report: (s: SolveState) => void): Promise<void> {
    const id = ++this.id;
    const total = scene.mounts.length;
    report({ state: 'solving', done: 0, total });
    const kept = await this.store.load(scene);
    if (id !== this.id) return;
    if (kept !== undefined) {
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
      const reply = parseReply(ev.data, total);
      if (reply?.id !== id || id !== this.id) return;
      if (reply.op === 'progress') {
        report({ state: 'solving', done: reply.done, total: reply.total });
      } else if (reply.op === 'failed') {
        finish({ state: 'failed', reason: reply.error });
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
