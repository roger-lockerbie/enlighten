/**
 * The brightness ceiling (SPEC R6, ADR 0004). A comfort feature: it holds on the ordinary paths.
 */
import { short } from '../dali/address.ts';
import { framesForAll } from '../dali/sequences.ts';
import type { Governor, Outcome } from './governor.ts';
import { applySafetyProfile, patient, type ProfileResult, type Submit } from './profile.ts';
import type { Source } from './types.ts';

export type CeilingChange = Outcome & { readonly profiles?: readonly ProfileResult[] };

/**
 * Lower the ceiling (SPEC R6.2): the governor uses it for the next transaction at once, MAX LEVEL is
 * rewritten on every known address, any address whose level or fade target is above the new ceiling
 * gets a level command, and the profile is read back to verify each address again.
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
  const profiles: ProfileResult[] = [];
  for (const n of governor.knownAddresses()) {
    await submit({
      frames: framesForAll([
        { id: 'DTR0', value: arc },
        { id: 'SET_MAX_LEVEL', address: short(n) },
      ]),
      source: 'profile',
      label: 'lower MAX LEVEL',
    });
    const unit = governor.shadow.byShortAddress(n);
    if (unit !== undefined) {
      if (unit.gear.finalLevel() > arc || unit.gear.levelAt(now()) > arc) {
        await submit({
          frames: framesForAll([{ id: 'DAPC', address: short(n), value: arc }]),
          source: 'profile',
          label: 'hold under the new ceiling',
        });
      }
      // A colour mix can keep the light above the ceiling even at the lowest level the driver holds.
      if (governor.overCeiling(n, now())) {
        await submit({
          frames: framesForAll([{ id: 'OFF', address: short(n) }]),
          source: 'profile',
          label: 'off: the colour mix cannot fit under the new ceiling',
        });
      }
    }
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
