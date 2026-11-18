/**
 * The store (docs/ARCHITECTURE.md section 2, ADR 0009). Every record is `{ version, data }`. A load
 * checks the shape, migrates, and validates. A record that fails is set aside under a dated key, not
 * deleted, and the defaults are used. The backend is IndexedDB in the page and a map in tests.
 */
import { mergeStored, type StoredLine } from '../console/history.ts';
import { percentText } from '../dali/curve.ts';
import {
  HISTORY_MIGRATIONS,
  PREFERENCES_MIGRATIONS,
  SCRIPTS_MIGRATIONS,
  WORKSPACE_MIGRATIONS,
} from './migrations/index.ts';
import { migrate, type Migration } from './migrate.ts';
import {
  checkHistory,
  checkPreferences,
  checkScripts,
  checkWorkspace,
  DEFAULT_PREFERENCES,
  HISTORY_VERSION,
  PREFERENCES_VERSION,
  SCRIPTS_VERSION,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  type Preferences,
  type StoredScript,
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

/** The light cache's keys: one per kept scene, and its index (`src/light/cache.ts`). */
const LIGHT_KEY = /^light:[0-9a-f]{16}$|^light-index$/;

export const PREFERENCES_KEY = 'preferences';
export const HISTORY_KEY = 'history';
export const SCRIPTS_KEY = 'scripts';
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

  /**
   * Load one record: read, migrate, validate. One that fails is set aside under a dated key and the
   * defaults are used.
   */
  private async load<T>(
    key: string,
    what: string,
    version: number,
    migrations: readonly Migration[],
    check: (x: unknown) => Result<T>,
    defaults: T,
  ): Promise<Loaded<T>> {
    let raw: unknown;
    try {
      raw = await this.backend.get(key);
    } catch {
      return { value: defaults, problem: `Stored ${what} could not be read.` };
    }
    if (raw === undefined) return { value: defaults };
    const r = readRecord(raw, (d) => migrate(d.data, d.version, version, migrations));
    const checked = r.ok ? check(r.value) : r;
    if (checked.ok) return { value: checked.value };
    try {
      await this.backend.put(`${SET_ASIDE_PREFIX}${key}:${this.stamp()}`, raw);
      await this.backend.delete(key);
    } catch {
      // The defaults are used either way.
    }
    return {
      value: defaults,
      problem: `Stored ${what} were set aside and defaults used. ${checked.error}`,
    };
  }

  private async save<T>(
    key: string,
    version: number,
    check: (x: unknown) => Result<T>,
    data: unknown,
  ): Promise<void> {
    const checked = check(data);
    if (!checked.ok) throw new Error(checked.error);
    await this.backend.put(key, { version, data: checked.value });
  }

  /**
   * The backend as the light cache may use it: its own keys and no others, so the cache's code can
   * never read or write preferences, history, scripts or set-aside records.
   */
  lightBackend(): Backend {
    const b = this.backend;
    const mine = (key: string): boolean => LIGHT_KEY.test(key);
    const refuse = (): Promise<never> => Promise.reject(new Error('Not a light cache key.'));
    return {
      get: (key) => (mine(key) ? b.get(key) : refuse()),
      put: (key, value) => (mine(key) ? b.put(key, value) : refuse()),
      delete: (key) => (mine(key) ? b.delete(key) : refuse()),
      keys: async () => (await b.keys()).filter(mine),
    };
  }

  loadPreferences(): Promise<Loaded<Preferences>> {
    return this.load(
      PREFERENCES_KEY,
      'preferences',
      PREFERENCES_VERSION,
      PREFERENCES_MIGRATIONS,
      checkPreferences,
      DEFAULT_PREFERENCES,
    );
  }

  savePreferences(p: Preferences): Promise<void> {
    return this.save(PREFERENCES_KEY, PREFERENCES_VERSION, checkPreferences, p);
  }

  /** Console history, oldest first. */
  async loadHistory(): Promise<Loaded<readonly StoredLine[]>> {
    const r = await this.load(
      HISTORY_KEY,
      'history lines',
      HISTORY_VERSION,
      HISTORY_MIGRATIONS,
      checkHistory,
      { lines: [] },
    );
    return { ...r, value: r.value.lines };
  }

  /**
   * Add a line to stored history. What another tab stored since is kept, so neither tab overwrites
   * the other's lines (research section 7). A stored record that fails is set aside first.
   */
  async appendHistory(line: StoredLine, limit: number): Promise<void> {
    const stored = await this.loadHistory();
    await this.saveHistory(mergeStored(stored.value, line, limit));
  }

  saveHistory(lines: readonly StoredLine[]): Promise<void> {
    return this.save(HISTORY_KEY, HISTORY_VERSION, checkHistory, { lines });
  }

  async loadScripts(): Promise<Loaded<readonly StoredScript[]>> {
    const r = await this.load(
      SCRIPTS_KEY,
      'scripts',
      SCRIPTS_VERSION,
      SCRIPTS_MIGRATIONS,
      checkScripts,
      { scripts: [] },
    );
    return { ...r, value: r.value.scripts };
  }

  saveScripts(scripts: readonly StoredScript[]): Promise<void> {
    return this.save(SCRIPTS_KEY, SCRIPTS_VERSION, checkScripts, { scripts });
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
  present: { readonly ceilingArc: number; readonly scripts?: readonly string[] },
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
  if (p?.historyLength !== undefined)
    changes.push(`Console history: keeps ${String(p.historyLength)} lines.`);
  if (p?.historyIgnoreSpace !== undefined)
    changes.push(
      `Console history: lines that start with a space are ${p.historyIgnoreSpace ? 'left out' : 'kept'}.`,
    );
  if (p?.verifyMode === false)
    changes.push('Verify mode: the file turns it off. An import cannot, so it stays on.');
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
  const have = new Set((present.scripts ?? []).map((n) => n.toLowerCase()));
  for (const s of w.scripts ?? [])
    changes.push(
      `Script "${s.name}": ${have.has(s.name.toLowerCase()) ? 'replaces the stored one' : 'added'}. It runs only when you type run.`,
    );
  return {
    ok: true,
    value: {
      workspace: w,
      changes,
      ...(lowerCeiling === undefined ? {} : { lowerCeiling }),
    },
  };
}
