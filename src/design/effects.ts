/**
 * The built-in effects (SPEC R4.1, ADR 0020), with the parameters of `docs/research/effects.md`
 * section 3. Each is a pure function from its parameters and the drivers it is aimed at to timed
 * steps, which the planner turns into rows. A repeating effect comes back to where it started, so
 * its plan can start again each period.
 *
 * The ranges are the research's starting points, to be tuned by eye on the bench. Nothing here is
 * measured. The rate guard judges every plan, in the check and again when it runs.
 */
import { percentToArcNearest } from '../dali/curve.ts';
import { kelvinToMirek } from '../dali/sequences.ts';
import type { Channels } from '../engine/engine.ts';
import type { Edit, LookColour } from './look.ts';
import { planTimed, type Driver, type Plan, type TimedStep } from './plan.ts';

export const EFFECT_IDS = [
  'breathe',
  'swell',
  'tc-drift',
  'hue-drift',
  'warm-shift',
  'accent-tint',
  'two-tone',
  'notification',
  'presence',
  'sunrise',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export const MAX_EFFECTS = 100;
/** An effect is aimed at up to this many drivers. */
export const MAX_TARGETS = 16;

export interface Param {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

/** A saved effect: which one, its parameter values, and the addresses it is aimed at, in order. */
export interface EffectDef {
  readonly name: string;
  readonly type: EffectId;
  readonly params: Readonly<Record<string, number>>;
  readonly targets: readonly number[];
}

export interface EffectSpec {
  readonly id: EffectId;
  readonly name: string;
  readonly about: string;
  /** Runs until stopped, or once. */
  readonly repeating: boolean;
  readonly params: readonly Param[];
}

const p = (
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  def: number,
): Param => ({ key, label, unit, min, max, step, default: def });

const depth = p('depth', 'Depth', 'levels', 4, 12, 1, 8);
const period = p('period', 'Period', 's', 8, 16, 1, 12);
const interval = p('interval', 'Time between steps', 's', 20, 60, 1, 40);

export const EFFECTS: readonly EffectSpec[] = [
  {
    id: 'breathe',
    name: 'Breathe',
    about: 'The level rises and falls slowly around where it is.',
    repeating: true,
    params: [depth, period],
  },
  {
    id: 'swell',
    name: 'Swell and settle',
    about: 'A brief rise, then an ease back.',
    repeating: false,
    params: [
      p('overshoot', 'Overshoot', 'levels', 5, 10, 1, 7),
      p('rise', 'Rise', 's', 0.7, 2, 0.1, 1),
      p('settle', 'Settle', 's', 2, 4, 0.1, 3),
    ],
  },
  {
    id: 'tc-drift',
    name: 'Colour temperature drift',
    about: 'A slow wander between warmer and cooler, for drivers that take a colour temperature.',
    repeating: true,
    params: [p('step', 'Step', 'mirek', 10, 30, 1, 20), interval],
  },
  {
    id: 'hue-drift',
    name: 'Hue drift',
    about: 'A slow wander in tint, kept pale, for RGBWAF drivers.',
    repeating: true,
    params: [p('amount', 'Amount', 'channel levels', 5, 40, 1, 20), interval],
  },
  {
    id: 'warm-shift',
    name: 'Warm shift',
    about: 'Dims to a level and warms as it goes, as a filament lamp does.',
    repeating: false,
    params: [
      p('level', 'Level to dim to', '%', 0.5, 30, 0.5, 5),
      p('time', 'Time', 's', 2, 60, 1, 8),
      p('warmest', 'Warmest', 'K', 1800, 3000, 50, 2700),
      p('curve', 'Curve (0 linear, 1 filament)', '', 0, 1, 1, 1),
    ],
  },
  {
    id: 'accent-tint',
    name: 'Accent tint',
    about: 'White with a small colour offset, for RGBWAF drivers.',
    repeating: false,
    params: [
      p('strength', 'Strength', 'steps', 3, 7, 1, 5),
      p('hue', 'Hue', 'degrees', 0, 359, 1, 200),
      p('time', 'Time', 's', 0.7, 4, 0.1, 2),
    ],
  },
  {
    id: 'two-tone',
    name: 'Two-tone',
    about: 'Neighbouring drivers breathe in opposite phase, so the room as a whole stays even.',
    repeating: true,
    params: [depth, period],
  },
  {
    id: 'notification',
    name: 'Notification',
    about: 'One or two soft pulses.',
    repeating: false,
    params: [
      p('pulses', 'Pulses', '', 1, 2, 1, 1),
      p('depth', 'Depth', 'levels', 5, 15, 1, 8),
      p('rise', 'Rise', 's', 0.7, 1, 0.1, 0.7),
      p('fall', 'Fall', 's', 1, 3, 0.1, 1.5),
    ],
  },
  {
    id: 'presence',
    name: 'Presence follow',
    about: 'Each driver in turn brightens ahead of someone walking past, then eases back.',
    repeating: false,
    params: [
      p('pace', 'Time from one driver to the next', 's', 1, 5, 0.1, 2),
      p('boost', 'Boost', 'levels', 5, 40, 1, 20),
      p('rise', 'Rise', 's', 0.7, 1.4, 0.1, 1),
      p('hold', 'Hold', 's', 1, 10, 0.5, 3),
    ],
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    about: 'A long rise from off, from warm to cooler.',
    repeating: false,
    params: [
      p('minutes', 'Length', 'min', 20, 40, 1, 30),
      p('level', 'Level to reach', '%', 5, 39, 1, 30),
      p('kelvin', 'Colour temperature to reach', 'K', 3000, 5000, 100, 4000),
    ],
  },
];

export function effectSpec(id: EffectId): EffectSpec {
  const s = EFFECTS.find((e) => e.id === id);
  if (s === undefined) throw new Error(`no effect ${id}`);
  return s;
}

/** An effect's parameters at their defaults. */
export function defaultParams(id: EffectId): Record<string, number> {
  return Object.fromEntries(effectSpec(id).params.map((x) => [x.key, x.default]));
}

/** Why a set of parameter values is not allowed, or undefined when it is. */
export function paramsProblem(
  id: EffectId,
  values: Readonly<Record<string, number>>,
): string | undefined {
  const spec = effectSpec(id);
  for (const k of Object.keys(values))
    if (!spec.params.some((x) => x.key === k))
      return `${spec.name} has no setting "${k.slice(0, 40)}".`;
  for (const x of spec.params) {
    const v = values[x.key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < x.min || v > x.max)
      return `${x.label} is from ${String(x.min)} to ${String(x.max)}${x.unit === '' ? '' : ` ${x.unit}`}.`;
  }
  return undefined;
}

const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const NONE: LookColour = { kind: 'none' };
const WARM_MIREK = 370;
const COOLEST_MIREK = 154;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Built {
  readonly steps: TimedStep[];
  readonly periodMs?: number;
}

type Build = (
  v: Readonly<Record<string, number>>,
  drivers: readonly Driver[],
  ceiling: number,
) => Edit<Built>;

const get = (v: Readonly<Record<string, number>>, key: string): number => v[key] ?? 0;
const lit = (drivers: readonly Driver[]): string | undefined => {
  const off = drivers.find((d) => d.arc <= 0);
  return off === undefined
    ? undefined
    : `A${String(off.address)} is off. Set a level first: this effect moves around the level the light is at.`;
};
const only = (
  drivers: readonly Driver[],
  drive: Driver['drive'],
  what: string,
): string | undefined => {
  const other = drivers.find((d) => d.drive !== drive);
  return other === undefined ? undefined : `A${String(other.address)} does not take ${what}.`;
};

/** Up by `by` and back, or down and back when there is no room above. */
function wave(d: Driver, by: number, ceiling: number): [number, number] | string {
  if (d.arc + by <= ceiling) return [d.arc + by, d.arc];
  if (d.arc - by >= d.minArc) return [d.arc - by, d.arc];
  return `A${String(d.address)} has no room for a depth of ${String(by)} levels between its minimum and the ceiling.`;
}

const breathe: Build = (v, drivers, ceiling) => {
  const off = lit(drivers);
  if (off !== undefined) return bad(off);
  const half = (get(v, 'period') * 1000) / 2;
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const w = wave(d, get(v, 'depth'), ceiling);
    if (typeof w === 'string') return bad(w);
    steps.push(
      { atMs: 0, address: d.address, arc: w[0], colour: NONE, durationMs: half, step: 0 },
      { atMs: half, address: d.address, arc: w[1], colour: NONE, durationMs: half, step: 1 },
    );
  }
  return { ok: true, value: { steps, periodMs: half * 2 } };
};

const twoTone: Build = (v, drivers, ceiling) => {
  if (drivers.length < 2) return bad('Two-tone needs at least two drivers.');
  const off = lit(drivers);
  if (off !== undefined) return bad(off);
  const half = (get(v, 'period') * 1000) / 2;
  const by = get(v, 'depth');
  const steps: TimedStep[] = [];
  for (const [i, d] of drivers.entries()) {
    // Every other driver goes the other way first.
    const down = i % 2 === 1;
    const first = down ? d.arc - by : d.arc + by;
    if (first > ceiling || first < d.minArc)
      return bad(
        `A${String(d.address)} has no room to go ${down ? 'down' : 'up'} by ${String(by)} levels. Set it a little ${down ? 'higher' : 'lower'} first.`,
      );
    steps.push(
      { atMs: 0, address: d.address, arc: first, colour: NONE, durationMs: half, step: 0 },
      { atMs: half, address: d.address, arc: d.arc, colour: NONE, durationMs: half, step: 1 },
    );
  }
  return { ok: true, value: { steps, periodMs: half * 2 } };
};

const swell: Build = (v, drivers, ceiling) => {
  const off = lit(drivers);
  if (off !== undefined) return bad(off);
  const rise = Math.round(get(v, 'rise') * 1000);
  const settle = Math.round(get(v, 'settle') * 1000);
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const top = d.arc + get(v, 'overshoot');
    if (top > ceiling)
      return bad(
        `A${String(d.address)} is too near the ceiling to rise by ${String(get(v, 'overshoot'))} levels.`,
      );
    steps.push(
      { atMs: 0, address: d.address, arc: top, colour: NONE, durationMs: rise, step: 0 },
      { atMs: rise, address: d.address, arc: d.arc, colour: NONE, durationMs: settle, step: 1 },
    );
  }
  return { ok: true, value: { steps } };
};

