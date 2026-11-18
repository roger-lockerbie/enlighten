/**
 * The black-body locus, and colour temperature with its distance from the locus (Duv).
 * docs/research/rendering.md section 5: Krystek's 1985 fit in CIE 1960 (u, v), searched in mirek for
 * the nearest point, with McCamy's cubic as a cross-check in tests.
 */
import type { Xy } from './xyz.ts';

/** The range Krystek's fit covers. */
export const LOCUS_MIN_K = 1000;
export const LOCUS_MAX_K = 15000;

interface Uv {
  readonly u: number;
  readonly v: number;
}

export function xyToUv(c: Xy): Uv {
  const d = -2 * c.x + 12 * c.y + 3;
  return { u: (4 * c.x) / d, v: (6 * c.y) / d };
}

export function uvToXy(c: Uv): Xy {
  const d = 2 * c.u - 8 * c.v + 4;
  return { x: (3 * c.u) / d, y: (2 * c.v) / d };
}

function locusUv(kelvin: number): Uv {
  const t = Math.min(LOCUS_MAX_K, Math.max(LOCUS_MIN_K, kelvin));
  const t2 = t * t;
  return {
    u:
      (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t2) /
      (1 + 8.42420235e-4 * t + 7.08145163e-7 * t2),
    v:
      (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t2) /
      (1 - 2.89741816e-5 * t + 1.61456053e-7 * t2),
  };
}

/** The chromaticity of a black body at a temperature, clamped to the fit's range. */
export function locusXy(kelvin: number): Xy {
  return uvToXy(locusUv(kelvin));
}

export interface Cct {
  /** Correlated colour temperature in kelvin, within the fit's range. */
  readonly kelvin: number;
  /** Distance from the locus in CIE 1960 (u, v). Positive is above the locus, toward green. */
  readonly duv: number;
}

const MIREK_MIN = 1e6 / LOCUS_MAX_K;
const MIREK_MAX = 1e6 / LOCUS_MIN_K;

/** The nearest point on the locus to a chromaticity, by a search in mirek. */
export function cct(c: Xy): Cct {
  const p = xyToUv(c);
  const dist2 = (mirek: number): number => {
    const q = locusUv(1e6 / mirek);
    return (q.u - p.u) ** 2 + (q.v - p.v) ** 2;
  };
  // A coarse scan finds the right valley, then a golden-section search narrows it.
  const steps = 96;
  let best = MIREK_MIN;
  let bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const m = MIREK_MIN + ((MIREK_MAX - MIREK_MIN) * i) / steps;
    const d = dist2(m);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  const span = (MIREK_MAX - MIREK_MIN) / steps;
  let lo = Math.max(MIREK_MIN, best - span);
  let hi = Math.min(MIREK_MAX, best + span);
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 48; i++) {
    const a = hi - phi * (hi - lo);
    const b = lo + phi * (hi - lo);
    if (dist2(a) < dist2(b)) hi = b;
    else lo = a;
  }
  const mirek = (lo + hi) / 2;
  const kelvin = 1e6 / mirek;
  const q = locusUv(kelvin);
  // The sign comes from the side of the locus's tangent the point lies on. Toward higher
  // temperatures u falls, so the left-hand normal of that direction points up, toward green.
  const ahead = locusUv(1e6 / Math.max(MIREK_MIN, mirek - 0.5));
  const behind = locusUv(1e6 / Math.min(MIREK_MAX, mirek + 0.5));
  const tu = ahead.u - behind.u;
  const tv = ahead.v - behind.v;
  const cross = tu * (p.v - q.v) - tv * (p.u - q.u);
  const d = Math.sqrt((p.u - q.u) ** 2 + (p.v - q.v) ** 2);
  return { kelvin, duv: cross < 0 ? d : -d };
}

/** McCamy's cubic. Good to about 2 K on the locus from 2,856 to 6,504 K, and a cross-check only. */
export function mccamy(c: Xy): number {
  const n = (c.x - 0.332) / (0.1858 - c.y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}
