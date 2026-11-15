/**
 * The page's side of the bus worker (ADR 0010, SPEC S4.5, S4.6). It reads the session token from the
 * address, removes it from the address bar and the tab's history entry, and hands it to the worker in
 * the first message without keeping a copy. It sends a heartbeat every second while the page is
 * visible, and ends the worker if panic is not confirmed within 250 ms, which closes the WebSocket so
 * the server turns the lights off.
 */
import type { Snapshot } from '../engine/engine.ts';
import {
  parseFromWorker,
  parseToken,
  type Call,
  type CallResult,
  type ToWorker,
} from '../engine/protocol.ts';
import { startBusWorker } from '../workers/policy.ts';

/** How long the worker has to confirm panic before the page ends it (SPEC S4.5). */
export const PANIC_CONFIRM_MS = 250;
export const HEARTBEAT_MS = 1000;

export interface TokenRead {
  readonly token?: Uint8Array;
  /** Why a token in the address was not used. */
  readonly problem?: string;
}

/** Read `#t=<64 hex>` and remove it from the address bar and this history entry. */
export function readToken(): TokenRead {
  const hash = location.hash;
  if (hash === '') return {};
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  const m = /^#t=([0-9a-f]{64})$/.exec(hash);
  if (m?.[1] === undefined)
    return { problem: 'The address had something after # that is not a session token.' };
  // A service worker on this origin could read the token. The app registers none (THREAT_MODEL 3.4).
  const sw = (navigator as { serviceWorker?: { controller: unknown } }).serviceWorker;
  if (sw?.controller != null)
    return {
      problem: 'A service worker controls this page, so the app did not use the session token.',
    };
  const token = parseToken(m[1]);
  return token === undefined ? {} : { token };
}

export class BusClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly waiting = new Map<number, (r: CallResult) => void>();
  private readonly snapshotListeners = new Set<(s: Snapshot) => void>();
  private readonly deadListeners = new Set<(why: string) => void>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private panicTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set once the worker is gone. Nothing more can be sent. */
  dead: string | undefined;

  constructor(token: Uint8Array | undefined) {
    const w = startBusWorker();
    this.worker = w;
    w.onmessage = (ev: MessageEvent) => {
      this.receive(ev.data);
    };
    w.onerror = () => {
      this.end('The bus worker stopped with an error. Reload the page.');
    };
    this.post(token === undefined ? { type: 'init' } : { type: 'init', token });
    // The page keeps no copy: the caller's array is cleared.
    token?.fill(0);
    const beat = () => {
      this.post({ type: 'heartbeat', visible: document.visibilityState === 'visible' });
    };
    beat();
    this.heartbeat = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
  }

  onSnapshot(fn: (s: Snapshot) => void): () => void {
    this.snapshotListeners.add(fn);
    return () => this.snapshotListeners.delete(fn);
  }

  onDead(fn: (why: string) => void): () => void {
    this.deadListeners.add(fn);
    return () => this.deadListeners.delete(fn);
  }

  call(call: Call): Promise<CallResult> {
    if (this.dead !== undefined) return Promise.resolve({ ok: false, reason: this.dead });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.post({ type: 'call', id, call });
    });
  }

  /** Panic. If the worker does not confirm in time, end it: the server's own stop turns the lights off. */
  panic(): void {
    if (this.dead !== undefined) return;
    const id = this.nextId++;
    this.post({ type: 'panic', id });
    clearTimeout(this.panicTimer);
    this.panicTimer = setTimeout(() => {
      this.end(
        'The bus worker did not confirm panic in time, so the page ended it. With hardware, the server turned the lights off. Reload the page.',
      );
    }, PANIC_CONFIRM_MS);
  }

  private post(m: ToWorker): void {
    this.worker?.postMessage(m);
  }

  private receive(data: unknown): void {
    const m = parseFromWorker(data);
    if (m === undefined) return;
    switch (m.type) {
      case 'snapshot':
        for (const l of this.snapshotListeners) l(m.snapshot);
        return;
      case 'reply': {
        const r = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        r?.(m.result);
        return;
      }
      case 'panicked':
        clearTimeout(this.panicTimer);
        this.panicTimer = undefined;
        return;
    }
  }

  private end(why: string): void {
    if (this.dead !== undefined) return;
    this.dead = why;
    this.worker?.terminate();
    this.worker = undefined;
    clearInterval(this.heartbeat);
    for (const r of this.waiting.values()) r({ ok: false, reason: why });
    this.waiting.clear();
    for (const l of this.deadListeners) l(why);
  }
}