const notification: Build = (v, drivers, ceiling) => {
  const off = lit(drivers);
  if (off !== undefined) return bad(off);
  const rise = Math.round(get(v, 'rise') * 1000);
  const fall = Math.round(get(v, 'fall') * 1000);
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const top = d.arc + get(v, 'depth');
    if (top > ceiling)
      return bad(
        `A${String(d.address)} is too near the ceiling to pulse by ${String(get(v, 'depth'))} levels.`,
      );
    for (let k = 0; k < get(v, 'pulses'); k++) {
      const at = k * (rise + fall);
      steps.push(
        { atMs: at, address: d.address, arc: top, colour: NONE, durationMs: rise, step: k * 2 },
        {
          atMs: at + rise,
          address: d.address,
          arc: d.arc,
          colour: NONE,
          durationMs: fall,
          step: k * 2 + 1,
        },
      );
    }
  }
  return { ok: true, value: { steps } };
};

const tcDrift: Build = (v, drivers) => {
  const wrong = only(drivers, 'tc', 'a colour temperature') ?? lit(drivers);
  if (wrong !== undefined) return bad(wrong);
  const t = get(v, 'interval') * 1000;
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const centre = d.colour.kind === 'tc' ? d.colour.mirek : 250;
    const warm = clamp(centre + get(v, 'step'), COOLEST_MIREK, WARM_MIREK);
    const cool = clamp(centre - get(v, 'step'), COOLEST_MIREK, WARM_MIREK);
    // Warmer, back, cooler, back: each a step of the size asked for, with a fade as long as the
    // time between steps.
    [warm, centre, cool, centre].forEach((mirek, k) => {
      steps.push({
        atMs: k * t,
        address: d.address,
        arc: d.arc,
        colour: { kind: 'tc', mirek },
        durationMs: t,
        step: k,
      });
    });
  }
  return { ok: true, value: { steps, periodMs: 4 * t } };
};

