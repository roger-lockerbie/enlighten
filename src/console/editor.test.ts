/** U-console: key-sequence tests for the line editor and its binding table. */
import { describe, expect, it } from 'vitest';
import {
  afterAccept,
  apply,
  emptyEditor,
  input,
  statusText,
  typeText,
  type EditorContext,
  type EditorState,
  type Effect,
  type HistLine,
} from './editor.ts';
import { BINDINGS, legend, widgetFor, type KeyPress } from './keys.ts';

/** A key press from a label such as `Ctrl-A`, `Alt-F`, `Alt-<`, `Ctrl-Shift-Z` or `Up`. */
function press(label: string): KeyPress {
  const k = { key: '', code: '', ctrl: false, alt: false, shift: false, meta: false };
  const named: Record<string, string> = {
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
  };
  const codes: Record<string, [string, boolean]> = {
    '<': ['Comma', true],
    '>': ['Period', true],
    '.': ['Period', false],
    '!': ['Digit1', true],
    Space: ['Space', false],
    Backspace: ['Backspace', false],
    Left: ['ArrowLeft', false],
    Right: ['ArrowRight', false],
  };
  const parts = label.split('-');
  let rest = parts[parts.length - 1] ?? '';
  if (label.endsWith('-_')) rest = '_';
  for (const p of parts.slice(0, -1)) {
    if (p === 'Ctrl') k.ctrl = true;
    if (p === 'Alt') k.alt = true;
    if (p === 'Shift') k.shift = true;
  }
  if (k.alt) {
    const c = codes[rest];
    if (c !== undefined) [k.code, k.shift] = [c[0], c[1] || k.shift];
    else k.code = `Key${rest.toUpperCase()}`;
    k.key = rest.toLowerCase();
    return k;
  }
  if (k.ctrl) {
    if (rest === '_') k.shift = true;
    k.key =
      named[rest] ??
      (rest.length === 1 ? (k.shift ? rest.toUpperCase() : rest.toLowerCase()) : rest);
    return k;
  }
  k.key = named[rest] ?? rest;
  return k;
}

interface Run {
  st: EditorState;
  effects: Effect[];
}

function ctxOf(lines: string[] = [], extra: Partial<EditorContext> = {}): EditorContext {
  const history: HistLine[] = lines.map((line, i) => ({ n: i + 1, line }));
  return { history, ...extra };
}

/** Run a sequence: `{text}` types, anything else is a key label. */
function keys(seq: (string | { text: string })[], ctx = ctxOf(), from = emptyEditor()): Run {
  let st = from;
  const effects: Effect[] = [];
  for (const s of seq) {
    if (typeof s !== 'string') {
      st = typeText(st, ctx, s.text);
      continue;
    }
    const w = widgetFor(press(s));
    if (w === undefined) throw new Error(`No binding for ${s}`);
    const r = apply(st, w, ctx);
    st = r.state;
    if (r.effect !== undefined) effects.push(r.effect);
  }
  return { st, effects };
}

const t = (text: string) => ({ text });
/** The buffer with a bar at the cursor. */
const show = (st: EditorState) => `${st.buffer.slice(0, st.cursor)}|${st.buffer.slice(st.cursor)}`;

describe('binding table', () => {
  it('maps every key in the table back to its widget', () => {
    for (const b of BINDINGS)
      for (const k of b.keys)
        expect([k.label, widgetFor(press(k.label))]).toEqual([k.label, b.widget]);
  });

  it('never binds Cmd, Ctrl with Alt, or Shift-Tab', () => {
    expect(widgetFor({ ...press('Ctrl-A'), meta: true })).toBeUndefined();
    expect(widgetFor({ ...press('Ctrl-A'), alt: true })).toBeUndefined();
    expect(widgetFor({ ...press('Alt-F'), ctrl: true })).toBeUndefined();
    expect(widgetFor({ ...press('Tab'), shift: true })).toBeUndefined();
    expect(widgetFor(press('Ctrl-V'))).toBeUndefined();
    expect(widgetFor(press('Ctrl-X'))).toBeUndefined();
  });

  it('matches Alt keys by position, so Option on a Mac works', () => {
    expect(
      widgetFor({ key: 'ƒ', code: 'KeyF', ctrl: false, alt: true, shift: false, meta: false }),
    ).toBe('forward-word');
  });

  it('marks the keys a Windows or Linux tab keeps', () => {
    const other = legend('other');
    const kill = other.find((r) => r.does.startsWith('Kill the word before'));
    expect(kill?.keys).toEqual(['Alt-Backspace', 'Ctrl-Backspace']);
    expect(kill?.elsewhere).toEqual(['Ctrl-W']);
    const mac = legend('mac').find((r) => r.does.startsWith('Kill the word before'));
    expect(mac?.elsewhere).toEqual([]);
    expect(legend('mac')).toHaveLength(BINDINGS.length);
  });
});

