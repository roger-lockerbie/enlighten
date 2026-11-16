/**
 * Values in the console language (SPEC section 6): `35%` is output, a bare number is an arc level,
 * `2700K` is kelvin and `370m` is mirek, and times are `300ms`, `2s` or `25min`. Each parser returns
 * the value or a sentence saying what was expected.
 */
import { percentToArcNearest } from '../dali/curve.ts';
import { kelvinToMirek } from '../dali/sequences.ts';

export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const good = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** The longest time the console waits in one step: the longest extended fade, 16 minutes. */
export const MAX_WAIT_MS = 16 * 60 * 1000;

/** A whole number written in decimal, with nothing else. */
export function int(text: string): number | undefined {
  return /^\d{1,6}$/.test(text) ? Number(text) : undefined;
}

/** An arc level from `35%` or a bare 0 to 254. */
export function level(text: string): Parsed<number> {
  const pct = /^(\d{1,3}(?:\.\d+)?)%$/.exec(text);
  if (pct?.[1] !== undefined) {
    const p = Number(pct[1]);
    if (p > 100) return bad(`${text} is more than 100%.`);
    return good(percentToArcNearest(p));
  }
  const n = int(text);
  if (n === undefined || n > 254)
    return bad(`Expected a level, such as 35% or an arc level 0 to 254, not "${text}".`);
  return good(n);
}

/** A channel level, 0 to 254. */
export function channel(text: string): Parsed<number> {
  const n = int(text);
  if (n === undefined || n > 254) return bad(`Expected a channel level 0 to 254, not "${text}".`);
  return good(n);
}

/** Mirek from `2700K` or `370m`. */
export function temperature(text: string): Parsed<number> {
  const k = /^(\d{3,5})K$/i.exec(text);
  if (k?.[1] !== undefined) {
    const kelvin = Number(k[1]);
    if (kelvin < 1000 || kelvin > 20000) return bad(`${text} is outside 1000K to 20000K.`);
    return good(kelvinToMirek(kelvin));
  }
  const m = /^(\d{1,5})m$/.exec(text);
  if (m?.[1] !== undefined) {
    const mirek = Number(m[1]);
    if (mirek < 1 || mirek > 0xfffe) return bad(`${text} is outside 1m to 65534m.`);
    return good(mirek);
  }
  return bad(`Expected a colour temperature, such as 2700K or 370m, not "${text}".`);
}

/** Milliseconds from `300ms`, `2s`, `1.5s` or `25min`. */
export function time(text: string): Parsed<number> {
  const t = /^(\d{1,5}(?:\.\d{1,3})?)(ms|s|min)$/.exec(text);
  if (t?.[1] === undefined)
    return bad(`Expected a time, such as 300ms, 2s or 25min, not "${text}".`);
  const v = Number(t[1]);
  const ms = Math.round(t[2] === 'ms' ? v : t[2] === 's' ? v * 1000 : v * 60_000);
  if (ms > MAX_WAIT_MS) return bad(`${text} is longer than 16 minutes.`);
  return good(ms);
}

/** A byte in hex, as `ff`, `FF` or `0xff`. */
export function hexByte(text: string): Parsed<number> {
  const m = /^(?:0x)?([0-9a-fA-F]{1,2})$/.exec(text);
  if (m?.[1] === undefined) return bad(`Expected a byte in hex, such as ff, not "${text}".`);
  return good(parseInt(m[1], 16));
}

/** A whole number in a range, with a name for the error. */
export function ranged(text: string, lo: number, hi: number, what: string): Parsed<number> {
  const n = int(text);
  if (n === undefined || n < lo || n > hi)
    return bad(`Expected ${what} from ${String(lo)} to ${String(hi)}, not "${text}".`);
  return good(n);
}

/** Six channel levels from `#rrggbb`: red, green and blue, with the whites off. */
export function colour(text: string): Parsed<[number, number, number]> {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(text);
  if (m === null) return bad(`Expected a colour as #rrggbb, not "${text}".`);
  // 255 is DALI's mask ("leave as it is"), so full on is 254.
  const v = (h: string | undefined) => Math.min(254, parseInt(h ?? '0', 16));
  return good([v(m[1]), v(m[2]), v(m[3])]);
}

/** A time for people: 300 ms, 2 s, 1.5 s, 4 min 30 s. */
export function msText(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))} ms`;
  if (ms < 60_000) {
    const s = Math.round(ms / 100) / 10;
    return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  const min = Math.floor(ms / 60_000);
  const s = Math.round((ms - min * 60_000) / 1000);
  return s === 0 ? `${String(min)} min` : `${String(min)} min ${String(s)} s`;
}
