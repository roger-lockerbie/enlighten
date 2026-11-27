/** U-script: every statement, every limit, and every error with its line (ADR 0007). */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import type { ParseContext } from '../console/parse.ts';
import { BUILTIN_SCRIPTS, builtin } from './builtin.ts';
import {
  MAX_ERRORS,
  MAX_STEPS,
  NOT_IN_SCRIPTS,
  parseScript,
  scriptNameProblem,
  type ScriptResult,
} from './parse.ts';
import { printScript } from './print.ts';

const ctx: ParseContext = { aliases: new Map([['tw', 0]]) };

const steps = (r: ScriptResult) => (r.ok ? r.steps.map((s) => [s.line, s.command.cmd]) : r.errors);
const errors = (r: ScriptResult) => (r.ok ? [] : r.errors.map((e) => [e.line, e.text]));

describe('parseScript', () => {
  it('reads commands, wait, pause, echo, comments and blank lines', () => {
    const r = parseScript(
      [
        '# a comment',
        '',
        'level tw 50%  # set it',
        'wait 2s',
        'pause "Look"',
        'echo done',
        'off 0',
      ].join('\n'),
      ctx,
    );
    expect(steps(r)).toEqual([
      [3, 'level'],
      [4, 'wait'],
      [5, 'pause'],
      [6, 'echo'],
      [7, 'off'],
    ]);
    expect(r.ok && r.steps[0]?.command).toEqual({ cmd: 'level', to: [short(0)], arc: 229 });
  });

  it('takes Windows and old Mac line ends', () => {
    expect(steps(parseScript('off 0\r\non 0\roff 1', ctx))).toEqual([
      [1, 'off'],
      [2, 'on'],
      [3, 'off'],
    ]);
  });

  it('expands repeat blocks, nested twice', () => {
    const r = parseScript(
      ['repeat 2', '  off 0', '  repeat 3', '    on 0', '  end', 'end', 'echo x'].join('\n'),
      ctx,
    );
    expect(r.ok && r.steps.map((s) => s.line)).toEqual([2, 4, 4, 4, 2, 4, 4, 4, 7]);
  });

  it('reports each error with its line, and keeps going', () => {
    const r = parseScript(
      [
        'level 0',
        'frob',
        'unlock reset',
        'end',
        'repeat 0',
        'end',
        'repeat x',
        'end x',
        'echo "open',
      ].join('\n'),
      ctx,
    );
    expect(errors(r)).toEqual([
      [1, 'level needs a value, such as 35% or 128.'],
      [2, 'Unknown command "frob". Type "help" for the list.'],
      [3, 'unlock cannot be used in a script.'],
      [4, 'end without a repeat.'],
      [5, 'repeat takes a count from 1 to 1000.'],
      [7, 'repeat takes a count from 1 to 1000.'],
      [8, 'end takes nothing more.'],
      [9, 'A double quote is not closed.'],
    ]);
  });

  it('refuses every command a script may not use', () => {
    const lines: Record<string, string> = {
      unlock: 'unlock rate',
      lock: 'lock',
      target: 'target sim',
      run: 'run x',
      history: 'history',
      clear: 'clear',
      use: 'use 0',
      resume: 'resume',
      scripts: 'scripts',
      explain: 'explain off 0',
      manual: 'manual',
    };
    for (const c of NOT_IN_SCRIPTS) {
      const line = lines[c] ?? c;
      expect(errors(parseScript(line, ctx))).toEqual([[1, `${c} cannot be used in a script.`]]);
    }
    // Lowering the ceiling is allowed; a raise is refused when it runs.
    expect(steps(parseScript('cap 30%', ctx))).toEqual([[1, 'cap']]);
  });

  it('checks the limits before anything runs', () => {
    expect(errors(parseScript('x'.repeat(64 * 1024 + 1), ctx))).toEqual([
      [0, 'A script is at most 64 kB.'],
    ]);
    expect(errors(parseScript('é'.repeat(33 * 1024), ctx))).toEqual([
      [0, 'A script is at most 64 kB.'],
    ]);
    expect(errors(parseScript('\n'.repeat(2000), ctx))).toEqual([
      [0, 'A script is at most 2000 lines.'],
    ]);
    expect(errors(parseScript(`echo ${'x'.repeat(500)}`, ctx))).toEqual([
      [1, 'A line is at most 500 characters.'],
    ]);
    expect(errors(parseScript('repeat 1001\nend', ctx))).toEqual([
      [1, 'repeat takes a count from 1 to 1000.'],
    ]);
    expect(errors(parseScript('repeat 2\nrepeat 2\nrepeat 2\noff 0\nend\nend\nend', ctx))).toEqual([
      [3, 'repeat is nested at most 2 deep.'],
    ]);
    expect(errors(parseScript('repeat 2\noff 0', ctx))).toEqual([[1, 'repeat without an end.']]);
    expect(errors(parseScript('repeat 1000\nrepeat 11\noff 0\nend\nend', ctx))).toEqual([
      [0, `A script runs at most ${String(MAX_STEPS)} steps once repeats are counted.`],
    ]);
    expect(parseScript('repeat 1000\nrepeat 10\noff 0\nend\nend', ctx).ok).toBe(true);
    const many = parseScript(Array.from({ length: 80 }, () => 'frob').join('\n'), ctx);
    expect(errors(many)).toHaveLength(MAX_ERRORS);
  });

  it('a quoted first word is not a command', () => {
    expect(errors(parseScript('"repeat" 2', ctx))).toEqual([
      [1, 'A line starts with a command name.'],
    ]);
  });
});

