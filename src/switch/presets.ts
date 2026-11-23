/**
 * Starting layouts for each provider family, from `docs/research/switchgear.md` sections 3 to 7. Each
 * is a starting point the mapping editor can change. Double press is off in every preset, because no
 * provider documents a use for it.
 */
import { short, type Address } from '../dali/address.ts';
import { DEFAULT_FILTER, DEFAULT_TIMERS, type Timers } from './button.ts';
import type { Action, ButtonConfig, Family, Layout, LedMode, Mapping, Plate } from './plate.ts';

const dimUp = (t: Address): Action => ({ kind: 'dim', target: t, dir: 'up' });
const dimDown = (t: Address): Action => ({ kind: 'dim', target: t, dir: 'down' });

const btn = (mapping: Mapping, led: LedMode): ButtonConfig => ({ mapping, led });

/** Memory dimmer: press toggles, hold dims with the direction alternating (zencontrol, section 3). */
function memoryDimmer(t: Address, led: LedMode): ButtonConfig {
  return btn(
    {
      short: { kind: 'toggle', target: t, on: 'last' },
      longStart: { kind: 'dim', target: t, dir: 'alternate' },
    },
    led,
  );
}

function zenButtons(layout: Layout, t: Address): ButtonConfig[] {
  if (layout === 1) return [memoryDimmer(t, 'onWhenOn')];
  if (layout === 2)
    return [
      btn({ short: { kind: 'on', target: t }, longStart: dimUp(t) }, 'onWhenOn'),
      btn({ short: { kind: 'off', target: t }, longStart: dimDown(t) }, 'onWhenOff'),
    ];
  return [
    btn({ short: { kind: 'on', target: t }, longStart: dimUp(t) }, 'onWhenOn'),
    btn({ short: { kind: 'scene', target: t, slot: 1 }, longStart: dimUp(t) }, 'off'),
    btn({ short: { kind: 'scene', target: t, slot: 2 }, longStart: dimDown(t) }, 'off'),
    btn({ short: { kind: 'off', target: t }, longStart: dimDown(t) }, 'onWhenOff'),
  ];
}

/** Lunatone's factory functions for four inputs (research section 4). A coupler has no LEDs. */
function couplerButtons(layout: Layout, t: Address): ButtonConfig[] {
  const all = [
    memoryDimmer(t, 'off'),
    btn({ short: { kind: 'on', target: t }, longStart: dimUp(t) }, 'off'),
    btn({ short: { kind: 'off', target: t }, longStart: dimDown(t) }, 'off'),
    btn(
      {
        short: { kind: 'toggle', target: t, on: 'max' },
        longStart: { kind: 'tune', target: t, dir: 'alternate' },
      },
      'off',
    ),
  ];
  return all.slice(0, layout);
}

/** The Lunatone built-in controller's own timings: short under 400 ms, repeats every 200 ms. */
const COUPLER_TIMERS: Timers = { ...DEFAULT_TIMERS, shortMs: 400, repeatMs: 200 };

export function presetPlate(
  id: string,
  family: Family,
  layout: Layout,
  target: Address = short(0),
): Plate {
  const names: Record<Family, string> = {
    zencontrol: 'zencontrol style',
    coupler: 'DALI-2 coupler',
    knx: 'KNX gateway',
  };
  const name = `${names[family]} ${String(layout)}`;
  const buttons =
    family === 'coupler' ? couplerButtons(layout, target) : zenButtons(layout, target);
  const timers = family === 'coupler' ? COUPLER_TIMERS : DEFAULT_TIMERS;
  const plate: Plate = { id, name, family, buttons, timers, filter: DEFAULT_FILTER };
  return family === 'knx' && layout > 1
    ? { ...plate, multi: { kind: 'toggle', target: { kind: 'broadcast' }, on: 'last' } }
    : plate;
}