describe('movement', () => {
  it('moves by character, line and word, zsh style', () => {
    const r = keys([t('level 0 50%'), 'Ctrl-A']);
    expect(show(r.st)).toBe('|level 0 50%');
    expect(show(keys(['Alt-F'], ctxOf(), r.st).st)).toBe('level |0 50%');
    expect(show(keys(['Alt-F', 'Alt-F'], ctxOf(), r.st).st)).toBe('level 0 |50%');
    expect(show(keys(['Ctrl-E', 'Alt-B'], ctxOf(), r.st).st)).toBe('level 0 |50%');
    expect(show(keys(['Ctrl-F', 'Right', 'Ctrl-B'], ctxOf(), r.st).st)).toBe('l|evel 0 50%');
    expect(show(keys(['End', 'Left', 'Home'], ctxOf(), r.st).st)).toBe('|level 0 50%');
    expect(show(keys(['Ctrl-Right', 'Alt-Right', 'Ctrl-Left', 'Alt-Left'], ctxOf(), r.st).st)).toBe(
      '|level 0 50%',
    );
  });

  it('treats a hyphen and an underscore as part of a word', () => {
    const r = keys([t('set-max-level a_b,c'), 'Ctrl-A', 'Alt-F']);
    expect(show(r.st)).toBe('set-max-level |a_b,c');
    expect(show(keys(['Alt-F'], ctxOf(), r.st).st)).toBe('set-max-level a_b,|c');
  });

  it('stops at the ends', () => {
    expect(show(keys(['Ctrl-B', 'Alt-B']).st)).toBe('|');
    expect(show(keys([t('ab'), 'Ctrl-F', 'Alt-F']).st)).toBe('ab|');
  });
});

describe('deleting and killing', () => {
  it('deletes characters without touching the kill ring', () => {
    const r = keys([t('abcd'), 'Backspace', 'Ctrl-A', 'Ctrl-D', 'Delete']);
    expect(show(r.st)).toBe('|c');
    expect(r.st.cut).toBe('');
    expect(show(keys(['Ctrl-H'], ctxOf(), keys([t('ab')]).st).st)).toBe('a|');
    // At the start, Backspace does nothing; at the end, Delete does nothing.
    expect(
      show(keys(['Ctrl-A', 'Backspace', 'Ctrl-E', 'Delete'], ctxOf(), keys([t('ab')]).st).st),
    ).toBe('ab|');
  });

  it('Ctrl-D on an empty line does nothing', () => {
    const r = keys(['Ctrl-D']);
    expect(r.effects).toEqual([]);
    expect(r.st.buffer).toBe('');
  });

  it('Ctrl-D at the end of a line lists completions', () => {
    const ctx = ctxOf([], {
      complete: () => ({ from: 0, to: 2, text: 'le', items: ['level', 'lock'] }),
    });
    const r = keys([t('le'), 'Ctrl-D'], ctx);
    expect(r.effects).toEqual([{ kind: 'list', items: ['level', 'lock'] }]);
    expect(keys([t('zz'), 'Ctrl-D']).effects).toEqual([{ kind: 'beep' }]);
  });

  it('chains kills so the buffer reads in the original order', () => {
    const r = keys([t('one two three'), 'Ctrl-W', 'Ctrl-W', 'Alt-Backspace']);
    expect(r.st.buffer).toBe('');
    expect(r.st.cut).toBe('one two three');
    const y = keys(['Ctrl-Y'], ctxOf(), r.st);
    expect(y.st.buffer).toBe('one two three');
  });

  it('kills forward, to the end and the whole line', () => {
    const r = keys([t('scene 0 recall 3'), 'Ctrl-A', 'Alt-D', 'Alt-D']);
    expect(r.st.buffer).toBe(' recall 3');
    expect(r.st.cut).toBe('scene 0');
    const k = keys([t('abc def'), 'Ctrl-A', 'Alt-F', 'Ctrl-K']);
    expect(k.st.buffer).toBe('abc ');
    expect(k.st.cut).toBe('def');
    const u = keys([t('abc def'), 'Ctrl-B', 'Ctrl-U']);
    expect(u.st.buffer).toBe('');
    expect(u.st.cut).toBe('abc def');
    expect(keys(['Ctrl-Backspace']).st.cut).toBe('');
  });

  it('a move between kills starts a new kill, and the old one goes to the ring', () => {
    const r = keys([t('aa bb'), 'Ctrl-W', 'Ctrl-B', 'Ctrl-W']);
    expect(r.st.cut).toBe('aa');
    expect(r.st.ring).toEqual(['bb']);
  });

  it('keeps eight kills at most', () => {
    let st = emptyEditor();
    for (let i = 0; i < 12; i++) st = keys([t(`w${String(i)}`), 'Ctrl-U'], ctxOf(), st).st;
    expect(st.cut).toBe('w11');
    expect(st.ring).toHaveLength(7);
    expect(st.ring[0]).toBe('w10');
  });
});

