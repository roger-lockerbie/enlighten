/**
 * The store (docs/ARCHITECTURE.md section 2, ADR 0009). Every record is `{ version, data }`. A load
 * checks the shape, migrates, and validates. A record that fails is set aside under a dated key, not
 * deleted, and the defaults are used. The backend is IndexedDB in the page and a map in tests.
 */
import { percentText } from '../dali/curve.ts';
import { PREFERENCES_MIGRATIONS, WORKSPACE_MIGRATIONS } from './migrations/index.ts';
import { migrate } from './migrate.ts';
import {
  checkPreferences,
  checkWorkspace,
  DEFAULT_PREFERENCES,
  PREFERENCES_VERSION,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  type Preferences,
  type Workspace,
} from './schema.ts';
import { checkTree, parseText, type Result } from './validate.ts';

export interface Backend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/** For tests: values are cloned in and out, as IndexedDB does. */
export class MemoryBackend implements Backend {
  readonly map = new Map<string, unknown>();
  get(key: string): Promise<unknown> {
    return Promise.resolve(structuredClone(this.map.get(key)));
  }
  put(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
    return Promise.resolve();
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()]);
  }
  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
}

export const PREFERENCES_KEY = 'preferences';
export const SET_ASIDE_PREFIX = 'set-aside:';

export interface Loaded<T> {
  readonly value: T;
  /** Set when a stored record could not be used and was set aside. */
  readonly problem?: string;
}

export class Store {
  private readonly backend: Backend;
  private readonly stamp: () => string;

  /** `stamp` names a set-aside record, for example with the date and time. */
  constructor(backend: Backend, stamp: () => string) {
    this.backend = backend;
    this.stamp = stamp;
  }

  async loadPreferences(): Promise<Loaded<Preferences>> {
    let raw: unknown;
    try {
      raw = await this.backend.get(PREFERENCES_KEY);
    } catch {
      return { value: DEFAULT_PREFERENCES, problem: 'Stored preferences could not be read.' };
    }
    if (raw === undefined) return { value: DEFAULT_PREFERENCES };
    const r = readRecord(raw, (d) =>
      migrate(d.data, d.version, PREFERENCES_VERSION, PREFERENCES_MIGRATIONS),
    );
    const checked = r.ok ? checkPreferences(r.value) : r;
    if (checked.ok) return { value: checked.value };
    const key = `${SET_ASIDE_PREFIX}${PREFERENCES_KEY}:${this.stamp()}`;
    try {
      await this.backend.put(key, raw);
      await this.backend.delete(PREFERENCES_KEY);
    } catch {
      // The defaults are used either way.
    }
    return {
      value: DEFAULT_PREFERENCES,
      problem: `Stored preferences were set aside and defaults used. ${checked.error}`,
    };
  }

  async savePreferences(p: Preferences): Promise<void> {
    const checked = checkPreferences(p);
    if (!checked.ok) throw new Error(checked.error);
    await this.backend.put(PREFERENCES_KEY, { version: PREFERENCES_VERSION, data: checked.value });
  }

  async setAside(): Promise<string[]> {
    return (await this.backend.keys()).filter((k) => k.startsWith(SET_ASIDE_PREFIX)).sort();
  }

  async discardSetAside(): Promise<void> {
    for (const k of await this.setAside()) await this.backend.delete(k);
  }
}

/** A stored record is `{ version, data }` and nothing else. */
function readRecord(
  raw: unknown,
  then: (r: { version: unknown; data: unknown }) => Result<unknown>,
): Result<unknown> {
  const bad = checkTree(raw);
  if (bad !== undefined) return { ok: false, error: bad };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, error: 'A stored record is an object.' };
  const keys = Object.keys(raw);
  if (keys.length !== 2 || !keys.includes('version') || !keys.includes('data'))
    return { ok: false, error: 'A stored record has a version and data, and nothing else.' };
  const r = raw as { version: unknown; data: unknown };
  return then(r);
}

// -------------------------------------------------------------------------------------------------
// Workspace files

/** Build a workspace file. What it writes is checked, so every export can be imported. */
export function exportWorkspace(content: Omit<Workspace, 'format' | 'version'>): string {
  const checked = checkWorkspace({
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    ...content,
  });
  if (!checked.ok) throw new Error(checked.error);
  return `${JSON.stringify(checked.value, null, 2)}\n`;
}

export interface ImportPlan {
  readonly workspace: Workspace;
  /** What applying it will change, one line each, for the confirmation (SPEC section 8). */
  readonly changes: readonly string[];
  /** The file's ceiling, only when it is lower than the present one. */
  readonly lowerCeiling?: number;
}

const pct = (arc: number) => `${percentText(arc)}%`;

/**
 * Read a workspace file: size, parse, tree check, migrate, validate. Nothing is applied: the plan
 * lists what would change. A higher ceiling is never applied. Reading sends nothing.
 */
export function readWorkspace(
  text: string,
  present: { readonly ceilingArc: number },
): Result<ImportPlan> {
  const parsed = parseText(text);
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, error: 'A workspace file is an object.' };
  const head = raw as Record<string, unknown>;
  if (head['format'] !== WORKSPACE_FORMAT)
    return { ok: false, error: 'This is not an Enlighten workspace file.' };
  const migrated = migrate(raw, head['version'], WORKSPACE_VERSION, WORKSPACE_MIGRATIONS);
  if (!migrated.ok) return migrated;
  const checked = checkWorkspace(migrated.value);
  if (!checked.ok) return checked;
  const w = checked.value;
  const changes: string[] = [];
  let lowerCeiling: number | undefined;
  if (w.ceiling !== undefined) {
    if (w.ceiling < present.ceilingArc) {
      lowerCeiling = w.ceiling;
      changes.push(
        `Ceiling: lowered from ${pct(present.ceilingArc)} (arc ${String(present.ceilingArc)}) to ${pct(w.ceiling)} (arc ${String(w.ceiling)}).`,
      );
    } else if (w.ceiling > present.ceilingArc) {
      changes.push(
        `Ceiling: the file's ${pct(w.ceiling)} is higher than the present ${pct(present.ceilingArc)}, so it is not applied.`,
      );
    }
  }
  const p = w.preferences;
  if (p?.playgroundMode !== undefined)
    changes.push(`Playground mode: ${p.playgroundMode === 'live' ? 'Live' : 'Commit'}.`);
  if (p?.reducedMotion === 'always') changes.push('Reduced motion: always on.');
  for (const d of w.devices ?? []) {
    const parts: string[] = [];
    if (d.alias !== undefined) parts.push(`name "${d.alias}"`);
    if (d.presentation !== undefined)
      parts.push(`simulated as ${d.presentation === 'tc' ? 'Tc' : 'RGBWAF'}`);
    if (d.settings !== undefined) {
      const n = Object.keys(d.settings).length;
      parts.push(
        n === 0
          ? 'simulator settings at their defaults'
          : `${String(n)} simulator settings changed`,
      );
    }
    if (parts.length > 0) changes.push(`A${String(d.address)}: ${parts.join(', ')}.`);
  }
  return {
    ok: true,
    value: {
      workspace: w,
      changes,
      ...(lowerCeiling === undefined ? {} : { lowerCeiling }),
    },
  };
}
