/** Pure edits of a plate, for the mapping editor. Each returns a new plate. */
import type { Address } from '../dali/address.ts';
import { short } from '../dali/address.ts';
import { EVENTS, type ButtonEvent, type Timers } from './button.ts';
import type { Action, ActionKind, ButtonConfig, LedMode, Mapping, Plate } from './plate.ts';
import { targetOf } from './plate.ts';

/** A new action of a kind, aimed at `target` where it has one. */
export function newAction(kind: ActionKind, target: Address = short(0)): Action {
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'stop':
      return { kind: 'stop' };
    case 'toggle':
      return { kind: 'toggle', target, on: 'last' };
    case 'on':
      return { kind: 'on', target };
    case 'off':
      return { kind: 'off', target };
    case 'scene':
      return { kind: 'scene', target, slot: 0 };
    case 'dim':
      return { kind: 'dim', target, dir: 'alternate' };
    case 'tune':
      return { kind: 'tune', target, dir: 'alternate' };
    case 'run':
      return { kind: 'run', what: 'sequence', name: '' };
  }
}

const withButton = (p: Plate, i: number, f: (b: ButtonConfig) => ButtonConfig): Plate => ({
  ...p,
  buttons: p.buttons.map((b, j) => (j === i ? f(b) : b)),
});

/** Set or clear (`undefined`) the action for one event of one button. */
export function setAction(
  p: Plate,
  button: number,
  event: ButtonEvent,
  action: Action | undefined,
): Plate {
  return withButton(p, button, (b) => {
    const rest = Object.fromEntries(Object.entries(b.mapping).filter(([k]) => k !== event));
    const mapping: Mapping =
      action === undefined || action.kind === 'none' ? rest : { ...rest, [event]: action };
    return { ...b, mapping };
  });
}

export const setLed = (p: Plate, button: number, led: LedMode): Plate =>
  withButton(p, button, (b) => ({ ...b, led }));

export const setTimers = (p: Plate, timers: Timers): Plate => ({ ...p, timers });

export const setFilter = (p: Plate, filter: number): Plate => ({ ...p, filter });

export const rename = (p: Plate, name: string): Plate => ({ ...p, name });

/** The first address any action on the plate names, for a new action to start from. */
export function plateTarget(p: Plate): Address {
  for (const b of p.buttons)
    for (const e of EVENTS) {
      const a = b.mapping[e];
      const t = a === undefined ? undefined : targetOf(a);
      if (t !== undefined) return t;
    }
  return short(0);
}

/** A plate id not used by any plate: p1, p2, and so on. */
export function freeId(plates: readonly Plate[]): string {
  const used = new Set(plates.map((p) => p.id));
  for (let n = 1; ; n++) if (!used.has(`p${String(n)}`)) return `p${String(n)}`;
}

/** Names of the sequences and effects the plates run, for the page to resolve. */
export function runNames(
  plates: readonly Plate[],
): { what: 'sequence' | 'effect'; name: string }[] {
  const seen = new Map<string, { what: 'sequence' | 'effect'; name: string }>();
  const take = (a: Action | undefined) => {
    if (a?.kind === 'run') seen.set(`${a.what}:${a.name}`, { what: a.what, name: a.name });
  };
  for (const p of plates) {
    take(p.multi);
    for (const b of p.buttons) for (const e of EVENTS) take(b.mapping[e]);
  }
  return [...seen.values()];
}
