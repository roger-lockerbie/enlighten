/**
 * Console history and history expansion (docs/research/console.md sections 6 and 7, ADR 0006).
 *
 * Event numbers start at 1 when the page loads and are never reused. A duplicate of the line before
 * is dropped and uses no number. A line kept out by the leading-space rule, or the `history` command
 * itself, lingers for one Up and gives its number to the next line. Expansion is a text rewrite before
 * parsing and nothing more. It applies only to lines typed at the prompt, never to scripts or files.
 */
import type { HistLine } from './editor.ts';

/** The longest line the console takes, expanded or not. */
export const MAX_LINE = 500;
export const DEFAULT_HISTORY = 1000;

export interface HistoryEntry extends HistLine {
  /** When the line was entered, in ms since 1970, for `history -i`. */
  readonly at: number;
}

export interface StoredLine {
  readonly line: string;
  readonly at: number;
}

export interface HistoryOptions {
  /** How many lines to keep. */
  readonly limit: number;
  /** Keep lines that start with a space out of history (HIST_IGNORE_SPACE). */
  readonly ignoreSpace: boolean;
}

/**
 * Remove superfluous blanks (HIST_REDUCE_BLANKS): trim, and fold runs of blanks to one space outside
 * double quotes, so duplicates are found.
 */
export function reduceBlanks(line: string): string {
  let out = '';
  let quoted = false;
  let blank = false;
  for (const ch of line.trim()) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && /\s/.test(ch)) {
      blank = true;
      continue;
    }
    if (blank) out += ' ';
    blank = false;
    out += ch;
  }
  return out;
}

export type Added =
  | { readonly kind: 'added'; readonly entry: HistoryEntry }
  | { readonly kind: 'lingering'; readonly entry: HistoryEntry }
  | { readonly kind: 'skipped' };

export class History {
  private list: HistoryEntry[] = [];
  private nextNumber = 1;
  private linger: HistoryEntry | undefined;
  private opts: HistoryOptions;

  constructor(stored: readonly StoredLine[], opts: HistoryOptions) {
    this.opts = opts;
    for (const s of stored.slice(-opts.limit)) {
      this.list.push({ n: this.nextNumber++, line: s.line, at: s.at });
    }
  }

  /** History as the editor and expansion see it, oldest first, with a lingering line last. */
  get lines(): readonly HistoryEntry[] {
    return this.linger === undefined ? this.list : [...this.list, this.linger];
  }

  /** The lines that are kept, for storage. */
  get kept(): readonly HistoryEntry[] {
    return this.list;
  }

  get options(): HistoryOptions {
    return this.opts;
  }

  setOptions(opts: HistoryOptions): void {
    this.opts = opts;
    this.trim();
  }

  /** Add an accepted line, already expanded. */
  add(raw: string, at: number): Added {
    this.linger = undefined;
    const line = reduceBlanks(raw);
    if (line === '') return { kind: 'skipped' };
    const entry: HistoryEntry = { n: this.nextNumber, line, at };
    if ((this.opts.ignoreSpace && /^\s/.test(raw)) || /^history(\s|$)/i.test(line)) {
      this.linger = entry;
      return { kind: 'lingering', entry };
    }
    if (this.list[this.list.length - 1]?.line === line) return { kind: 'skipped' };
    this.nextNumber++;
    this.list.push(entry);
    this.trim();
    return { kind: 'added', entry };
  }

  clear(): void {
    this.list = [];
    this.linger = undefined;
  }

  private trim(): void {
    const over = this.list.length - this.opts.limit;
    if (over > 0) this.list.splice(0, over);
  }
}

/**
 * Two tabs: what is stored, then this tab's new line, with the duplicate rule and the limit applied.
 * Neither tab overwrites the other's lines (research section 7, "Two tabs").
 */
export function mergeStored(
  stored: readonly StoredLine[],
  line: StoredLine,
  limit: number,
): StoredLine[] {
  const out = [...stored];
  if (out[out.length - 1]?.line !== line.line) out.push(line);
  return out.slice(-limit);
}

// -------------------------------------------------------------------------------------------------
// Expansion

export interface Substitution {
  readonly from: string;
  readonly to: string;
}

export type Expansion =
  /** The line has no history reference and runs as typed. */
  | { readonly kind: 'none' }
  /** The expanded line. With `print`, it is shown and stored, but not run (`:p`). */
  | {
      readonly kind: 'ok';
      readonly line: string;
      readonly print: boolean;
      readonly sub?: Substitution | undefined;
    }
  | { readonly kind: 'error'; readonly message: string };

