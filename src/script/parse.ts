/**
 * The script format (SPEC section 7, ADR 0007). A script is data: plain text, one statement a line,
 * parsed whole into a list of steps before anything runs. No variables, expressions, conditions,
 * functions or includes. `repeat` takes a literal count. The parser never throws: it returns the steps,
 * or every error it found with its line number.
 */
import { lex, type Token } from '../console/lex.ts';
import {
  parseLine,
  type CommandName,
  type ConsoleCommand,
  type ParseContext,
} from '../console/parse.ts';

export const MAX_BYTES = 64 * 1024;
export const MAX_LINES = 2000;
export const MAX_LINE_CHARS = 500;
export const MAX_REPEAT = 1000;
export const MAX_NESTING = 2;
export const MAX_STEPS = 10_000;
/** The parser stops listing errors after this many. */
export const MAX_ERRORS = 50;
export const MAX_SCRIPT_NAME = 60;

/** Commands a script may not use (SPEC section 7). `cap` above the present ceiling is refused when run. */
export const NOT_IN_SCRIPTS: readonly CommandName[] = [
  'unlock',
  'lock',
  'target',
  'run',
  'history',
  'clear',
  'use',
  'resume',
  'scripts',
  'explain',
  'manual',
];

export interface Step {
  /** The line in the script, from 1. */
  readonly line: number;
  /** The statement as written, without its comment, for the console. */
  readonly text: string;
  readonly command: ConsoleCommand;
}

/** The script as written: statements and repeat blocks, for printing it back. */
export type Item =
  | {
      readonly kind: 'statement';
      readonly line: number;
      readonly tokens: readonly Token[];
      readonly command: ConsoleCommand;
    }
  | {
      readonly kind: 'repeat';
      readonly line: number;
      readonly count: number;
      readonly body: readonly Item[];
    };

export interface ScriptError {
  readonly line: number;
  readonly text: string;
}

export type ScriptResult =
  | { readonly ok: true; readonly steps: readonly Step[]; readonly items: readonly Item[] }
  | { readonly ok: false; readonly errors: readonly ScriptError[] };

const encoder = new TextEncoder();

/** A word as it was written: quoted words in double quotes. */
export const tokenText = (t: Token): string => (t.quoted ? `"${t.text}"` : t.text);

/** A script name: a letter or digit, then letters, digits, spaces, dots, hyphens and underscores. */
export function scriptNameProblem(name: string): string | undefined {
  if (name.length === 0 || name.length > MAX_SCRIPT_NAME)
    return `A script name is 1 to ${String(MAX_SCRIPT_NAME)} characters.`;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name))
    return 'A script name starts with a letter or digit, and has only letters, digits, spaces, dots, - and _.';
  return undefined;
}

interface Frame {
  readonly line: number;
  readonly count: number;
  readonly body: Item[];
}

function count(items: readonly Item[]): number {
  let n = 0;
  for (const it of items) {
    n += it.kind === 'statement' ? 1 : it.count * count(it.body);
    if (n > MAX_STEPS) return n;
  }
  return n;
}

function flatten(items: readonly Item[], out: Step[]): void {
  for (const it of items) {
    if (it.kind === 'statement')
      out.push({ line: it.line, text: it.tokens.map(tokenText).join(' '), command: it.command });
    else for (let i = 0; i < it.count; i++) flatten(it.body, out);
  }
}

export function parseScript(text: string, ctx: ParseContext): ScriptResult {
  if (encoder.encode(text).length > MAX_BYTES)
    return {
      ok: false,
      errors: [{ line: 0, text: `A script is at most ${String(MAX_BYTES / 1024)} kB.` }],
    };
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > MAX_LINES)
    return {
      ok: false,
      errors: [{ line: 0, text: `A script is at most ${String(MAX_LINES)} lines.` }],
    };
  const errors: ScriptError[] = [];
  const add = (line: number, t: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ line, text: t });
  };
  const top: Item[] = [];
  const stack: Frame[] = [];
  const here = () => stack[stack.length - 1]?.body ?? top;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.length > MAX_LINE_CHARS) {
      add(line, `A line is at most ${String(MAX_LINE_CHARS)} characters.`);
      return;
    }
    const lexed = lex(raw);
    if (!lexed.ok) {
      add(line, lexed.error);
      return;
    }
    const [head, ...args] = lexed.tokens;
    if (head === undefined) return;
    const word = head.quoted ? '' : head.text.toLowerCase();
    if (word === 'repeat') {
      const v = args[0];
      const n =
        v === undefined || args.length > 1 || !/^\d{1,4}$/.test(v.text) ? NaN : Number(v.text);
      if (!(n >= 1 && n <= MAX_REPEAT)) {
        add(line, `repeat takes a count from 1 to ${String(MAX_REPEAT)}.`);
        // Keep the block open so its end still matches.
      }
      if (stack.length >= MAX_NESTING)
        add(line, `repeat is nested at most ${String(MAX_NESTING)} deep.`);
      stack.push({ line, count: n >= 1 && n <= MAX_REPEAT ? n : 1, body: [] });
      return;
    }
    if (word === 'end') {
      if (args.length > 0) add(line, 'end takes nothing more.');
      const f = stack.pop();
      if (f === undefined) {
        add(line, 'end without a repeat.');
        return;
      }
      here().push({ kind: 'repeat', line: f.line, count: f.count, body: f.body });
      return;
    }
    const r = parseLine(raw, ctx);
    if (!r.ok) {
      add(line, r.error);
      return;
    }
    const command = r.command;
    if (command === undefined) return;
    if (NOT_IN_SCRIPTS.includes(command.cmd)) {
      add(line, `${command.cmd} cannot be used in a script.`);
      return;
    }
    here().push({ kind: 'statement', line, tokens: lexed.tokens, command });
  });
  for (const f of stack) add(f.line, 'repeat without an end.');
  if (errors.length > 0) return { ok: false, errors };
  if (count(top) > MAX_STEPS)
    return {
      ok: false,
      errors: [
        {
          line: 0,
          text: `A script runs at most ${String(MAX_STEPS)} steps once repeats are counted.`,
        },
      ],
    };
  const steps: Step[] = [];
  flatten(top, steps);
  return { ok: true, steps, items: top };
}
