/**
 * The stored `design` record: the library of looks, the slot map, the sequences and the saved
 * effects (ADR 0020). Loaded only by the pages that use it and by a workspace import
 * or export, so the entry chunk does not carry these checks.
 */
import { object, opt, req, type Result } from '../store/validate.ts';
import type { Plate } from '../switch/plate.ts';
import { plates } from '../switch/schema.ts';
import type { Look, SlotEntry } from './look.ts';
import type { EffectDef } from './effects.ts';
import { effects, looks, sequences, slots } from './schema.ts';
import type { Sequence } from './sequence.ts';

export interface Design {
  readonly looks: readonly Look[];
  readonly slots: readonly SlotEntry[];
  readonly sequences: readonly Sequence[];
  readonly effects: readonly EffectDef[];
  /** The switch plates and their mappings (SPEC R16). */
  readonly plates: readonly Plate[];
}

export const defaultDesign = (): Design => ({
  looks: [],
  slots: [],
  sequences: [],
  effects: [],
  plates: [],
});

const design = object({
  looks: req(looks),
  slots: req(slots),
  sequences: req(sequences),
  effects: req(effects),
  plates: opt(plates),
});

/** Check a stored or imported design. Every slot must name a look the library has. */
export function parseDesign(x: unknown): Result<Design> {
  const parsed = design(x, '');
  if (!parsed.ok) return parsed;
  // A design stored before Stage 10 has no plates.
  const r: { readonly ok: true; readonly value: Design } = {
    ok: true,
    value: { ...parsed.value, plates: parsed.value.plates ?? [] },
  };
  const names = new Set(r.value.looks.map((l) => l.name));
  const orphan = r.value.slots.find((s) => !names.has(s.look));
  if (orphan !== undefined)
    return {
      ok: false,
      error: `slots: A${String(orphan.address)} slot ${String(orphan.slot)} names a look the library does not have.`,
    };
  return r;
}

/** The design's keys as a workspace file carries them. A part that is empty is left out. */
export type FileDesign = Partial<Record<keyof Design, unknown>>;

export function exportDesign(d: Design): Partial<Design> {
  return {
    ...(d.looks.length === 0 ? {} : { looks: d.looks }),
    ...(d.slots.length === 0 ? {} : { slots: d.slots }),
    ...(d.sequences.length === 0 ? {} : { sequences: d.sequences }),
    ...(d.effects.length === 0 ? {} : { effects: d.effects }),
    ...(d.plates.length === 0 ? {} : { plates: d.plates }),
  };
}

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * What importing a file's design would do (SPEC section 8). Each part the file has takes the place
 * of the stored one. Looks without slots keep the stored slots that still name a look. Nothing is
 * sent to any driver: the slot map only records what was written before.
 */
export function importDesign(
  present: Design,
  file: FileDesign,
): Result<{ readonly design: Design; readonly changes: readonly string[] } | undefined> {
  const has = (k: keyof Design) => file[k] !== undefined;
  if (!has('looks') && !has('slots') && !has('sequences') && !has('effects') && !has('plates'))
    return { ok: true, value: undefined };
  const looksIn = has('looks') ? file.looks : present.looks;
  const names =
    has('looks') && Array.isArray(file.looks)
      ? new Set(
          (file.looks as unknown[]).map((l) =>
            typeof l === 'object' && l !== null ? (l as { name?: unknown }).name : undefined,
          ),
        )
      : undefined;
  const kept = names === undefined ? present.slots : present.slots.filter((s) => names.has(s.look));
  const r = parseDesign({
    looks: looksIn,
    slots: has('slots') ? file.slots : kept,
    sequences: has('sequences') ? file.sequences : present.sequences,
    effects: has('effects') ? file.effects : present.effects,
    plates: has('plates') ? file.plates : present.plates,
  });
  if (!r.ok) return { ok: false, error: `The file's looks, sequences or effects: ${r.error}` };
  const d = r.value;
  const changes: string[] = [];
  if (has('looks'))
    changes.push(
      `Looks: the file's ${count(d.looks.length, 'look takes', 'looks take')} the place of the ${String(present.looks.length)} stored.`,
    );
  if (has('slots'))
    changes.push(
      `Slots: the file's map of ${count(d.slots.length, 'slot', 'slots')} takes the place of the stored one. Nothing is written to any driver.`,
    );
  else if (kept.length !== present.slots.length)
    changes.push(
      `Slots: ${count(present.slots.length - kept.length, 'entry names', 'entries name')} a look the file does not have, and will be dropped from the map.`,
    );
  if (has('sequences'))
    changes.push(
      `Sequences: the file's ${count(d.sequences.length, 'sequence takes', 'sequences take')} the place of the ${String(present.sequences.length)} stored. None runs until you run it.`,
    );
  if (has('effects'))
    changes.push(
      `Effects: the file's ${count(d.effects.length, 'effect takes', 'effects take')} the place of the ${String(present.effects.length)} stored. None runs until you run it.`,
    );
  if (has('plates'))
    changes.push(
      `Switches: the file's ${count(d.plates.length, 'plate takes', 'plates take')} the place of the ${String(present.plates.length)} stored. A plate sends nothing until you press it.`,
    );
  return { ok: true, value: { design: d, changes } };
}
