/**
 * What each tape gives out (docs/research/optics.md section 1). Every figure is a placeholder
 * until the tapes are measured, and says where it came from. The UI marks tape data "estimated".
 *
 * The simulator already applies the dimming curve, the colour temperature mixing law and RGBWAF
 * scaling, and reports a drive from 0 to 1 on each output terminal. Flux is taken as linear in that
 * drive, which is what PWM dimming gives.
 */
import type { Terminal } from '../sim/profile.ts';
import { locusXy } from './colour/locus.ts';
import type { Vec3, Xy } from './colour/xyz.ts';
import { xyToXyz } from './colour/xyz.ts';
import { DIFFUSERS } from './diffuser.ts';
import type { DiffuserId, TapeId } from './scene.ts';

export type Standing = 'datasheet' | 'estimated' | 'assumed';

/** The kinds of emitter a tape can carry. */
export type ChannelId = 'R' | 'G' | 'B' | 'WW' | 'CW';

export interface TapeChannel {
  readonly id: ChannelId;
  /** Luminous flux per metre at full drive, in lumens. */
  readonly flux: number;
  readonly fluxBasis: string;
  readonly fluxStanding: Standing;
  readonly xy: Xy;
  readonly colourBasis: string;
  readonly colourStanding: Standing;
  /** Where this emitter sits within one repeat of the tape, in metres. */
  readonly offset: number;
}

export interface TapeProfile {
  readonly id: TapeId;
  readonly name: string;
  /** The distance after which the pattern of emitters repeats, in metres. */
  readonly period: number;
  /** The length of one emitter along the tape, in metres. */
  readonly chip: number;
  readonly layoutBasis: string;
  readonly channels: readonly TapeChannel[];
}

const locusBasis = (k: number): string =>
  `The black-body locus at the stated ${String(k)} K. No tolerance is published`;

export const TAPES: Readonly<Record<TapeId, TapeProfile>> = {
  A: {
    id: 'A',
    name: 'Tape A, tunable white, 120 LEDs a metre',
    // 120 LEDs a metre, warm and cool alternating: each colour repeats every 16.67 mm.
    period: 1 / 60,
    chip: 0.0028,
    layoutBasis:
      'Warm and cool alternating at 8.33 mm (the brief; the sheet\'s diagram is "representative"). Chip length assumed, for a 2835 package',
    channels: [
      {
        id: 'WW',
        flux: 900,
        fluxBasis: "Not on the datasheet. 18 W/m at the COB sibling's 100 lm/W, split evenly",
        fluxStanding: 'estimated',
        xy: locusXy(2700),
        colourBasis: locusBasis(2700),
        colourStanding: 'estimated',
        offset: 0,
      },
      {
        id: 'CW',
        flux: 900,
        fluxBasis: "Not on the datasheet. 18 W/m at the COB sibling's 100 lm/W, split evenly",
        fluxStanding: 'estimated',
        xy: locusXy(6500),
        colourBasis: locusBasis(6500),
        colourStanding: 'estimated',
        offset: 1 / 120,
      },
    ],
  },
  B: {
    id: 'B',
    name: 'Tape B, RGB + CCT, 60 LEDs a metre',
    period: 1 / 60,
    chip: 0.001,
    layoutBasis:
      'Five emitters in each 5050 package at 16.67 mm. Their places within the package are assumed, 1 to 2 mm apart',
    channels: [
      {
        id: 'R',
        flux: 50,
        fluxBasis: 'Datasheet V1.0. Weak against green, and the sheet contradicts itself elsewhere',
        fluxStanding: 'datasheet',
        xy: { x: 0.7, y: 0.3 },
        colourBasis: 'From a typical 620 to 630 nm dominant wavelength. Not from Linear Lux',
        colourStanding: 'estimated',
        offset: -0.0015,
      },
      {
        id: 'G',
        flux: 270,
        fluxBasis: 'Datasheet V1.0',
        fluxStanding: 'datasheet',
        xy: { x: 0.17, y: 0.7 },
        colourBasis: 'From a typical 520 to 530 nm dominant wavelength. Not from Linear Lux',
        colourStanding: 'estimated',
        offset: 0,
      },
      {
        id: 'B',
        flux: 38,
        fluxBasis: 'Datasheet V1.0',
        fluxStanding: 'datasheet',
        xy: { x: 0.13, y: 0.06 },
        colourBasis: 'From a typical 465 to 475 nm dominant wavelength. Not from Linear Lux',
        colourStanding: 'estimated',
        offset: 0.0015,
      },
      {
        id: 'WW',
        flux: 342,
        fluxBasis: 'Datasheet V1.0, at 2900 K',
        fluxStanding: 'datasheet',
        xy: locusXy(2900),
        colourBasis: `${locusBasis(2900)}. The web page says 2400 K`,
        colourStanding: 'estimated',
        offset: -0.001,
      },
      {
        id: 'CW',
        flux: 396,
        fluxBasis: 'Datasheet V1.0, at 6000 K',
        fluxStanding: 'datasheet',
        xy: locusXy(6000),
        colourBasis: locusBasis(6000),
        colourStanding: 'estimated',
        offset: 0.001,
      },
    ],
  },
  COB: {
    id: 'COB',
    name: 'COB tunable white, 608 chips a metre',
    // 608 chips a metre, taken as warm and cool alternating: each repeats every 3.29 mm.
    period: 2 / 608,
    chip: 0.001,
    layoutBasis: '608 chips a metre under one phosphor line. Alternation and chip length assumed',
    channels: [
      {
        id: 'WW',
        flux: 1100,
        fluxBasis: 'The sheet\'s "estimated 2,200 lm/m planning basis", split evenly',
        fluxStanding: 'estimated',
        xy: locusXy(3000),
        colourBasis: locusBasis(3000),
        colourStanding: 'estimated',
        offset: 0,
      },
      {
        id: 'CW',
        flux: 1100,
        fluxBasis: 'The sheet\'s "estimated 2,200 lm/m planning basis", split evenly',
        fluxStanding: 'estimated',
        xy: locusXy(6500),
        colourBasis: locusBasis(6500),
        colourStanding: 'estimated',
        offset: 1 / 608,
      },
    ],
  },
};