/** The first three channels with something added, kept in range. The rest are left alone. */
function tinted(base: Channels, add: readonly [number, number, number]): Channels {
  const ch = (i: 0 | 1 | 2) => clamp(Math.round((base[i] === 255 ? 0 : base[i]) + add[i]), 0, 254);
  return [ch(0), ch(1), ch(2), 255, 255, 255];
}

const baseChannels = (d: Driver): Channels =>
  d.colour.kind === 'rgbwaf' ? d.colour.channels : [0, 0, 0, 255, 255, 255];

const hueDrift: Build = (v, drivers) => {
  const wrong = only(drivers, 'rgbwaf', 'RGBWAF channel levels') ?? lit(drivers);
  if (wrong !== undefined) return bad(wrong);
  const t = get(v, 'interval') * 1000;
  const a = get(v, 'amount');
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const base = baseChannels(d);
    // Towards green, towards blue, towards a pale yellow, and back. Red is never raised alone, so
    // no step is a move to or from saturated red (SPEC S3.5).
    const tints: Channels[] = [
      tinted(base, [0, a, 0]),
      tinted(base, [0, 0, a]),
      tinted(base, [a / 2, a / 2, 0]),
      tinted(base, [0, 0, 0]),
    ];
    tints.forEach((channels, k) => {
      steps.push({
        atMs: k * t,
        address: d.address,
        arc: d.arc,
        colour: { kind: 'rgbwaf', channels },
        durationMs: t,
        step: k,
      });
    });
  }
  return { ok: true, value: { steps, periodMs: 4 * t } };
};

