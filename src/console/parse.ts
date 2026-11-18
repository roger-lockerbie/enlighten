/**
 * The console language (SPEC section 6): a line is parsed to a typed command, or to one sentence
 * saying what is wrong. Nothing typed is ever evaluated as code (ADR 0006). The page parses to show
 * errors and to complete, and the bus worker parses the same text again before it runs anything.
 */
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import { percentToArcFloor } from '../dali/curve.ts';
import type { CommandSpec } from '../dali/commands.ts';
import { lex, type Token } from './lex.ts';
import { MAX_LINE } from './history.ts';
import { byName, nameOf, sharedNames } from './names.ts';
import {
  channel,
  colour,
  hexByte,
  int,
  level,
  ranged,
  temperature,
  time,
  type Parsed,
} from './values.ts';

export type Target = readonly Address[];
export type Channels6 = readonly [number, number, number, number, number, number];
export type UnlockName = 'rate' | 'reset' | 'expert';
export type TargetName = 'simulator' | 'hardware' | 'both';

/** What `query <addr> <what>` asks: a summary, a group of queries, or one query by id. */
export type QueryWhat = 'summary' | 'fade' | 'groups' | 'tc' | { readonly id: string };

export type ConsoleCommand =
  | { readonly cmd: 'level'; readonly to: Target; readonly arc: number; readonly fadeMs?: number }
  | { readonly cmd: 'off'; readonly to: Target }
  | { readonly cmd: 'on'; readonly to: Target }
  | { readonly cmd: 'tc'; readonly to: Target; readonly mirek: number; readonly arc?: number }
  | { readonly cmd: 'rgb'; readonly to: Target; readonly channels: Channels6 }
  | { readonly cmd: 'fade'; readonly to: Target; readonly ms?: number; readonly rate?: number }
  | {
      readonly cmd: 'scene';
      readonly to: Target;
      readonly op: 'recall' | 'store' | 'remove';
      readonly n: number;
      readonly arc?: number;
    }
  | { readonly cmd: 'scene'; readonly to: Target; readonly op: 'list' }
  | {
      readonly cmd: 'group';
      readonly to: Target;
      readonly op: 'add' | 'remove';
      readonly n: number;
    }
  | { readonly cmd: 'query'; readonly to: Target; readonly what: QueryWhat }
  | { readonly cmd: 'devices' }
  | { readonly cmd: 'scan' }
  | { readonly cmd: 'profile'; readonly to?: Target; readonly apply?: boolean }
  | { readonly cmd: 'cap'; readonly arc?: number }
  | { readonly cmd: 'target'; readonly target?: TargetName }
  | { readonly cmd: 'trace'; readonly on?: boolean }
  | { readonly cmd: 'panic' }
  | { readonly cmd: 'resume' }
  | { readonly cmd: 'unlock'; readonly name: UnlockName }
  | { readonly cmd: 'lock'; readonly name?: UnlockName }
  | { readonly cmd: 'run'; readonly name: string }
  | { readonly cmd: 'scripts' }
  | { readonly cmd: 'history'; readonly args: readonly string[] }
  | { readonly cmd: 'clear' }
  | { readonly cmd: 'help'; readonly topic?: string }
  | { readonly cmd: 'echo'; readonly text: string }
  | { readonly cmd: 'wait'; readonly ms: number }
  | { readonly cmd: 'pause'; readonly text?: string }
  | { readonly cmd: 'use'; readonly to?: Target }
  | { readonly cmd: 'raw'; readonly a: number; readonly b: number; readonly twice: boolean }
  | {
      readonly cmd: 'dali';
      readonly id: string;
      readonly to?: Target;
      readonly value?: number;
    };

export type CommandName = ConsoleCommand['cmd'];

/** The friendly commands and keywords, in the order help lists them. */
export const FRIENDLY = [
  'level',
  'off',
  'on',
  'tc',
  'rgb',
  'fade',
  'scene',
  'group',
  'query',
  'devices',
  'scan',
  'profile',
  'cap',
  'target',
  'trace',
  'panic',
  'resume',
  'unlock',
  'lock',
  'run',
  'scripts',
  'history',
  'clear',
  'help',
  'echo',
  'wait',
  'pause',
  'use',
  'raw',
] as const;

