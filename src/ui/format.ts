/** Text for the page. Every value from the engine reaches the page as text through Svelte. */
import { arcToFraction } from '../dali/curve.ts';
import { mirekToKelvin } from '../dali/sequences.ts';
import type { Connection, OutputTarget } from '../engine/engine.ts';
import type { DriveMode } from '../engine/inventory.ts';

/** Output % for an arc level, as the top bar shows it. */
export function percent(arc: number): string {
  const p = arcToFraction(arc) * 100;
  return p >= 10 ? p.toFixed(0) : p.toFixed(1);
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
  return mirek === undefined || mirek === 0 ? 'not read' : `${String(mirekToKelvin(mirek))} K`;
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
