/**
 * The brightness ceiling (SPEC R6, ADR 0004). A comfort feature: it holds on the ordinary paths.
 */
import { short } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesForAll } from '../dali/sequences.ts';
import type { Governor, Outcome } from './governor.ts';
import { applySafetyProfile, patient, type ProfileResult, type Submit } from './profile.ts';
import type { Source } from './types.ts';

export type CeilingChange = Outcome & { readonly profiles?: readonly ProfileResult[] };

/**
 * Send commands as one transaction. If the governor refuses the whole, send them one at a time, so
 * one address it will not accept does not hold the others back.
 */
async function together(submit: Submit, cmds: readonly Command[], label: string): Promise<void> {
  if (cmds.length === 0) return;
  const r = await submit({ frames: framesForAll(cmds), source: 'profile', label });
  if (r.kind === 'done' || cmds.length === 1) return;
  for (const c of cmds) await submit({ frames: framesForAll([c]), source: 'profile', label });
}

/**
 * Lower the ceiling (SPEC R6.2): the governor uses it for the next transaction at once, MAX LEVEL is
 * rewritten on every known address, any address whose level or fade target is above the new ceiling
 * gets a level command, and the profile is read back to verify each address again. The level
 * commands go first, together, so the light is under the new ceiling before the slower profile work.
 */
export async function lowerCeiling(
  governor: Governor,
  arc: number,
  submit: Submit,
  source: Source,
  now: () => number,
  wait: (ms: number) => Promise<void>,
): Promise<CeilingChange> {
  if (arc > governor.ceilingArc)
    return { ok: false, reason: 'That is not lower than the ceiling.' };
  // The rate guard can hold a pull-down back for a moment. The writes wait for it rather than fail.
  submit = patient(submit, wait, now);
  const set = governor.setCeiling(arc, source);
  if (!set.ok) return set;
  const addresses = governor.knownAddresses();
  // Turn lit gear down first, in one transaction, before any MAX LEVEL write (S4-D6). The rate guard
  // counts a transaction once for the room, so every address lands under the new ceiling together,
  // and the MAX LEVEL writes that follow no longer predict a pull-down of their own.
  const holds: Command[] = [];
  for (const n of addresses) {
    const unit = governor.shadow.byShortAddress(n);
    if (unit === undefined) continue;
    const at = now();
    if (governor.overCeiling(n, at) || unit.gear.finalLevel() > arc || unit.gear.levelAt(at) > arc)
      // Fading to off already: OFF ends the fade now. Otherwise the level it is heading for, at most
      // the ceiling. The governor lowers this DAPC further if the colour mix needs it.
      holds.push(
        unit.gear.finalLevel() < 1
          ? { id: 'OFF', address: short(n) }
          : {
              id: 'DAPC',
              address: short(n),
              value: Math.min(arc, Math.round(unit.gear.finalLevel())),
            },
      );
  }
  await together(submit, holds, 'hold under the new ceiling');
  // A colour mix can keep the light above the ceiling even at the lowest level the driver holds.
  const offs = addresses
    .filter((n) => governor.overCeiling(n, now()))
    .map((n): Command => ({ id: 'OFF', address: short(n) }));
  await together(submit, offs, 'off: the colour mix cannot fit under the new ceiling');
  const profiles: ProfileResult[] = [];
  for (const n of addresses) {
    await submit({
      frames: framesForAll([
        { id: 'DTR0', value: arc },
        { id: 'SET_MAX_LEVEL', address: short(n) },
      ]),
      source: 'profile',
      label: 'lower MAX LEVEL',
    });
    profiles.push(await applySafetyProfile(n, governor, submit));
  }
  return { ok: true, profiles };
}

/**
 * Raise the ceiling (SPEC R6.3): only a person, with a confirmation that names the old and new values.
 * MAX LEVEL is then rewritten through the safety profile.
 */
export async function raiseCeiling(
  governor: Governor,
  arc: number,
  submit: Submit,
  source: Source,
  confirmed: boolean,
): Promise<CeilingChange> {
  if (arc <= governor.ceilingArc)
    return { ok: false, reason: 'That is not higher than the ceiling.' };
  const set = governor.setCeiling(arc, source, confirmed);
  if (!set.ok) return set;
  const profiles: ProfileResult[] = [];
  for (const n of governor.knownAddresses())
    profiles.push(await applySafetyProfile(n, governor, submit));
  return { ok: true, profiles };
}
