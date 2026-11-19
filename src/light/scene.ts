/**
 * The scene the light engine works on: a straight hallway and up to six mounts (SPEC R10, R11, R14.2).
 * Plain data. Stage 8 edits it, and Stage 7 uses the default. Metres throughout: x runs along the
 * hallway, y is up, z runs across it from the left wall (z = 0) to the right.
 */

export type Side = 'left' | 'right';
/**
 * A lit skirting slot with the tape facing down at the floor, a reveal higher on the wall with the
 * tape facing up or down, or a flush channel facing into the hallway (docs/research/optics.md
 * section 5).
 */
export type MountKind = 'skirting' | 'reveal' | 'channel';
export type Facing = 'up' | 'down';
export type TapeId = 'A' | 'B' | 'COB';
export type DiffuserId = 'none' | 'clear' | 'frosted' | 'opal-market' | 'opal-linear-lux';
export type EndWalls = 'closed' | 'open';

export interface Mount {
  readonly id: string;
  readonly kind: MountKind;
  readonly side: Side;
  /** Skirting: ignored, the slot sits on the floor. Reveal: the bottom of the opening. Channel: its centre. */
  readonly height: number;
  /** Reveals only. A reveal lit both ways is two mounts with the same opening. */
  readonly facing: Facing;
  /** Where the tape starts along the hallway, and how long it is. */
  readonly start: number;
  readonly length: number;
  /** The opening's height and depth into the wall. Unused by a channel. */
  readonly slotHeight: number;
  readonly slotDepth: number;
  /** How far behind the wall plane the tape's centre line sits. Unused by a channel. */
  readonly setback: number;
  /** The width of the emitting surface: the cover, or the bare tape. */
  readonly aperture: number;
  /** Voltage drop: the fraction of output lost by the far end of the tape. 0 is none. */
  readonly gradient: number;
  readonly tape: TapeId;
  readonly diffuser: DiffuserId;
  /** LED to cover, for the dots. */
  readonly depth: number;
  /**
   * The DALI short address whose driver this mount follows (SPEC R14.2). An address with no driver
   * leaves the mount unlit.
   */
  readonly address: number;
}

export interface Scene {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly endWalls: EndWalls;
  readonly reflectance: {
    readonly ceiling: number;
    readonly walls: number;
    readonly floor: number;
  };
  readonly mounts: readonly Mount[];
}

export const MAX_MOUNTS = 6;

/** A default with where it came from, for the mount editor to show (SPEC R11.2). */
export interface Sourced {
  readonly value: number;
  readonly basis: string;
  readonly sourced: boolean;
}

/** Geometry defaults by kind, from docs/research/optics.md section 5. */
export const MOUNT_DEFAULTS: Readonly<
  Record<
    MountKind,
    Readonly<
      Record<'height' | 'slotHeight' | 'slotDepth' | 'setback' | 'aperture' | 'depth', Sourced>
    >
  >
> = {
  skirting: {
    height: { value: 0, basis: 'The slot sits at floor level', sourced: true },
    slotHeight: { value: 0.025, basis: 'Linear Lux 1963, scaled from its drawing', sourced: true },
    slotDepth: { value: 0.019, basis: 'Linear Lux 1963, scaled from its drawing', sourced: true },
    setback: { value: 0.0095, basis: 'The middle of the slot', sourced: false },
    aperture: {
      value: 0.012,
      basis: 'Linear Lux 1963, 14.3 mm channel less its walls',
      sourced: false,
    },
    depth: { value: 0.013, basis: 'Linear Lux 1963, scaled from its drawing', sourced: true },
  },
  reveal: {
    height: { value: 2.4, basis: 'A high reveal, 300 mm below a 2.7 m ceiling', sourced: false },
    slotHeight: {
      value: 0.03,
      basis: 'Sized to hold a 17 by 16 mm profile out of sight',
      sourced: false,
    },
    slotDepth: {
      value: 0.025,
      basis: 'Sized to hold a 17 by 16 mm profile out of sight',
      sourced: false,
    },
    setback: {
      value: 0.015,
      basis: 'Sized to hold a 17 by 16 mm profile out of sight',
      sourced: false,
    },
    aperture: { value: 0.012, basis: 'Linear Lux 1715, 12.3 mm channel', sourced: true },
    depth: {
      value: 0.011,
      basis: 'As the flush channel. No reveal profile is dimensioned',
      sourced: false,
    },
  },
  channel: {
    height: { value: 0.6, basis: 'The brief', sourced: true },
    slotHeight: { value: 0, basis: 'A flush channel has no opening', sourced: true },
    slotDepth: { value: 0, basis: 'A flush channel has no opening', sourced: true },
    setback: { value: 0, basis: 'The cover is flush with the plaster', sourced: true },
    aperture: {
      value: 0.012,
      basis: 'Linear Lux 5410 and 1715, 12 mm lit aperture',
      sourced: true,
    },
    depth: {
      value: 0.011,
      basis: 'Linear Lux 5410 and 1715, LED to cover 10 to 12 mm',
      sourced: true,
    },
  },
};