/** Words for `query <addr> <what>`, besides any query command's name without `query-`. */
export const QUERY_WORDS: Readonly<Record<string, QueryWhat>> = {
  level: { id: 'QUERY_ACTUAL_LEVEL' },
  max: { id: 'QUERY_MAX_LEVEL' },
  min: { id: 'QUERY_MIN_LEVEL' },
  phm: { id: 'QUERY_PHYSICAL_MINIMUM' },
  'power-on': { id: 'QUERY_POWER_ON_LEVEL' },
  failure: { id: 'QUERY_SYSTEM_FAILURE_LEVEL' },
  type: { id: 'QUERY_DEVICE_TYPE' },
  fade: 'fade',
  groups: 'groups',
  tc: 'tc',
};

export const UNLOCKS: readonly UnlockName[] = ['rate', 'reset', 'expert'];
const TARGETS: Readonly<Record<string, TargetName>> = {
  sim: 'simulator',
  simulator: 'simulator',
  hw: 'hardware',
  hardware: 'hardware',
  both: 'both',
};

export interface ParseContext {
  /** Aliases from the Devices page, by lower-case name. */
  readonly aliases: ReadonlyMap<string, number>;
  /** The default target set by `use`. */
  readonly use?: Target;
}

export type ParseResult =
  | { readonly ok: true; readonly command: ConsoleCommand }
  /** A blank line or a comment. */
  | { readonly ok: true; readonly command?: undefined }
  | { readonly ok: false; readonly error: string };

/** The most addresses one target may name. */
export const MAX_TARGETS = 64;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** An alias starts with a letter and is not a command, a keyword or an address word (SPEC section 6). */
export function aliasProblem(name: string): string | undefined {
  const n = name.toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,59}$/.test(n))
    return 'An alias starts with a letter and has only letters, digits, - and _.';
  if (/^g\d+$/.test(n) || n === 'all' || n === 'unaddressed')
    return `"${name}" is an address word.`;
  if ((FRIENDLY as readonly string[]).includes(n) || byName(n) !== undefined)
    return `"${name}" is a command name.`;
  if (
    [
      'fade',
      'rate',
      'recall',
      'store',
      'remove',
      'list',
      'add',
      'apply',
      'on',
      'off',
      'w',
      'a',
      'x2',
      'none',
    ].includes(n)
  )
    return `"${name}" is a keyword.`;
  return undefined;
}

/** One address form: a short address, a group, `all`, `unaddressed`, an alias, a list or a range. */
export function parseTarget(text: string, ctx: ParseContext): Parsed<Target> {
  const t = text.toLowerCase();
  if (t === 'all') return { ok: true, value: [broadcast] };
  if (t === 'unaddressed') return { ok: true, value: [unaddressed] };
  const out: Address[] = [];
  for (const part of t.split(',')) {
    const range = /^(\d{1,2})\.\.(\d{1,2})$/.exec(part);
    if (range !== null) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > 63 || b > 63 || a > b)
        return fail(`"${part}" is not a range of short addresses, such as 0..3.`);
      for (let n = a; n <= b; n++) out.push(short(n));
      continue;
    }
    const g = /^g(\d{1,2})$/.exec(part);
    if (g !== null) {
      const n = Number(g[1]);
      if (n > 15) return fail(`There are 16 groups, g0 to g15, not ${part}.`);
      out.push(group(n));
      continue;
    }
    const n = int(part);
    if (n !== undefined) {
      if (n > 63) return fail(`A short address is 0 to 63, not ${part}.`);
      out.push(short(n));
      continue;
    }
    const alias = ctx.aliases.get(part);
    if (alias !== undefined) {
      out.push(short(alias));
      continue;
    }
    return fail(`"${part}" is not an address. Use 0 to 63, g0 to g15, all, or an alias.`);
  }
  if (out.length === 0) return fail('No address.');
  if (out.length > MAX_TARGETS)
    return fail(`A list names at most ${String(MAX_TARGETS)} addresses.`);
  return { ok: true, value: out };
}

/**
 * The address and the rest. The first word is the address when it is one and the rest then reads;
 * otherwise the `use` default stands in for it.
 */
