/**
 * A plate: one to four buttons, each with a mapping from events to actions, and the timers and
 * event filter its buttons share (SPEC section 10). Plain data, checked by `schema.ts`.
 */
import { addressText, type Address } from '../dali/address.ts';
import type { FadeSetting } from '../engine/engine.ts';
import { DEFAULT_FILTER, DEFAULT_TIMERS, type ButtonEvent, type Timers } from './button.ts';

export type Family = 'zencontrol' | 'coupler' | 'knx';
export type Layout = 1 | 2 | 4;

export const FAMILY_LABEL: Readonly<Record<Family, string>> = {
  zencontrol: 'zencontrol style',
  coupler: 'Generic DALI-2 coupler',
  knx: 'KNX through a gateway',
};

export type LedMode = 'off' | 'onWhenOn' | 'onWhenOff' | 'always';

export const LED_LABEL: Readonly<Record<LedMode, string>> = {
  off: 'Off',
  onWhenOn: 'On when the target is on',
  onWhenOff: 'On when the target is off',
  always: 'Always on',
};

/** How a hold chooses its direction when the action says `alternate`. */
export type Direction = 'up' | 'down' | 'alternate';
export type TuneDirection = 'warmer' | 'cooler' | 'alternate';

export type Action =
  | { readonly kind: 'none' }
  /** Off if the target is on, else RECALL MAX LEVEL (or GO TO LAST ACTIVE LEVEL). */
  | { readonly kind: 'toggle'; readonly target: Address; readonly on: 'max' | 'last' }
  | { readonly kind: 'on'; readonly target: Address }
  | { readonly kind: 'off'; readonly target: Address }
  | {
      readonly kind: 'scene';
      readonly target: Address;
      readonly slot: number;
      readonly fade?: FadeSetting;
    }
  /** Dim while held. Starts on long press start and repeats on each long press repeat. */
  | { readonly kind: 'dim'; readonly target: Address; readonly dir: Direction }
  | { readonly kind: 'tune'; readonly target: Address; readonly dir: TuneDirection }
  | { readonly kind: 'run'; readonly what: 'sequence' | 'effect'; readonly name: string }
  | { readonly kind: 'stop' };

export type ActionKind = Action['kind'];

export const ACTION_LABEL: Readonly<Record<ActionKind, string>> = {
  none: 'Nothing',
  toggle: 'Toggle',
  on: 'On (recall max)',
  off: 'Off',
  scene: 'Recall a scene slot',
  dim: 'Dim while held',
  tune: 'Warmer or cooler while held',
  run: 'Run a sequence or effect',
  stop: 'Stop the running sequence or effect',
};

/** Events a mapping can bind. Repeat is part of the hold that long press start begins. */
export const MAPPABLE: readonly ButtonEvent[] = [
  'pressed',
  'released',
  'short',
  'double',
  'longStart',
  'longStop',
];

export type Mapping = Partial<Record<ButtonEvent, Action>>;

export interface ButtonConfig {
  readonly mapping: Mapping;
  readonly led: LedMode;
}

export interface Plate {
  readonly id: string;
  readonly name: string;
  readonly family: Family;
  readonly buttons: readonly ButtonConfig[];
  readonly timers: Timers;
  readonly filter: number;
  /** KNX plates: touching two surfaces at once does this (research section 5). */
  readonly multi?: Action;
}

export const MAX_PLATES = 8;

export function targetOf(a: Action): Address | undefined {
  switch (a.kind) {
    case 'toggle':
    case 'on':
    case 'off':
    case 'scene':
    case 'dim':
    case 'tune':
      return a.target;
    default:
      return undefined;
  }
}

/** The address a button's LED follows: the target of its first mapped action. */
export function ledTarget(b: ButtonConfig): Address | undefined {
  for (const a of Object.values(b.mapping)) {
    const t = targetOf(a);
    if (t !== undefined) return t;
  }
  return undefined;
}

export function actionText(a: Action): string {
  switch (a.kind) {
    case 'none':
      return 'nothing';
    case 'toggle':
      return `toggle ${addressText(a.target)}`;
    case 'on':
      return `on ${addressText(a.target)}`;
    case 'off':
      return `off ${addressText(a.target)}`;
    case 'scene':
      return `scene ${String(a.slot)} on ${addressText(a.target)}`;
    case 'dim':
      return `dim ${a.dir} ${addressText(a.target)}`;
    case 'tune':
      return `tune ${a.dir} ${addressText(a.target)}`;
    case 'run':
      return `run ${a.what} "${a.name}"`;
    case 'stop':
      return 'stop the run';
  }
}

/** Whether a plate has a given layout of buttons. */
export const isLayout = (n: number): n is Layout => n === 1 || n === 2 || n === 4;

/** Names for the buttons of a layout, in order. */
export function buttonNames(n: Layout): readonly string[] {
  if (n === 1) return ['Button'];
  if (n === 2) return ['Top', 'Bottom'];
  return ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
}

export { DEFAULT_FILTER, DEFAULT_TIMERS };
