/** Text for the page. Every value from the engine reaches the page as text through Svelte. */
import { percentText } from '../dali/curve.ts';
import { mirekToKelvin } from '../dali/sequences.ts';
import type { Connection, OutputTarget } from '../engine/engine.ts';
import type { DriveMode } from '../engine/inventory.ts';

/** Output % for an arc level, as the top bar shows it. */
export function percent(arc: number): string {
  return percentText(arc);
}

export function ceilingText(arc: number): string {
  return `${percent(arc)}%  arc ${String(arc)}`;
}

export const TARGETS: readonly { readonly value: OutputTarget; readonly label: string }[] = [
  { value: 'simulator', label: 'Simulator' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'both', label: 'Both' },
];

export function connectionText(c: Connection, firmware: string | undefined): string {
  switch (c) {
    case 'none':
      return 'Server: connected, not in use';
    case 'connecting':
      return 'Hardware: connecting';
    case 'ready':
      return firmware === undefined
        ? 'Hardware: ready'
        : `Hardware: ready, hasseb firmware ${firmware}`;
    case 'no-hasseb':
      return 'Hardware: no hasseb';
    case 'disconnected':
      return 'Hardware: disconnected';
  }
}

export function driveText(d: DriveMode | undefined): string {
  switch (d) {
    case 'tc':
      return 'Colour temperature';
    case 'rgbwaf':
      return 'RGBWAF channels';
    case 'level':
      return 'Level only';
    case undefined:
      return 'not read yet';
  }
}

export function num(x: number | undefined | null): string {
  return x === undefined || x === null ? 'not read' : String(x);
}

export function kelvin(mirek: number | undefined): string {
  return mirek === undefined || mirek === 0
    ? 'not read'
    : `${String(Math.round(mirekToKelvin(mirek)))} K`;
}

/** DT8 assigned colour codes (IEC 62386-209). */
const ASSIGNED: Record<number, string> = {
  0: 'none',
  1: 'red',
  2: 'green',
  3: 'blue',
  4: 'white',
  5: 'amber',
  6: 'freecolour',
};

export function assignedText(codes: readonly (number | undefined)[] | undefined): string {
  if (codes === undefined) return 'none';
  return codes
    .map((c, i) => `${String(i)}: ${c === undefined ? '?' : (ASSIGNED[c] ?? String(c))}`)
    .join(', ');
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A fade or wait as people say it: 0.7 s, 2 s, 1 min 30 s, 16 min. */
export function duration(ms: number): string {
  if (ms < 10_000) {
    const s = Math.round(ms / 100) / 10;
    return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  if (ms < 60_000) return `${String(Math.round(ms / 1000))} s`;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${String(m)} min` : `${String(m)} min ${String(s)} s`;
}

/** The name of one RGBWAF channel from its assigned colour, or its letter when none is reported. */
export function channelName(i: number, code: number | undefined): string {
  const fallback =
    ['Red', 'Green', 'Blue', 'White', 'Amber', 'Free colour'][i] ?? `Channel ${String(i)}`;
  if (code === undefined || code === 255 || code === 0) return fallback;
  const name = ASSIGNED[code];
  return name === undefined ? fallback : name.charAt(0).toUpperCase() + name.slice(1);
}