function withTarget<T>(
  name: string,
  args: readonly Token[],
  ctx: ParseContext,
  body: (rest: readonly Token[]) => Parsed<T>,
): Parsed<{ to: Target; body: T }> {
  const first = args[0];
  let firstError: string | undefined;
  if (first !== undefined && !first.quoted) {
    const t = parseTarget(first.text, ctx);
    if (t.ok) {
      const b = body(args.slice(1));
      if (b.ok) return { ok: true, value: { to: t.value, body: b.value } };
      firstError = b.error;
    }
  }
  if (ctx.use !== undefined) {
    const b = body(args);
    if (b.ok) return { ok: true, value: { to: ctx.use, body: b.value } };
    return fail(firstError ?? b.error);
  }
  if (firstError !== undefined) return fail(firstError);
  if (first === undefined) return fail(`${name} needs an address. Set a default with "use".`);
  const t = parseTarget(first.text, ctx);
  return fail(t.ok ? `${name}: unexpected "${first.text}".` : t.error);
}

const none = (rest: readonly Token[]): Parsed<null> =>
  rest.length === 0 ? { ok: true, value: null } : fail(`Unexpected "${rest[0]?.text ?? ''}".`);

const word = (t: Token | undefined) => t?.text.toLowerCase();

function levelBody(rest: readonly Token[]): Parsed<{ arc: number; fadeMs?: number }> {
  const v = rest[0];
  if (v === undefined) return fail('level needs a value, such as 35% or 128.');
  const l = level(v.text);
  if (!l.ok) return l;
  if (rest.length === 1) return { ok: true, value: { arc: l.value } };
  if (word(rest[1]) !== 'fade' || rest[2] === undefined || rest.length > 3)
    return fail('After the level, only "fade <time>" may follow.');
  const t = time(rest[2].text);
  if (!t.ok) return t;
  return { ok: true, value: { arc: l.value, fadeMs: t.value } };
}

function tcBody(rest: readonly Token[]): Parsed<{ mirek: number; arc?: number }> {
  const v = rest[0];
  if (v === undefined) return fail('tc needs a colour temperature, such as 2700K.');
  const m = temperature(v.text);
  if (!m.ok) return m;
  if (rest.length === 1) return { ok: true, value: { mirek: m.value } };
  if (rest.length > 2 || rest[1] === undefined)
    return fail('tc takes a temperature and an optional level.');
  const l = level(rest[1].text);
  if (!l.ok) return l;
  return { ok: true, value: { mirek: m.value, arc: l.value } };
}

function rgbBody(rest: readonly Token[]): Parsed<Channels6> {
  let rgb: number[];
  let i: number;
  const first = rest[0];
  if (first === undefined) return fail('rgb needs three channel levels or #rrggbb.');
  if (first.text.startsWith('#')) {
    const c = colour(first.text);
    if (!c.ok) return c;
    rgb = [...c.value];
    i = 1;
  } else {
    rgb = [];
    for (i = 0; i < 3; i++) {
      const t = rest[i];
      if (t === undefined) return fail('rgb needs three channel levels: red, green and blue.');
      const c = channel(t.text);
      if (!c.ok) return c;
      rgb.push(c.value);
    }
  }
  // The whites are off unless given (`w` the first white, `a` the second), and the free colour is off.
  const extra: Record<string, number> = { w: 0, a: 0 };
  const seen = new Set<string>();
  while (i < rest.length) {
    const k = word(rest[i]);
    const v = rest[i + 1];
    if ((k !== 'w' && k !== 'a') || v === undefined || seen.has(k))
      return fail('After the colour, only "w <n>" and "a <n>" may follow, once each.');
    const c = channel(v.text);
    if (!c.ok) return c;
    extra[k] = c.value;
    seen.add(k);
    i += 2;
  }
  return {
    ok: true,
    value: [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, extra['w'] ?? 0, extra['a'] ?? 0, 0],
  };
}