describe('yank', () => {
  it('yank-pop walks the ring after a yank, and only after one', () => {
    const r = keys([t('a'), 'Ctrl-U', t('b'), 'Ctrl-U', t('c'), 'Ctrl-U']);
    expect(r.st.cut).toBe('c');
    const y = keys(['Ctrl-Y', 'Alt-Y'], ctxOf(), r.st);
    expect(show(y.st)).toBe('b|');
    expect(show(keys(['Alt-Y'], ctxOf(), y.st).st)).toBe('a|');
    expect(show(keys(['Alt-Y', 'Alt-Y'], ctxOf(), y.st).st)).toBe('c|');
    const after = keys([t('x'), 'Alt-Y'], ctxOf(), y.st);
    expect(after.effects).toEqual([{ kind: 'beep' }]);
  });

  it('yank with an empty cut buffer does nothing', () => {
    expect(keys(['Ctrl-Y']).st.buffer).toBe('');
    expect(keys(['Alt-Y']).effects).toEqual([{ kind: 'beep' }]);
  });
});

describe('transpose and case', () => {
  it('transposes characters, at the end and in the middle', () => {
    expect(show(keys([t('ab'), 'Ctrl-T']).st)).toBe('ba|');
    expect(show(keys([t('abc'), 'Ctrl-B', 'Ctrl-T']).st)).toBe('acb|');
    expect(keys(['Ctrl-T']).effects).toEqual([{ kind: 'beep' }]);
    expect(keys([t('ab'), 'Ctrl-A', 'Ctrl-T']).effects).toEqual([{ kind: 'beep' }]);
  });

  it('transposes words', () => {
    expect(show(keys([t('tc 0'), 'Alt-T']).st)).toBe('0 tc|');
    expect(show(keys([t('one two three'), 'Alt-B', 'Alt-T']).st)).toBe('one three two|');
    expect(keys([t('one'), 'Alt-T']).effects).toEqual([{ kind: 'beep' }]);
  });

  it('changes the case of the word and moves past it', () => {
    expect(show(keys([t('raw ff'), 'Ctrl-A', 'Alt-U']).st)).toBe('RAW| ff');
    expect(show(keys([t('RAW FF'), 'Ctrl-A', 'Alt-F', 'Alt-L']).st)).toBe('RAW ff|');
    expect(show(keys([t('hello WORLD'), 'Ctrl-A', 'Alt-C', 'Alt-C']).st)).toBe('Hello World|');
    expect(show(keys([t('12ab'), 'Ctrl-A', 'Alt-C']).st)).toBe('12Ab|');
    expect(show(keys([t('12'), 'Ctrl-A', 'Alt-C']).st)).toBe('12|');
    expect(show(keys([t('a  '), 'Alt-U']).st)).toBe('a  |');
  });
});

