/**
 * Messages between the page and the bus worker (ADR 0010). Each side has one function that posts and
 * one that receives, and every message received is checked here before it is used. A message that does
 * not pass is dropped.
 *
 * Everything the page asks for comes from a person, so the worker gives it the source `ui`, or
 * `console` for a typed console line. A script's steps run with the source `script` (ADR 0014).
 */
import type { Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { aliasProblem, parseTarget, type ParseContext } from '../console/parse.ts';
import { MAX_LINE } from '../console/history.ts';
import { MAX_BYTES, scriptNameProblem } from '../script/parse.ts';
import { DEFAULT_CEILING_ARC, type Outcome } from '../safety/governor.ts';
import type { Unlock } from '../safety/types.ts';
import { parseUnitSetup, type UnitSetup } from '../sim/settings.ts';
import type {
  Channels,
  FadeSetting,
  Intent,
  OutputTarget,
  RequestResult,
  Snapshot,
} from './engine.ts';

export type Call =
  | { readonly op: 'setTarget'; readonly target: OutputTarget }
  | { readonly op: 'reconnect' }
  | { readonly op: 'resume' }
  | { readonly op: 'setCeiling'; readonly arc: number; readonly confirmed: boolean }
  | { readonly op: 'unlock'; readonly unlock: Unlock; readonly confirmed: boolean }
  | { readonly op: 'lock'; readonly unlock?: Unlock }
  | { readonly op: 'swingLimit'; readonly n: number }
  | { readonly op: 'canSee'; readonly can: boolean }
  | { readonly op: 'request'; readonly intent: Intent }
  | { readonly op: 'rescan' }
  | { readonly op: 'reapplyProfile' }
  | { readonly op: 'commission'; readonly typed: string }
  | {
      readonly op: 'check';
      readonly step: string;
      readonly confirmed?: boolean;
      readonly note?: string;
      readonly skip?: boolean;
    }
  | { readonly op: 'checkReport' }
  | { readonly op: 'clearCheck' }
  | { readonly op: 'clearDivergences' }
  /** Set up the simulated bench's units again (SPEC R1.6). */
  | { readonly op: 'bench'; readonly setup: Partial<Record<'A' | 'B', UnitSetup>> }
  /** A typed console line, with the page's aliases and `use` default. Parsed again in the worker. */
  | {
      readonly op: 'console';
      readonly line: string;
      readonly aliases: readonly Alias[];
      readonly use?: string;
      /** The person typed the confirmation for an unlock or a raise of the ceiling. */
      readonly confirmed?: boolean;
    }
  | {
      readonly op: 'runScript';
      readonly name: string;
      readonly text: string;
      readonly aliases: readonly Alias[];
    }
  | { readonly op: 'scriptContinue' }
  | { readonly op: 'stopConsole' };

/** An alias from the Devices page: a name and a short address. */
export type Alias = readonly [string, number];

/** The most aliases a console call carries: one for each short address. */
export const MAX_ALIASES = 64;
/** The longest `use` default a console call carries. */
export const MAX_USE = 200;

export type ToWorker =
  /** The first message. The token is present only when the page came from the server. */
  | {
      readonly type: 'init';
      readonly token?: Uint8Array;
      /** The ceiling to start with, from the page's stored preferences (ADR 0009). */
      readonly ceilingArc?: number;
      /** The simulated bench's set-up, from the page's stored preferences. */
      readonly bench?: Partial<Record<'A' | 'B', UnitSetup>>;
    }
  | { readonly type: 'heartbeat'; readonly visible: boolean }
  | { readonly type: 'panic'; readonly id: number }
  | { readonly type: 'call'; readonly id: number; readonly call: Call };

export type CallResult = Outcome | RequestResult | { readonly ok: true; readonly text: string };

export type FromWorker =
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'reply'; readonly id: number; readonly result: CallResult }
  /** Panic has started: every governor is latched and every queue dropped (SPEC S4.5). */
  | { readonly type: 'panicked'; readonly id: number };

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isId = (x: unknown): x is number => isInt(x, 0, Number.MAX_SAFE_INTEGER);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const UNLOCKS: readonly string[] = ['rate', 'reset', 'expert'];
const TARGETS: readonly string[] = ['simulator', 'hardware', 'both'];
const isUnlock = (x: unknown): x is Unlock => typeof x === 'string' && UNLOCKS.includes(x);