const fail = (message: string): Expansion => ({ kind: 'error', message: `enlighten: ${message}` });

/** Split a line into words as the console's lexer does: blanks, with double quotes kept together. */
export function historyWords(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let any = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && /\s/.test(ch)) {
      if (any) out.push(cur);
      cur = '';
      any = false;
      continue;
    }
    cur += ch;
    any = true;
  }
  if (any) out.push(cur);
  return out;
}

class ExpandError extends Error {}

interface Cursor {
  readonly s: string;
  i: number;
}

const isBlank = (c: string | undefined) => c === undefined || /\s/.test(c);

type WordSpec = '$' | '^' | '*';
const isWordSpec = (c: string | undefined): c is WordSpec => c === '$' || c === '^' || c === '*';

/** The event a designator names, and for the shorthand forms (`!$`, `!^`, `!*`) the word. */
function event(c: Cursor, events: readonly HistLine[]): { line: string; word?: WordSpec } {
  const s = c.s;
  const ch = s[c.i];
  const last = events[events.length - 1];
  const find = (pred: (h: HistLine) => boolean): HistLine | undefined => {
    for (let k = events.length - 1; k >= 0; k--) {
      const h = events[k];
      if (h !== undefined && pred(h)) return h;
    }
    return undefined;
  };
  if (ch === '!' || isWordSpec(ch)) {
    c.i++;
    if (last === undefined) throw new ExpandError('no such event: !');
    return isWordSpec(ch) ? { line: last.line, word: ch } : { line: last.line };
  }
  if (ch === '?') {
    const end = s.indexOf('?', c.i + 1);
    const text = end < 0 ? s.slice(c.i + 1) : s.slice(c.i + 1, end);
    c.i = end < 0 ? s.length : end + 1;
    const h = text === '' ? undefined : find((e) => e.line.includes(text));
    if (h === undefined) throw new ExpandError(`no such event: ${text}`);
    return { line: h.line };
  }
  const num = /^-?\d+/.exec(s.slice(c.i));
  if (num !== null) {
    c.i += num[0].length;
    const v = Number(num[0]);
    const h = v < 0 ? events[events.length + v] : events.find((e) => e.n === v);
    if (h === undefined) throw new ExpandError(`no such event: ${num[0]}`);
    return { line: h.line };
  }
  let j = c.i;
  while (j < s.length && !isBlank(s[j]) && s[j] !== ':') j++;
  const prefix = s.slice(c.i, j);
  c.i = j;
  const h = find((e) => e.line.startsWith(prefix));
  if (h === undefined) throw new ExpandError(`event not found: ${prefix}`);
  return { line: h.line };
}

/** The words the designator picks: `$` the last argument, `^` the first, `*` all of them. */
function words(c: Cursor, ev: { line: string; word?: WordSpec }): string {
  let w = ev.word;
  const next = c.s[c.i + 1];
  if (w === undefined && c.s[c.i] === ':' && isWordSpec(next)) {
    w = next;
    c.i += 2;
  }
  if (w === undefined) return ev.line;
  const all = historyWords(ev.line);
  if (w === '*') return all.slice(1).join(' ');
  if (all.length < 2) throw new ExpandError('bad word specifier');
  return (w === '$' ? all[all.length - 1] : all[1]) ?? '';
}

function delimited(c: Cursor, d: string): string {
  const s = c.s;
  let out = '';
  while (c.i < s.length && s[c.i] !== d) {
    if (s[c.i] === '\\' && s[c.i + 1] === d) {
      out += d;
      c.i += 2;
      continue;
    }
    out += s.charAt(c.i);
    c.i++;
  }
  if (s[c.i] === d) c.i++;
  return out;
}

function substitute(text: string, sub: Substitution, global: boolean): string {
  if (sub.from === '' || !text.includes(sub.from)) throw new ExpandError('substitution failed');
  return global ? text.split(sub.from).join(sub.to) : text.replace(sub.from, () => sub.to);
}

