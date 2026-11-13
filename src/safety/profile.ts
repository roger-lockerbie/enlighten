/**
 * The inventory scan (SPEC D1, the parts the governor needs) and the gear safety profile (SPEC S1).
 * Both send ordinary transactions through the scheduler and the governor.
 */
import { broadcast, short, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesForAll, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import type { Governor, Outcome } from './governor.ts';
import type { SendResult, Source, Transaction } from './types.ts';

/** The scheduler's answer to a transaction, as much of it as these runners need. */
export type Submitted =
  | { readonly kind: 'done'; readonly results: readonly SendResult[] }
  | { readonly kind: 'refused' | 'dropped' | 'fault'; readonly reason: string };

export type Submit = (tx: Transaction) => Promise<Submitted>;

function tx(cmds: readonly Command[], source: Source, label: string): Transaction {
  return { frames: framesForAll(cmds), source, label };
}

/** The reply byte to the last frame of a transaction, or undefined for no reply. Throws on refusal or fault. */
async function ask(
  submit: Submit,
  cmds: readonly Command[],
  source: Source,
  label: string,
): Promise<number | undefined> {
  const r = await submit(tx(cmds, source, label));
  if (r.kind !== 'done') throw new ProfileError(`${label}: ${r.reason}`);
  const last = r.results[r.results.length - 1];
  if (last?.kind === 'fault') throw new ProfileError(`${label}: ${last.reason}`);
  return last?.kind === 'reply' ? last.byte : undefined;
}

async function send(
  submit: Submit,
  cmds: readonly Command[],
  source: Source,
  label: string,
): Promise<void> {
  const r = await submit(tx(cmds, source, label));
  if (r.kind !== 'done') throw new ProfileError(`${label}: ${r.reason}`);
}

export class ProfileError extends Error {}

const q = (id: string, a: Address, value?: number): Command =>
  value === undefined ? { id, address: a } : { id, address: a, value };

/** Read what the governor needs about one address. Returns false when nothing answers. */
export async function scanAddress(
  n: number,
  submit: Submit,
  source: Source = 'internal',
): Promise<boolean> {
  const a = short(n);
  const present = await ask(
    submit,
    [q('QUERY_CONTROL_GEAR_PRESENT', a)],
    source,
    `scan A${String(n)}`,
  );
  if (present === undefined) return false;
  let dt = await ask(submit, [q('QUERY_DEVICE_TYPE', a)], source, 'device type');
  const types: number[] = [];
  if (dt === 255) {
    for (let i = 0; i < 8; i++) {
      dt = await ask(submit, [q('QUERY_NEXT_DEVICE_TYPE', a)], source, 'next device type');
      if (dt === undefined || dt === 254) break;
      types.push(dt);
    }
  } else if (dt !== undefined && dt !== 254) types.push(dt);
  const reads = [
    'QUERY_PHYSICAL_MINIMUM',
    'QUERY_MIN_LEVEL',
    'QUERY_MAX_LEVEL',
    'QUERY_FADE_TIME_FADE_RATE',
    'QUERY_GROUPS_0_7',
    'QUERY_GROUPS_8_15',
  ];
  for (const id of reads) await ask(submit, [q(id, a)], source, id);
  if (types.includes(6))
    await ask(submit, [q('DT6_QUERY_DIMMING_CURVE', a)], source, 'dimming curve');
  if (types.includes(8))
    await ask(submit, [q('DT8_QUERY_COLOUR_TYPE_FEATURES', a)], source, 'colour type features');
  return true;
}

/** Scan a set of addresses, then ask whether gear without a short address is present. */
export async function scan(
  governor: Governor,
  submit: Submit,
  addresses: readonly number[] = range64(),
): Promise<number[]> {
  const found: number[] = [];
  for (const n of addresses) if (await scanAddress(n, submit)) found.push(n);
  const unaddressed = await ask(
    submit,
    [q('QUERY_MISSING_SHORT_ADDRESS', broadcast)],
    'internal',
    'unaddressed gear',
  );
  governor.markInventoryFresh(unaddressed !== undefined);
  return found;
}

function range64(): number[] {
  return Array.from({ length: 64 }, (_, i) => i);
}

export interface ProfileResult {
  readonly address: number;
  readonly verified: boolean;
  readonly reason?: string;
  readonly mismatches: readonly {
    readonly what: string;
    readonly expected: number;
    readonly actual: number | undefined;
  }[];
  /** Steps that rest on behaviour not yet confirmed on hardware (SPEC S1.4). */
  readonly unconfirmed: readonly string[];
}

/** Warm colour temperature for the stored power-on colour, in mirek (2700 K). */
export const WARM_MIREK = 370;

/**
 * Write and read back the gear safety profile (SPEC S1.1): MIN LEVEL lowered if it is above the
 * ceiling, MAX LEVEL at the ceiling, POWER ON LEVEL 0 with a warm colour on DT8 gear, and SYSTEM
 * FAILURE LEVEL 255. Verified only when every read-back matches and the curve is standard.
 */
export async function applySafetyProfile(
  n: number,
  governor: Governor,
  submit: Submit,
): Promise<ProfileResult> {
  const a = short(n);
  const src: Source = 'profile';
  const unconfirmed = [
    'POWER ON LEVEL 0 means off (a DALI-2 feature)',
    'The power-on colour is stored with POWER ON LEVEL',
  ];
  const fail = (reason: string): ProfileResult => ({
    address: n,
    verified: false,
    reason,
    mismatches: [],
    unconfirmed,
  });
  try {
    const physMin = await ask(submit, [q('QUERY_PHYSICAL_MINIMUM', a)], src, 'physical minimum');
    const min = await ask(submit, [q('QUERY_MIN_LEVEL', a)], src, 'min level');
    if (physMin === undefined || min === undefined) return fail('The gear did not answer.');
    const info = governor.addressInfo(n);
    const types = info?.deviceTypes ?? [];
    const ceiling = governor.ceilingArc;
    if (ceiling < physMin)
      return fail(
        `The ceiling is below this driver's physical minimum (arc level ${String(physMin)}).`,
      );
    if (min > ceiling)
      await send(
        submit,
        [{ id: 'DTR0', value: physMin }, q('SET_MIN_LEVEL', a)],
        src,
        'lower MIN LEVEL',
      );
    await send(submit, [{ id: 'DTR0', value: ceiling }, q('SET_MAX_LEVEL', a)], src, 'MAX LEVEL');
    const colour = info?.colour;
    if (types.includes(8) && colour !== undefined) {
      if (colour.tc)
        await send(submit, tcCommands(a, WARM_MIREK, false), src, 'warm power-on colour');
      else if (colour.channels > 0) {
        const warm = colour.channels >= 4 ? 3 : 0;
        const mix = [0, 0, 0, 0, 0, 0].map((_, i) => (i === warm ? 254 : 0)) as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        await send(submit, rgbwafCommands(a, mix, false), src, 'warm power-on colour');
      }
    }
    await send(
      submit,
      [{ id: 'DTR0', value: 0 }, q('SET_POWER_ON_LEVEL', a)],
      src,
      'POWER ON LEVEL',
    );
    await send(
      submit,
      [{ id: 'DTR0', value: 255 }, q('SET_SYSTEM_FAILURE_LEVEL', a)],
      src,
      'SYSTEM FAILURE LEVEL',
    );

    const rb = {
      min: await ask(submit, [q('QUERY_MIN_LEVEL', a)], src, 'read back MIN'),
      max: await ask(submit, [q('QUERY_MAX_LEVEL', a)], src, 'read back MAX'),
      powerOn: await ask(submit, [q('QUERY_POWER_ON_LEVEL', a)], src, 'read back POWER ON'),
      systemFailure: await ask(
        submit,
        [q('QUERY_SYSTEM_FAILURE_LEVEL', a)],
        src,
        'read back SYSTEM FAILURE',
      ),
      curve: types.includes(6)
        ? await ask(submit, [q('DT6_QUERY_DIMMING_CURVE', a)], src, 'read back curve')
        : 0,
    };
    const expectedMin = min > ceiling ? physMin : min;
    const mismatches: { what: string; expected: number; actual: number | undefined }[] = [];
    const check = (what: string, expected: number, actual: number | undefined) => {
      if (actual !== expected) mismatches.push({ what, expected, actual });
    };
    check('MAX LEVEL', ceiling, rb.max);
    check('MIN LEVEL', expectedMin, rb.min);
    check('POWER ON LEVEL', 0, rb.powerOn);
    check('SYSTEM FAILURE LEVEL', 255, rb.systemFailure);
    check('dimming curve', 0, rb.curve);
    if (mismatches.length > 0) return { address: n, verified: false, mismatches, unconfirmed };
    const marked = governor.markVerified(n, {
      max: rb.max ?? 255,
      min: rb.min ?? 255,
      powerOn: rb.powerOn ?? 255,
      systemFailure: rb.systemFailure ?? 0,
      linear: rb.curve !== 0,
    });
    if (!marked.ok)
      return { address: n, verified: false, reason: marked.reason, mismatches, unconfirmed };
    return { address: n, verified: true, mismatches, unconfirmed };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/**
 * RESET under the unlock (SPEC section 5): send it, wait 300 ms, send OFF, then re-apply the safety
 * profile and read it back. The caller warns first that the tape will go to full output.
 */
export async function resetAndRestore(
  n: number,
  governor: Governor,
  submit: Submit,
  wait: (ms: number) => Promise<void>,
  source: Source,
): Promise<Outcome & { profile?: ProfileResult }> {
  const a = short(n);
  const r = await submit(tx([q('RESET', a)], source, 'RESET'));
  if (r.kind !== 'done') return { ok: false, reason: r.reason };
  await wait(350);
  const off = await submit(tx([q('OFF', a)], source, 'OFF after RESET'));
  if (off.kind !== 'done') return { ok: false, reason: `OFF after RESET: ${off.reason}` };
  await scanAddress(n, submit);
  const profile = await applySafetyProfile(n, governor, submit);
  return profile.verified
    ? { ok: true, profile }
    : { ok: false, reason: profile.reason ?? 'The safety profile did not verify.', profile };
}
