/**
 * The mount editor's core (SPEC R10.1, R11, R14.2, R15.1): a scene plus the links that keep mounts
 * in step, and the edits a person can make. Every edit is checked with `parseScene`, so a refused
 * edit says why in one line and a set-up is always a valid scene. No DOM.
 *
 * Two kinds of link:
 * - mirror: the same mount on the other wall.
 * - both: a reveal lit both ways, which is two mounts in one opening, one facing up and one down.
 *
 * Linked mounts share everything but their id, their address, and the side or facing the link
 * turns over. An edit to one is made to all the mounts it is linked to.
 */
import type { DiffuserId, Facing, Mount, MountKind, Scene, Side, TapeId } from './scene.ts';
import { MAX_MOUNTS, MOUNT_DEFAULTS, defaultScene, mount, parseScene } from './scene.ts';

export type LinkKind = 'mirror' | 'both';

export interface Link {
  readonly kind: LinkKind;
  readonly a: string;
  readonly b: string;
}

export interface Setup {
  readonly scene: Scene;
  readonly links: readonly Link[];
}

export type Edit =
  { readonly ok: true; readonly setup: Setup } | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): Edit => ({ ok: false, reason });

export function defaultSetup(): Setup {
  return { scene: defaultScene(), links: [] };
}

// Limits the editor shows. They are the scene's own limits (`parseScene`).

export const HALL_LIMITS = {
  length: { min: 1, max: 12 },
  width: { min: 1, max: 1.5 },
  height: { min: 2.4, max: 3 },
} as const;

export const REFLECTANCE_MAX = 0.98;

export type Surface = 'ceiling' | 'walls' | 'floor';

export interface MaterialPreset {
  readonly id: string;
  readonly name: string;
  readonly reflectance: number;
  readonly basis: string;
  readonly sourced: boolean;
}

/** Finishes with a published light reflectance value, less a margin for an applied surface (optics.md section 4). */
export const MATERIALS: Readonly<Record<Surface, readonly MaterialPreset[]>> = {
  ceiling: [
    {
      id: 'vivid-white',
      name: 'Vivid White',
      reflectance: 0.9,
      basis: 'Dulux LRV 94, less a margin for an applied surface',
      sourced: true,
    },
    {
      id: 'natural-white',
      name: 'Natural White',
      reflectance: 0.8,
      basis: 'Dulux LRV 85, less a margin for an applied surface',
      sourced: true,
    },
  ],
  walls: [
    {
      id: 'natural-white',
      name: 'Natural White',
      reflectance: 0.8,
      basis: 'Dulux LRV 85, less a margin for an applied surface',
      sourced: true,
    },
    {
      id: 'lexicon-quarter',
      name: 'Lexicon Quarter',
      reflectance: 0.85,
      basis: 'Dulux LRV 90, less a margin for an applied surface',
      sourced: true,
    },
    {
      id: 'vivid-white',
      name: 'Vivid White',
      reflectance: 0.9,
      basis: 'Dulux LRV 94, less a margin for an applied surface',
      sourced: true,
    },
  ],
  floor: [
    {
      id: 'microcement-light',
      name: 'Light microcement',
      reflectance: 0.5,
      basis: 'A placeholder. No maker publishes a figure for microcement',
      sourced: false,
    },
    {
      id: 'microcement-paler',
      name: 'Paler microcement',
      reflectance: 0.6,
      basis: 'The top of the placeholder range, 0.4 to 0.6',
      sourced: false,
    },
    {
      id: 'microcement-darker',
      name: 'Darker microcement',
      reflectance: 0.4,
      basis: 'The bottom of the placeholder range, 0.4 to 0.6',
      sourced: false,
    },
  ],
};

/** The material preset a reflectance matches, if any. */
export function materialFor(surface: Surface, reflectance: number): MaterialPreset | undefined {
  return MATERIALS[surface].find((m) => Math.abs(m.reflectance - reflectance) < 1e-9);
}

/** The tapes a mount can carry, by density (R15.1). Only researched tapes are offered. */
export const TAPE_CHOICES: readonly { readonly id: TapeId; readonly label: string }[] = [
  { id: 'A', label: 'Tunable white, 120 LEDs/m' },
  { id: 'B', label: 'RGB + CCT, 60 LEDs/m' },
  { id: 'COB', label: 'COB tunable white' },
];