/** The most commands one request may carry. A transaction is a short group of frames. */
export const MAX_COMMANDS = 16;

function parseCommand(x: unknown): Command | undefined {
  if (!isObj(x) || !isStr(x['id'], 64) || !/^[A-Z0-9_]+$/.test(x['id'])) return undefined;
  const out: { id: string; address?: Address; value?: number } = { id: x['id'] };
  const a = x['address'];
  if (a !== undefined) {
    if (!isObj(a)) return undefined;
    const kind = a['kind'];
    if (kind === 'short' && isInt(a['n'], 0, 63)) out.address = { kind, n: a['n'] };
    else if (kind === 'group' && isInt(a['n'], 0, 15)) out.address = { kind, n: a['n'] };
    else if (kind === 'broadcast' || kind === 'unaddressed') out.address = { kind };
    else return undefined;
  }
  if (x['value'] !== undefined) {
    if (!isInt(x['value'], 0, 255)) return undefined;
    out.value = x['value'];
  }
  return out;
}

function parseChannels(x: unknown): Channels | undefined {
  if (!Array.isArray(x) || x.length !== 6) return undefined;
  const out: number[] = [];
  for (const v of x) {
    if (!isInt(v, 0, 255)) return undefined;
    out.push(v);
  }
  return out as unknown as Channels;
}

function parseFade(x: unknown): FadeSetting | undefined {
  if (!isObj(x)) return undefined;
  if (x['kind'] === 'standard' && isInt(x['value'], 0, 15))
    return { kind: 'standard', value: x['value'] };
  if (x['kind'] === 'extended' && isInt(x['value'], 0, 0x4f))
    return { kind: 'extended', value: x['value'] };
  return undefined;
}

/** A set-up for the bench's units. A change must name a unit; a start may name none. */
function parseBench(
  x: unknown,
  allowEmpty = false,
): Partial<Record<'A' | 'B', UnitSetup>> | undefined {
  if (!isObj(x) || (!allowEmpty && Object.keys(x).length === 0)) return undefined;
  const out: Partial<Record<'A' | 'B', UnitSetup>> = {};
  for (const k of Object.keys(x)) {
    if (k !== 'A' && k !== 'B') return undefined;
    const u = parseUnitSetup(x[k]);
    if (typeof u === 'string') return undefined;
    out[k] = u;
  }
  return out;
}

const isMirek = (x: unknown): x is number => isInt(x, 1, 0xfffe);

function parseIntent(x: unknown): Intent | undefined {
  if (!isObj(x)) return undefined;
  switch (x['kind']) {
    case 'level': {
      const live = x['live'];
      if (!isInt(x['address'], 0, 63) || !isInt(x['arc'], 0, 254)) return undefined;
      if (live !== undefined && !isBool(live)) return undefined;
      return live === undefined
        ? { kind: 'level', address: x['address'], arc: x['arc'] }
        : { kind: 'level', address: x['address'], arc: x['arc'], live };
    }
    case 'tc':
      return isInt(x['address'], 0, 63) && isMirek(x['mirek'])
        ? { kind: 'tc', address: x['address'], mirek: x['mirek'] }
        : undefined;
    case 'rgbwaf': {
      const channels = parseChannels(x['channels']);
      return isInt(x['address'], 0, 63) && channels !== undefined
        ? { kind: 'rgbwaf', address: x['address'], channels }
        : undefined;
    }
    case 'apply': {
      const { address, fade, arc, mirek, channels } = x;
      if (!isInt(address, 0, 63)) return undefined;
      const f = fade === undefined ? undefined : parseFade(fade);
      const ch = channels === undefined ? undefined : parseChannels(channels);
      if (fade !== undefined && f === undefined) return undefined;
      if (channels !== undefined && ch === undefined) return undefined;
      if (arc !== undefined && !isInt(arc, 0, 254)) return undefined;
      if (mirek !== undefined && !isMirek(mirek)) return undefined;
      return {
        kind: 'apply',
        address,
        ...(f === undefined ? {} : { fade: f }),
        ...(arc === undefined ? {} : { arc }),
        ...(mirek === undefined ? {} : { mirek }),
        ...(ch === undefined ? {} : { channels: ch }),
      };
    }
    case 'raw':
      return isInt(x['a'], 0, 255) && isInt(x['b'], 0, 255)
        ? { kind: 'raw', a: x['a'], b: x['b'] }
        : undefined;
    case 'commands': {
      const list = x['commands'];
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_COMMANDS) return undefined;
      const commands: Command[] = [];
      for (const c of list) {
        const p = parseCommand(c);
        if (p === undefined) return undefined;
        commands.push(p);
      }
      const label = x['label'];
      if (label !== undefined && !isStr(label, 200)) return undefined;
      return label === undefined
        ? { kind: 'commands', commands }
        : { kind: 'commands', commands, label };
    }
    default:
      return undefined;
  }
}

