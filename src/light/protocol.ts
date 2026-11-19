/**
 * Messages between the page and the light worker (ADR 0010). Both sides check what they receive:
 * the worker checks the scene, and the page checks the layers that come back.
 */
import { checkResponse } from './cache.ts';
import type { Response } from './response.ts';
import { solveScene } from './response.ts';
import type { Scene } from './scene.ts';
import { parseScene } from './scene.ts';

export interface LightRequest {
  readonly op: 'solve';
  readonly id: number;
  readonly scene: Scene;
}

export type LightReply =
  | { readonly op: 'progress'; readonly id: number; readonly done: number; readonly total: number }
  | { readonly op: 'solved'; readonly id: number; readonly response: Response }
  | { readonly op: 'failed'; readonly id: number; readonly error: string };

const MAX_ID = 2 ** 31;

function record(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null ? (v as Record<string, unknown>) : undefined;
}

const isId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_ID;

/** A request from the page, or nothing if it is not one. */
export function parseRequest(v: unknown): LightRequest | undefined {
  const o = record(v);
  if (o?.['op'] !== 'solve' || Object.keys(o).length !== 3) return undefined;
  const id = o['id'];
  if (!isId(id)) return undefined;
  const scene = parseScene(o['scene']);
  return scene.ok ? { op: 'solve', id, scene: scene.value } : undefined;
}

/** A reply from the worker for a scene with `mounts` mounts, or nothing if it is not one. */
export function parseReply(v: unknown, mounts: number): LightReply | undefined {
  const o = record(v);
  if (o === undefined) return undefined;
  const id = o['id'];
  if (!isId(id)) return undefined;
  switch (o['op']) {
    case 'progress': {
      const { done, total } = o;
      if (Object.keys(o).length !== 4 || !isId(done) || !isId(total) || done > total)
        return undefined;
      return { op: 'progress', id, done, total };
    }
    case 'solved': {
      if (Object.keys(o).length !== 3) return undefined;
      const response = checkResponse(o['response'], mounts);
      return typeof response === 'string' ? undefined : { op: 'solved', id, response };
    }
    case 'failed': {
      const error = o['error'];
      if (Object.keys(o).length !== 3 || typeof error !== 'string') return undefined;
      return { op: 'failed', id, error: error.slice(0, 200) };
    }
    default:
      return undefined;
  }
}

/**
 * What the worker does with a message: solve the scene and post the layers back, handing their
 * memory over, not copying it. Anything that is not a request is dropped.
 */
export function answer(
  data: unknown,
  post: (reply: LightReply, transfer: ArrayBuffer[]) => void,
  solver: typeof solveScene = solveScene,
): void {
  const request = parseRequest(data);
  if (request === undefined) return;
  const { id } = request;
  try {
    const response = solver(request.scene, {
      progress: (done, total) => {
        post({ op: 'progress', id, done, total }, []);
      },
    });
    post(
      { op: 'solved', id, response },
      response.layers.map((l) => l.buffer as ArrayBuffer),
    );
  } catch (err) {
    post(
      { op: 'failed', id, error: (err instanceof Error ? err.message : 'failed').slice(0, 200) },
      [],
    );
  }
}