/** A mount of a kind with its defaults, running the length of the hallway. */
export function mount(
  id: string,
  kind: MountKind,
  side: Side,
  hallLength: number,
  over: Partial<Mount> = {},
): Mount {
  const d = MOUNT_DEFAULTS[kind];
  return {
    id,
    kind,
    side,
    height: d.height.value,
    facing: kind === 'reveal' ? 'up' : 'down',
    start: 0,
    length: hallLength,
    slotHeight: d.slotHeight.value,
    slotDepth: d.slotDepth.value,
    setback: d.setback.value,
    aperture: d.aperture.value,
    gradient: 0,
    tape: 'A',
    diffuser: 'opal-linear-lux',
    depth: d.depth.value,
    address: 0,
    ...over,
  };
}

/**
 * The Stage 7 hallway: 5 by 1.2 by 2.7 m, closed ends, with tape A in a skirting slot on the left
 * and tape B in a flush channel at 600 mm on the right (optics.md sections 4 to 6).
 */
export function defaultScene(): Scene {
  const length = 5;
  return {
    length,
    width: 1.2,
    height: 2.7,
    endWalls: 'closed',
    reflectance: { ceiling: 0.9, walls: 0.8, floor: 0.5 },
    mounts: [
      mount('m1', 'skirting', 'left', length, { tape: 'A', address: 0 }),
      mount('m2', 'channel', 'right', length, { tape: 'B', address: 1 }),
    ],
  };
}

/**
 * The most a scene can hold, for timing (docs/TEST_PLAN.md, Perf-frame and Perf-solve): on each
 * wall a skirting slot, a channel at 600 mm and a high reveal, three on tape A and three on tape B.
 */
export function sixMountScene(): Scene {
  const base = defaultScene();
  const l = base.length;
  return {
    ...base,
    mounts: [
      mount('l1', 'skirting', 'left', l, { tape: 'A', address: 0 }),
      mount('l2', 'channel', 'left', l, { tape: 'B', address: 1 }),
      mount('l3', 'reveal', 'left', l, { tape: 'A', address: 0, facing: 'up' }),
      mount('r1', 'skirting', 'right', l, { tape: 'B', address: 1 }),
      mount('r2', 'channel', 'right', l, { tape: 'A', address: 0 }),
      mount('r3', 'reveal', 'right', l, { tape: 'B', address: 1, facing: 'down' }),
    ],
  };
}

const KINDS: readonly MountKind[] = ['skirting', 'reveal', 'channel'];
const SIDES: readonly Side[] = ['left', 'right'];
const FACINGS: readonly Facing[] = ['up', 'down'];
const TAPES: readonly TapeId[] = ['A', 'B', 'COB'];
const DIFFUSERS: readonly DiffuserId[] = [
  'none',
  'clear',
  'frosted',
  'opal-market',
  'opal-linear-lux',
];

export type SceneResult =
  { readonly ok: true; readonly value: Scene } | { readonly ok: false; readonly error: string };

const fail = (error: string): SceneResult => ({ ok: false, error });

function record(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined;
  return v as Record<string, unknown>;
}

function onlyKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Object.keys(o);
  return names.length === keys.length && keys.every((k) => Object.hasOwn(o, k));
}

