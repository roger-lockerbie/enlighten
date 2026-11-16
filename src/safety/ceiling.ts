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
 * How long one step of lowering the ceiling waits for the rate guard before the next fallback. It is
 * a time, not a count of attempts, because the hold while the simulated bench is rebuilt asks again
 * every quarter second until it ends (DALI re-review S5-D19).
 */
export const PATIENCE_MS = 5000;
/** A limit on attempts as well, in case a refusal keeps asking to be tried again at once. */
export const MAX_TRIES = 40;

/**
 * Send what `build` says, as one transaction, until it is done or needs nothing more. The commands are
 * worked out again before each attempt, so a wait for the rate guard never sends a stale command:
 * gear a person has turned off meanwhile is left alone (security review S5-L4). It gives up when the
 * rate guard's next retry time is more than `PATIENCE_MS` after it started.
 */
export async function sendFresh(
  submit: Submit,
  build: () => Command[],
  label: string,
  now: () => number,
  wait: (ms: number) => Promise<void>,
): Promise<'done' | 'nothing' | 'refused'> {
  const start = now();
  for (let i = 0; i < MAX_TRIES; i++) {
    const cmds = build();
    if (cmds.length === 0) return 'nothing';
    const r = await submit({ frames: framesForAll(cmds), source: 'profile', label });
    if (r.kind === 'done') return 'done';
    if (r.kind !== 'refused' || r.retryAt === undefined) return 'refused';
    if (r.retryAt > start + PATIENCE_MS) return 'refused';
    await wait(Math.max(1, r.retryAt - now()));
  }
  return 'refused';
}

/**
 * Lower the ceiling (SPEC R6.2): the governor uses it for the next transaction at once, MAX LEVEL is
 * rewritten on every known address, any address whose level or fade target is above the new ceiling
 * gets a level command, and the profile is read back to verify each address again.
 *
 * Lit gear goes first, before the slower profile work (S4-D6). For each address above the new
 * ceiling the MAX LEVEL write and the hold go together: gear that pulls its output down to a lower
 * MAX LEVEL lands there at once, and the DAPC holds gear that does not. All addresses are tried as one
 * transaction, which the rate guard counts once for the room. If the governor will not take that,
 * each address is tried alone, and if it will not take the MAX LEVEL write either (on hardware with a
 * colour unknown it counts as two hard steps), the hold goes alone.
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
  const raw = submit;
  // The rate guard can hold a write back for a moment. The writes wait for it rather than fail.
  submit = patient(submit, wait, now);
  const set = governor.setCeiling(arc, source);
  if (!set.ok) return set;
  const addresses = governor.knownAddresses();

  /** The hold for one address now, if it is still above the new ceiling. */
  const hold = (n: number): Command | undefined => {
    const unit = governor.shadow.byShortAddress(n);
    if (unit === undefined) return undefined;
    const at = now();
    const final = unit.gear.finalLevel();
    if (!governor.overCeiling(n, at) && final <= arc && unit.gear.levelAt(at) <= arc)
      return undefined;
    // Fading to off already: OFF ends the fade now. Otherwise the level it is heading for, at most
    // the ceiling. The governor lowers this DAPC further if the colour mix needs it.
    return final < 1
      ? { id: 'OFF', address: short(n) }
      : { id: 'DAPC', address: short(n), value: Math.min(arc, Math.round(final)) };
  };
  const withMax = (n: number): Command[] => {
    const h = hold(n);
    return h === undefined
      ? []
      : [{ id: 'DTR0', value: arc }, { id: 'SET_MAX_LEVEL', address: short(n) }, h];
  };

  const all = await sendFresh(
    raw,
    () => addresses.flatMap(withMax),
    'hold under the new ceiling',
    now,
    wait,
  );
  if (all === 'refused') {
    for (const n of addresses) {
      const one = await sendFresh(raw, () => withMax(n), 'hold under the new ceiling', now, wait);
      if (one === 'refused') {
        const h = (): Command[] => {
          const c = hold(n);
          return c === undefined ? [] : [c];
        };
        await sendFresh(raw, h, 'hold under the new ceiling', now, wait);
      }
    }
  }
  // A colour mix can keep the light above the ceiling even at the lowest level the driver holds, and
  // gear that does not pull down is still above it while its hold fades.
  for (const n of addresses) {
    const off = (): Command[] =>
      governor.overCeiling(n, now()) ? [{ id: 'OFF', address: short(n) }] : [];
    await sendFresh(raw, off, 'off: still above the new ceiling', now, wait);
  }
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
