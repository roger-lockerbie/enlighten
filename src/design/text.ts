/** A look's values in words, for lists, previews and the export. */
import { arcToFraction } from '../dali/curve.ts';
import { extendedFadeMs, fadeTimeMs } from '../dali/fade.ts';
import { mirekToKelvin } from '../dali/sequences.ts';
import type { FadeSetting } from '../engine/engine.ts';
import type { Look, LookColour } from './look.ts';

/** An arc level as output: "off", or a percentage with one decimal. */
export function levelText(arc: number): string {
  return arc === 0 ? 'off' : `${(Math.round(arcToFraction(arc) * 1000) / 10).toFixed(1)}%`;
}

const CHANNEL = ['R', 'G', 'B', 'W', 'A', 'F'];

export function colourText(c: LookColour): string {
  if (c.kind === 'none') return 'colour unchanged';
  if (c.kind === 'tc') return `${String(Math.round(mirekToKelvin(c.mirek) / 10) * 10)} K`;
  const set = c.channels
    .map((v, i) => (v === 255 ? undefined : `${CHANNEL[i] ?? '?'} ${String(v)}`))
    .filter((x) => x !== undefined);
  return set.length === 0 ? 'colour unchanged' : set.join(', ');
}

/** How long a fade setting takes, in ms. */
export function fadeMs(f: FadeSetting): number {
  return f.kind === 'standard' ? fadeTimeMs(f.value) : extendedFadeMs(f.value);
}

/** A time as people say it: 0.7 s, 45 s, 1 min 30 s, 16 min. */
export function timeText(ms: number): string {
  if (ms < 10_000) {
    const s = Math.round(ms / 100) / 10;
    return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  const total = Math.round(ms / 1000);
  if (total < 60) return `${String(total)} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${String(m)} min` : `${String(m)} min ${String(s)} s`;
}

export function fadeText(f: FadeSetting | undefined): string {
  if (f === undefined) return "the driver's fade";
  const ms = fadeMs(f);
  return ms === 0 ? 'no fade' : `fade ${timeText(ms)}`;
}

export function lookText(l: Look): string {
  return `${levelText(l.arc)}, ${colourText(l.colour)}, ${fadeText(l.fade)}`;
}