describe('undo and redo', () => {
  it('groups a typed run, broken at a space', () => {
    const r = keys([t('l'), t('e'), t('v'), t(' '), t('0')]);
    expect(r.st.buffer).toBe('lev 0');
    // A space starts a new step: "lev", then " 0".
    const u1 = keys(['Ctrl-_'], ctxOf(), r.st);
    expect(u1.st.buffer).toBe('lev');
    const u3 = keys(['Ctrl-/'], ctxOf(), u1.st);
    expect(u3.st.buffer).toBe('');
    expect(keys(['Ctrl-Z'], ctxOf(), u3.st).effects).toEqual([{ kind: 'beep' }]);
    const r1 = keys(['Ctrl-Shift-Z', 'Ctrl-Shift-Z'], ctxOf(), u3.st);
    expect(r1.st.buffer).toBe('lev 0');
    expect(keys(['Ctrl-Shift-Z'], ctxOf(), r1.st).effects).toEqual([{ kind: 'beep' }]);
  });

  it('a kill is one step, and a new edit clears redo', () => {
    const r = keys([t('one two'), 'Ctrl-W', 'Ctrl-_']);
    expect(r.st.buffer).toBe('one two');
    const n = keys(['Ctrl-W', t('x'), 'Ctrl-Shift-Z'], ctxOf(), r.st);
    expect(n.effects).toEqual([{ kind: 'beep' }]);
  });

  it('undo goes back to the history line a change was made on, as one step', () => {
    const ctx = ctxOf(['off 0']);
    const r = keys([t('abc'), 'Up'], ctx);
    expect(r.st.buffer).toBe('off 0');
    const u = keys(['Ctrl-_'], ctx, r.st);
    expect(u.st.buffer).toBe('abc');
    expect(u.st.hist).toBeNull();
    expect(keys(['Ctrl-_'], ctx, u.st).st.buffer).toBe('');
  });

  it('redo also returns to the line it belongs to', () => {
    const ctx = ctxOf(['off 0']);
    const r = keys([t('abc'), 'Ctrl-_', 'Up'], ctx);
    const u = keys(['Ctrl-Shift-Z'], ctx, r.st);
    expect(u.st.hist).toBeNull();
    expect(keys(['Ctrl-Shift-Z'], ctx, u.st).st.buffer).toBe('abc');
  });
});

