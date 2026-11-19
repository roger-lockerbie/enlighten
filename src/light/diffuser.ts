/**
 * Covers, and the dots they do or do not hide (docs/research/optics.md sections 2 and 3).
 *
 * Transmission is from the research. How much a cover blurs is not published for any of them, so
 * each has an assumed haze: the share of what you see that is the cover's own glow, as against
 * the LEDs seen through it. The research's model for the glow: each LED is a small even source at
 * a depth behind the cover, and lights it as the fourth power of the cosine.
 */
import type { DiffuserId } from './scene.ts';

export interface Diffuser {
  readonly id: DiffuserId;
  readonly name: string;
  readonly transmission: number;
  readonly transmissionBasis: string;
  /** 0 shows the LEDs themselves. 1 shows only the cover's glow. Assumed for every cover. */
  readonly haze: number;
}

export const DIFFUSERS: Readonly<Record<DiffuserId, Diffuser>> = {
  none: {
    id: 'none',
    name: 'No cover',
    transmission: 1,
    transmissionBasis: 'Nothing in the way',
    haze: 0,
  },
  clear: {
    id: 'clear',
    name: 'Clear',
    transmission: 0.9,
    transmissionBasis: "Market figures of 90 to 95%, not Linear Lux's nominal 100%",
    haze: 0.05,
  },
  frosted: {
    id: 'frosted',
    name: 'Frosted',
    transmission: 0.75,
    transmissionBasis: "Linear Lux's 70 to 80% and the market agree",
    haze: 0.6,
  },
  'opal-market': {
    id: 'opal-market',
    name: 'Opal (market typical)',
    transmission: 0.6,
    transmissionBasis: 'The market spread is 45 to 75%',
    haze: 0.95,
  },
  'opal-linear-lux': {
    id: 'opal-linear-lux',
    name: 'Opal (Linear Lux)',
    transmission: 0.35,
    transmissionBasis: "Linear Lux's 1715 sheet, 30 to 40%",
    haze: 1,
  },
};

/** Samples in one repeat of a tape's pattern. */
export const RIPPLE_SAMPLES = 64;

/**
 * Luminance along the lit surface over one repeat of the tape, for an emitter at `offset` within
 * the repeat. The mean is 1, so the pattern changes how the light looks and never how much there is.
 */
export function ripple(
  period: number,
  chip: number,
  offset: number,
  depth: number,
  haze: number,
): Float32Array {
  const n = RIPPLE_SAMPLES;
  const glow = new Float64Array(n);
  const dots = new Float64Array(n);
  const reach = Math.max(4, Math.ceil((6 * depth) / period));
  const half = Math.min(chip, period) / 2;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * period - offset;
    // Distance to the nearest emitter, for the dots.
    const nearest = Math.abs(s - Math.round(s / period) * period);
    dots[i] = nearest <= half ? 1 : 0;
    let sum = 0;
    for (let k = -reach; k <= reach; k++) {
      const d = s - k * period;
      const c = (depth * depth) / (depth * depth + d * d);
      sum += c * c;
    }
    glow[i] = sum;
  }
  const mean = (v: Float64Array): number => v.reduce((a, c) => a + c, 0) / n;
  const glowMean = mean(glow);
  // An emitter narrower than one sample still shows as one lit sample.
  let dotMean = mean(dots);
  if (dotMean === 0) {
    const s = (((offset % period) + period) % period) / period;
    dots[Math.min(n - 1, Math.floor(s * n))] = 1;
    dotMean = 1 / n;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (1 - haze) * ((dots[i] ?? 0) / dotMean) + haze * ((glow[i] ?? 0) / glowMean);
  }
  return out;
}

/** How strongly a pattern shows: (max − min) ÷ (max + min). 0 is an even line, 1 is separate dots. */
export function contrast(pattern: ArrayLike<number>): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of Array.from(pattern)) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi + lo > 0 ? (hi - lo) / (hi + lo) : 0;
}
