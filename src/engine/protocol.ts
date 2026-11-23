/**
 * Messages between the page and the bus worker (ADR 0010). Each side has one function that posts and
 * one that receives, and every message received is checked here before it is used. A message that does
 * not pass is dropped.
 *
 * Everything the page asks for comes from a person, so the worker gives it the source `ui`, or
 * `console` for a typed console line. A script's steps run with the source `script` (ADR 0014).
 */
import type { Address } from '../dali/address.ts';
import { parseTarget, type ParseContext } from '../console/parse.ts';
import type { Look } from '../design/look.ts';
import type { Plate } from '../switch/plate.ts';
import type { Outcome } from '../safety/governor.ts';
import type { Unlock } from '../safety/types.ts';
import type { ExtraUnit, UnitSetup } from '../sim/settings.ts';
import type {
  FadeSetting,
  Intent,
  OutputTarget,
  RequestResult,
  RunDef,
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
  /** Write a look to one slot of one driver, and read it back (SPEC R5.2). */
  | {
      readonly op: 'sceneWrite';
      readonly address: number;
      readonly slot: number;
      readonly look: Look;
    }
  | { readonly op: 'sceneRemove'; readonly address: number; readonly slot: number }
  | { readonly op: 'sceneRead'; readonly address: number }
  /** Recall a slot by address, group or broadcast, with the look's fade set first (SPEC R5.3). */
  | {
      readonly op: 'sceneRecall';
      readonly target: Address;
      readonly slot: number;
      readonly fade?: FadeSetting;
    }
  /** Check a sequence or effect against the governor without running it (SPEC R4.2). */
  | { readonly op: 'planCheck'; readonly run: RunDef }
  /** Start a sequence or effect. The worker plans it again from this definition. */
  | { readonly op: 'runPlan'; readonly run: RunDef }
  | { readonly op: 'stopRun' }
  /** Replace the switch plates, with the sequences and effects they name (SPEC R16). */
  | {
      readonly op: 'switchPlates';
      readonly plates: readonly Plate[];
      readonly runs: readonly RunDef[];
    }
  /** A switch button went down or up. */
  | {
      readonly op: 'switchInput';
      readonly plate: string;
      readonly button: number;
      readonly down: boolean;
    }
  /** Set the whole list of simulated drivers beyond the bench's two (SPEC R14.2). */
  | { readonly op: 'extras'; readonly extras: readonly ExtraUnit[] }
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
      /** The extra simulated drivers, from the page's stored preferences. */
      readonly extras?: readonly ExtraUnit[];
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

export type Obj = Record<string, unknown>;

export const isObj = (x: unknown): x is Obj =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
export const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
export const isId = (x: unknown): x is number => isInt(x, 0, Number.MAX_SAFE_INTEGER);
export const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
export const isStr = (x: unknown, max: number): x is string =>
  typeof x === 'string' && x.length <= max;
export const UNLOCKS: readonly string[] = ['rate', 'reset', 'expert'];
export const TARGETS: readonly string[] = ['simulator', 'hardware', 'both'];
export const isUnlock = (x: unknown): x is Unlock => typeof x === 'string' && UNLOCKS.includes(x);

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
        'extras',
        'switches',
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
