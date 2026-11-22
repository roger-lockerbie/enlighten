/**
 * The drivers' 16 scene slots (SPEC R5.2, R5.3): write a look to a slot and read it back, remove it,
 * read all sixteen, and recall by address, group or broadcast. Each step is an ordinary transaction
 * through the scheduler and the governor.
 */
import { addressText, short, type Address } from '../dali/address.ts';
import {
  readCommands,
  recallCommands,
  recallFadeCommands,
  removeCommands,
  storeCommands,
  type Drive,
  type Look,
} from '../design/look.ts';
import type { Submit } from '../safety/profile.ts';
import type { Source } from '../safety/types.ts';
import { fadeReadBack } from './console.ts';
import type { FadeSetting } from './engine.ts';
import { answers, send, StepError } from './submit.ts';

const where = (address: number, slot: number) => `A${String(address)} slot ${String(slot)}`;

/**
 * Store a look and check the level the driver reads back. Throws a `StepError` when the store is
 * refused or the read-back differs.
 */
export async function writeSlot(
  submit: Submit,
  source: Source,
  address: number,
  slot: number,
  look: Look,
  drive: Drive,
): Promise<void> {
  const a = short(address);
  const label = `store ${where(address, slot)}`;
  // One transaction: the store, the read-back, and the temporary colour left as "no change".
  const back = (await answers(submit, storeCommands(a, slot, look, drive), source, label)).at(-1);
  if (back !== look.arc)
    throw new StepError(
      `${where(address, slot)} reads back ${typeof back === 'number' ? String(back) : 'nothing'}, not ${String(look.arc)}.`,
    );
}

/** Take a driver out of a scene, and check that it reads back as not in it. */
export async function removeSlot(
  submit: Submit,
  source: Source,
  address: number,
  slot: number,
): Promise<void> {
  const label = `remove ${where(address, slot)}`;
  const back = (await answers(submit, removeCommands(short(address), slot), source, label)).at(-1);
  if (back !== 255)
    throw new StepError(`${where(address, slot)} still reads back a level after the remove.`);
}

/** Read a driver's sixteen slots. The governor keeps what it hears. */
export async function readSlots(submit: Submit, source: Source, address: number): Promise<void> {
  await send(submit, readCommands(short(address)), source, `read the slots of A${String(address)}`);
}

/**
 * Recall a slot. A look's own fade is set first, in a transaction of its own, and read back where
 * one address was named: on hardware the guard rests on a fade only as read back (ADR 0019).
 */
export async function recallSlot(
  submit: Submit,
  source: Source,
  target: Address,
  slot: number,
  fade: FadeSetting | undefined,
): Promise<void> {
  const what = `${addressText(target)} scene ${String(slot)}`;
  const set = recallFadeCommands(target, fade);
  if (set.length > 0)
    await send(submit, [...set, ...fadeReadBack(target)], source, `fade for ${what}`);
  await send(submit, recallCommands(target, slot), source, `recall ${what}`);
}
