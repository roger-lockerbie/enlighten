/**
 * The checks on plates, stored or imported or sent by the page (SPEC section 8, section 10). Built
 * from the store's validator: unknown keys are refused and every value is copied fresh.
 */
import { fade, name, target } from '../design/schema.ts';
import {
  arrayOf,
  int,
  object,
  oneOf,
  opt,
  req,
  uniqueBy,
  type Result,
  type Schema,
} from '../store/validate.ts';
import { timersProblem, type Timers } from './button.ts';
import { MAX_PLATES, isLayout, type Action, type ButtonConfig, type Plate } from './plate.ts';
import { SLOTS } from '../design/look.ts';

const none = object({ kind: req(oneOf('none')) });
const stop = object({ kind: req(oneOf('stop')) });
const toggle = object({
  kind: req(oneOf('toggle')),
  target: req(target),
  on: req(oneOf('max', 'last')),
});
const on = object({ kind: req(oneOf('on')), target: req(target) });
const off = object({ kind: req(oneOf('off')), target: req(target) });
const scene = object({
  kind: req(oneOf('scene')),
  target: req(target),
  slot: req(int(0, SLOTS - 1)),
  fade: opt(fade),
});
const dim = object({
  kind: req(oneOf('dim')),
  target: req(target),
  dir: req(oneOf('up', 'down', 'alternate')),
});
const tune = object({
  kind: req(oneOf('tune')),
  target: req(target),
  dir: req(oneOf('warmer', 'cooler', 'alternate')),
});
const run = object({
  kind: req(oneOf('run')),
  what: req(oneOf('sequence', 'effect')),
  name: req(name),
});

const BY_KIND: Record<string, Schema<Action>> = {
  none,
  stop,
  toggle,
  on,
  off,
  scene,
  dim,
  tune,
  run,
};

export const action: Schema<Action> = (x, path) => {
  const kind = typeof x === 'object' && x !== null ? (x as { kind?: unknown }).kind : undefined;
  const schema =
    typeof kind === 'string' && Object.hasOwn(BY_KIND, kind) ? BY_KIND[kind] : undefined;
  return schema === undefined ? { ok: false, error: `${path}: an action.` } : schema(x, path);
};

const mapping = object({
  pressed: opt(action),
  released: opt(action),
  short: opt(action),
  double: opt(action),
  longStart: opt(action),
  longStop: opt(action),
});

const button: Schema<ButtonConfig> = object({
  mapping: req(mapping),
  led: req(oneOf('off', 'onWhenOn', 'onWhenOff', 'always')),
});

const timers: Schema<Timers> = (x, path) => {
  const r = object({
    shortMs: req(int(20, 5100)),
    doubleMs: req(int(0, 2000)),
    repeatMs: req(int(100, 2000)),
    stuckS: req(int(5, 255)),
    minPulseMs: req(int(0, 500)),
  })(x, path);
  if (!r.ok) return r;
  const p = timersProblem(r.value);
  return p === undefined ? r : { ok: false, error: `${path}: ${p}` };
};

const id: Schema<string> = (x, path) =>
  typeof x === 'string' && /^[a-z0-9-]{1,16}$/.test(x)
    ? { ok: true, value: x }
    : { ok: false, error: `${path}: an id of 1 to 16 lowercase letters, digits or hyphens.` };

export const plate: Schema<Plate> = (x, path) => {
  const r = object({
    id: req(id),
    name: req(name),
    family: req(oneOf('zencontrol', 'coupler', 'knx')),
    buttons: req(arrayOf(button, 4)),
    timers: req(timers),
    filter: req(int(0, 255)),
    multi: opt(action),
  })(x, path);
  if (!r.ok) return r;
  if (!isLayout(r.value.buttons.length))
    return { ok: false, error: `${path}: a plate has 1, 2 or 4 buttons.` };
  return { ok: true, value: r.value as unknown as Plate };
};

export const plates = uniqueBy(arrayOf(plate, MAX_PLATES), (p) => p.id, 'the plate');

export function parsePlates(x: unknown): Result<readonly Plate[]> {
  return plates(x, 'plates');
}
