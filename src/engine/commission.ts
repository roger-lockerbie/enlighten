/**
 * Commissioning (SPEC D3): give each driver without a short address the lowest free one, by the
 * standard's random address search (`docs/research/dali.md` section 13).
 *
 * Every command here needs the `reset` unlock and a person (SPEC section 5), and a command behind an
 * unlock travels on its own (ADR 0011), so each goes out as its own transaction. The caller asks for
 * the confirmation first and runs the scan and the safety profile afterwards.
 */
import type { Command } from '../dali/codec.ts';
import { initialiseData, shortAddressData } from '../dali/sequences.ts';
import type { Submit } from '../safety/profile.ts';
import type { Source } from '../safety/types.ts';
import { answers, send, StepError } from './submit.ts';

/** The highest 24-bit random address. */
const TOP = 0xffffff;

/** Gear needs time after RANDOMISE before it answers COMPARE. */
export const RANDOMISE_SETTLE_MS = 100;

/** How often a shared random address is randomised again before giving up. */
export const MAX_RERANDOMISE = 5;

export interface Assignment {
  readonly random: number;
  readonly address: number;
}

export interface CommissionResult {
  readonly assigned: readonly Assignment[];
  /** Gear found that could not be given an address: no free address, or VERIFY failed. */
  readonly problems: readonly string[];
}

export interface CommissionOptions {
  readonly submit: Submit;
  readonly source: Source;
  /** Short addresses already in use, from the scan. */
  readonly used: ReadonlySet<number>;
  readonly wait: (ms: number) => Promise<void>;
  /** Called between steps: true stops the search. */
  readonly stopped?: () => boolean;
}

export async function commission(o: CommissionOptions): Promise<CommissionResult> {
  const { submit, source } = o;
  const one = (cmd: Command, label: string) => send(submit, [cmd], source, label);
  const yes = async (cmd: Command, label: string): Promise<boolean> => {
    const [r] = await answers(submit, [cmd], source, label);
    // During the search, several gear answering at once is still an answer (a framing error).
    return r !== undefined && r !== 'none';
  };
  const compare = async (search: number): Promise<boolean> => {
    await one({ id: 'SEARCHADDRH', value: (search >> 16) & 0xff }, 'SEARCHADDRH');
    await one({ id: 'SEARCHADDRM', value: (search >> 8) & 0xff }, 'SEARCHADDRM');
    await one({ id: 'SEARCHADDRL', value: search & 0xff }, 'SEARCHADDRL');
    return yes({ id: 'COMPARE' }, 'COMPARE');
  };
  const check = () => {
    if (o.stopped?.() === true) throw new StepError('Commissioning was stopped.');
  };

  const free = Array.from({ length: 64 }, (_, i) => i).filter((n) => !o.used.has(n));
  const assigned: Assignment[] = [];
  const problems: string[] = [];
  /** One answer to a lone query frame. */
  const answer = async (cmd: Command, label: string) =>
    (await answers(submit, [cmd], source, label))[0];
  const randomise = async () => {
    await one({ id: 'RANDOMISE' }, 'RANDOMISE');
    await o.wait(RANDOMISE_SETTLE_MS);
  };
  let rerandomised = 0;
  try {
    // Leave any earlier initialise state first (dali.md section 13, step 2).
    await one({ id: 'TERMINATE' }, 'TERMINATE');
    await one({ id: 'INITIALISE', value: initialiseData('unaddressed') }, 'INITIALISE');
    await randomise();
    for (;;) {
      check();
      if (!(await compare(TOP))) break;
      // The lowest random address that answers: binary search.
      let lo = 0;
      let hi = TOP;
      while (lo < hi) {
        check();
        const mid = Math.floor((lo + hi) / 2);
        if (await compare(mid)) hi = mid;
        else lo = mid + 1;
      }
      // Set the search address to `lo` and ask once more. Two answers at once mean two gear chose
      // the same random address: randomise again (dali.md section 13, step 6).
      await one({ id: 'SEARCHADDRH', value: (lo >> 16) & 0xff }, 'SEARCHADDRH');
      await one({ id: 'SEARCHADDRM', value: (lo >> 8) & 0xff }, 'SEARCHADDRM');
      await one({ id: 'SEARCHADDRL', value: lo & 0xff }, 'SEARCHADDRL');
      const at = await answer({ id: 'COMPARE' }, 'COMPARE');
      if (at === 'collision') {
        if (++rerandomised > MAX_RERANDOMISE) {
          problems.push(
            'Two drivers kept choosing the same random address. Commissioning stopped.',
          );
          break;
        }
        await randomise();
        continue;
      }
      if (at === undefined || at === 'none') {
        problems.push('The driver found by the search stopped answering. Commissioning stopped.');
        break;
      }
      const address = free.shift();
      if (address === undefined) {
        problems.push('There is no free short address left.');
        break;
      }
      await one(
        { id: 'PROGRAM_SHORT_ADDRESS', value: shortAddressData(address) },
        'PROGRAM SHORT ADDRESS',
      );
      const verify = await answer(
        { id: 'VERIFY_SHORT_ADDRESS', value: shortAddressData(address) },
        'VERIFY SHORT ADDRESS',
      );
      if (typeof verify === 'number') {
        assigned.push({ random: lo, address });
      } else {
        problems.push(
          verify === 'collision'
            ? `More than one driver answered at address ${String(address)}.`
            : `The driver at random address ${String(lo)} did not take address ${String(address)}.`,
        );
        if (verify !== 'collision') free.unshift(address);
      }
      // Take it out of the search, whether or not it took the address, so the search ends.
      await one({ id: 'WITHDRAW' }, 'WITHDRAW');
    }
  } finally {
    // Leave the initialise state even when the search failed. A failure here is reported, not hidden.
    try {
      await one({ id: 'TERMINATE' }, 'TERMINATE');
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { assigned, problems };
}
