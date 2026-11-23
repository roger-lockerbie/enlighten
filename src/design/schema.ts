/**
 * The checks on everything this stage stores or takes from outside: looks, the slot map, and what
 * the page sends the worker (SPEC section 8, ADR 0020). Built from the store's validator, so unknown
 * keys are refused and every value is copied fresh.
 */
import type { Address } from '../dali/address.ts';
import type { Channels, FadeSetting, RunDef } from '../engine/engine.ts';
import {
  arrayOf,
  bool,
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
import { MAX_SEQUENCES, MAX_STEP_MS, MAX_STEPS, type Sequence, type Step } from './sequence.ts';
import { EFFECT_IDS, MAX_EFFECTS, MAX_TARGETS, paramsProblem, type EffectDef } from './effects.ts';

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
  colour: opt(colour),
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

const step: Schema<Step> = object({
  target: req(target),
  arc: req(int(0, 254)),
  colour: req(colour),
  durationMs: req(int(0, MAX_STEP_MS)),
  together: opt(bool),
});

export const sequence: Schema<Sequence> = object({
  name: req(name),
  steps: req(arrayOf(step, MAX_STEPS)),
});

export const sequences = uniqueBy(arrayOf(sequence, MAX_SEQUENCES), (q) => q.name, 'the sequence');

const effectShape = object({
  name: req(name),
  type: req(oneOf(...EFFECT_IDS)),
  params: req(
    custom((x): Record<string, number> | string => {
      if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'settings as an object.';
      const out: Record<string, number> = {};
      const entries = Object.entries(x as Record<string, unknown>);
      if (entries.length > 16) return 'at most 16 settings.';
      for (const [k, v] of entries) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 40)
          return 'settings with plain names.';
        if (typeof v !== 'number' || !Number.isFinite(v)) return 'settings that are numbers.';
        out[k] = v;
      }
      return out;
    }),
  ),
  targets: req(uniqueBy(arrayOf(int(0, 63), MAX_TARGETS), (n) => n, 'the address')),
});

/** A saved effect. Its settings are checked against the ranges of the effect it names. */
export const effect: Schema<EffectDef> = (x, path) => {
  const r = effectShape(x, path);
  if (!r.ok) return r;
  const wrong = paramsProblem(r.value.type, r.value.params);
  return wrong === undefined ? r : { ok: false, error: `${path}: ${wrong}` };
};

export const effects = uniqueBy(arrayOf(effect, MAX_EFFECTS), (e) => e.name, 'the effect');

const runSequence = object({ kind: req(oneOf('sequence')), sequence: req(sequence) });
const runEffect = object({ kind: req(oneOf('effect')), effect: req(effect) });

/** Something to plan and run: a sequence or an effect. */
export const runDef: Schema<RunDef> = (x, path) =>
  typeof x === 'object' && x !== null && (x as { kind?: unknown }).kind === 'effect'
    ? runEffect(x, path)
    : runSequence(x, path);

export function parseRunDef(x: unknown): Result<RunDef> {
  return runDef(x, 'run');
}

export function parseLook(x: unknown): Result<Look> {
  return look(x, 'look');
}

export function parseTarget(x: unknown): Result<Address> {
  return target(x, 'target');
}

export function parseFade(x: unknown): Result<FadeSetting> {
  return fade(x, 'fade');
}
