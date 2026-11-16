/**
 * The console's page side (SPEC section 6, ADR 0006, ADR 0014). It holds the line editor, history and
 * its expansion, the scrollback, and the inline confirmations. Lines that need the engine go to the
 * bus worker as text, which parses them again and runs them with the source `console`. The commands
 * that only touch the page run here: history, clear, help, use, scripts, trace, and the start of run.
 */
import { complete } from '../console/complete.ts';
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
} from '../console/editor.ts';
import { help } from '../console/help.ts';
import { expand, History, historyList, type HistoryEntry } from '../console/history.ts';
import { widgetFor, type KeyPress, type Platform } from '../console/keys.ts';
import { aliasProblem, parseLine, type ParseContext } from '../console/parse.ts';
import type { ConsoleLineKind } from '../engine/console.ts';
import type { Snapshot } from '../engine/engine.ts';
import { aliasContext, consoleContext, type Alias } from '../engine/protocol.ts';
import { BUILTIN_SCRIPTS, builtin } from '../script/builtin.ts';
import type { StoredScript } from '../store/schema.ts';
import { timeText } from './format.ts';
import type { AppState } from './state.svelte.ts';

/** Lines the scrollback keeps. */
export const SCROLLBACK = 2000;

export type OutKind = ConsoleLineKind | 'input' | 'trace';

export interface OutLine {
  readonly id: number;
  readonly kind: OutKind;
  readonly text: string;
}

interface Confirm {
  /** What to type, compared without case. */
  readonly expect: string;
  readonly run: () => void;
}

/** The platform for the key legend: a Mac, or an app window, can use the keys a browser tab keeps. */
export function platform(): Platform {
  const mac = /Mac/i.test(navigator.platform);
  const app = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)');
  return mac || app.matches ? 'mac' : 'other';
}

export function keyPress(e: KeyboardEvent): KeyPress {
  return {
    key: e.key,
    code: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  };
}

export class ConsoleState {
  private readonly app: AppState;
  ed = $state<EditorState>(emptyEditor());
  out = $state<OutLine[]>([]);
  /** Completion candidates, or a message, under the input. */
  list = $state<readonly string[]>([]);
  message = $state('');
  /** The newest refusal, fault or panic, for the alert region. */
  alert = $state('');
  confirm = $state<Confirm | undefined>(undefined);
  /** A line is running in the worker. */
  busy = $state(false);
  trace = $state(false);
  /** The default target set by `use`, as typed. */
  use = $state<string | undefined>(undefined);
  /** The expanded line waiting for a second Enter (verify mode). */
  private verified: string | undefined;
  readonly history: History;
  private nextId = 1;
  private consoleSeq = 0;
  private traceSeq = 0;
  readonly platform: Platform;

  constructor(app: AppState, stored: readonly { line: string; at: number }[], p: Platform) {
    this.app = app;
    this.platform = p;
    this.history = new History(stored, {
      limit: app.prefs.historyLength,
      ignoreSpace: app.prefs.historyIgnoreSpace,
    });
    this.historyLines = this.history.lines;
  }

  /** History as a reactive list, for the editor. */
  historyLines = $state<readonly HistoryEntry[]>([]);

  setHistoryOptions(limit: number, ignoreSpace: boolean): void {
    this.history.setOptions({ limit, ignoreSpace });
    this.historyLines = this.history.lines;
  }

  // -----------------------------------------------------------------------------------------------
  // Output

  print(kind: OutKind, text: string): void {
    const next = [...this.out, { id: this.nextId++, kind, text }];
    this.out = next.length > SCROLLBACK ? next.slice(-SCROLLBACK) : next;
    if (kind === 'refused' || kind === 'fault') this.alert = text;
  }

  /** New lines from the worker, and the monitor in trace mode. */
  onSnapshot(s: Snapshot): void {
    for (const l of s.console) {
      if (l.seq <= this.consoleSeq) continue;
      this.consoleSeq = l.seq;
      this.print(l.kind, l.text);
    }
    for (const m of s.monitor) {
      if (m.seq <= this.traceSeq) continue;
      this.traceSeq = m.seq;
      if (this.trace)
        this.print(
          'trace',
          `${m.target === 'hardware' ? 'hw' : 'sim'} ${m.source} ${m.frame} ${m.text}: ${m.result}`,
        );
    }
  }

  /** What the status line shows: a search, a confirmation, a pause, or a verify note. */
  get status(): string {
    const search = statusText(this.ed);
    if (search !== '') return search;
    if (this.confirm !== undefined)
      return `Type ${this.confirm.expect} and Enter to go on. Escape cancels.`;
    const paused = this.app.snap?.script?.paused;
    if (paused !== undefined) return `${paused} Enter goes on, Ctrl-C stops.`;
    if (this.verified !== undefined && this.ed.buffer === this.verified)
      return 'History expanded. Enter runs it.';
    return this.message;
  }

  get prompt(): string {
    return this.confirm === undefined ? '>' : 'confirm>';
  }