/** How many channel levels one step of colour difference is taken as. A placeholder, not measured. */
export const TINT_LEVELS_PER_STEP = 6;

const accentTint: Build = (v, drivers) => {
  const wrong = only(drivers, 'rgbwaf', 'RGBWAF channel levels') ?? lit(drivers);
  if (wrong !== undefined) return bad(wrong);
  const size = get(v, 'strength') * TINT_LEVELS_PER_STEP;
  const hue = (get(v, 'hue') * Math.PI) / 180;
  // Red, green and blue a third of a turn apart. Only what the hue adds is used.
  const part = (shift: number) => size * Math.max(0, Math.cos(hue - shift));
  const add: [number, number, number] = [part(0), part((2 * Math.PI) / 3), part((4 * Math.PI) / 3)];
  const steps = drivers.map((d): TimedStep => ({
    atMs: 0,
    address: d.address,
    arc: d.arc,
    colour: { kind: 'rgbwaf', channels: tinted(baseChannels(d), add) },
    durationMs: Math.round(get(v, 'time') * 1000),
    step: 0,
  }));
  return { ok: true, value: { steps } };
};

const warmShift: Build = (v, drivers) => {
  const wrong = only(drivers, 'tc', 'a colour temperature') ?? lit(drivers);
  if (wrong !== undefined) return bad(wrong);
  const total = get(v, 'time') * 1000;
  const warmest = kelvinToMirek(get(v, 'warmest'));
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const to = Math.max(d.minArc, percentToArcNearest(get(v, 'level')));
    if (to >= d.arc)
      return bad(
        `A${String(d.address)} is at or below ${String(get(v, 'level'))}% already. Warm shift dims.`,
      );
    const from = d.colour.kind === 'tc' ? d.colour.mirek : 250;
    // A warmer end than where it starts, or it stays where it is.
    const end = Math.max(from, warmest);
    // Linear: the colour follows the level. Filament: little change at first, most near the bottom.
    const parts = get(v, 'curve') >= 1 ? 3 : 1;
    for (let k = 1; k <= parts; k++) {
      const f = k / parts;
      steps.push({
        atMs: ((k - 1) * total) / parts,
        address: d.address,
        arc: Math.round(d.arc + (to - d.arc) * f),
        colour: { kind: 'tc', mirek: Math.round(from + (end - from) * f * f) },
        durationMs: total / parts,
        step: k - 1,
      });
    }
  }
  return { ok: true, value: { steps } };
};

