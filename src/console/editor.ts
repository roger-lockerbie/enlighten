/**
 * The console's line editor (ADR 0006, docs/research/console.md sections 1 to 5). A state value and a
 * function from a widget to a new state. The component turns DOM keys into widgets with `widgetFor`
 * and writes the result back to a real `<input>`. Pure: no DOM and no time.
 *
 * Departures from zsh, all from the research: undo groups typed runs and has a redo key, Escape cancels
 * a search, and Ctrl-C ends a search as Ctrl-G does.
 */
import type { Widget } from './keys.ts';

/** One line of history as the editor walks it: its fixed event number and its text. */
export interface HistLine {
  readonly n: number;
  readonly line: string;
}

/** Characters that count as part of a word, besides letters and digits (research section 2). */
export const WORDCHARS = '-_';
/** zsh keeps eight kills. */
export const KILL_RING = 8;
/** The most undo steps kept for one line. */
export const UNDO_LIMIT = 200;

export interface Search {
  readonly dir: 'back' | 'fwd';
  readonly query: string;
  /** The event number of the line found, or undefined if none yet. */
  readonly hit: number | undefined;
  readonly failing: boolean;
  /** Where the match starts in the found line. */
  readonly at: number;
  /** The line as it was before the search, for a cancel. */
  readonly origin: {
    readonly buffer: string;
    readonly cursor: number;
    readonly hist: number | null;
  };
  /** Earlier search states, for Backspace. */
  readonly back: readonly Omit<Search, 'back' | 'origin'>[];
}

interface Snap {
  readonly buffer: string;
  readonly cursor: number;
  /** The history line the change was made on, or null for the new line. */
  readonly hist: number | null;
}

export interface EditorState {
  readonly buffer: string;
  readonly cursor: number;
  /** The history line showing, by event number, or null for the line being typed. */
  readonly hist: number | null;
  /** What the new line held before the walk through history started. */
  readonly draft: string;
  /** Edits made to history lines during this walk, by event number. Dropped on accept. */
  readonly edits: Readonly<Record<number, string>>;
  readonly cut: string;
  readonly ring: readonly string[];
  /** The widget before this one, for kill chaining, yank-pop, insert-last-word and typing runs. */
  readonly last: Widget | 'insert' | 'input' | undefined;
  readonly lastYank?:
    { readonly start: number; readonly end: number; readonly index: number } | undefined;
  readonly lastWord?:
    { readonly start: number; readonly end: number; readonly back: number } | undefined;
  readonly lastFirstWord?: string | undefined;
  readonly undo: readonly Snap[];
  readonly redo: readonly Snap[];
  readonly search?: Search | undefined;
  readonly lastQuery: string;
  /** Lines parked by push-line, newest last. */
  readonly pushed: readonly string[];
}

export type Effect =
  | { readonly kind: 'accept'; readonly line: string; readonly andDown?: number }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'clear' }
  | { readonly kind: 'interrupt' }
  | { readonly kind: 'release' }
  | { readonly kind: 'help'; readonly topic: string }
  | { readonly kind: 'beep' }
  | { readonly kind: 'message'; readonly text: string };

export interface Completion {
  /** The range of the buffer to replace, and what to put there. */
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Every candidate, when there is more than one. */
  readonly items: readonly string[];
}

export interface EditorContext {
  /** History, oldest first. */
  readonly history: readonly HistLine[];
  /** Completion at the cursor, or undefined when there is nothing to complete. */
  readonly complete?: (buffer: string, cursor: number) => Completion | undefined;
  /** History expansion of the whole buffer, for expand-history. */
  readonly expand?: (buffer: string) => { ok: true; line: string } | { ok: false; error: string };
}

export interface Result {
  readonly state: EditorState;
  readonly effect?: Effect;
}

export function emptyEditor(): EditorState {
  return {
    buffer: '',
    cursor: 0,
    hist: null,
    draft: '',
    edits: {},
    cut: '',
    ring: [],
    last: undefined,
    undo: [],
    redo: [],
    lastQuery: '',
    pushed: [],
  };
}

// -------------------------------------------------------------------------------------------------
// Words

export function isWordChar(c: string | undefined): boolean {
  return c !== undefined && (/^[\p{L}\p{N}]$/u.test(c) || WORDCHARS.includes(c));
}

