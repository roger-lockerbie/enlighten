/**
 * Built-in sequences (SPEC R5.5). The spec names one: off to 20% at 2700 K over 25 minutes. The
 * others are additions of Stage 9 (ADR 0020), with values from `docs/research/effects.md`.
 *
 * Each is built for the drivers there are: a colour temperature for gear that takes one, the warm
 * white channel for RGBWAF gear, and the level alone for the rest.
 */
import { short } from '../dali/address.ts';
import { percentToArcNearest } from '../dali/curve.ts';
import type { Drive, LookColour } from './look.ts';
import type { Sequence, Step } from './sequence.ts';

const MIN = 60_000;
/** 2700 K and 4000 K. */
const WARM_MIREK = 370;
const NEUTRAL_MIREK = 250;

/**
 * Warm white for a driver. On RGBWAF gear this is the W channel alone, which is the warm white on a
 * DA5-L in C5 as the simulator's profile has it (`c5Whites`, a hardware-day setting).
 */
function warm(drive: Drive): LookColour {
  if (drive === 'tc') return { kind: 'tc', mirek: WARM_MIREK };
  if (drive === 'rgbwaf') return { kind: 'rgbwaf', channels: [0, 0, 0, 254, 0, 255] };
  return { kind: 'none' };
}

/** About 4000 K. On RGBWAF gear a placeholder mix of the two whites, not a measured one. */
function neutral(drive: Drive): LookColour {
  if (drive === 'tc') return { kind: 'tc', mirek: NEUTRAL_MIREK };
  if (drive === 'rgbwaf') return { kind: 'rgbwaf', channels: [0, 0, 0, 150, 104, 255] };
  return { kind: 'none' };
}

export interface PresetDriver {
  readonly address: number;
  readonly drive: Drive;
}

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly about: string;
  /** Named in the spec, or added in Stage 9. */
  readonly fromSpec: boolean;
  build(drivers: readonly PresetDriver[]): Sequence;
}

/** One step for every driver, all starting together. */
function each(
  drivers: readonly PresetDriver[],
  make: (d: PresetDriver) => Omit<Step, 'target' | 'together'>,
  first: boolean,
): Step[] {
  return drivers.map((d, i) => ({
    target: short(d.address),
    ...make(d),
    ...(i === 0 && first ? {} : i === 0 ? {} : { together: true }),
  }));
}

const arcAt = (percent: number) => percentToArcNearest(percent);

export const PRESETS: readonly Preset[] = [
  {
    id: 'night',
    name: 'Night fade-in',
    about: 'From off to 20% at 2700 K over 25 minutes.',
    fromSpec: true,
    build: (drivers) => ({
      name: 'Night fade-in',
      steps: [
        // The colour goes in while the light is off, so the fade starts warm.
        ...each(drivers, (d) => ({ arc: 0, colour: warm(d.drive), durationMs: 0 }), true),
        ...each(
          drivers,
          (d) => ({ arc: arcAt(20), colour: warm(d.drive), durationMs: 25 * MIN }),
          false,
        ),
      ],
    }),
  },
  {
    id: 'wind-down',
    name: 'Wind down',
    about: 'From where the light is to 10% at 2700 K over 10 minutes.',
    fromSpec: false,
    build: (drivers) => ({
      name: 'Wind down',
      steps: each(
        drivers,
        (d) => ({ arc: arcAt(10), colour: warm(d.drive), durationMs: 10 * MIN }),
        true,
      ),
    }),
  },
  {
    id: 'night-light',
    name: 'Night light',
    about: 'From where the light is to 1% at 2700 K over 1 minute.',
    fromSpec: false,
    build: (drivers) => ({
      name: 'Night light',
      steps: each(
        drivers,
        (d) => ({ arc: arcAt(1), colour: warm(d.drive), durationMs: MIN }),
        true,
      ),
    }),
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    about: 'From off at 2700 K to 30% at about 4000 K over 30 minutes.',
    fromSpec: false,
    build: (drivers) => ({
      name: 'Sunrise',
      steps: [
        ...each(drivers, (d) => ({ arc: 0, colour: warm(d.drive), durationMs: 0 }), true),
        ...each(
          drivers,
          (d) => ({ arc: arcAt(30), colour: neutral(d.drive), durationMs: 30 * MIN }),
          false,
        ),
      ],
    }),
  },
];