export const KIND_NAMES: Readonly<Record<MountKind, string>> = {
  skirting: 'Skirting slot',
  reveal: 'Shadowline reveal',
  channel: 'Flush channel',
};

// Links

const otherSide = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const otherFacing = (f: Facing): Facing => (f === 'up' ? 'down' : 'up');

interface Member {
  readonly id: string;
  /** Relative to the mount the walk started from. */
  readonly flipSide: boolean;
  readonly flipFacing: boolean;
}

/** Every mount linked to `id`, directly or through others, with how each is turned over. */
export function group(setup: Setup, id: string): Member[] {
  const out: Member[] = [{ id, flipSide: false, flipFacing: false }];
  const seen = new Set([id]);
  // The array iterator reads the length each step, so members pushed here are walked too.
  for (const at of out) {
    for (const l of setup.links) {
      const next = l.a === at.id ? l.b : l.b === at.id ? l.a : undefined;
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      out.push({
        id: next,
        flipSide: at.flipSide !== (l.kind === 'mirror'),
        flipFacing: at.flipFacing !== (l.kind === 'both'),
      });
    }
  }
  return out;
}

/** The mount linked to `id` by a link of this kind. */
export function linked(setup: Setup, id: string, kind: LinkKind): string | undefined {
  for (const l of setup.links) {
    if (l.kind !== kind) continue;
    if (l.a === id) return l.b;
    if (l.b === id) return l.a;
  }
  return undefined;
}

/** The fields linked mounts share. Id, side, facing and address are their own. */
const SHARED = [
  'kind',
  'height',
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
] as const;

type Shared = (typeof SHARED)[number];

/** True when two linked mounts agree as their link says they should. */
export function linkHolds(scene: Scene, l: Link): boolean {
  const a = scene.mounts.find((m) => m.id === l.a);
  const b = scene.mounts.find((m) => m.id === l.b);
  if (a === undefined || b === undefined || a.id === b.id) return false;
  if (!SHARED.every((k) => a[k] === b[k])) return false;
  if (l.kind === 'mirror') return a.side !== b.side && a.facing === b.facing;
  return a.kind === 'reveal' && a.side === b.side && a.facing !== b.facing;
}

function nextId(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `m${String(n)}`;
    if (!taken.has(id)) return id;
  }
}

/** Check a candidate scene and links, and say why it is refused. */
function settle(scene: Scene, links: readonly Link[]): Edit {
  if (scene.mounts.length > MAX_MOUNTS) {
    return refuse(`A hallway holds at most ${String(MAX_MOUNTS)} mounts.`);
  }
  const r = parseScene(scene);
  if (!r.ok) return refuse(reasonFor(r.error));
  const ids = new Set(r.value.mounts.map((m) => m.id));
  const kept = links.filter((l) => ids.has(l.a) && ids.has(l.b));
  return { ok: true, setup: { scene: r.value, links: kept } };
}

/** The scene check's words, put the way the editor says them. */
function reasonFor(error: string): string {
  const overlap = /Mounts (\S+) and (\S+) overlap/.exec(error);
  if (overlap !== null) return 'Two mounts would overlap on one wall.';
  if (error.includes('does not fit on the wall')) return 'The mount would not fit on the wall.';
  if (error.includes('runs past the end'))
    return 'The mount would run past the end of the hallway.';
  if (error.includes('tape wider than its opening')) {
    return 'The tape would be wider than its opening is deep.';
  }
  if (error.includes('tape outside the opening')) return 'The tape would sit outside its opening.';
  if (error.includes('face the same way')) {
    return 'Two mounts would take the same place on one wall.';
  }
  return error.replace(/^The scene is not valid: /, '').replace(/^a /, 'A ');
}

function replaceMounts(setup: Setup, change: (m: Mount) => Mount): Mount[] {
  return setup.scene.mounts.map(change);
}

// The hallway

export interface HallChange {
  readonly length?: number;
  readonly width?: number;
  readonly height?: number;
  readonly endWalls?: Scene['endWalls'];
}

/** Fit a mount to a hallway: shorten it, move it along, or lower it so it stays on the wall. */
function fitMount(m: Mount, hall: { length: number; height: number }): Mount {
  const length = Math.max(0.05, Math.min(m.length, hall.length));
  const start = Math.max(0, Math.min(m.start, hall.length - length));
  let height = m.height;
  if (m.kind === 'channel') {
    height = Math.min(Math.max(height, m.aperture / 2), hall.height - m.aperture / 2);
  } else if (m.kind === 'reveal') {
    height = Math.min(Math.max(height, 0), hall.height - m.slotHeight);
  }
  return { ...m, length, start, height };
}

