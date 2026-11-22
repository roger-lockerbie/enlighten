/**
 * The checks on everything this stage stores or takes from outside: looks, the slot map, and what
 * the page sends the worker (SPEC section 8, ADR 0020). Built from the store's validator, so unknown
 * keys are refused and every value is copied fresh.
 */
import type { Address } from '../dali/address.ts';
import type { Channels, FadeSetting } from '../engine/engine.ts';
import {
  arrayOf,
  custom,
  int,
  object,
  oneOf,
  opt,
  req,
  textWith,
  uniqueBy,
  type Result,
  type Schema,
} from '../store/validate.ts';
import {
  MAX_LOOKS,
  MAX_SLOT_ENTRIES,
  SLOTS,
  type Look,
  type LookColour,
  type SlotEntry,
} from './look.ts';

/** Names are at most 60 characters (SPEC section 8). */
export const MAX_NAME = 60;

export const name: Schema<string> = textWith((x) =>
  x.trim() === '' || x.length > MAX_NAME || x !== x.trim()
    ? `a name of 1 to ${String(MAX_NAME)} characters, with no space at either end.`
    : undefined,
);

const fadeStandard = object({ kind: req(oneOf('standard')), value: req(int(0, 15)) });
const fadeExtended = object({ kind: req(oneOf('extended')), value: req(int(0, 0x4f)) });

export const fade: Schema<FadeSetting> = (x, path) => {
  const r = fadeStandard(x, path);
  return r.ok ? r : fadeExtended(x, path);
};

const channels: Schema<Channels> = (x, path) => {
  const r = arrayOf(int(0, 255), 6)(x, path);
  if (!r.ok) return r;
  if (r.value.length !== 6) return { ok: false, error: `${path}: six channel levels.` };
  return { ok: true, value: r.value as unknown as Channels };
};

const colourNone = object({ kind: req(oneOf('none')) });
const colourTc = object({ kind: req(oneOf('tc')), mirek: req(int(1, 0xfffe)) });
const colourRgbwaf = object({ kind: req(oneOf('rgbwaf')), channels: req(channels) });

export const colour: Schema<LookColour> = (x, path) => {
  const kind = typeof x === 'object' && x !== null ? (x as { kind?: unknown }).kind : undefined;
  if (kind === 'tc') return colourTc(x, path);
  if (kind === 'rgbwaf') return colourRgbwaf(x, path);
  return colourNone(x, path);
};

export const look: Schema<Look> = object({
  name: req(name),
  arc: req(int(0, 254)),
  colour: req(colour),
  fade: opt(fade),
});

const slotEntry: Schema<SlotEntry> = object({
  address: req(int(0, 63)),
  slot: req(int(0, SLOTS - 1)),
  look: req(name),
  arc: req(int(0, 254)),
});

export const looks = uniqueBy(arrayOf(look, MAX_LOOKS), (l) => l.name, 'the look');
export const slots = uniqueBy(
  arrayOf(slotEntry, MAX_SLOT_ENTRIES),
  (s) => `A${String(s.address)} slot ${String(s.slot)}`,
  'the slot',
);

/** A short address, a group, or every driver. */
export const target: Schema<Address> = custom((x) => {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'a target.';
  const o = x as Record<string, unknown>;
  const n = o['n'];
  const whole = (max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
  if (o['kind'] === 'broadcast' && Object.keys(o).length === 1) return { kind: 'broadcast' };
  if (Object.keys(o).length !== 2) return 'a target.';
  if (o['kind'] === 'short' && whole(63)) return { kind: 'short', n: n as number };
  if (o['kind'] === 'group' && whole(15)) return { kind: 'group', n: n as number };
  return 'a target.';
});

export function parseLook(x: unknown): Result<Look> {
  return look(x, 'look');
}

export function parseTarget(x: unknown): Result<Address> {
  return target(x, 'target');
}

export function parseFade(x: unknown): Result<FadeSetting> {
  return fade(x, 'fade');
}
