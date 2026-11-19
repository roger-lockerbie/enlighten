/**
 * What the Visualiser keeps between visits (ADR 0018): set-ups A and B, whether they are shown side
 * by side, which one the editor changes, and the view. Checked on every read, as every stored
 * record is (ADR 0009). It lives with the light core, not the store, so the app's first page does
 * not carry the scene's code: only the Visualiser and a workspace import or export load it.
 */
import type { View } from './camera.ts';
import { downHall, parseView } from './camera.ts';
import type { Setup } from './setup.ts';
import { defaultSetup, parseSetup } from './setup.ts';

export type Side = 'a' | 'b';

export interface Saved {
  readonly a: Setup;
  readonly b: Setup;
  /** The A/B view: both set-ups side by side (SPEC R12.2). */
  readonly compare: boolean;
  /** The set-up the editor changes. */
  readonly editing: Side;
  readonly view: View;
}

export type SavedResult =
  { readonly ok: true; readonly value: Saved } | { readonly ok: false; readonly error: string };

export function defaultSaved(): Saved {
  const a = defaultSetup();
  return { a, b: defaultSetup(), compare: false, editing: 'a', view: downHall(a.scene) };
}

const KEYS = ['a', 'b', 'compare', 'editing', 'view'];

export function parseSaved(v: unknown): SavedResult {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { ok: false, error: 'The visualiser record is not an object.' };
  }
  if (Object.getPrototypeOf(v) !== Object.prototype) {
    return { ok: false, error: 'The visualiser record is not a plain object.' };
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(o, k))) {
    return { ok: false, error: 'The visualiser record has the wrong keys.' };
  }
  const a = parseSetup(o['a']);
  if (!a.ok) return { ok: false, error: `Set-up A: ${a.error}` };
  const b = parseSetup(o['b']);
  if (!b.ok) return { ok: false, error: `Set-up B: ${b.error}` };
  const compare = o['compare'];
  const editing = o['editing'];
  const view = parseView(o['view']);
  if (typeof compare !== 'boolean')
    return { ok: false, error: 'The A/B setting is not a yes or no.' };
  if (editing !== 'a' && editing !== 'b')
    return { ok: false, error: 'The set-up being edited is not A or B.' };
  if (view === undefined) return { ok: false, error: 'The view is not valid.' };
  return { ok: true, value: { a: a.value, b: b.value, compare, editing, view } };
}

// The workspace file's form (SPEC section 8): the hallway and mounts of set-up A as their own keys,
// with set-up B under `compare`.

export interface WorkspaceSetup {
  readonly hallway: {
    readonly length: number;
    readonly width: number;
    readonly height: number;
    readonly endWalls: 'open' | 'closed';
    readonly reflectance: {
      readonly ceiling: number;
      readonly walls: number;
      readonly floor: number;
    };
  };
  readonly mounts: Setup['scene']['mounts'];
  readonly links: Setup['links'];
}

export function toWorkspace(s: Setup): WorkspaceSetup {
  const { mounts, ...hallway } = s.scene;
  return { hallway, mounts, links: s.links };
}

export function fromWorkspace(w: unknown): SetupResult {
  if (typeof w !== 'object' || w === null || Array.isArray(w)) {
    return { ok: false, error: 'The set-up is not an object.' };
  }
  const o = w as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || !['hallway', 'mounts', 'links'].every((k) => Object.hasOwn(o, k))) {
    return { ok: false, error: 'The set-up has the wrong keys.' };
  }
  const hall = o['hallway'];
  if (typeof hall !== 'object' || hall === null || Array.isArray(hall)) {
    return { ok: false, error: 'The hallway is not an object.' };
  }
  if (Object.hasOwn(hall, 'mounts')) return { ok: false, error: 'The hallway has the wrong keys.' };
  return parseSetup({ scene: { ...hall, mounts: o['mounts'] }, links: o['links'] });
}

type SetupResult =
  { readonly ok: true; readonly value: Setup } | { readonly ok: false; readonly error: string };

/** One line for each way an imported set-up differs from the present one, for the confirmation. */
export function setupChanges(label: string, before: Setup, after: Setup): string[] {
  const out: string[] = [];
  const a = before.scene;
  const b = after.scene;
  const m = (v: number): string => String(Number(v.toFixed(3)));
  if (a.length !== b.length || a.width !== b.width || a.height !== b.height) {
    out.push(`${label}: the hallway becomes ${m(b.length)} by ${m(b.width)} by ${m(b.height)} m.`);
  }
  if (a.endWalls !== b.endWalls) out.push(`${label}: end walls ${b.endWalls}.`);
  const r = b.reflectance;
  if (JSON.stringify(a.reflectance) !== JSON.stringify(r)) {
    out.push(
      `${label}: reflectances ${m(r.ceiling)} ceiling, ${m(r.walls)} walls, ${m(r.floor)} floor.`,
    );
  }
  if (
    JSON.stringify(a.mounts) !== JSON.stringify(b.mounts) ||
    JSON.stringify(before.links) !== JSON.stringify(after.links)
  ) {
    out.push(
      `${label}: ${String(b.mounts.length)} ${b.mounts.length === 1 ? 'mount' : 'mounts'}, replacing ${String(a.mounts.length)}.`,
    );
  }
  return out;
}