  /** Something would be lost by leaving: a half-typed line, or a script running. */
  get guarded(): boolean {
    return this.ed.buffer.trim() !== '' || this.app.snap?.script !== undefined;
  }

  // -----------------------------------------------------------------------------------------------
  // Context

  private aliases(): Alias[] {
    return this.app.prefs.aliases
      .filter((a) => aliasProblem(a.alias) === undefined)
      .map((a) => [a.alias, a.address] as const);
  }

  /** The same context the worker builds, so the page and the worker parse alike. */
  private parseContext(): ParseContext {
    const c = consoleContext(this.aliases(), this.use);
    return c.ok ? c.ctx : aliasContext(this.aliases());
  }

  scriptNames(): string[] {
    return [...BUILTIN_SCRIPTS.map((s) => s.name), ...this.app.scripts.map((s) => s.name)];
  }

  private editorContext(): EditorContext {
    return {
      history: this.historyLines,
      complete: (b, c) =>
        complete(b, c, {
          addresses: (this.app.snap?.devices ?? []).map((d) => d.address),
          aliases: this.aliases().map(([n]) => n),
          scripts: this.scriptNames(),
        }),
      expand: (b) => {
        const r = expand(b, this.historyLines);
        if (r.kind === 'error') return { ok: false, error: r.message };
        return { ok: true, line: r.kind === 'ok' ? r.line : b };
      },
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Keys and input

  /**
   * A key in the input. Returns true when the console handled it, so the caller prevents the
   * browser's default. Tab with nothing to complete, and keys with no binding, are left alone.
   */
  key(k: KeyPress, hasSelection: boolean): { handled: boolean; release?: boolean } {
    // Ctrl-C with a selection copies, as everywhere else.
    if (k.ctrl && !k.alt && !k.meta && k.key.toLowerCase() === 'c' && hasSelection)
      return { handled: false };
    // Enter at a script's pause goes on, whatever the line holds.
    if (
      k.key === 'Enter' &&
      !k.ctrl &&
      !k.alt &&
      this.app.snap?.script?.paused !== undefined &&
      this.ed.buffer.trim() === '' &&
      this.ed.search === undefined
    ) {
      void this.app.call({ op: 'scriptContinue' });
      return { handled: true };
    }
    // Typing while a search is open goes to the search.
    if (this.ed.search !== undefined && !k.ctrl && !k.alt && !k.meta && k.key.length === 1) {
      this.ed = typeText(this.ed, this.editorContext(), k.key);
      return { handled: true };
    }
    const w = widgetFor(k);
    if (w === undefined) return { handled: false };
    if (w === 'escape' && this.confirm !== undefined) {
      this.confirm = undefined;
      this.print('note', 'Not confirmed.');
      return { handled: true };
    }
    const r = apply(this.ed, w, this.editorContext());
    if (r.effect?.kind !== 'list') this.list = [];
    if (r.effect?.kind === 'release') {
      this.ed = r.state;
      return { handled: false, release: true };
    }
    this.ed = r.state;
    this.message = '';
    if (r.effect !== undefined) this.effect(r.effect);
    return { handled: true };
  }

  /** The browser changed the input: typing, paste, IME or a cut. */
  input(value: string, cursor: number): void {
    this.ed = input(this.ed, value, cursor);
    this.list = [];
  }

  private effect(e: Effect): void {
    switch (e.kind) {
      case 'accept':
        this.accept(e.line, e.andDown);
        return;
      case 'list':
        this.list = e.items;
        return;
      case 'clear':
        this.out = [];
        return;
      case 'interrupt':
        this.print('input', `${this.prompt} ${this.ed.buffer}^C`);
        this.ed = afterAccept(this.ed);
        this.confirm = undefined;
        if (this.busy || this.app.snap?.script !== undefined)
          void this.app.call({ op: 'stopConsole' });
        return;
      case 'release':
        return;
      case 'help':
        for (const l of help(e.topic, this.platform)) this.print('out', l);
        return;
      case 'beep':
        this.message = 'Nothing there.';
        return;
      case 'message':
        this.message = e.text;
        return;
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Running a line

  private accept(raw: string, andDown?: number): void {
    const next = andDown === undefined ? undefined : this.historyLines.find((l) => l.n === andDown);
    this.ed = afterAccept(this.ed, next);
    this.print('input', `${this.prompt} ${raw}`);
    const c = this.confirm;
    if (c !== undefined) {
      this.confirm = undefined;
      if (raw.trim().toLowerCase() === c.expect.toLowerCase()) c.run();
      else this.print('note', 'Not confirmed. Nothing changed.');
      return;
    }
    let line = raw;
    if (raw !== this.verified) {
      const x = expand(raw, this.historyLines);
      if (x.kind === 'error') {
        this.print('error', x.message);
        return;
      }
      if (x.kind === 'ok') {
        if (x.print) {
          this.print('out', x.line);
          this.remember(x.line);
          return;
        }
        if (this.app.prefs.verifyMode) {
          // zsh's HIST_VERIFY: the expanded line comes back to the input, and Enter runs it.
          this.verified = x.line;
          this.ed = { ...this.ed, buffer: x.line, cursor: x.line.length };
          return;
        }
        this.print('out', x.line);
        line = x.line;
      }
    }
    this.verified = undefined;
    this.remember(line);
    this.run(line);
  }

  private remember(line: string): void {
    const r = this.history.add(line, Date.now());
    this.historyLines = this.history.lines;
    if (r.kind === 'added')
      this.app.store
        .appendHistory({ line: r.entry.line, at: r.entry.at }, this.app.prefs.historyLength)
        .catch(() => {
          this.message = 'History could not be saved.';
        });
  }

  /** Run a line: a page command here, anything else in the worker. */
  run(line: string): void {
    const p = parseLine(line, this.parseContext());
    if (!p.ok) {
      this.print('error', p.error);
      return;
    }
    const c = p.command;
    if (c === undefined) return;
    switch (c.cmd) {
      case 'history':
        this.historyCommand(c.args);
        return;
      case 'clear':
        this.out = [];
        return;
      case 'help':
        for (const l of help(c.topic, this.platform)) this.print('out', l);
        return;
      case 'use':
        if (c.to === undefined) {
          this.use = undefined;
          this.print('out', 'No default target.');
        } else {
          this.use = line.trim().split(/\s+/)[1] ?? '';
          this.print('out', `Commands with no address go to ${this.use}.`);
        }
        return;
      case 'scripts':
        for (const s of BUILTIN_SCRIPTS) this.print('out', `${s.name} (built in)`);
        for (const s of this.app.scripts) this.print('out', s.name);
        return;
      case 'trace':
        this.trace = c.on ?? !this.trace;
        this.print('out', `Trace ${this.trace ? 'on: every frame is shown here' : 'off'}.`);
        return;
      case 'run':
        this.runScript(c.name);
        return;
      case 'panic':
        this.app.client.panic();
        this.alert = 'Panic: everything stopped and every light sent OFF.';
        this.print(
          'note',
          'Panic: everything stopped and every light sent OFF. Type resume to go on.',
        );
        return;
      case 'unlock':
        this.ask(
          `Unlock ${c.name} until the page reloads? ${UNLOCK_TEXT[c.name]} Type ${c.name} to confirm.`,
          c.name,
          () => {
            this.send(line, true);
          },
        );
        return;
      case 'cap': {
        const now = this.app.snap?.ceilingArc ?? this.app.prefs.ceilingArc;
        if (c.arc !== undefined && c.arc > now) {
          const typed = line.trim().split(/\s+/)[1] ?? String(c.arc);
          this.ask(
            `Raise the ceiling from arc level ${String(now)} to ${String(c.arc)}? Every driver's MAX LEVEL is rewritten. Type ${typed} to confirm.`,
            typed,
            () => {
              this.send(line, true);
            },
          );
          return;
        }
        this.send(line, false);
        return;
      }
      default:
        this.send(line, false);
    }
  }

  private ask(text: string, expect: string, run: () => void): void {
    this.print('note', text);
    this.confirm = { expect, run };
  }

  private historyCommand(args: readonly string[]): void {
    if (args.includes('-c')) {
      this.ask('Clear the console history in this browser? Type yes to confirm.', 'yes', () => {
        this.history.clear();
        this.historyLines = this.history.lines;
        void this.app.store.saveHistory([]);
        this.print('out', 'History cleared.');
      });
      return;
    }
    const r = historyList(this.history.lines, args, timeText);
    if (!r.ok) {
      this.print('error', r.error);
      return;
    }
    for (const l of r.lines) this.print('out', l);
  }

  private send(line: string, confirmed: boolean): void {
    this.busy = true;
    void this.app
      .call({
        op: 'console',
        line,
        aliases: this.aliases(),
        ...(this.use === undefined ? {} : { use: this.use }),
        ...(confirmed ? { confirmed } : {}),
      })
      .finally(() => {
        this.busy = false;
      });
  }

  runScript(name: string): void {
    const b = builtin(name);
    const s: StoredScript | undefined =
      b ?? this.app.scripts.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (s === undefined) {
      this.print('error', `No script called "${name}". Type scripts for the list.`);
      return;
    }
    this.busy = true;
    void this.app
      .call({ op: 'runScript', name: s.name, text: s.text, aliases: this.aliases() })
      .finally(() => {
        this.busy = false;
      });
  }

  /** Run a line as if typed, from another page (the Scripts page's Run). */
  submit(line: string): void {
    this.print('input', `${this.prompt} ${line}`);
    this.remember(line);
    this.run(line);
  }
}

const UNLOCK_TEXT: Readonly<Record<'rate' | 'reset' | 'expert', string>> = {
  rate: 'The swing limit can then be set to 2 or 3 a second. Nothing allows more than 3.',
  reset:
    'RESET, addressing and the search commands are then allowed from a typed line. RESET sends a driver to full output for 300 ms.',
  expert:
    'Commands that store colour limits, gear features or a dimming curve are then allowed, each with a read-back.',
};
