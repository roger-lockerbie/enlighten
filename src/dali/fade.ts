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

/** One fade time a driver can hold, and the value that selects it. */
export interface FadeOption {
  /** For a standard fade, the fade time 1 to 15. For an extended fade, the stored byte. */
  readonly value: number;
  readonly ms: number;
  /** Extended only: the step from the value before is larger than the steps before it. */
  readonly gapBefore?: boolean;
}

/** The 15 standard fade times (`docs/research/dali.md` section 7). */
export function standardFades(): readonly FadeOption[] {
  return Array.from({ length: 15 }, (_, i) => ({ value: i + 1, ms: fadeTimeMs(i + 1) }));
}

/**
 * Every extended fade time, shortest first. Where two bytes give the same time, the one with the
 * smaller multiplier is listed. `gapBefore` marks where the step grows: past 1.6 s the next is 2 s,
 * past 16 s it is 20 s, and past 160 s it is 3 minutes.
 */
export function extendedFades(): readonly FadeOption[] {
  const byMs = new Map<number, number>();
  for (let byte = 0x10; byte <= 0x4f; byte++) {
    const ms = extendedFadeMs(byte);
    if (!byMs.has(ms)) byMs.set(ms, byte);
  }
  const sorted = [...byMs.entries()].sort((a, b) => a[0] - b[0]);
  const unit = (byte: number) => EXTENDED_MULTIPLIER_MS[(byte >> 4) & 0x07] ?? 0;
  return sorted.map(([ms, value], i) => {
    const prev = sorted[i - 1];
    const gapBefore =
      prev !== undefined && unit(prev[1]) !== unit(value) && ms - prev[0] > unit(prev[1]);
    return gapBefore ? { value, ms, gapBefore } : { value, ms };
  });
}

/** Which fade a DAPC uses, and why, by the order in `docs/research/dali.md` section 7. */
export interface FadeInUse {
  readonly kind: 'standard' | 'fast' | 'extended' | 'none';
  readonly ms: number;
  readonly why: string;
}

/**
 * The fade a level command uses: the fade time if it is set, else the DT6 fast fade time if it is
 * set, else the extended fade time (which may be none). `fast27Ms` is what a fast fade count of 27
 * means for this driver, which the standard leaves to the gear.
 */
export function fadeInUse(
  fadeTime: number,
  extended: number,
  fastFade = 0,
  fast27Ms = fastFadeMs(27),
): FadeInUse {
  if (fadeTime > 0)
    return {
      kind: 'standard',
      ms: fadeTimeMs(fadeTime),
      why: `The driver uses its standard fade time ${String(fadeTime)}. Extended fade is not used while it is set.`,
    };
  if (fastFade > 0)
    return {
      kind: 'fast',
      ms: fastFade >= 27 ? fast27Ms : fastFadeMs(fastFade),
      why: 'The fade time is 0 and a fast fade time is set, so the driver uses the fast fade.',
    };
  const ms = extendedFadeMs(extended);
  return ms > 0
    ? {
        kind: 'extended',
        ms,
        why: 'The fade time is 0, so the driver uses its extended fade time.',
      }
    : {
        kind: 'none',
        ms: 0,
        why: 'The fade time and the extended fade time are both 0, so changes are instant.',
      };
}