/** zsh's forward-word: over the rest of this word, then over the gap to the next. */
export function nextWordStart(s: string, i: number): number {
  let j = i;
  while (j < s.length && isWordChar(s[j])) j++;
  while (j < s.length && !isWordChar(s[j])) j++;
  return j;
}

/** The end of the word at or after the cursor: over the gap, then over the word. */
export function wordEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && !isWordChar(s[j])) j++;
  while (j < s.length && isWordChar(s[j])) j++;
  return j;
}

/** The start of the word before the cursor: back over the gap, then back over the word. */
export function wordStart(s: string, i: number): number {
  let j = i;
  while (j > 0 && !isWordChar(s[j - 1])) j--;
  while (j > 0 && isWordChar(s[j - 1])) j--;
  return j;
}

// -------------------------------------------------------------------------------------------------
// Helpers

const clampCursor = (s: string, c: number) => Math.max(0, Math.min(s.length, c));

function snap(st: EditorState): Snap {
  return { buffer: st.buffer, cursor: st.cursor, hist: st.hist };
}

/** Record an undo step and set the new text. `group` continues a typed run. */
function change(st: EditorState, buffer: string, cursor: number, group = false): EditorState {
  if (buffer === st.buffer && !group) return { ...st, cursor: clampCursor(buffer, cursor) };
  const undo = group ? st.undo : [...st.undo, snap(st)].slice(-UNDO_LIMIT);
  return { ...st, buffer, cursor: clampCursor(buffer, cursor), undo, redo: [] };
}

function lineText(st: EditorState, ctx: EditorContext, hist: number | null): string {
  if (hist === null) return st.draft;
  return st.edits[hist] ?? ctx.history.find((h) => h.n === hist)?.line ?? '';
}

/** Leave the showing line, keeping what was typed on it, and show another. */
function goToLine(st: EditorState, ctx: EditorContext, hist: number | null): EditorState {
  const kept =
    st.hist === null
      ? { draft: st.buffer, edits: st.edits }
      : { draft: st.draft, edits: { ...st.edits, [st.hist]: st.buffer } };
  const next = { ...st, ...kept, hist };
  const text = lineText(next, ctx, hist);
  return { ...next, buffer: text, cursor: text.length };
}

function histIndex(ctx: EditorContext, hist: number | null): number {
  if (hist === null) return ctx.history.length;
  const i = ctx.history.findIndex((h) => h.n === hist);
  return i < 0 ? ctx.history.length : i;
}

function kill(st: EditorState, from: number, to: number, backward: boolean): EditorState {
  if (from >= to) return st;
  const text = st.buffer.slice(from, to);
  const chained = isKill(st.last);
  let cut: string;
  let ring = st.ring;
  if (chained) cut = backward ? text + st.cut : st.cut + text;
  else {
    if (st.cut !== '') ring = [st.cut, ...ring].slice(0, KILL_RING - 1);
    cut = text;
  }
  const changed = change(st, st.buffer.slice(0, from) + st.buffer.slice(to), from);
  return { ...changed, cut, ring };
}

const KILLS: readonly Widget[] = [
  'backward-kill-word',
  'kill-word',
  'kill-line',
  'kill-whole-line',
];
const isKill = (w: EditorState['last']) =>
  w !== undefined && (KILLS as readonly string[]).includes(w);

function caseWord(st: EditorState, f: (w: string) => string): EditorState {
  let s = st.cursor;
  while (s < st.buffer.length && !isWordChar(st.buffer[s])) s++;
  const e = wordEnd(st.buffer, s);
  if (s >= e) return { ...st, cursor: e };
  const out = st.buffer.slice(0, s) + f(st.buffer.slice(s, e)) + st.buffer.slice(e);
  return change(st, out, e);
}

function firstWord(s: string): string {
  return s.trimStart().split(/\s+/)[0] ?? '';
}

function lastWordOf(s: string): string {
  const words = s.trim().split(/\s+/);
  return words[words.length - 1] ?? '';
}

// -------------------------------------------------------------------------------------------------
// Typing

/** Type text at the cursor. A run of typed characters is one undo step, broken at a space. */
export function insert(st0: EditorState, text: string): EditorState {
  const st = st0.search === undefined ? st0 : endSearch(st0);
  if (text === '') return st;
  const group = st.last === 'insert' && text.length === 1 && text !== ' ';
  const out = st.buffer.slice(0, st.cursor) + text + st.buffer.slice(st.cursor);
  return { ...change(st, out, st.cursor + text.length, group), last: 'insert' };
}

