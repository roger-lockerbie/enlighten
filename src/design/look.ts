/**
 * Looks and the slot map (SPEC R5.1 to R5.3, ADR 0020). A look is a named level, colour and
 * optional fade, kept in the app. A driver holds 16 scene slots, and the slot map records which look
 * was written to which slot of which driver, and the level that was written.
 *
 * A fade belongs to the driver, not to a scene, so a look's fade is set on the driver just before
 * the recall (`docs/research/dali.md` section 9).
 */
import type { Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { fadeCommands, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import type { Channels, FadeSetting } from '../engine/engine.ts';

export const MAX_LOOKS = 200;
export const SLOTS = 16;
/** Sixteen slots on each of 64 addresses. */
export const MAX_SLOT_ENTRIES = 64 * SLOTS;

export type LookColour =
  | { readonly kind: 'none' }
  /** A colour temperature in mirek. */
  | { readonly kind: 'tc'; readonly mirek: number }
  /** RGBWAF channel levels, 0 to 254, or 255 to leave a channel as it is. */
  | { readonly kind: 'rgbwaf'; readonly channels: Channels };

export interface Look {
  /** Unique in the library, and how the slot map names the look. */
  readonly name: string;
  /** Arc level 0 to 254. 0 is off. */
  readonly arc: number;
  readonly colour: LookColour;
  readonly fade?: FadeSetting;
}

/** One slot of one driver that holds a look, and the level written to it. */
export interface SlotEntry {
  readonly address: number;
  readonly slot: number;
  readonly look: string;
  readonly arc: number;
  /** The colour that was written with it. Absent in a map kept before this was recorded. */
  readonly colour?: LookColour;
}

/** How a driver is driven, as the scan found it (`src/engine/inventory.ts`). */
export type Drive = 'tc' | 'rgbwaf' | 'level';

const NO_CHANGE: Channels = [255, 255, 255, 255, 255, 255];
/** A colour temperature of MASK: activating it changes nothing. */
const TC_MASK = 0xffff;

/** Why a look cannot go to a driver, or undefined when it can. */
export function lookFits(look: Look, drive: Drive): string | undefined {
  if (look.colour.kind === 'none' || look.colour.kind === drive) return undefined;
  return look.colour.kind === 'tc'
    ? 'This look has a colour temperature, and the driver does not take one.'
    : 'This look has RGBWAF channel levels, and the driver does not take them.';
}

/** A temporary colour that changes nothing when it is activated or stored. */
function noChange(address: Address, drive: Drive): Command[] {
  if (drive === 'tc') return tcCommands(address, TC_MASK, false);
  if (drive === 'rgbwaf') return rgbwafCommands(address, NO_CHANGE, false);
  return [];
}

/**
 * Store a look in a slot and read the level back. The colour goes in as the temporary colour, which
 * SET SCENE stores with the level. A look with no colour stores "no change" on colour gear, so
 * nothing left over from before is stored by accident. QUERY SCENE LEVEL is the one frame that
 * expects a reply. After it, in the same transaction, the temporary colour is set to "no change",
 * so no level command from anywhere can come between and bring the stored colour in.
 */
export function storeCommands(address: Address, slot: number, look: Look, drive: Drive): Command[] {
  const colour =
    look.colour.kind === 'tc'
      ? tcCommands(address, look.colour.mirek, false)
      : look.colour.kind === 'rgbwaf'
        ? rgbwafCommands(address, look.colour.channels, false)
        : noChange(address, drive);
  return [
    ...colour,
    { id: 'DTR0', value: look.arc },
    { id: 'SET_SCENE', address, value: slot },
    { id: 'QUERY_SCENE_LEVEL', address, value: slot },
    ...noChange(address, drive),
  ];
}

export function removeCommands(address: Address, slot: number): Command[] {
  return [
    { id: 'REMOVE_FROM_SCENE', address, value: slot },
    { id: 'QUERY_SCENE_LEVEL', address, value: slot },
  ];
}

export function readCommands(address: Address): Command[] {
  return Array.from({ length: SLOTS }, (_, n) => ({
    id: 'QUERY_SCENE_LEVEL' as const,
    address,
    value: n,
  }));
}

/** The fade to set before a recall, as its own transaction, or none. */
export function recallFadeCommands(address: Address, fade: FadeSetting | undefined): Command[] {
  return fade === undefined ? [] : fadeCommands(address, fade);
}

export function recallCommands(address: Address, slot: number): Command[] {
  return [{ id: 'GO_TO_SCENE', address, value: slot }];
}

// -------------------------------------------------------------------------------------------------
// The library

export interface Library {
  readonly looks: readonly Look[];
  readonly slots: readonly SlotEntry[];
}

export type Edit<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Add a look, or put it in place of the one with its name. */
export function putLook(lib: Library, look: Look): Edit<Library> {
  const name = look.name.trim();
  if (name === '') return bad('A look needs a name.');
  const next = { ...look, name };
  const at = lib.looks.findIndex((l) => l.name === name);
  if (at < 0 && lib.looks.length >= MAX_LOOKS)
    return bad(`The library holds at most ${String(MAX_LOOKS)} looks.`);
  const looks = at < 0 ? [...lib.looks, next] : lib.looks.map((l, i) => (i === at ? next : l));
  return { ok: true, value: { looks, slots: lib.slots } };
}

/** Rename a look. The slot map follows. */
export function renameLook(lib: Library, from: string, to: string): Edit<Library> {
  const name = to.trim();
  if (name === '') return bad('A look needs a name.');
  if (name === from) return { ok: true, value: lib };
  if (!lib.looks.some((l) => l.name === from)) return bad('No look has that name.');
  if (lib.looks.some((l) => l.name === name)) return bad('Another look has that name.');
  return {
    ok: true,
    value: {
      looks: lib.looks.map((l) => (l.name === from ? { ...l, name } : l)),
      slots: lib.slots.map((s) => (s.look === from ? { ...s, look: name } : s)),
    },
  };
}

/** Remove a look. Its slots leave the map: the drivers still hold what was written. */
export function removeLook(lib: Library, name: string): Library {
  return {
    looks: lib.looks.filter((l) => l.name !== name),
    slots: lib.slots.filter((s) => s.look !== name),
  };
}

/** Record that a slot now holds a look, in place of whatever the map had there. */
export function setSlot(lib: Library, entry: SlotEntry): Library {
  return {
    looks: lib.looks,
    slots: [...clearSlot(lib, entry.address, entry.slot).slots, entry].sort(
      (a, b) => a.address - b.address || a.slot - b.slot,
    ),
  };
}

export function clearSlot(lib: Library, address: number, slot: number): Library {
  return {
    looks: lib.looks,
    slots: lib.slots.filter((s) => s.address !== address || s.slot !== slot),
  };
}

function sameLookColour(a: LookColour, b: LookColour): boolean {
  if (a.kind === 'tc' && b.kind === 'tc') return a.mirek === b.mirek;
  if (a.kind === 'rgbwaf' && b.kind === 'rgbwaf')
    return a.channels.every((v, i) => v === b.channels[i]);
  return a.kind === 'none' && b.kind === 'none';
}

export type SlotState =
  /** Not read from the driver yet. */
  | 'pending'
  /** The driver holds nothing here and the map has nothing. */
  | 'empty'
  /** The driver holds a level the map does not know. */
  | 'unlisted'
  /** The driver's level is the one written, and the look still has that level. */
  | 'verified'
  /** The driver's level, the level written and the look's level are not all the same. */
  | 'mismatch';

/**
 * A slot's state from the map's entry, the look it names and the level the driver reports
 * (255 is "not in this scene"). Only the level is checked: no route to read a slot's colour back is
 * confirmed (`dali.md` section 9).
 */
export function slotState(
  entry: SlotEntry | undefined,
  look: Look | undefined,
  read: number | undefined,
): SlotState {
  if (read === undefined) return 'pending';
  if (entry === undefined) return read === 255 ? 'empty' : 'unlisted';
  if (read !== entry.arc || look?.arc !== entry.arc) return 'mismatch';
  // The colour cannot be read back, but the app knows what it wrote: a look whose colour has
  // changed since is a known mismatch, not an assumption.
  return entry.colour === undefined || sameLookColour(entry.colour, look.colour)
    ? 'verified'
    : 'mismatch';
}
