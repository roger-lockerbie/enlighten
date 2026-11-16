/**
 * Replies as the console prints them (SPEC section 6, "Replies"): the decoded meaning and the raw
 * byte, for example `actual level 170 (10.1%) [0xAA]`. No reply prints `no reply`. Two answers at once
 * print as a framing error. A fault and a refusal are printed by the executor, never as "no reply".
 */
import { percentText } from '../dali/curve.ts';
import { spec } from '../dali/commands.ts';
import { extendedFadeMs, fadeRateStepsPerSecond, fadeTimeMs } from '../dali/fade.ts';
import { decodeColourTypeFeatures, decodeFadeTimeRate, decodeStatus } from '../dali/reply.ts';
import { msText } from './values.ts';

export type Answer = number | 'none' | 'collision';

export const NO_REPLY = 'no reply';
export const COLLISION = 'framing error (more than one device answered?)';

const hex = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;

/** Levels: an arc level with its output, where 255 means "none" (MASK). */
const LEVELS = new Set([
  'QUERY_ACTUAL_LEVEL',
  'QUERY_MAX_LEVEL',
  'QUERY_MIN_LEVEL',
  'QUERY_PHYSICAL_MINIMUM',
  'QUERY_POWER_ON_LEVEL',
  'QUERY_SYSTEM_FAILURE_LEVEL',
  'QUERY_SCENE_LEVEL',
]);

/** "QUERY ACTUAL LEVEL" as "actual level". */
export function replyName(id: string): string {
  return spec(id)
    .label.replace(/^QUERY /, '')
    .toLowerCase();
}

function levelText(v: number): string {
  if (v === 255) return 'none (MASK)';
  if (v === 0) return '0 (off)';
  return `${String(v)} (${percentText(v)}%)`;
}

function meaning(id: string, v: number): string {
  if (LEVELS.has(id)) return levelText(v);
  switch (id) {
    case 'QUERY_STATUS': {
      const s = decodeStatus(v);
      const on = Object.entries({
        'gear failure': s.gearFailure,
        'lamp failure': s.lampFailure,
        'lamp on': s.lampOn,
        'limit error': s.limitError,
        'fade running': s.fadeRunning,
        'reset state': s.resetState,
        'no short address': s.missingShortAddress,
        'power failure': s.powerFailure,
      })
        .filter(([, set]) => set)
        .map(([k]) => k);
      return on.length === 0 ? 'nothing set' : on.join(', ');
    }
    case 'QUERY_FADE_TIME_FADE_RATE': {
      const f = decodeFadeTimeRate(v);
      const t = f.fadeTime === 0 ? 'none' : msText(fadeTimeMs(f.fadeTime));
      const r =
        f.fadeRate === 0
          ? 'none'
          : `${String(Math.round(fadeRateStepsPerSecond(f.fadeRate) * 10) / 10)} steps/s`;
      return `fade time ${String(f.fadeTime)} (${t}), fade rate ${String(f.fadeRate)} (${r})`;
    }
    case 'QUERY_EXTENDED_FADE_TIME': {
      const ms = extendedFadeMs(v);
      return `${String(v)} (${ms === 0 ? 'none' : msText(ms)})`;
    }
    case 'QUERY_GROUPS_0_7':
    case 'QUERY_GROUPS_8_15': {
      const base = id === 'QUERY_GROUPS_0_7' ? 0 : 8;
      const gs = [0, 1, 2, 3, 4, 5, 6, 7]
        .filter((b) => (v & (1 << b)) !== 0)
        .map((b) => `g${String(base + b)}`);
      return gs.length === 0 ? 'none' : gs.join(' ');
    }
    case 'QUERY_DEVICE_TYPE':
    case 'QUERY_NEXT_DEVICE_TYPE':
      return v === 255 ? 'several' : v === 254 ? 'none left' : `DT${String(v)}`;
    case 'DT8_QUERY_COLOUR_TYPE_FEATURES': {
      const f = decodeColourTypeFeatures(v);
      const parts: string[] = [];
      if (f.xy) parts.push('xy');
      if (f.tc) parts.push('Tc');
      if (f.primaries > 0) parts.push(`${String(f.primaries)} primaries`);
      if (f.rgbwafChannels > 0) parts.push(`${String(f.rgbwafChannels)} RGBWAF channels`);
      return parts.length === 0 ? 'none' : parts.join(', ');
    }
    default:
      return String(v);
  }
}

/** One reply as text. */
export function replyText(id: string, a: Answer): string {
  const name = replyName(id);
  if (a === 'collision') return `${name}: ${COLLISION}`;
  const s = spec(id);
  if (s.reply === 'yesno')
    return `${name}: ${a === 'none' ? 'no' : 'yes'}${a === 'none' ? '' : ` [${hex(a)}]`}`;
  if (a === 'none') return `${name}: ${NO_REPLY}`;
  return `${name} ${meaning(id, a)} [${hex(a)}]`;
}

/** Bus results as the trace shows them. */
export { hex as hexText };
