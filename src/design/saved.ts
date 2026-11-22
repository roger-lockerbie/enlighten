/**
 * The stored `design` record: the library of looks, the slot map, the sequences and the saved
 * effects (ADR 0020). Loaded only by the pages that use it and by a workspace import
 * or export, so the entry chunk does not carry these checks.
 */
import { object, req, type Result } from '../store/validate.ts';
import type { Look, SlotEntry } from './look.ts';
import type { EffectDef } from './effects.ts';
import { effects, looks, sequences, slots } from './schema.ts';
import type { Sequence } from './sequence.ts';

export interface Design {
  readonly looks: readonly Look[];
  readonly slots: readonly SlotEntry[];
  readonly sequences: readonly Sequence[];
  readonly effects: readonly EffectDef[];
}

export const defaultDesign = (): Design => ({
  looks: [],
  slots: [],
  sequences: [],
  effects: [],
});

const design = object({
  looks: req(looks),
  slots: req(slots),
  sequences: req(sequences),
  effects: req(effects),
});

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
