/**
 * Fade times and rates (`docs/research/dali.md` section 7). Times are in milliseconds.
 */

/** Fade time n (1 to 15) in ms: 0.5 * sqrt(2^n) s. Zero means no fade. */
export function fadeTimeMs(n: number): number {
  if (n <= 0) return 0;
  return 500 * Math.sqrt(Math.pow(2, Math.min(n, 15)));
}

/** Fade rate n (1 to 15) in steps a second: 506 / sqrt(2^n). Zero is not allowed and reads as 1. */
export function fadeRateStepsPerSecond(n: number): number {
  const r = Math.max(1, Math.min(n, 15));
  return 506 / Math.sqrt(Math.pow(2, r));
}

const EXTENDED_MULTIPLIER_MS = [0, 100, 1000, 10_000, 60_000];

/**
 * The extended fade time in ms for the byte SET EXTENDED FADE TIME stores. Bits 3 to 0 are the base
 * (1 to 16 when one is added) and bits 6 to 4 the multiplier. A byte above 0x4F stores zero.
 */
export function extendedFadeMs(byte: number): number {
  const stored = normaliseExtendedFade(byte);
  const base = (stored & 0x0f) + 1;
  const mult = EXTENDED_MULTIPLIER_MS[(stored >> 4) & 0x07] ?? 0;
  return base * mult;
}

/** What gear stores for SET EXTENDED FADE TIME with a given DTR0. */
export function normaliseExtendedFade(byte: number): number {
  return byte > 0x4f ? 0 : byte;
}

/** DT6 fast fade time: 25 ms a count, up to 27. */
export function fastFadeMs(count: number): number {
  if (count <= 0) return 0;
  return 25 * Math.min(count, 27);
}

/** The duration UP and DOWN run for. */
export const UP_DOWN_MS = 200;
/** ENABLE DAPC SEQUENCE: DAPCs within this time of each other fade over it. */
export const DAPC_SEQUENCE_MS = 200;