function fadeBody(rest: readonly Token[]): Parsed<{ ms?: number; rate?: number }> {
  if (rest.length === 0) return { ok: true, value: {} };
  if (word(rest[0]) === 'rate') {
    const v = rest[1];
    if (v === undefined || rest.length > 2) return fail('fade rate needs a rate from 1 to 15.');
    const r = ranged(v.text, 1, 15, 'a fade rate');
    return r.ok ? { ok: true, value: { rate: r.value } } : r;
  }
  if (rest.length > 1 || rest[0] === undefined) return fail('fade takes one time, or "rate <n>".');
  const t = time(rest[0].text);
  return t.ok ? { ok: true, value: { ms: t.value } } : t;
}

type SceneBody = { op: 'recall' | 'store' | 'remove'; n: number; arc?: number } | { op: 'list' };

function sceneBody(rest: readonly Token[]): Parsed<SceneBody> {
  const op = word(rest[0]);
  if (op === 'list')
    return rest.length === 1 ? { ok: true, value: { op } } : fail('scene list takes nothing more.');
  if (op !== 'recall' && op !== 'store' && op !== 'remove')
    return fail('scene needs recall, store, remove or list.');
  const v = rest[1];
  if (v === undefined) return fail(`scene ${op} needs a scene number from 0 to 15.`);
  const n = ranged(v.text, 0, 15, 'a scene number');
  if (!n.ok) return n;
  if (rest.length === 2) return { ok: true, value: { op, n: n.value } };
  const l = rest[2];
  if (op !== 'store' || l === undefined || rest.length > 3)
    return fail(
      op === 'store'
        ? 'scene store takes a scene and an optional level.'
        : `scene ${op} takes a scene number only.`,
    );
  const arc = level(l.text);
  return arc.ok ? { ok: true, value: { op, n: n.value, arc: arc.value } } : arc;
}

function groupBody(rest: readonly Token[]): Parsed<{ op: 'add' | 'remove'; n: number }> {
  const op = word(rest[0]);
  const v = rest[1];
  if ((op !== 'add' && op !== 'remove') || v === undefined || rest.length > 2)
    return fail('group needs add or remove, and a group number from 0 to 15.');
  const n = ranged(v.text.replace(/^g/i, ''), 0, 15, 'a group number');
  return n.ok ? { ok: true, value: { op, n: n.value } } : n;
}

function queryBody(rest: readonly Token[]): Parsed<QueryWhat> {
  const w = word(rest[0]);
  if (w === undefined) return { ok: true, value: 'summary' };
  if (rest.length > 1) return fail('query takes one thing to ask.');
  const known = QUERY_WORDS[w];
  if (known !== undefined) return { ok: true, value: known };
  const s = w.startsWith('query-') || /^dt[68]-query-/.test(w) ? byName(w) : byName(`query-${w}`);
  if (s !== undefined && s.reply !== 'none' && s.kind !== 'special') {
    // A query that takes a number, or answers from a DTR, needs its own command (S6-D8).
    if (s.param !== 'none' || s.reads.length > 0)
      return fail(
        `query cannot ask "${w}": it needs a value set first. Use scene <addr> list, query <addr> tc, or the command ${nameOf(s.id)} itself.`,
      );
    return { ok: true, value: { id: s.id } };
  }
  return fail(`"${w}" is not something query can ask. Try "help query".`);
}