const presence: Build = (v, drivers, ceiling) => {
  const off = lit(drivers);
  if (off !== undefined) return bad(off);
  const pace = Math.round(get(v, 'pace') * 1000);
  const rise = Math.round(get(v, 'rise') * 1000);
  const hold = Math.round(get(v, 'hold') * 1000);
  const steps: TimedStep[] = [];
  for (const [i, d] of drivers.entries()) {
    const top = d.arc + get(v, 'boost');
    if (top > ceiling)
      return bad(
        `A${String(d.address)} is too near the ceiling to brighten by ${String(get(v, 'boost'))} levels.`,
      );
    steps.push(
      { atMs: i * pace, address: d.address, arc: top, colour: NONE, durationMs: rise, step: i * 2 },
      // It eases back over twice the rise, once the walker has passed.
      {
        atMs: i * pace + rise + hold,
        address: d.address,
        arc: d.arc,
        colour: NONE,
        durationMs: rise * 2,
        step: i * 2 + 1,
      },
    );
  }
  return { ok: true, value: { steps } };
};

const sunrise: Build = (v, drivers) => {
  const total = get(v, 'minutes') * 60_000;
  const arc = percentToArcNearest(get(v, 'level'));
  const steps: TimedStep[] = [];
  for (const d of drivers) {
    const start: LookColour =
      d.drive === 'tc'
        ? { kind: 'tc', mirek: WARM_MIREK }
        : d.drive === 'rgbwaf'
          ? { kind: 'rgbwaf', channels: [0, 0, 0, 254, 0, 255] }
          : NONE;
    // On RGBWAF gear the end is a placeholder mix of the two whites, not a measured one.
    const end: LookColour =
      d.drive === 'tc'
        ? { kind: 'tc', mirek: kelvinToMirek(get(v, 'kelvin')) }
        : d.drive === 'rgbwaf'
          ? { kind: 'rgbwaf', channels: [0, 0, 0, 150, 104, 255] }
          : NONE;
    steps.push(
      { atMs: 0, address: d.address, arc: 0, colour: start, durationMs: 0, step: 0 },
      { atMs: 0, address: d.address, arc, colour: end, durationMs: total, step: 1 },
    );
  }
  return { ok: true, value: { steps } };
};

const BUILD: Record<EffectId, Build> = {
  breathe,
  swell,
  'tc-drift': tcDrift,
  'hue-drift': hueDrift,
  'warm-shift': warmShift,
  'accent-tint': accentTint,
  'two-tone': twoTone,
  notification,
  presence,
  sunrise,
};

/**
 * Plan an effect for the drivers there are. Its targets are taken in the order given. A target with
 * no driver is left out, with a note.
 */
export function planEffect(
  def: EffectDef,
  drivers: readonly Driver[],
  ceiling: number,
): Edit<Plan> {
  const wrong = paramsProblem(def.type, def.params);
  if (wrong !== undefined) return bad(wrong);
  if (def.targets.length === 0) return bad('Choose at least one driver.');
  if (def.targets.length > MAX_TARGETS)
    return bad(`An effect is aimed at no more than ${String(MAX_TARGETS)} drivers.`);
  if (new Set(def.targets).size !== def.targets.length) return bad('A driver is listed twice.');
  const notes = new Set<string>();
  const aimed: Driver[] = [];
  for (const n of def.targets) {
    const d = drivers.find((x) => x.address === n);
    if (d === undefined) notes.add(`No driver at A${String(n)}, so it is left out.`);
    else aimed.push(d);
  }
  if (aimed.length === 0) return bad('None of the drivers chosen is there.');
  const built = BUILD[def.type](def.params, aimed, ceiling);
  if (!built.ok) return built;
  const plan = planTimed(built.value.steps, drivers, ceiling, notes);
  if (!plan.ok) return plan;
  return {
    ok: true,
    value:
      built.value.periodMs === undefined
        ? plan.value
        : { ...plan.value, periodMs: built.value.periodMs },
  };
}