/**
 * The tape channel an output terminal feeds. A single white output (W, or a one-channel driver)
 * is taken to feed the warm white. Assumed: the bench has neither.
 */
export function channelFor(label: Terminal): ChannelId | undefined {
  switch (label) {
    case 'R':
    case 'G':
    case 'B':
    case 'WW':
    case 'CW':
      return label;
    case 'W':
    case 'mono':
      return 'WW';
    case 'unused':
      return undefined;
  }
}

/** What a driver is putting on its terminals: the simulator's output. */
export interface Drive {
  readonly terminals: readonly number[];
  readonly labels: readonly Terminal[];
}

/**
 * The drive on each of a tape's channels, 0 to 1, in the tape's channel order. A driver with two
 * terminals for one colour runs them alike, and a tape is wired to one of each, so they are averaged.
 */
export function channelDrives(drive: Drive | undefined, tape: TapeProfile): number[] {
  return tape.channels.map((c) => {
    if (drive === undefined) return 0;
    let sum = 0;
    let count = 0;
    drive.terminals.forEach((v, i) => {
      if (channelFor(drive.labels[i] ?? 'unused') !== c.id) return;
      sum += Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
      count++;
    });
    return count === 0 ? 0 : sum / count;
  });
}

export interface Emitted {
  /** XYZ per metre of tape for each channel, with Y in lumens, after the cover. */
  readonly channels: readonly Vec3[];
  /** Their sum. */
  readonly xyz: Vec3;
}

/** The light leaving one metre of a mount, as XYZ with Y in lumens. */
export function emitted(drive: Drive | undefined, tapeId: TapeId, diffuserId: DiffuserId): Emitted {
  const tape = TAPES[tapeId];
  const through = DIFFUSERS[diffuserId].transmission;
  const drives = channelDrives(drive, tape);
  const channels = tape.channels.map((c, i) => xyToXyz(c.xy, c.flux * (drives[i] ?? 0) * through));
  const xyz = channels.reduce<Vec3>((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
  return { channels, xyz };
}

/** The tape's channels that no terminal of the driver feeds, in the tape's order. */
export function undriven(drive: Drive, tapeId: TapeId): ChannelId[] {
  const fed = new Set(drive.labels.map((l) => channelFor(l)));
  return TAPES[tapeId].channels.map((c) => c.id).filter((id) => !fed.has(id));
}