/**
 * What the input holds after the browser edited it (typing, IME, paste, a cut). A single character
 * typed at the cursor joins the typed run; anything else is its own undo step.
 */
export function input(st: EditorState, value: string, cursor: number): EditorState {
  if (value === st.buffer) return { ...st, cursor: clampCursor(value, cursor) };
  const typed =
    value.length === st.buffer.length + 1 &&
    cursor === st.cursor + 1 &&
    value.slice(0, st.cursor) === st.buffer.slice(0, st.cursor) &&
    value.slice(cursor) === st.buffer.slice(st.cursor);
  if (typed) return insert(st, value.charAt(st.cursor));
  return { ...change(st, value, cursor), last: 'input' };
}

/** Back to an empty new line after a line was accepted, with a parked line restored. */
export function afterAccept(st: EditorState, next?: HistLine): EditorState {
  const pushed = [...st.pushed];
  const back = pushed.pop() ?? '';
  const base: EditorState = {
    ...st,
    buffer: back,
    cursor: back.length,
    hist: null,
    draft: '',
    edits: {},
    last: undefined,
    undo: [],
    redo: [],
    pushed,
    search: undefined,
    lastYank: undefined,
    lastWord: undefined,
    lastFirstWord: undefined,
  };
  if (next === undefined || back !== '') return base;
  return { ...base, hist: next.n, buffer: next.line, cursor: next.line.length };
}

// -------------------------------------------------------------------------------------------------
// Incremental search (research section 5)

function caseless(q: string): boolean {
  return q === q.toLowerCase();
}

function find(line: string, query: string): number {
  const anchored = query.startsWith('^');
  const q = anchored ? query.slice(1) : query;
  const hay = caseless(q) ? line.toLowerCase() : line;
  if (anchored) return hay.startsWith(q) ? 0 : -1;
  return hay.indexOf(q);
}

/** Search from history index `from` (inclusive) in a direction, skipping the line now showing. */
function searchFrom(
  ctx: EditorContext,
  query: string,
  dir: 'back' | 'fwd',
  from: number,
  showing: string,
): { hit: number; at: number } | undefined {
  const step = dir === 'back' ? -1 : 1;
  for (let i = from; i >= 0 && i < ctx.history.length; i += step) {
    const h = ctx.history[i];
    if (h === undefined) continue;
    // A line the same as the one showing is skipped (HIST_FIND_NO_DUPS).
    if (h.line === showing) continue;
    const at = find(h.line, query);
    if (at >= 0) return { hit: h.n, at };
  }
  return undefined;
}

function startSearch(st: EditorState, dir: 'back' | 'fwd'): EditorState {
  const search: Search = {
    dir,
    query: '',
    hit: undefined,
    failing: false,
    at: 0,
    origin: { buffer: st.buffer, cursor: st.cursor, hist: st.hist },
    back: [],
  };
  return { ...st, search };
}

function showHit(st: EditorState, ctx: EditorContext, s: Search): EditorState {
  if (s.hit === undefined) return { ...st, search: s };
  const line = ctx.history.find((h) => h.n === s.hit)?.line ?? '';
  return { ...st, search: s, buffer: line, cursor: s.at, hist: s.hit };
}

type SearchStep = Search['back'][number];

function stepOf(s: Search): SearchStep {
  return { dir: s.dir, query: s.query, hit: s.hit, failing: s.failing, at: s.at };
}

function searchAgain(
  st: EditorState,
  ctx: EditorContext,
  s: Search,
  dir: 'back' | 'fwd',
): EditorState {
  const query = s.query === '' ? st.lastQuery : s.query;
  if (query === '') return { ...st, search: { ...s, dir } };
  const here = s.hit === undefined ? histIndex(ctx, st.hist) : histIndex(ctx, s.hit);
  const from = dir === 'back' ? here - 1 : here + 1;
  const showing = s.hit === undefined ? s.origin.buffer : st.buffer;
  const r = searchFrom(ctx, query, dir, from, showing);
  const base: Search = { ...s, query, dir, back: [...s.back, stepOf(s)] };
  // A repeat that finds nothing keeps the last match and says "failing".
  const next: Search =
    r === undefined
      ? { ...base, failing: true }
      : { ...base, failing: false, hit: r.hit, at: r.at };
  return showHit({ ...st, lastQuery: query }, ctx, next);
}

