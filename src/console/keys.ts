/**
 * The console's one binding table (ADR 0006). The key handler, the legend in Settings and `help keys`
 * all read it. Ctrl bindings match on `key`, Alt bindings on `altKey` and `code`, so Option on a Mac
 * still works (docs/research/console.md section 8). Nothing binds Cmd, and nothing binds Ctrl with
 * Alt, which is AltGr on Windows.
 */

export type Widget =
  | 'beginning-of-line'
  | 'end-of-line'
  | 'forward-char'
  | 'backward-char'
  | 'forward-word'
  | 'backward-word'
  | 'delete-char-or-list'
  | 'delete-char'
  | 'backward-delete-char'
  | 'backward-kill-word'
  | 'kill-word'
  | 'kill-line'
  | 'kill-whole-line'
  | 'yank'
  | 'yank-pop'
  | 'transpose-chars'
  | 'transpose-words'
  | 'up-case-word'
  | 'down-case-word'
  | 'capitalize-word'
  | 'undo'
  | 'redo'
  | 'up-line-or-history'
  | 'down-line-or-history'
  | 'beginning-of-buffer-or-history'
  | 'end-of-buffer-or-history'
  | 'history-search-backward'
  | 'history-search-forward'
  | 'insert-last-word'
  | 'accept-line-and-down-history'
  | 'expand-history'
  | 'history-incremental-search-backward'
  | 'history-incremental-search-forward'
  | 'accept-line'
  | 'expand-or-complete'
  | 'clear-screen'
  | 'send-break'
  | 'push-line'
  | 'run-help'
  | 'interrupt'
  | 'escape';

/** A key event as the editor sees it: the fields of a DOM `KeyboardEvent` it uses. */
export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

export type Platform = 'mac' | 'other';

type Chord =
  /** A key with no modifier but, where given, Shift. */
  | { readonly mod: 'none'; readonly key: string }
  /** Ctrl and a key, matched on `key`, case-insensitive for letters. */
  | { readonly mod: 'ctrl'; readonly key: string; readonly shift?: boolean }
  /** Alt (Option) and a physical key, matched on `code`. */
  | { readonly mod: 'alt'; readonly code: string; readonly shift?: boolean };

export interface Binding {
  readonly widget: Widget;
  /** What it does, for the legend. */
  readonly does: string;
  readonly keys: readonly { readonly label: string; readonly chord: Chord }[];
}

const none = (key: string, label = key) => ({ label, chord: { mod: 'none', key } as const });
const ctrl = (key: string, label?: string, shift?: boolean) => ({
  label: label ?? `Ctrl-${key.toUpperCase()}`,
  chord: { mod: 'ctrl', key, ...(shift === undefined ? {} : { shift }) } as const,
});
const alt = (code: string, label: string, shift?: boolean) => ({
  label,
  chord: { mod: 'alt', code, ...(shift === undefined ? {} : { shift }) } as const,
});