/** A number in range. Minus zero comes back as zero, so a scene survives JSON unchanged. */
function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v + 0 : undefined;
}

function oneOf<T extends string>(v: unknown, set: readonly T[]): T | undefined {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : undefined;
}

const MOUNT_KEYS = [
  'id',
  'kind',
  'side',
  'height',
  'facing',
  'start',
  'length',
  'slotHeight',
  'slotDepth',
  'setback',
  'aperture',
  'gradient',
  'tape',
  'diffuser',
  'depth',
  'address',
] as const;

function parseMount(v: unknown, hall: { length: number; height: number }): Mount | string {
  const o = record(v);
  if (o === undefined || !onlyKeys(o, MOUNT_KEYS)) return 'a mount has the wrong keys';
  const id = o['id'];
  const address = o['address'];
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,16}$/.test(id)) return 'a mount has a bad id';
  if (typeof address !== 'number' || !Number.isInteger(address) || address < 0 || address > 63) {
    return 'a mount has a bad address';
  }
  const kind = oneOf(o['kind'], KINDS);
  const side = oneOf(o['side'], SIDES);
  const facing = oneOf(o['facing'], FACINGS);
  const tape = oneOf(o['tape'], TAPES);
  const diffuser = oneOf(o['diffuser'], DIFFUSERS);
  const height = num(o['height'], 0, hall.height);
  const start = num(o['start'], 0, hall.length);
  const length = num(o['length'], 0.05, hall.length);
  const slotHeight = num(o['slotHeight'], 0, 0.2);
  const slotDepth = num(o['slotDepth'], 0, 0.2);
  const setback = num(o['setback'], 0, 0.2);
  const aperture = num(o['aperture'], 0.004, 0.05);
  const gradient = num(o['gradient'], 0, 0.5);
  const depth = num(o['depth'], 0.001, 0.05);
  if (
    kind === undefined ||
    side === undefined ||
    facing === undefined ||
    tape === undefined ||
    diffuser === undefined ||
    height === undefined ||
    start === undefined ||
    length === undefined ||
    slotHeight === undefined ||
    slotDepth === undefined ||
    setback === undefined ||
    aperture === undefined ||
    gradient === undefined ||
    depth === undefined
  ) {
    return `mount ${id} has a value out of range`;
  }
  if (start + length > hall.length + 1e-9) return `mount ${id} runs past the end of the hallway`;
  if (kind === 'channel') {
    if (height - aperture / 2 < 0 || height + aperture / 2 > hall.height) {
      return `mount ${id} does not fit on the wall`;
    }
  } else {
    if (slotHeight < 0.008 || slotDepth < 0.008) return `mount ${id} has an opening too small`;
    if (aperture > slotDepth) return `mount ${id} has a tape wider than its opening is deep`;
    if (setback < aperture / 2 - 1e-9 || setback > slotDepth - aperture / 2 + 1e-9) {
      return `mount ${id} has its tape outside the opening`;
    }
    const bottom = kind === 'skirting' ? 0 : height;
    if (bottom + slotHeight > hall.height) return `mount ${id} does not fit on the wall`;
  }
  return {
    id,
    kind,
    side,
    height: kind === 'skirting' ? 0 : height,
    facing: kind === 'reveal' ? facing : 'down',
    start,
    length,
    slotHeight: kind === 'channel' ? 0 : slotHeight,
    slotDepth: kind === 'channel' ? 0 : slotDepth,
    setback: kind === 'channel' ? 0 : setback,
    aperture,
    gradient,
    tape,
    diffuser,
    depth,
    address,
  };
}

/** Where a mount's opening, or a channel's lit strip, sits on its wall. */
export function span(m: Mount): { y0: number; y1: number; x0: number; x1: number } {
  const x0 = m.start;
  const x1 = m.start + m.length;
  if (m.kind === 'channel')
    return { y0: m.height - m.aperture / 2, y1: m.height + m.aperture / 2, x0, x1 };
  const y0 = m.kind === 'skirting' ? 0 : m.height;
  return { y0, y1: y0 + m.slotHeight, x0, x1 };
}

