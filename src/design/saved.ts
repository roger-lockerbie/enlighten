/**
 * The stored `design` record: the library of looks and the slot map (ADR 0020). Sequences and
 * effects join it as they are built. Loaded only by the pages that use it and by a workspace import
 * or export, so the entry chunk does not carry these checks.
 */
import { object, req, type Result } from '../store/validate.ts';
import type { Look, SlotEntry } from './look.ts';
import { looks, slots } from './schema.ts';

export interface Design {
  readonly looks: readonly Look[];
  readonly slots: readonly SlotEntry[];
}

export const defaultDesign = (): Design => ({ looks: [], slots: [] });

const design = object({ looks: req(looks), slots: req(slots) });

/** Check a stored or imported design. Every slot must name a look the library has. */
export function parseDesign(x: unknown): Result<Design> {
  const r = design(x, '');
  if (!r.ok) return r;
  const names = new Set(r.value.looks.map((l) => l.name));
  const orphan = r.value.slots.find((s) => !names.has(s.look));
  if (orphan !== undefined)
    return {
      ok: false,
      error: `slots: A${String(orphan.address)} slot ${String(orphan.slot)} names a look the library does not have.`,
    };
  return r;
}