/**
 * Change the hallway's size or ends. Mounts are fitted to a smaller hallway rather than refused.
 * The change is refused only if a value is out of range, or fitting would make two mounts overlap.
 */
export function setHallway(setup: Setup, change: HallChange): Edit {
  const s = setup.scene;
  const next = { ...s, ...change };
  for (const k of ['length', 'width', 'height'] as const) {
    const v = next[k];
    const lim = HALL_LIMITS[k];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) {
      return refuse(`The hallway's ${k} must be ${String(lim.min)} to ${String(lim.max)} m.`);
    }
  }
  // A mount that ran the full length still does.
  const full = (m: Mount): boolean => m.start === 0 && Math.abs(m.length - s.length) < 1e-9;
  const mounts = s.mounts.map((m) => fitMount(full(m) ? { ...m, length: next.length } : m, next));
  return settle({ ...next, mounts }, setup.links);
}

export function setReflectance(setup: Setup, surface: Surface, value: number): Edit {
  if (!Number.isFinite(value) || value < 0 || value > REFLECTANCE_MAX) {
    return refuse(`A reflectance must be 0 to ${String(REFLECTANCE_MAX)}.`);
  }
  const s = setup.scene;
  return settle({ ...s, reflectance: { ...s.reflectance, [surface]: value } }, setup.links);
}

// Mounts

/** Add a mount of a kind on a wall, with its defaults, running the hallway's length. */
export function addMount(setup: Setup, kind: MountKind, side: Side, address = 0): Edit {
  const s = setup.scene;
  if (s.mounts.length >= MAX_MOUNTS) {
    return refuse(`A hallway holds at most ${String(MAX_MOUNTS)} mounts.`);
  }
  const id = nextId(new Set(s.mounts.map((m) => m.id)));
  const m = fitMount(mount(id, kind, side, s.length, { address }), s);
  return settle({ ...s, mounts: [...s.mounts, m] }, setup.links);
}

/** Remove a mount. A mount it was linked to stays, on its own. */
export function removeMount(setup: Setup, id: string): Edit {
  const s = setup.scene;
  if (!s.mounts.some((m) => m.id === id)) return refuse('There is no such mount.');
  return settle(
    { ...s, mounts: s.mounts.filter((m) => m.id !== id) },
    setup.links.filter((l) => l.a !== id && l.b !== id),
  );
}

export type LengthField =
  'height' | 'start' | 'length' | 'slotHeight' | 'slotDepth' | 'setback' | 'aperture' | 'depth';

/** What the editor calls each length, and the range the scene allows for it, in metres. */
export function mountLimits(
  scene: Scene,
): Readonly<Record<LengthField, { label: string; min: number; max: number }>> {
  return {
    height: { label: 'Height', min: 0, max: scene.height },
    start: { label: 'Start', min: 0, max: scene.length - 0.05 },
    length: { label: 'Length', min: 0.05, max: scene.length },
    slotHeight: { label: 'Opening height', min: 0.008, max: 0.2 },
    slotDepth: { label: 'Opening depth', min: 0.008, max: 0.2 },
    setback: { label: 'Setback', min: 0, max: 0.2 },
    aperture: { label: 'Lit width', min: 0.004, max: 0.05 },
    depth: { label: 'LED to cover', min: 0.001, max: 0.05 },
  };
}

const mm = (v: number): string => String(Math.round(v * 1000));

/** The value types of the fields `setMountField` takes. */
export interface MountFields {
  readonly kind: MountKind;
  readonly side: Side;
  readonly height: number;
  readonly start: number;
  readonly length: number;
  readonly slotHeight: number;
  readonly slotDepth: number;
  readonly setback: number;
  readonly aperture: number;
  readonly gradient: number;
  readonly tape: TapeId;
  readonly diffuser: DiffuserId;
  readonly depth: number;
  readonly address: number;
}

/**
 * Change one field of a mount, and of every mount linked to it. The address is the mount's own.
 * A new kind brings that kind's defaults, and a mount that is no longer a reveal loses the tape
 * that lit it the other way.
 */
