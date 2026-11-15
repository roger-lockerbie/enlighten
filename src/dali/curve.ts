/**
 * The standard logarithmic dimming curve (`docs/research/dali.md` section 2).
 * Output % = 10^((level - 1) * 3 / 253 - 1) for levels 1 to 254. Level 0 is off.
 */

/** Output as a fraction of full (0 to 1) for an arc level 0 to 254. */
export function arcToFraction(level: number): number {
  if (level <= 0) return 0;
  const l = Math.min(level, 254);
  return Math.pow(10, ((l - 1) * 3) / 253 - 1) / 100;
}

/** The highest whole arc level whose output does not exceed a fraction of full output. */
export function fractionToArcFloor(fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 254;
  const pct = fraction * 100;
  // A tiny tolerance stops 10^x round-off pushing an exact level down by one.
  const exact = 1 + (253 / 3) * (Math.log10(pct) + 1) + 1e-9;
  return Math.max(0, Math.min(254, Math.floor(exact)));
}

/** Arc level for an output percentage, rounded down (the ceiling's rule, SPEC R6.1). */
export function percentToArcFloor(percent: number): number {
  return fractionToArcFloor(percent / 100);
}

/** The ratio between successive levels, 10^(3/253). */
export const STEP_RATIO = Math.pow(10, 3 / 253);

/** The nearest whole arc level to an output percentage. Any output above zero is at least level 1. */
export function percentToArcNearest(percent: number): number {
  if (!(percent > 0)) return 0;
  if (percent >= 100) return 254;
  const exact = 1 + (253 / 3) * (Math.log10(percent) + 1);
  return Math.max(1, Math.min(254, Math.round(exact)));
}