/** A DALI command by name, with its address and value as its parameter needs. */
function daliCommand(s: CommandSpec, args: readonly Token[], ctx: ParseContext): ParseResult {
  if (s.kind === 'special') {
    const v = args[0];
    if (s.param === 'none') {
      if (args.length > 0) return fail(`${s.label} takes no address or value.`);
      return { ok: true, command: { cmd: 'dali', id: s.id } };
    }
    if (v === undefined || args.length > 1) return fail(`${s.label} takes one value.`);
    const t = v.text.toLowerCase();
    let value: number | undefined;
    if (s.param === 'byte') {
      const n = t.startsWith('0x') ? hexByte(t) : ranged(t, 0, 255, 'a byte');
      if (!n.ok) return n;
      value = n.value;
    } else if (s.param === 'shortAddress') {
      if (t === 'none') value = 0xff;
      else {
        const n = ranged(t, 0, 63, 'a short address');
        if (!n.ok) return fail(`${n.error} Or "none".`);
        value = (n.value << 1) | 1;
      }
    } else {
      // INITIALISE: all gear, gear without an address, or one short address.
      if (t === 'all') value = 0;
      else if (t === 'unaddressed') value = 0xff;
      else {
        const n = ranged(t, 0, 63, 'a short address');
        if (!n.ok) return fail(`${n.error} Or "all" or "unaddressed".`);
        value = (n.value << 1) | 1;
      }
    }
    return { ok: true, command: { cmd: 'dali', id: s.id, value } };
  }
  const name = s.label.toLowerCase();
  if (s.kind === 'dapc') {
    const r = withTarget(name, args, ctx, (rest) => {
      const v = rest[0];
      if (v === undefined || rest.length > 1) return fail('DAPC needs one level.');
      if (v.text === '255' || v.text.toLowerCase() === 'mask') return { ok: true, value: 255 };
      return level(v.text);
    });
    return r.ok
      ? { ok: true, command: { cmd: 'dali', id: s.id, to: r.value.to, value: r.value.body } }
      : r;
  }
  if (s.param === 'nibble') {
    const r = withTarget(name, args, ctx, (rest) => {
      const v = rest[0];
      if (v === undefined || rest.length > 1)
        return fail(`${s.label} needs a number from 0 to 15.`);
      return ranged(v.text.replace(/^g/i, ''), 0, 15, 'a number');
    });
    return r.ok
      ? { ok: true, command: { cmd: 'dali', id: s.id, to: r.value.to, value: r.value.body } }
      : r;
  }
  const r = withTarget(name, args, ctx, none);
  return r.ok ? { ok: true, command: { cmd: 'dali', id: s.id, to: r.value.to } } : r;
}

const ok = (command: ConsoleCommand): ParseResult => ({ ok: true, command });

function target<T>(
  r: Parsed<{ to: Target; body: T }>,
  make: (to: Target, body: T) => ConsoleCommand,
): ParseResult {
  return r.ok ? ok(make(r.value.to, r.value.body)) : r;
}

