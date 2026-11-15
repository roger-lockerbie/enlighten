/**
 * Migrations (ADR 0009, docs/ARCHITECTURE.md section 5): an ordered list of pure functions over plain
 * data, from version n to n + 1. A record newer than the app is refused, and so is one older than the
 * oldest migration knows.
 */
import type { Result } from './validate.ts';

/** From the version before it to its own `to`. */
export interface Migration {
  readonly to: number;
  readonly run: (data: unknown) => unknown;
}

/**
 * Bring data at `version` up to `current`. `migrations` holds one step per version after the first,
 * in order: the step with `to: 2`, then `to: 3`, and so on.
 */
export function migrate(
  data: unknown,
  version: unknown,
  current: number,
  migrations: readonly Migration[],
): Result<unknown> {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return { ok: false, error: 'The version is not a whole number from 1.' };
  if (version > current)
    return {
      ok: false,
      error: `This was saved by a newer version of the app (${String(version)}, this app reads ${String(current)}).`,
    };
  let out = data;
  for (let v = version + 1; v <= current; v++) {
    const step = migrations.find((m) => m.to === v);
    if (step === undefined) return { ok: false, error: `No migration to version ${String(v)}.` };
    try {
      out = step.run(out);
    } catch {
      return { ok: false, error: `The migration to version ${String(v)} failed.` };
    }
  }
  return { ok: true, value: out };
}