export function setMountField<K extends keyof MountFields>(
  setup: Setup,
  id: string,
  field: K,
  value: MountFields[K],
): Edit {
  const s = setup.scene;
  const self = s.mounts.find((m) => m.id === id);
  if (self === undefined) return refuse('There is no such mount.');
  if (typeof value === 'number' && !Number.isFinite(value)) return refuse('That is not a number.');
  const limits = mountLimits(s) as Partial<
    Record<string, { label: string; min: number; max: number }>
  >;
  const lim = limits[field];
  if (lim !== undefined && typeof value === 'number' && (value < lim.min || value > lim.max)) {
    return refuse(`${lim.label} must be ${mm(lim.min)} to ${mm(lim.max)} mm.`);
  }
  if (field === 'gradient' && typeof value === 'number' && (value < 0 || value > 0.5)) {
    return refuse('Voltage drop must be 0 to 50%.');
  }

  if (field === 'address') {
    const address = value as number;
    if (!Number.isInteger(address) || address < 0 || address > 63) {
      return refuse('An address must be a whole number from 0 to 63.');
    }
    return settle(
      { ...s, mounts: replaceMounts(setup, (m) => (m.id === id ? { ...m, address } : m)) },
      setup.links,
    );
  }

  let base = setup;
  if (field === 'kind' && value !== 'reveal') {
    // Only a reveal holds a tape each way. Drop the ones facing away from this mount.
    const gone = new Set(
      group(setup, id)
        .filter((g) => g.flipFacing)
        .map((g) => g.id),
    );
    base = {
      scene: { ...s, mounts: s.mounts.filter((m) => !gone.has(m.id)) },
      links: setup.links.filter((l) => !gone.has(l.a) && !gone.has(l.b)),
    };
  }
  const members = new Map(group(base, id).map((g) => [g.id, g]));

  const change = (m: Mount): Mount => {
    const g = members.get(m.id);
    if (g === undefined) return m;
    if (field === 'side') {
      const side = value as Side;
      return { ...m, side: g.flipSide ? otherSide(side) : side };
    }
    if (field === 'kind') {
      const kind = value as MountKind;
      const d = MOUNT_DEFAULTS[kind];
      return {
        ...m,
        kind,
        height: d.height.value,
        slotHeight: d.slotHeight.value,
        slotDepth: d.slotDepth.value,
        setback: d.setback.value,
        aperture: d.aperture.value,
        depth: d.depth.value,
        // A mount that becomes a reveal faces up, as a new reveal does. Only a reveal had a
        // tape the other way, and those went above, so nothing here is turned over.
        facing: kind === 'reveal' ? (self.kind === 'reveal' ? m.facing : 'up') : 'down',
      };
    }
    return { ...m, [field as Shared]: value };
  };
  const mounts = base.scene.mounts.map(change);
  const fitted =
    field === 'kind' ? mounts.map((m) => (members.has(m.id) ? fitMount(m, s) : m)) : mounts;
  return settle({ ...base.scene, mounts: fitted }, base.links);
}

/**
 * Which way a reveal's tape faces: up, down, or both, which adds a second tape in the same opening.
 * Skirting slots face down and channels face into the hallway, so only a reveal can change.
 */
export function setFacing(setup: Setup, id: string, facing: Facing | 'both'): Edit {
  const s = setup.scene;
  const self = s.mounts.find((m) => m.id === id);
  if (self === undefined) return refuse('There is no such mount.');
  if (self.kind !== 'reveal') return refuse('Only a reveal can face up or down.');
  const partner = linked(setup, id, 'both');

  if (facing === 'both') {
    if (partner !== undefined) return { ok: true, setup };
    // A tape the other way for this mount and for its mirror, if it has one.
    const taken = new Set(s.mounts.map((m) => m.id));
    const twin = linked(setup, id, 'mirror');
    const added: Mount[] = [];
    const links: Link[] = [...setup.links];
    const turn = (m: Mount): string => {
      const nid = nextId(taken);
      taken.add(nid);
      added.push({ ...m, id: nid, facing: otherFacing(m.facing) });
      links.push({ kind: 'both', a: m.id, b: nid });
      return nid;
    };
    const p = turn(self);
    const t = s.mounts.find((m) => m.id === twin);
    if (t !== undefined) links.push({ kind: 'mirror', a: p, b: turn(t) });
    return settle({ ...s, mounts: [...s.mounts, ...added] }, links);
  }

  const members = new Map(group(setup, id).map((g) => [g.id, g]));
  const turned = s.mounts.map((m) => {
    const g = members.get(m.id);
    if (g === undefined) return m;
    return { ...m, facing: g.flipFacing ? otherFacing(facing) : facing };
  });
  if (partner === undefined) return settle({ ...s, mounts: turned }, setup.links);
  // From both ways to one: the tapes now facing the other way go.
  const gone = new Set(
    turned.filter((m) => members.has(m.id) && m.facing !== facing).map((m) => m.id),
  );
  return settle(
    { ...s, mounts: turned.filter((m) => !gone.has(m.id)) },
    setup.links.filter((l) => !gone.has(l.a) && !gone.has(l.b)),
  );
}