function parseAliases(x: unknown): Alias[] | undefined {
  if (!Array.isArray(x) || x.length > MAX_ALIASES) return undefined;
  const out: Alias[] = [];
  for (const a of x) {
    if (!Array.isArray(a) || a.length !== 2) return undefined;
    const [name, n] = a as unknown[];
    if (!isStr(name, 60) || aliasProblem(name) !== undefined || !isInt(n, 0, 63)) return undefined;
    out.push([name, n]);
  }
  return out;
}

/** A parse context with aliases and no `use` default. */
export function aliasContext(aliases: readonly Alias[]): ParseContext {
  return { aliases: new Map(aliases.map(([name, n]) => [name.toLowerCase(), n])) };
}

/**
 * The parse context for a console line or a script, built in the worker from what the page sent. A
 * `use` default that does not parse is an error, not a silent change of target.
 */
export function consoleContext(
  aliases: readonly Alias[],
  use?: string,
): { ok: true; ctx: ParseContext } | { ok: false; reason: string } {
  const map = aliasContext(aliases).aliases;
  if (use === undefined) return { ok: true, ctx: { aliases: map } };
  const t = parseTarget(use, { aliases: map });
  if (!t.ok) return { ok: false, reason: `The use default: ${t.error}` };
  return { ok: true, ctx: { aliases: map, use: t.value } };
}

function parseCall(x: unknown): Call | undefined {
  if (!isObj(x)) return undefined;
  switch (x['op']) {
    case 'setTarget':
      return typeof x['target'] === 'string' && TARGETS.includes(x['target'])
        ? { op: 'setTarget', target: x['target'] as OutputTarget }
        : undefined;
    case 'reconnect':
    case 'resume':
    case 'scriptContinue':
    case 'stopConsole':
    case 'rescan':
    case 'reapplyProfile':
    case 'checkReport':
    case 'clearCheck':
    case 'clearDivergences':
      return { op: x['op'] };
    case 'setCeiling':
      return isInt(x['arc'], 1, 254) && isBool(x['confirmed'])
        ? { op: 'setCeiling', arc: x['arc'], confirmed: x['confirmed'] }
        : undefined;
    case 'unlock':
      return isUnlock(x['unlock']) && isBool(x['confirmed'])
        ? { op: 'unlock', unlock: x['unlock'], confirmed: x['confirmed'] }
        : undefined;
    case 'lock':
      if (x['unlock'] === undefined) return { op: 'lock' };
      return isUnlock(x['unlock']) ? { op: 'lock', unlock: x['unlock'] } : undefined;
    case 'swingLimit':
      return isInt(x['n'], 1, 3) ? { op: 'swingLimit', n: x['n'] } : undefined;
    case 'canSee':
      return isBool(x['can']) ? { op: 'canSee', can: x['can'] } : undefined;
    case 'request': {
      const intent = parseIntent(x['intent']);
      return intent === undefined ? undefined : { op: 'request', intent };
    }
    case 'commission':
      return isStr(x['typed'], 64) ? { op: 'commission', typed: x['typed'] } : undefined;
    case 'bench': {
      const setup = parseBench(x['setup']);
      return setup === undefined ? undefined : { op: 'bench', setup };
    }
    case 'console': {
      const { line, use, confirmed } = x;
      const aliases = parseAliases(x['aliases']);
      if (!isStr(line, MAX_LINE) || aliases === undefined) return undefined;
      if (use !== undefined && !isStr(use, MAX_USE)) return undefined;
      if (confirmed !== undefined && !isBool(confirmed)) return undefined;
      return {
        op: 'console',
        line,
        aliases,
        ...(use === undefined ? {} : { use }),
        ...(confirmed === undefined ? {} : { confirmed }),
      };
    }
    case 'runScript': {
      const { name, text } = x;
      const aliases = parseAliases(x['aliases']);
      if (!isStr(name, 60) || scriptNameProblem(name) !== undefined) return undefined;
      // Characters here; the parser checks the size in bytes.
      if (!isStr(text, MAX_BYTES) || aliases === undefined) return undefined;
      return { op: 'runScript', name, text, aliases };
    }
    case 'check': {
      const { step, confirmed, note, skip } = x;
      if (!isStr(step, 64)) return undefined;
      if (confirmed !== undefined && !isBool(confirmed)) return undefined;
      if (note !== undefined && !isStr(note, 2000)) return undefined;
      if (skip !== undefined && !isBool(skip)) return undefined;
      return {
        op: 'check',
        step,
        ...(confirmed === undefined ? {} : { confirmed }),
        ...(note === undefined ? {} : { note }),
        ...(skip === undefined ? {} : { skip }),
      };
    }
    default:
      return undefined;
  }
}

