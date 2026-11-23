/**
 * The worker's check on what the page sends (ADR 0010). It is apart from `protocol.ts` so the page,
 * which only needs the message types and its own check on what the worker sends, does not carry the
 * checks on looks, sequences and effects in its first chunk (ADR 0020).
 */
import { aliasProblem } from '../console/parse.ts';
import { MAX_LINE } from '../console/history.ts';
import type { Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { parsePlates } from '../switch/schema.ts';
import { parseLook, parseRunDef, parseTarget as parseAddress } from '../design/schema.ts';
import { DEFAULT_CEILING_ARC } from '../safety/governor.ts';
import { MAX_BYTES, scriptNameProblem } from '../script/parse.ts';
import { parseExtras, parseUnitSetup, type UnitSetup } from '../sim/settings.ts';
import type { Channels, FadeSetting, Intent, OutputTarget } from './engine.ts';
import {
  isBool,
  isId,
  isInt,
  isObj,
  isStr,
  isUnlock,
  MAX_ALIASES,
  MAX_USE,
  TARGETS,
  type Alias,
  type Call,
  type ToWorker,
} from './protocol.ts';

/** The most commands one request may carry. A transaction is a short group of frames. */
export const MAX_COMMANDS = 16;
/** The most sequences and effects a set of plates can name. */
export const MAX_SWITCH_RUNS = 32;

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
    case 'sceneWrite': {
      const look = parseLook(x['look']);
      const { address, slot } = x;
      if (!look.ok || !isInt(address, 0, 63) || !isInt(slot, 0, 15)) return undefined;
      return { op: 'sceneWrite', address, slot, look: look.value };
    }
    case 'sceneRemove': {
      const { address, slot } = x;
      if (!isInt(address, 0, 63) || !isInt(slot, 0, 15)) return undefined;
      return { op: 'sceneRemove', address, slot };
    }
    case 'sceneRead':
      return isInt(x['address'], 0, 63) ? { op: 'sceneRead', address: x['address'] } : undefined;
    case 'sceneRecall': {
      const target = parseAddress(x['target']);
      const slot = x['slot'];
      const fade = x['fade'] === undefined ? undefined : parseFade(x['fade']);
      if (!target.ok || !isInt(slot, 0, 15)) return undefined;
      if (x['fade'] !== undefined && fade === undefined) return undefined;
      return {
        op: 'sceneRecall',
        target: target.value,
        slot,
        ...(fade === undefined ? {} : { fade }),
      };
    }
    case 'planCheck':
    case 'runPlan': {
      const run = parseRunDef(x['run']);
      return run.ok ? { op: x['op'], run: run.value } : undefined;
    }
    case 'stopRun':
      return { op: 'stopRun' };
    case 'switchPlates': {
      const plates = parsePlates(x['plates']);
      const runs = x['runs'];
      if (!plates.ok || !Array.isArray(runs) || runs.length > MAX_SWITCH_RUNS) return undefined;
      const defs = [];
      for (const r of runs) {
        const d = parseRunDef(r);
        if (!d.ok) return undefined;
        defs.push(d.value);
      }
      return { op: 'switchPlates', plates: plates.value, runs: defs };
    }
    case 'switchInput': {
      const { plate, button, down } = x;
      if (!isStr(plate, 16) || !isInt(button, 0, 3) || !isBool(down)) return undefined;
      return { op: 'switchInput', plate, button, down };
    }
    case 'extras': {
      const extras = parseExtras(x['extras']);
      return typeof extras === 'string' ? undefined : { op: 'extras', extras };
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
      const extras = x['extras'] === undefined ? undefined : parseExtras(x['extras']);
      if (typeof extras === 'string') return undefined;
      return {
        type: 'init',
        ...(t === undefined ? {} : { token: t.slice() }),
        ...(arc === undefined ? {} : { ceilingArc: arc }),
        ...(bench === undefined ? {} : { bench }),
        ...(extras === undefined ? {} : { extras }),
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