/** The facing a mount shows in the editor: a reveal lit both ways says so. */
export function facingOf(setup: Setup, id: string): Facing | 'both' | undefined {
  const m = setup.scene.mounts.find((x) => x.id === id);
  if (m === undefined) return undefined;
  return linked(setup, id, 'both') === undefined ? m.facing : 'both';
}

/**
 * Mirror a mount onto the other wall, or stop. On: a copy of the mount, and of the tape lighting
 * it the other way if there is one, goes on the other wall at the same address. Off: the mounts
 * on the other wall go.
 */
export function mirror(setup: Setup, id: string, on: boolean): Edit {
  const s = setup.scene;
  const self = s.mounts.find((m) => m.id === id);
  if (self === undefined) return refuse('There is no such mount.');
  const members = group(setup, id);
  const mirrored = members.some((g) => g.flipSide);

  if (!on) {
    if (!mirrored) return { ok: true, setup };
    const gone = new Set(members.filter((g) => g.flipSide).map((g) => g.id));
    return settle(
      { ...s, mounts: s.mounts.filter((m) => !gone.has(m.id)) },
      setup.links.filter((l) => !gone.has(l.a) && !gone.has(l.b)),
    );
  }
  if (mirrored) return { ok: true, setup };
  const taken = new Set(s.mounts.map((m) => m.id));
  const copies = new Map<string, string>();
  const added: Mount[] = [];
  const links: Link[] = [...setup.links];
  for (const g of members) {
    const m = s.mounts.find((x) => x.id === g.id);
    if (m === undefined) continue;
    const nid = nextId(taken);
    taken.add(nid);
    copies.set(m.id, nid);
    added.push({ ...m, id: nid, side: otherSide(m.side) });
    links.push({ kind: 'mirror', a: m.id, b: nid });
  }
  // The copies keep the links their originals have with each other.
  for (const l of setup.links) {
    const a = copies.get(l.a);
    const b = copies.get(l.b);
    if (a !== undefined && b !== undefined) links.push({ kind: l.kind, a, b });
  }
  return settle({ ...s, mounts: [...s.mounts, ...added] }, links);
}

/** True when a mount has a copy on the other wall. */
export function isMirrored(setup: Setup, id: string): boolean {
  return group(setup, id).some((g) => g.flipSide);
}

// Presets (R11.4)

export type PresetId = 'skirting' | 'channel' | 'reveal-up' | 'reveal-down' | 'mirrored';

export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  readonly description: string;
  /** The mounts and links for a hallway of this length. */
  readonly build: (scene: Scene) => Setup;
}

const only = (scene: Scene, m: Mount): Setup => ({
  scene: { ...scene, mounts: [m] },
  links: [],
});