/** `:s/l/r/`, `:gs/l/r/`, `:&`, `:g&` and `:p`, any number of them. */
function modifiers(
  c: Cursor,
  text0: string,
  state: { sub: Substitution | undefined; print: boolean },
): string {
  const s = c.s;
  let text = text0;
  while (s[c.i] === ':') {
    const m = s.slice(c.i + 1);
    if (m.startsWith('p')) {
      c.i += 2;
      state.print = true;
      continue;
    }
    const global = m.startsWith('g');
    const rest = global ? m.slice(1) : m;
    if (rest.startsWith('&')) {
      if (state.sub === undefined) throw new ExpandError('no previous substitution');
      c.i += global ? 3 : 2;
      text = substitute(text, state.sub, global);
      continue;
    }
    if (rest.startsWith('s') && rest.length > 1) {
      c.i += global ? 3 : 2;
      const d = s[c.i] ?? '/';
      c.i++;
      const l = delimited(c, d);
      const r = delimited(c, d);
      const from = l === '' ? (state.sub?.from ?? '') : l;
      // `&` on the right means the left side; `\&` is a plain ampersand.
      const to = r.replace(/\\&|&/g, (x) => (x === '&' ? from : '&'));
      state.sub = { from, to };
      text = substitute(text, state.sub, global);
      continue;
    }
    break;
  }
  return text;
}

/**
 * Expand history references in a typed line. `events` is the history as the editor walks it, oldest
 * first. `sub` is the last substitution, for `:&`.
 */
export function expand(line: string, events: readonly HistLine[], sub?: Substitution): Expansion {
  const state: { sub: Substitution | undefined; print: boolean } = { sub, print: false };
  try {
    let out = '';
    let changed = false;
    let i = 0;
    // ^old^new^ at the start repeats the last line with a substitution (the same as !!:s^old^new^).
    if (line.startsWith('^')) {
      const last = events[events.length - 1];
      if (last === undefined) throw new ExpandError('no such event: !');
      const c: Cursor = { s: line, i: 1 };
      const from = delimited(c, '^');
      const to = delimited(c, '^');
      state.sub = { from, to };
      out = substitute(last.line, state.sub, false);
      out += modifiers(c, '', state);
      i = c.i;
      changed = true;
    }
    let quoted: string | undefined;
    while (i < line.length) {
      const ch = line.charAt(i);
      if (quoted === "'") {
        out += ch;
        if (ch === "'") quoted = undefined;
        i++;
        continue;
      }
      if (ch === "'") quoted = "'";
      if (ch === '\\' && line[i + 1] === '!') {
        out += '!';
        i += 2;
        changed = true;
        continue;
      }
      const after = line[i + 1];
      if (ch !== '!' || isBlank(after) || after === '=' || after === '(') {
        out += ch;
        i++;
        continue;
      }
      const c: Cursor = { s: line, i: i + 1 };
      const ev = event(c, events);
      const picked = words(c, ev);
      out += modifiers(c, picked, state);
      i = c.i;
      changed = true;
    }
    if (!changed) return { kind: 'none' };
    if (out.length > MAX_LINE) throw new ExpandError('the expanded line is too long');
    return { kind: 'ok', line: out, print: state.print, sub: state.sub };
  } catch (e) {
    if (e instanceof ExpandError) return fail(e.message);
    throw e;
  }
}

// -------------------------------------------------------------------------------------------------
// The `history` command (research section 7)

export interface HistoryListOptions {
  readonly numbers: boolean;
  readonly reverse: boolean;
  readonly times: boolean;
}

/**
 * Lines for `history [first [last]] [-n] [-r] [-i]`. With no range, the last 16. A positive number is
 * an event number, a negative one counts back. `time` formats a timestamp for `-i`.
 */
export function historyList(
  entries: readonly HistoryEntry[],
  args: readonly string[],
  time: (at: number) => string,
): { ok: true; lines: string[] } | { ok: false; error: string } {
  const opts = { numbers: true, reverse: false, times: false };
  const range: number[] = [];
  for (const a of args) {
    if (/^-[nri]+$/.test(a)) {
      for (const f of a.slice(1)) {
        if (f === 'n') opts.numbers = false;
        if (f === 'r') opts.reverse = true;
        if (f === 'i') opts.times = true;
      }
      continue;
    }
    if (!/^-?\d+$/.test(a)) return { ok: false, error: `history: bad option: ${a}` };
    range.push(Number(a));
  }
  if (range.length > 2) return { ok: false, error: 'history: too many arguments' };
  const lastN = entries[entries.length - 1]?.n ?? 0;
  const resolve = (v: number) => (v < 0 ? lastN + v + 1 : v);
  const first = range[0] === undefined ? lastN - 15 : resolve(range[0]);
  const last = range[1] === undefined ? lastN : resolve(range[1]);
  let picked = entries.filter((e) => e.n >= first && e.n <= last);
  if (opts.reverse) picked = [...picked].reverse();
  return {
    ok: true,
    lines: picked.map((e) => {
      const num = opts.numbers ? `${String(e.n).padStart(5)}  ` : '';
      const at = opts.times ? `${time(e.at)}  ` : '';
      return `${num}${at}${e.line}`;
    }),
  };
}
