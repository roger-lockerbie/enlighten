/**
 * The ceiling's measure of output (SPEC R6.6, ADR 0004): the arc level's share of full output times
 * the sum of channel fractions. Tc counts as one channel at constant total (the profile's mixing law
 * until measured). Gear with no colour counts as one channel.
 */
import { arcToFraction, fractionToArcFloor } from '../dali/curve.ts';

export interface ColourFacts {
  readonly tc: boolean;
  /** RGBWAF channels (0 to 6). */
  readonly channels: number;
}

/** What the governor assumes when the gear has not said: every channel present. */
export const WORST_FACTS: ColourFacts = { tc: true, channels: 6 };

/** The sum of channel fractions for a colour state. Channels beyond `facts.channels` do not count. */
export function mixSum(facts: ColourFacts, ch: readonly number[]): number {
  let sum = facts.tc ? 1 : 0;
  for (let i = 0; i < facts.channels; i++) sum += Math.min(254, Math.max(0, ch[i] ?? 254)) / 254;
  return facts.tc || facts.channels > 0 ? sum : 1;
}

export function measure(arcFraction: number, facts: ColourFacts, ch: readonly number[]): number {
  return arcFraction * mixSum(facts, ch);
}

/** The highest arc level whose measure stays at or under the ceiling for a given mix sum. */
export function maxArcForMix(ceilingArc: number, sum: number): number {
  const ceiling = arcToFraction(ceilingArc);
  if (sum <= 1) return ceilingArc;
  return Math.min(ceilingArc, fractionToArcFloor(ceiling / sum));
}