export const BINDINGS: readonly Binding[] = [
  {
    widget: 'beginning-of-line',
    does: 'Start of line',
    keys: [ctrl('a'), none('Home')],
  },
  { widget: 'end-of-line', does: 'End of line', keys: [ctrl('e'), none('End')] },
  {
    widget: 'forward-char',
    does: 'One character forward',
    keys: [ctrl('f'), none('ArrowRight', 'Right')],
  },
  {
    widget: 'backward-char',
    does: 'One character back',
    keys: [ctrl('b'), none('ArrowLeft', 'Left')],
  },
  {
    widget: 'forward-word',
    does: 'To the start of the next word',
    keys: [alt('KeyF', 'Alt-F'), alt('ArrowRight', 'Alt-Right'), ctrl('ArrowRight', 'Ctrl-Right')],
  },
  {
    widget: 'backward-word',
    does: 'To the start of the word before',
    keys: [alt('KeyB', 'Alt-B'), alt('ArrowLeft', 'Alt-Left'), ctrl('ArrowLeft', 'Ctrl-Left')],
  },
  {
    widget: 'delete-char-or-list',
    does: 'Delete under the cursor, or list completions at the end',
    keys: [ctrl('d')],
  },
  { widget: 'delete-char', does: 'Delete under the cursor', keys: [none('Delete')] },
  {
    widget: 'backward-delete-char',
    does: 'Delete behind the cursor',
    keys: [none('Backspace'), ctrl('h')],
  },
  {
    widget: 'backward-kill-word',
    does: 'Kill the word before the cursor',
    keys: [alt('Backspace', 'Alt-Backspace'), ctrl('Backspace', 'Ctrl-Backspace'), ctrl('w')],
  },
  { widget: 'kill-word', does: 'Kill to the end of the word', keys: [alt('KeyD', 'Alt-D')] },
  { widget: 'kill-line', does: 'Kill to the end of the line', keys: [ctrl('k')] },
  { widget: 'kill-whole-line', does: 'Kill the whole line', keys: [ctrl('u')] },
  { widget: 'yank', does: 'Insert the last kill', keys: [ctrl('y')] },
  {
    widget: 'yank-pop',
    does: 'Replace the yank with an earlier kill',
    keys: [alt('KeyY', 'Alt-Y')],
  },
  { widget: 'transpose-chars', does: 'Swap two characters', keys: [ctrl('t')] },
  { widget: 'transpose-words', does: 'Swap two words', keys: [alt('KeyT', 'Alt-T')] },
  { widget: 'up-case-word', does: 'Upper-case the word', keys: [alt('KeyU', 'Alt-U')] },
  { widget: 'down-case-word', does: 'Lower-case the word', keys: [alt('KeyL', 'Alt-L')] },
  { widget: 'capitalize-word', does: 'Capitalise the word', keys: [alt('KeyC', 'Alt-C')] },
  {
    widget: 'undo',
    does: 'Undo',
    keys: [ctrl('_', 'Ctrl-_', true), ctrl('/', 'Ctrl-/'), ctrl('z', 'Ctrl-Z', false)],
  },
  { widget: 'redo', does: 'Redo', keys: [ctrl('z', 'Ctrl-Shift-Z', true)] },
  {
    widget: 'up-line-or-history',
    does: 'Previous history line',
    keys: [none('ArrowUp', 'Up'), ctrl('p')],
  },
  {
    widget: 'down-line-or-history',
    does: 'Next history line',
    keys: [none('ArrowDown', 'Down'), ctrl('n')],
  },
  {
    widget: 'beginning-of-buffer-or-history',
    does: 'First history line',
    keys: [alt('Comma', 'Alt-<', true)],
  },
  {
    widget: 'end-of-buffer-or-history',
    does: 'Back to the line being typed',
    keys: [alt('Period', 'Alt->', true)],
  },
  {
    widget: 'history-search-backward',
    does: 'Earlier line with the same first word',
    keys: [alt('KeyP', 'Alt-P')],
  },
  {
    widget: 'history-search-forward',
    does: 'Later line with the same first word',
    keys: [alt('KeyN', 'Alt-N')],
  },
  {
    widget: 'insert-last-word',
    does: 'Insert the last word of the line before',
    keys: [alt('Period', 'Alt-.', false)],
  },
  {
    widget: 'accept-line-and-down-history',
    does: 'Run the line and load the next one',
    keys: [ctrl('o')],
  },
  {
    widget: 'expand-history',
    does: 'Expand history references without running',
    keys: [alt('Space', 'Alt-Space'), alt('Digit1', 'Alt-!', true)],
  },
  {
    widget: 'history-incremental-search-backward',
    does: 'Search history backward',
    keys: [ctrl('r')],
  },
  {
    widget: 'history-incremental-search-forward',
    does: 'Search history forward',
    keys: [ctrl('s')],
  },
  { widget: 'accept-line', does: 'Run the line', keys: [none('Enter'), ctrl('j')] },
  {
    widget: 'expand-or-complete',
    does: 'Complete, when there is something to complete',
    keys: [none('Tab')],
  },
  { widget: 'clear-screen', does: 'Clear the output and keep the line', keys: [ctrl('l')] },
  { widget: 'send-break', does: 'Abandon the line', keys: [ctrl('g')] },
  {
    widget: 'push-line',
    does: 'Park the line, run one other, get it back',
    keys: [ctrl('q'), alt('KeyQ', 'Alt-Q')],
  },
  { widget: 'run-help', does: 'Help for the command being typed', keys: [alt('KeyH', 'Alt-H')] },
  {
    widget: 'interrupt',
    does: 'Abandon the line and stop a running script (copies if text is selected)',
    keys: [ctrl('c')],
  },
  {
    widget: 'escape',
    does: 'Cancel a search or list, then leave the console',
    keys: [none('Escape')],
  },
];

/**
 * Keys a normal Chrome or Edge tab on Windows and Linux keeps for itself (research section 8). They
 * work on a Mac and in an app window.
 */
export const BROWSER_KEEPS: readonly string[] = ['Ctrl-W', 'Ctrl-N', 'Ctrl-T'];

function matches(chord: Chord, k: KeyPress): boolean {
  switch (chord.mod) {
    case 'none':
      return !k.ctrl && !k.alt && !k.shift && k.key === chord.key;
    case 'ctrl': {
      if (!k.ctrl || k.alt) return false;
      if (chord.shift !== undefined && chord.shift !== k.shift) return false;
      return k.key.toLowerCase() === chord.key.toLowerCase();
    }
    case 'alt':
      if (!k.alt || k.ctrl) return false;
      if ((chord.shift ?? false) !== k.shift) return false;
      return k.code === chord.code;
  }
}

/** The widget a key runs, or undefined to leave the key to the browser. */
export function widgetFor(k: KeyPress): Widget | undefined {
  // Cmd is the browser's and the system's (ADR 0006).
  if (k.meta) return undefined;
  for (const b of BINDINGS) for (const { chord } of b.keys) if (matches(chord, k)) return b.widget;
  return undefined;
}

export interface LegendRow {
  readonly does: string;
  readonly keys: readonly string[];
  /** Keys that only work on a Mac or in an app window here. */
  readonly elsewhere: readonly string[];
}

/** The legend for one platform, in table order. */
export function legend(platform: Platform): LegendRow[] {
  return BINDINGS.map((b) => {
    const labels = b.keys.map((k) => k.label);
    const kept = platform === 'other' ? labels.filter((l) => BROWSER_KEEPS.includes(l)) : [];
    return { does: b.does, keys: labels.filter((l) => !kept.includes(l)), elsewhere: kept };
  });
}