const samePocket = (a: Mount, b: Mount): boolean =>
  a.kind !== 'channel' &&
  b.kind !== 'channel' &&
  a.side === b.side &&
  a.kind === b.kind &&
  a.height === b.height &&
  a.start === b.start &&
  a.length === b.length &&
  a.slotHeight === b.slotHeight &&
  a.slotDepth === b.slotDepth;

/** True when two mounts share one opening: a reveal lit both up and down. */
export function sharesPocket(a: Mount, b: Mount): boolean {
  return samePocket(a, b);
}

/**
 * Check an untrusted value as a scene. Refuses unknown keys, out-of-range numbers, and mounts that
 * overlap on a wall. The result shares nothing with the input.
 */
export function parseScene(v: unknown): SceneResult {
  const o = record(v);
  if (o === undefined) return fail('The scene is not an object.');
  if (!onlyKeys(o, ['length', 'width', 'height', 'endWalls', 'reflectance', 'mounts'])) {
    return fail('The scene has the wrong keys.');
  }
  const length = num(o['length'], 1, 12);
  const width = num(o['width'], 1, 1.5);
  const height = num(o['height'], 2.4, 3);
  const endWalls = oneOf(o['endWalls'], ['closed', 'open'] as const);
  const r = record(o['reflectance']);
  if (
    length === undefined ||
    width === undefined ||
    height === undefined ||
    endWalls === undefined
  ) {
    return fail('The hallway has a value out of range.');
  }
  if (r === undefined || !onlyKeys(r, ['ceiling', 'walls', 'floor'])) {
    return fail('The reflectances have the wrong keys.');
  }
  const ceiling = num(r['ceiling'], 0, 0.98);
  const walls = num(r['walls'], 0, 0.98);
  const floor = num(r['floor'], 0, 0.98);
  if (ceiling === undefined || walls === undefined || floor === undefined) {
    return fail('A reflectance is outside 0 to 0.98.');
  }
  const list = o['mounts'];
  if (!Array.isArray(list) || list.length > MAX_MOUNTS) {
    return fail(`A scene has at most ${String(MAX_MOUNTS)} mounts.`);
  }
  const mounts: Mount[] = [];
  for (const item of list as unknown[]) {
    const m = parseMount(item, { length, height });
    if (typeof m === 'string') return fail(`The scene is not valid: ${m}.`);
    if (mounts.some((x) => x.id === m.id)) return fail(`Two mounts share the id ${m.id}.`);
    for (const other of mounts) {
      if (other.side !== m.side || samePocket(other, m)) continue;
      const a = span(other);
      const b = span(m);
      const gap = 0.005;
      const apartY = a.y1 + gap <= b.y0 || b.y1 + gap <= a.y0;
      const apartX = a.x1 <= b.x0 || b.x1 <= a.x0;
      if (!apartY && !apartX) return fail(`Mounts ${other.id} and ${m.id} overlap.`);
    }
    if (mounts.some((x) => samePocket(x, m) && x.facing === m.facing)) {
      return fail(`Two tapes in one opening face the same way (${m.id}).`);
    }
    mounts.push(m);
  }
  return {
    ok: true,
    value: { length, width, height, endWalls, reflectance: { ceiling, walls, floor }, mounts },
  };
}

/**
 * The parts of a scene that change the light's paths, as stable text. Tape type, diffuser and address
 * are left out: they change only how much light leaves a mount, which is a weight on its response.
 */
export function geometryText(s: Scene): string {
  const n = (v: number): string => String(Math.round(v * 1e5) / 1e5);
  const head = [
    n(s.length),
    n(s.width),
    n(s.height),
    s.endWalls,
    n(s.reflectance.ceiling),
    n(s.reflectance.walls),
    n(s.reflectance.floor),
  ].join(',');
  const mounts = s.mounts.map((m) =>
    [
      m.kind,
      m.side,
      m.facing,
      n(m.height),
      n(m.start),
      n(m.length),
      n(m.slotHeight),
      n(m.slotDepth),
      n(m.setback),
      n(m.aperture),
      n(m.gradient),
    ].join(','),
  );
  return [head, ...mounts].join(';');
}