describe('history', () => {
  const ctx = ctxOf(['level 0 50%', 'off 0', 'tc 0 2700K']);

  it('walks up and down, and keeps what was typed', () => {
    const r = keys([t('draft'), 'Up', 'Ctrl-P'], ctx);
    expect(r.st.buffer).toBe('off 0');
    const e = keys([t('!'), 'Down', 'Up'], ctx, r.st);
    expect(e.st.buffer).toBe('off 0!');
    const d = keys(['Ctrl-N', 'Down'], ctx, e.st);
    expect(d.st.buffer).toBe('draft');
    expect(keys(['Down'], ctx, d.st).effects).toEqual([{ kind: 'beep' }]);
    expect(keys(['Up', 'Up', 'Up', 'Up'], ctx).effects).toEqual([{ kind: 'beep' }]);
  });

  it('jumps to the first line and back', () => {
    const r = keys(['Alt-<'], ctx);
    expect(r.st.buffer).toBe('level 0 50%');
    expect(keys(['Alt->'], ctx, r.st).st.buffer).toBe('');
    expect(keys(['Alt-<'], ctxOf()).effects).toEqual([{ kind: 'beep' }]);
  });

  it('searches by the first word with Alt-P and Alt-N', () => {
    const c = ctxOf(['level 0 10', 'off 0', 'level 1 20', 'level 1 20', 'tc 0 2700K']);
    const r = keys([t('level'), 'Alt-P'], c);
    expect(r.st.buffer).toBe('level 1 20');
    const p2 = keys(['Alt-P'], c, r.st);
    expect(p2.st.buffer).toBe('level 0 10');
    expect(keys(['Alt-P'], c, p2.st).effects).toEqual([{ kind: 'beep' }]);
    const n = keys(['Alt-N'], c, p2.st);
    expect(n.st.buffer).toBe('level 1 20');
    expect(keys(['Alt-N', 'Alt-N'], c, n.st).st.buffer).toBe('level');
    expect(keys(['Alt-P'], c).st.buffer).toBe('tc 0 2700K');
  });

  it('inserts the last word of earlier lines with Alt-.', () => {
    const r = keys([t('query '), 'Alt-.'], ctx);
    expect(r.st.buffer).toBe('query 2700K');
    expect(keys(['Alt-.'], ctx, r.st).st.buffer).toBe('query 0');
    expect(keys(['Alt-.', 'Alt-.', 'Alt-.'], ctx, r.st).effects).toEqual([{ kind: 'beep' }]);
  });

  it('Ctrl-O runs the line and names the next one', () => {
    const r = keys(['Up', 'Up', 'Ctrl-O'], ctx);
    expect(r.effects).toEqual([{ kind: 'accept', line: 'off 0', andDown: 3 }]);
    expect(keys([t('x'), 'Ctrl-O'], ctx).effects).toEqual([{ kind: 'accept', line: 'x' }]);
  });

  it('afterAccept loads the next line, or a parked one', () => {
    const r = keys(['Up', 'Up'], ctx);
    const next = afterAccept(r.st, { n: 3, line: 'tc 0 2700K' });
    expect(next.buffer).toBe('tc 0 2700K');
    expect(next.hist).toBe(3);
    const parked = keys([t('half typed'), 'Ctrl-Q'], ctx);
    expect(parked.st.buffer).toBe('');
    const back = afterAccept(keys([t('off 0')], ctx, parked.st).st);
    expect(back.buffer).toBe('half typed');
    expect(back.undo).toEqual([]);
    expect(keys(['Alt-Q']).st.pushed).toEqual([]);
  });

  it('Alt-Space and Alt-! expand history in the buffer', () => {
    const c = ctxOf(['off 0'], {
      expand: (b) =>
        b.includes('!!')
          ? { ok: true, line: b.replace('!!', 'off 0') }
          : { ok: false, error: 'nope' },
    });
    expect(keys([t('!! # again'), 'Alt-Space'], c).st.buffer).toBe('off 0 # again');
    expect(keys([t('x'), 'Alt-!'], c).effects).toEqual([{ kind: 'message', text: 'nope' }]);
    expect(keys([t('x'), 'Alt-!']).st.buffer).toBe('x');
  });
});