/** The worker's one check on what the page sends. */
export function parseToWorker(x: unknown): ToWorker | undefined {
  if (!isObj(x)) return undefined;
  switch (x['type']) {
    case 'init': {
      const t = x['token'];
      const arc = x['ceilingArc'];
      const b = x['bench'];
      if (t !== undefined && !(t instanceof Uint8Array && t.length === 32)) return undefined;
      // A session never starts above the default ceiling: a higher one needs a person's
      // confirmation once the app is running (ADR 0013, security review S5-L2).
      if (arc !== undefined && !isInt(arc, 1, DEFAULT_CEILING_ARC)) return undefined;
      const bench = b === undefined ? undefined : parseBench(b, true);
      if (b !== undefined && bench === undefined) return undefined;
      return {
        type: 'init',
        ...(t === undefined ? {} : { token: t.slice() }),
        ...(arc === undefined ? {} : { ceilingArc: arc }),
        ...(bench === undefined ? {} : { bench }),
      };
    }
    case 'heartbeat':
      return isBool(x['visible']) ? { type: 'heartbeat', visible: x['visible'] } : undefined;
    case 'panic':
      return isId(x['id']) ? { type: 'panic', id: x['id'] } : undefined;
    case 'call': {
      const call = parseCall(x['call']);
      return isId(x['id']) && call !== undefined ? { type: 'call', id: x['id'], call } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The page's one check on what the worker sends. The worker is our own code, so this checks the shape
 * the page relies on, not every field: the page shows all of it as text.
 */
export function parseFromWorker(x: unknown): FromWorker | undefined {
  if (!isObj(x)) return undefined;
  switch (x['type']) {
    case 'snapshot': {
      const s = x['snapshot'];
      if (!isObj(s) || typeof s['target'] !== 'string' || !TARGETS.includes(s['target']))
        return undefined;
      for (const k of [
        'devices',
        'divergences',
        'jobs',
        'check',
        'monitor',
        'console',
        'notices',
        'unlocks',
        'light',
        'feedback',
        'bench',
      ])
        if (!Array.isArray(s[k])) return undefined;
      if (!isBool(s['latched']) || !isInt(s['ceilingArc'], 1, 254)) return undefined;
      return { type: 'snapshot', snapshot: s as unknown as Snapshot };
    }
    case 'reply': {
      const r = x['result'];
      return isId(x['id']) && isObj(r) && isBool(r['ok'])
        ? { type: 'reply', id: x['id'], result: r as unknown as CallResult }
        : undefined;
    }
    case 'panicked':
      return isId(x['id']) ? { type: 'panicked', id: x['id'] } : undefined;
    default:
      return undefined;
  }
}

/** The session token from the URL fragment: exactly 64 lowercase hex characters. */
export function parseToken(hex: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