function searchType(st: EditorState, ctx: EditorContext, text: string): EditorState {
  const s = st.search;
  if (s === undefined) return st;
  const query = s.query + text;
  const base: Search = { ...s, query, back: [...s.back, stepOf(s)] };
  // The line now showing may still match the longer query.
  if (s.hit !== undefined) {
    const at = find(st.buffer, query);
    if (at >= 0) return showHit({ ...st, lastQuery: query }, ctx, { ...base, at, failing: false });
  }
  const here = s.hit === undefined ? histIndex(ctx, st.hist) : histIndex(ctx, s.hit);
  const from = s.hit === undefined ? (s.dir === 'back' ? here - 1 : here + 1) : here;
  const r = searchFrom(ctx, query, s.dir, from, s.hit === undefined ? s.origin.buffer : '');
  const next: Search =
    r === undefined
      ? { ...base, failing: true }
      : { ...base, failing: false, hit: r.hit, at: r.at };
  return showHit({ ...st, lastQuery: query }, ctx, next);
}

function searchBack(st: EditorState, ctx: EditorContext): EditorState {
  const s = st.search;
  if (s === undefined) return st;
  const prev = s.back[s.back.length - 1];
  if (prev === undefined) return st;
  const next: Search = { ...s, ...prev, back: s.back.slice(0, -1) };
  if (next.hit === undefined) {
    const o = s.origin;
    return { ...st, search: next, buffer: o.buffer, cursor: o.cursor, hist: o.hist };
  }
  return showHit(st, ctx, next);
}

/** End the search and keep the line found. */
function endSearch(st: EditorState): EditorState {
  return { ...st, search: undefined };
}

function cancelSearch(st: EditorState): EditorState {
  const s = st.search;
  if (s === undefined) return st;
  const o = s.origin;
  return { ...endSearch(st), buffer: o.buffer, cursor: o.cursor, hist: o.hist };
}

/** The status line under the input: the search prompt, or nothing. */
export function statusText(st: EditorState): string {
  const s = st.search;
  if (s === undefined) return '';
  const prompt = `${s.dir === 'back' ? 'bck' : 'fwd'}-i-search: ${s.query}_`;
  return s.failing ? `failing ${prompt}` : prompt;
}

/** Typing while a search is open adds to the search, not the line. */
export function typeText(st: EditorState, ctx: EditorContext, text: string): EditorState {
  if (st.search !== undefined) return searchType(st, ctx, text);
  return insert(st, text);
}

// -------------------------------------------------------------------------------------------------
// Widgets

const SEARCH_KEEPS: readonly Widget[] = [
  'history-incremental-search-backward',
  'history-incremental-search-forward',
  'backward-delete-char',
  'escape',
  'send-break',
  'interrupt',
];

/** Run one widget. */
export function apply(st0: EditorState, w: Widget, ctx: EditorContext): Result {
  if (st0.search !== undefined) {
    if (!SEARCH_KEEPS.includes(w)) {
      // Any other key ends the search, keeps the line found, and then acts (research section 5).
      return run(endSearch(st0), w, ctx);
    }
    switch (w) {
      case 'history-incremental-search-backward':
        return { state: searchAgain(st0, ctx, st0.search, 'back') };
      case 'history-incremental-search-forward':
        return { state: searchAgain(st0, ctx, st0.search, 'fwd') };
      case 'backward-delete-char':
        return { state: searchBack(st0, ctx) };
      default:
        // Escape, Ctrl-G and Ctrl-C cancel and restore the line.
        return { state: { ...cancelSearch(st0), last: w } };
    }
  }
  return run(st0, w, ctx);
}

function run(st: EditorState, w: Widget, ctx: EditorContext): Result {
  const r = widget(st, w, ctx);
  return { ...r, state: { ...r.state, last: w } };
}