/** Parse one line. */
export function parseLine(line: string, ctx: ParseContext): ParseResult {
  if (line.length > MAX_LINE) return fail(`A line is at most ${String(MAX_LINE)} characters.`);
  const lexed = lex(line);
  if (!lexed.ok) return lexed;
  const [head, ...args] = lexed.tokens;
  if (head === undefined) return { ok: true };
  if (head.quoted) return fail('A line starts with a command name.');
  const name = head.text.toLowerCase();
  const n = args.length;
  const only = (c: ConsoleCommand): ParseResult =>
    n === 0 ? ok(c) : fail(`${name} takes nothing more.`);
  switch (name) {
    case 'level':
      return target(withTarget(name, args, ctx, levelBody), (to, b) => ({
        cmd: 'level',
        to,
        ...b,
      }));
    case 'off':
    case 'on':
      return target(withTarget(name, args, ctx, none), (to) => ({ cmd: name, to }));
    case 'tc':
      return target(withTarget(name, args, ctx, tcBody), (to, b) => ({ cmd: 'tc', to, ...b }));
    case 'rgb':
      return target(withTarget(name, args, ctx, rgbBody), (to, channels) => ({
        cmd: 'rgb',
        to,
        channels,
      }));
    case 'fade':
      return target(withTarget(name, args, ctx, fadeBody), (to, b) => ({ cmd: 'fade', to, ...b }));
    case 'scene':
      return target(withTarget(name, args, ctx, sceneBody), (to, b) => ({
        cmd: 'scene',
        to,
        ...b,
      }));
    case 'group':
      return target(withTarget(name, args, ctx, groupBody), (to, b) => ({
        cmd: 'group',
        to,
        ...b,
      }));
    case 'query':
      return target(withTarget(name, args, ctx, queryBody), (to, what) => ({
        cmd: 'query',
        to,
        what,
      }));
    case 'devices':
    case 'scan':
    case 'panic':
    case 'resume':
    case 'scripts':
    case 'clear':
      return only({ cmd: name });
    case 'profile': {
      if (n === 0) return ok({ cmd: 'profile' });
      if (n === 1 && word(args[0]) === 'apply') return ok({ cmd: 'profile', apply: true });
      const t = n === 1 && args[0] !== undefined ? parseTarget(args[0].text, ctx) : undefined;
      if (t === undefined) return fail('profile takes an address, or "apply".');
      return t.ok ? ok({ cmd: 'profile', to: t.value }) : t;
    }
    case 'cap': {
      if (n === 0) return ok({ cmd: 'cap' });
      const v = args[0];
      if (v === undefined || n > 1) return fail('cap takes one value, such as 40% or 220.');
      if (v.text.endsWith('%')) {
        const p = Number(v.text.slice(0, -1));
        if (!/^\d{1,3}(\.\d+)?%$/.test(v.text) || p > 100)
          return fail(`"${v.text}" is not an output from 0% to 100%.`);
        // The ceiling rounds down (SPEC R6.1).
        const arc = percentToArcFloor(p);
        if (arc < 1) return fail(`${v.text} is below the lowest arc level.`);
        return ok({ cmd: 'cap', arc });
      }
      const arc = ranged(v.text, 1, 254, 'an arc level');
      return arc.ok ? ok({ cmd: 'cap', arc: arc.value }) : arc;
    }
    case 'target': {
      if (n === 0) return ok({ cmd: 'target' });
      const t = TARGETS[word(args[0]) ?? ''];
      if (t === undefined || n > 1) return fail('target takes sim, hw or both.');
      return ok({ cmd: 'target', target: t });
    }
    case 'trace': {
      if (n === 0) return ok({ cmd: 'trace' });
      const w = word(args[0]);
      if ((w !== 'on' && w !== 'off') || n > 1) return fail('trace takes on or off.');
      return ok({ cmd: 'trace', on: w === 'on' });
    }
    case 'unlock':
    case 'lock': {
      const w = word(args[0]);
      if (name === 'lock' && n === 0) return ok({ cmd: 'lock' });
      const u = UNLOCKS.find((x) => x === w);
      if (u === undefined || n > 1) return fail(`${name} takes rate, reset or expert.`);
      return ok(name === 'lock' ? { cmd: 'lock', name: u } : { cmd: 'unlock', name: u });
    }
    case 'run': {
      const v = args[0];
      if (v === undefined || n > 1) return fail('run takes the name of a script.');
      return ok({ cmd: 'run', name: v.text });
    }
    case 'history':
      return ok({ cmd: 'history', args: args.map((a) => a.text) });
    case 'help':
      if (n > 1) return fail('help takes one topic.');
      return ok(
        args[0] === undefined
          ? { cmd: 'help' }
          : { cmd: 'help', topic: args[0].text.toLowerCase() },
      );
    case 'echo':
      return ok({ cmd: 'echo', text: args.map((a) => a.text).join(' ') });
    case 'wait': {
      const v = args[0];
      if (v === undefined || n > 1) return fail('wait takes one time, such as 2s.');
      const t = time(v.text);
      return t.ok ? ok({ cmd: 'wait', ms: t.value }) : t;
    }
    case 'pause': {
      if (n > 1) return fail('pause takes one message in double quotes.');
      return ok(args[0] === undefined ? { cmd: 'pause' } : { cmd: 'pause', text: args[0].text });
    }
    case 'use': {
      if (n === 0) return ok({ cmd: 'use' });
      const v = args[0];
      if (v === undefined || n > 1) return fail('use takes one address.');
      const t = parseTarget(v.text, ctx);
      return t.ok ? ok({ cmd: 'use', to: t.value }) : t;
    }
    case 'raw': {
      const [a, b, x] = args;
      if (a === undefined || b === undefined || n > 3)
        return fail('raw takes two bytes in hex, then x2 to send twice.');
      if (x !== undefined && x.text.toLowerCase() !== 'x2')
        return fail(`Expected x2, not "${x.text}".`);
      const ha = hexByte(a.text);
      if (!ha.ok) return ha;
      const hb = hexByte(b.text);
      if (!hb.ok) return hb;
      return ok({ cmd: 'raw', a: ha.value, b: hb.value, twice: x !== undefined });
    }
    default: {
      const s = byName(name);
      if (s !== undefined) return daliCommand(s, args, ctx);
      const shared = sharedNames(name);
      if (shared !== undefined)
        return fail(
          `"${head.text}" names commands for more than one device type. Type ${shared.join(' or ')}.`,
        );
      return fail(`Unknown command "${head.text}". Type "help" for the list.`);
    }
  }
}