describe('printScript', () => {
  it('prints back a script that parses to the same steps', () => {
    const text = [
      '# note',
      'repeat 2',
      'level 0 50% # x',
      'pause "a  b"',
      'rgb 1 #ff0000',
      'end',
      'echo ""',
    ].join('\n');
    const r = parseScript(text, ctx);
    if (!r.ok) throw new Error('parse');
    const printed = printScript(r.items);
    expect(printed).toBe(
      ['repeat 2', '  level 0 50%', '  pause "a  b"', '  rgb 1 #ff0000', 'end', 'echo ""'].join(
        '\n',
      ),
    );
    const again = parseScript(printed, ctx);
    expect(again.ok && again.steps.map((s) => s.command)).toEqual(r.steps.map((s) => s.command));
  });
});

describe('script names', () => {
  it('checks names', () => {
    expect(scriptNameProblem('first-light')).toBeUndefined();
    expect(scriptNameProblem('My script 2.1')).toBeUndefined();
    expect(scriptNameProblem('')).toBeDefined();
    expect(scriptNameProblem('x'.repeat(61))).toBeDefined();
    expect(scriptNameProblem('-x')).toBeDefined();
    expect(scriptNameProblem('a/b')).toBeDefined();
  });
});

describe('built-in scripts', () => {
  it('first-light parses, and follows tools/first_light.py step for step', () => {
    const fl = builtin('First-Light');
    expect(fl?.name).toBe('first-light');
    expect(builtin('nope')).toBeUndefined();
    for (const s of BUILTIN_SCRIPTS) expect(parseScript(s.text, ctx).ok).toBe(true);
    const r = parseScript(fl?.text ?? '', ctx);
    if (!r.ok) throw new Error('parse');
    const pauses = r.steps.filter((s) => s.command.cmd === 'pause');
    // Steps 1 to 6, and five colours in step 7, as in the Python.
    expect(pauses).toHaveLength(11);
    expect(r.steps.map((s) => s.command.cmd).filter((c) => c === 'rgb')).toHaveLength(5);
    expect(r.steps[r.steps.length - 1]?.command).toEqual({
      cmd: 'echo',
      text: 'Done. Both tapes off.',
    });
  });
});