export const PRESETS: readonly Preset[] = [
  {
    id: 'skirting',
    name: 'Skirting slot',
    description: 'Tape A in a slot at the foot of the left wall, facing down at the floor.',
    build: (s) => only(s, mount('m1', 'skirting', 'left', s.length, { address: 0 })),
  },
  {
    id: 'channel',
    name: 'Mid-wall channel',
    description: 'Tape A in a flush channel at 600 mm on the left wall, facing into the hallway.',
    build: (s) => only(s, mount('m1', 'channel', 'left', s.length, { address: 0 })),
  },
  {
    id: 'reveal-up',
    name: 'High reveal, up',
    description:
      'Tape A in a reveal 300 mm below the ceiling on the left wall, washing the wall and ceiling above. A lit reveal needs a plaster-in profile, not the 10 mm shadowline bead.',
    build: (s) =>
      only(
        s,
        mount('m1', 'reveal', 'left', s.length, {
          address: 0,
          facing: 'up',
          height: Math.max(0, s.height - 0.3),
        }),
      ),
  },
  {
    id: 'reveal-down',
    name: 'High reveal, down',
    description:
      'Tape A in a reveal 300 mm below the ceiling on the left wall, washing the wall below. A lit reveal needs a plaster-in profile, not the 10 mm shadowline bead.',
    build: (s) =>
      only(
        s,
        mount('m1', 'reveal', 'left', s.length, {
          address: 0,
          facing: 'down',
          height: Math.max(0, s.height - 0.3),
        }),
      ),
  },
  {
    id: 'mirrored',
    name: 'Both sides mirrored',
    description: 'Tape A in a skirting slot on each wall, mirrored, both on address 0.',
    build: (s) => ({
      scene: {
        ...s,
        mounts: [
          mount('m1', 'skirting', 'left', s.length, { address: 0 }),
          mount('m2', 'skirting', 'right', s.length, { address: 0 }),
        ],
      },
      links: [{ kind: 'mirror', a: 'm1', b: 'm2' }],
    }),
  },
];

/** Replace the mounts with a preset's, keeping the hallway. */
export function applyPreset(setup: Setup, id: PresetId): Edit {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined) return refuse('There is no such preset.');
  const built = p.build(setup.scene);
  return settle(built.scene, built.links);
}

/** Where each mount sits in a cross-section of the hallway, for a preset's small drawing. */
export interface SectionMark {
  readonly side: Side;
  readonly kind: MountKind;
  /** Height on the wall, 0 to 1 of the hallway's height. */
  readonly y: number;
  readonly facing: Facing;
}

export function section(scene: Scene): SectionMark[] {
  return scene.mounts.map((m) => ({
    side: m.side,
    kind: m.kind,
    y: m.kind === 'skirting' ? 0 : m.height / scene.height,
    facing: m.facing,
  }));
}

// Checking an untrusted set-up

/** A mount's id, as `parseScene` accepts it. */
const MOUNT_ID = /^[a-z0-9-]{1,16}$/;

export type SetupResult =
  { readonly ok: true; readonly value: Setup } | { readonly ok: false; readonly error: string };

function record(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return undefined;
  return v as Record<string, unknown>;
}

/**
 * Check an untrusted value as a set-up: a valid scene, and links that name its mounts, hold, and
 * leave each mount with at most one link of each kind. The result shares nothing with the input.
 */
export function parseSetup(v: unknown): SetupResult {
  const o = record(v);
  if (o === undefined) return { ok: false, error: 'The set-up is not an object.' };
  const keys = Object.keys(o);
  if (keys.length !== 2 || !Object.hasOwn(o, 'scene') || !Object.hasOwn(o, 'links')) {
    return { ok: false, error: 'The set-up has the wrong keys.' };
  }
  const scene = parseScene(o['scene']);
  if (!scene.ok) return { ok: false, error: scene.error };
  const list = o['links'];
  if (!Array.isArray(list) || list.length > MAX_MOUNTS) {
    return { ok: false, error: 'The set-up has too many links.' };
  }
  const links: Link[] = [];
  const used = new Set<string>();
  for (const item of list as unknown[]) {
    const l = record(item);
    if (l === undefined || Object.keys(l).length !== 3) {
      return { ok: false, error: 'A link has the wrong keys.' };
    }
    const kind = l['kind'];
    const a = l['a'];
    const b = l['b'];
    if ((kind !== 'mirror' && kind !== 'both') || typeof a !== 'string' || typeof b !== 'string') {
      return { ok: false, error: 'A link has the wrong keys.' };
    }
    // Checked before either id is put in a message, so a file cannot write the app's words.
    if (!MOUNT_ID.test(a) || !MOUNT_ID.test(b)) return { ok: false, error: 'A link has a bad id.' };
    const link: Link = { kind, a, b };
    if (!linkHolds(scene.value, link)) {
      return { ok: false, error: `The ${kind} link between ${a} and ${b} does not hold.` };
    }
    for (const id of [a, b]) {
      const key = `${kind}:${id}`;
      if (used.has(key)) return { ok: false, error: `Mount ${id} has two ${kind} links.` };
      used.add(key);
    }
    links.push(link);
  }
  return { ok: true, value: { scene: scene.value, links } };
}