function widget(st: EditorState, w: Widget, ctx: EditorContext): Result {
  const b = st.buffer;
  const c = st.cursor;
  const same = (state: EditorState): Result => ({ state });
  const beep: Result = { state: st, effect: { kind: 'beep' } };
  switch (w) {
    case 'beginning-of-line':
      return same({ ...st, cursor: 0 });
    case 'end-of-line':
      return same({ ...st, cursor: b.length });
    case 'forward-char':
      return same({ ...st, cursor: Math.min(b.length, c + 1) });
    case 'backward-char':
      return same({ ...st, cursor: Math.max(0, c - 1) });
    case 'forward-word':
      return same({ ...st, cursor: nextWordStart(b, c) });
    case 'backward-word':
      return same({ ...st, cursor: wordStart(b, c) });
    case 'delete-char-or-list':
      if (b === '') return same(st);
      if (c >= b.length) {
        const comp = ctx.complete?.(b, c);
        if (comp === undefined) return beep;
        return {
          state: st,
          effect: { kind: 'list', items: comp.items.length > 0 ? comp.items : [comp.text] },
        };
      }
      return same(change(st, b.slice(0, c) + b.slice(c + 1), c));
    case 'delete-char':
      if (c >= b.length) return same(st);
      return same(change(st, b.slice(0, c) + b.slice(c + 1), c));
    case 'backward-delete-char':
      if (c === 0) return same(st);
      return same(change(st, b.slice(0, c - 1) + b.slice(c), c - 1));
    case 'backward-kill-word':
      return same(kill(st, wordStart(b, c), c, true));
    case 'kill-word':
      return same(kill(st, c, wordEnd(b, c), false));
    case 'kill-line':
      return same(kill(st, c, b.length, false));
    case 'kill-whole-line':
      return same(kill(st, 0, b.length, false));
    case 'yank': {
      if (st.cut === '') return same(st);
      const out = b.slice(0, c) + st.cut + b.slice(c);
      const changed = change(st, out, c + st.cut.length);
      return same({ ...changed, lastYank: { start: c, end: c + st.cut.length, index: 0 } });
    }
    case 'yank-pop': {
      const y = st.lastYank;
      if (y === undefined || (st.last !== 'yank' && st.last !== 'yank-pop')) return beep;
      const all = [st.cut, ...st.ring];
      let index = y.index;
      let text = '';
      let tries = all.length;
      while (tries-- > 0) {
        index = (index + 1) % all.length;
        text = all[index] ?? '';
        if (text !== '') break;
      }
      const out = b.slice(0, y.start) + text + b.slice(y.end);
      const changed = change(st, out, y.start + text.length);
      return same({ ...changed, lastYank: { start: y.start, end: y.start + text.length, index } });
    }
    case 'transpose-chars': {
      if (b.length < 2 || c === 0) return beep;
      const i = c >= b.length ? b.length - 2 : c - 1;
      const out = b.slice(0, i) + b.charAt(i + 1) + b.charAt(i) + b.slice(i + 2);
      return same(change(st, out, Math.min(b.length, i + 2)));
    }
    case 'transpose-words': {
      const e2 = wordEnd(b, c);
      let s2 = e2;
      while (s2 > 0 && isWordChar(b[s2 - 1])) s2--;
      let e1 = s2;
      while (e1 > 0 && !isWordChar(b[e1 - 1])) e1--;
      let s1 = e1;
      while (s1 > 0 && isWordChar(b[s1 - 1])) s1--;
      if (s1 === e1 || s2 === e2) return beep;
      const out =
        b.slice(0, s1) + b.slice(s2, e2) + b.slice(e1, s2) + b.slice(s1, e1) + b.slice(e2);
      return same(change(st, out, e2));
    }
    case 'up-case-word':
      return same(caseWord(st, (x) => x.toUpperCase()));
    case 'down-case-word':
      return same(caseWord(st, (x) => x.toLowerCase()));
    case 'capitalize-word':
      return same(caseWord(st, (x) => x.toLowerCase().replace(/\p{L}/u, (ch) => ch.toUpperCase())));
    case 'undo': {
      const top = st.undo[st.undo.length - 1];
      if (top === undefined) return beep;
      // A change made on another history line first takes the editor back to that line, as one step.
      if (top.hist !== st.hist) return same(goToLine(st, ctx, top.hist));
      return same({
        ...st,
        buffer: top.buffer,
        cursor: top.cursor,
        undo: st.undo.slice(0, -1),
        redo: [...st.redo, snap(st)],
      });
    }
    case 'redo': {
      const top = st.redo[st.redo.length - 1];
      if (top === undefined) return beep;
      if (top.hist !== st.hist) return same(goToLine(st, ctx, top.hist));
      return same({
        ...st,
        buffer: top.buffer,
        cursor: top.cursor,
        redo: st.redo.slice(0, -1),
        undo: [...st.undo, snap(st)],
      });
    }
    case 'up-line-or-history': {
      const i = histIndex(ctx, st.hist);
      const prev = ctx.history[i - 1];
      if (prev === undefined) return beep;
      return same(goToLine(st, ctx, prev.n));
    }
    case 'down-line-or-history': {
      if (st.hist === null) return beep;
      const i = histIndex(ctx, st.hist);
      const next = ctx.history[i + 1];
      return same(goToLine(st, ctx, next === undefined ? null : next.n));
    }
    case 'beginning-of-buffer-or-history': {
      const first = ctx.history[0];
      if (first === undefined) return beep;
      return same(goToLine(st, ctx, first.n));
    }
    case 'end-of-buffer-or-history':
      return same(goToLine(st, ctx, null));
    case 'history-search-backward':
    case 'history-search-forward': {
      const chained = st.last === 'history-search-backward' || st.last === 'history-search-forward';
      const word = chained && st.lastFirstWord !== undefined ? st.lastFirstWord : firstWord(b);
      const step = w === 'history-search-backward' ? -1 : 1;
      for (let i = histIndex(ctx, st.hist) + step; i >= 0 && i < ctx.history.length; i += step) {
        const h = ctx.history[i];
        if (h === undefined || h.line === b) continue;
        if (word === '' || firstWord(h.line) === word) {
          return same({ ...goToLine(st, ctx, h.n), lastFirstWord: word });
        }
      }
      if (step === 1 && st.hist !== null)
        return same({ ...goToLine(st, ctx, null), lastFirstWord: word });
      return { state: { ...st, lastFirstWord: word }, effect: { kind: 'beep' } };
    }
    case 'insert-last-word': {
      const prev = st.last === 'insert-last-word' ? st.lastWord : undefined;
      const back = prev === undefined ? 1 : prev.back + 1;
      const at = histIndex(ctx, st.hist) - back;
      const h = ctx.history[at];
      if (h === undefined) return beep;
      const word = lastWordOf(h.line);
      const start = prev?.start ?? c;
      const end = prev?.end ?? c;
      const out = b.slice(0, start) + word + b.slice(end);
      const changed = change(st, out, start + word.length);
      return same({ ...changed, lastWord: { start, end: start + word.length, back } });
    }
    case 'accept-line-and-down-history': {
      const i = histIndex(ctx, st.hist);
      const next = st.hist === null ? undefined : ctx.history[i + 1];
      return {
        state: st,
        effect: { kind: 'accept', line: b, ...(next === undefined ? {} : { andDown: next.n }) },
      };
    }
    case 'expand-history': {
      const e = ctx.expand?.(b);
      if (e === undefined) return same(st);
      if (!e.ok) return { state: st, effect: { kind: 'message', text: e.error } };
      return same(change(st, e.line, e.line.length));
    }
    case 'history-incremental-search-backward':
      return same(startSearch(st, 'back'));
    case 'history-incremental-search-forward':
      return same(startSearch(st, 'fwd'));
    case 'accept-line':
      return { state: st, effect: { kind: 'accept', line: b } };
    case 'expand-or-complete': {
      const comp = ctx.complete?.(b, c);
      if (comp === undefined) return { state: st, effect: { kind: 'release' } };
      const out = b.slice(0, comp.from) + comp.text + b.slice(comp.to);
      const changed = change(st, out, comp.from + comp.text.length);
      return comp.items.length > 1
        ? { state: changed, effect: { kind: 'list', items: comp.items } }
        : same(changed);
    }
    case 'clear-screen':
      return { state: st, effect: { kind: 'clear' } };
    case 'send-break':
      return same(change(st, '', 0));
    case 'push-line':
      if (b === '') return same(st);
      return same({ ...change(st, '', 0), pushed: [...st.pushed, b] });
    case 'run-help':
      return { state: st, effect: { kind: 'help', topic: firstWord(b) } };
    case 'interrupt':
      return {
        state: { ...st, buffer: '', cursor: 0, hist: null, draft: '', undo: [], redo: [] },
        effect: { kind: 'interrupt' },
      };
    case 'escape':
      return { state: st, effect: { kind: 'release' } };
  }
}