describe('incremental search', () => {
  const ctx = ctxOf(['level 0 50%', 'scene 0 recall 3', 'off 0', 'scene 1 recall 4', 'tc 0 2700K']);

  it('finds older lines as the query grows and shows the prompt', () => {
    const r = keys(['Ctrl-R', t('sce')], ctx);
    expect(r.st.buffer).toBe('scene 1 recall 4');
    expect(statusText(r.st)).toBe('bck-i-search: sce_');
    expect(r.st.cursor).toBe(0);
    const again = keys(['Ctrl-R'], ctx, r.st);
    expect(again.st.buffer).toBe('scene 0 recall 3');
    const fail = keys(['Ctrl-R'], ctx, again.st);
    expect(fail.st.buffer).toBe('scene 0 recall 3');
    expect(statusText(fail.st)).toBe('failing bck-i-search: sce_');
  });

  it('is case-insensitive unless the query has capitals, and ^ anchors it', () => {
    expect(keys(['Ctrl-R', t('k')], ctx).st.buffer).toBe('tc 0 2700K');
    expect(keys(['Ctrl-R', t('K')], ctx).st.buffer).toBe('tc 0 2700K');
    expect(keys(['Ctrl-R', t('^off')], ctx).st.buffer).toBe('off 0');
    expect(statusText(keys(['Ctrl-R', t('^0')], ctx).st)).toBe('failing bck-i-search: ^0_');
  });

  it('Backspace backs up one step of the search', () => {
    const r = keys(['Ctrl-R', t('sce'), 'Ctrl-R', 'Backspace'], ctx);
    expect(r.st.buffer).toBe('scene 1 recall 4');
    const b = keys(['Backspace', 'Backspace', 'Backspace', 'Backspace'], ctx, r.st);
    expect(b.st.buffer).toBe('');
    expect(statusText(b.st)).toBe('bck-i-search: _');
  });

  it('Ctrl-S searches forward', () => {
    const r = keys(['Ctrl-R', t('sce'), 'Ctrl-R', 'Ctrl-S'], ctx);
    expect(r.st.buffer).toBe('scene 1 recall 4');
    expect(statusText(r.st)).toBe('fwd-i-search: sce_');
    const fwd = keys(['Alt-<', 'Ctrl-S', t('off')], ctx);
    expect(fwd.st.buffer).toBe('off 0');
  });

  it('Ctrl-R with an empty query brings back the last one', () => {
    const r = keys(['Ctrl-R', t('off'), 'Escape'], ctx);
    expect(r.st.search).toBeUndefined();
    const again = keys(['Ctrl-R', 'Ctrl-R'], ctx, r.st);
    expect(again.st.buffer).toBe('off 0');
    expect(keys(['Ctrl-R', 'Ctrl-R'], ctx).st.buffer).toBe('');
  });

  it('Escape, Ctrl-G and Ctrl-C cancel and restore the line', () => {
    for (const k of ['Escape', 'Ctrl-G', 'Ctrl-C']) {
      const r = keys([t('draft'), 'Ctrl-R', t('off'), k], ctx);
      expect(r.st.buffer).toBe('draft');
      expect(r.st.search).toBeUndefined();
      expect(r.effects).toEqual([]);
    }
  });

  it('Enter runs the line found; other keys keep it and act', () => {
    expect(keys(['Ctrl-R', t('off'), 'Enter'], ctx).effects).toEqual([
      { kind: 'accept', line: 'off 0' },
    ]);
    const e = keys(['Ctrl-R', t('off'), 'Ctrl-E'], ctx);
    expect(show(e.st)).toBe('off 0|');
    expect(e.st.search).toBeUndefined();
  });

  it('typing outside the line edits the query only while searching', () => {
    const r = keys(['Ctrl-R', t('tc'), 'Right'], ctx);
    expect(show(keys([t('!')], ctx, r.st).st)).toBe('t!|c 0 2700K');
  });
});

describe('input from the browser', () => {
  it('joins a typed character to the run, and treats a paste as its own step', () => {
    let st = emptyEditor();
    st = input(st, 'a', 1);
    st = input(st, 'ab', 2);
    st = input(st, 'ab pasted', 9);
    st = input(st, 'ab pasted', 3);
    expect(st.cursor).toBe(3);
    const u = keys(['Ctrl-_'], ctxOf(), st);
    expect(u.st.buffer).toBe('ab');
    expect(keys(['Ctrl-_'], ctxOf(), u.st).st.buffer).toBe('');
  });
});

describe('the rest', () => {
  it('Tab completes, lists, or releases focus when there is nothing to complete', () => {
    const one = ctxOf([], { complete: () => ({ from: 0, to: 3, text: 'level ', items: [] }) });
    expect(keys([t('lev'), 'Tab'], one).st.buffer).toBe('level ');
    const many = ctxOf([], {
      complete: () => ({ from: 0, to: 1, text: 'l', items: ['level', 'lock'] }),
    });
    expect(keys([t('l'), 'Tab'], many).effects).toEqual([
      { kind: 'list', items: ['level', 'lock'] },
    ]);
    expect(keys(['Tab']).effects).toEqual([{ kind: 'release' }]);
  });

  it('accept, clear, break, help, interrupt and escape', () => {
    expect(keys([t('off 0'), 'Ctrl-J']).effects).toEqual([{ kind: 'accept', line: 'off 0' }]);
    expect(keys([t('x'), 'Ctrl-L']).effects).toEqual([{ kind: 'clear' }]);
    expect(keys([t('x'), 'Ctrl-G']).st.buffer).toBe('');
    expect(keys([t('scene 0'), 'Alt-H']).effects).toEqual([{ kind: 'help', topic: 'scene' }]);
    const c = keys([t('x'), 'Ctrl-C']);
    expect(c.st.buffer).toBe('');
    expect(c.effects).toEqual([{ kind: 'interrupt' }]);
    expect(keys(['Escape']).effects).toEqual([{ kind: 'release' }]);
  });
});
