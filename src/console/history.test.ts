/** U-console: history rules, expansion and the `history` command. */
import { describe, expect, it } from 'vitest';
import {
  expand,
  History,
  historyList,
  historyWords,
  mergeStored,
  reduceBlanks,
  type Expansion,
} from './history.ts';

const opts = { limit: 1000, ignoreSpace: false };

function hist(lines: string[], o = opts): History {
  const h = new History([], o);
  lines.forEach((l, i) => h.add(l, i));
  return h;
}

const ok = (line: string, print = false): Partial<Expansion> => ({ kind: 'ok', line, print });

describe('History', () => {
  it('numbers lines from 1 and keeps the numbers fixed', () => {
    const h = new History(
      [
        { line: 'a', at: 1 },
        { line: 'b', at: 2 },
      ],
      opts,
    );
    expect(h.lines.map((e) => [e.n, e.line])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    h.add('c', 3);
    expect(h.lines.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it('drops a duplicate of the line before, which uses no number', () => {
    const h = hist(['off 0', 'off 0', 'on 0', 'off   0']);
    expect(h.lines.map((e) => [e.n, e.line])).toEqual([
      [1, 'off 0'],
      [2, 'on 0'],
      [3, 'off 0'],
    ]);
    expect(h.add('  ', 9)).toEqual({ kind: 'skipped' });
  });

  it('trims the oldest past the limit, and never reuses their numbers', () => {
    const h = hist(['a', 'b', 'c', 'd'], { limit: 2, ignoreSpace: false });
    expect(h.lines.map((e) => [e.n, e.line])).toEqual([
      [3, 'c'],
      [4, 'd'],
    ]);
    h.setOptions({ limit: 1, ignoreSpace: false });
    expect(h.kept.map((e) => e.line)).toEqual(['d']);
    expect(h.options.limit).toBe(1);
    const loaded = new History(
      ['a', 'b', 'c'].map((line, at) => ({ line, at })),
      { limit: 2, ignoreSpace: false },
    );
    expect(loaded.lines.map((e) => [e.n, e.line])).toEqual([
      [1, 'b'],
      [2, 'c'],
    ]);
  });

  it('keeps a line starting with a space out when asked, but lets it linger for one Up', () => {
    const h = hist(['off 0'], { limit: 1000, ignoreSpace: true });
    const r = h.add(' secret 1', 5);
    expect(r.kind).toBe('lingering');
    expect(h.lines.map((e) => e.line)).toEqual(['off 0', 'secret 1']);
    expect(h.kept.map((e) => e.line)).toEqual(['off 0']);
    const next = h.add('on 0', 6);
    expect(next.kind === 'added' && next.entry.n).toBe(2);
    expect(h.lines.map((e) => e.line)).toEqual(['off 0', 'on 0']);
    // With the rule off, the line is kept, blanks reduced.
    expect(hist([' x']).lines.map((e) => e.line)).toEqual(['x']);
  });

  it('keeps the history command itself out', () => {
    const h = hist(['off 0', 'history', 'history -c']);
    expect(h.kept.map((e) => e.line)).toEqual(['off 0']);
  });

  it('clears', () => {
    const h = hist(['a', 'b']);
    h.clear();
    expect(h.lines).toEqual([]);
    expect(h.add('c', 1)).toMatchObject({ kind: 'added', entry: { n: 3 } });
  });
});

describe('reduceBlanks and words', () => {
  it('folds blanks outside double quotes', () => {
    expect(reduceBlanks('  pause   "a   b"   x ')).toBe('pause "a   b" x');
    expect(historyWords('echo "a b" c')).toEqual(['echo', '"a b"', 'c']);
    expect(historyWords('   ')).toEqual([]);
  });
});

describe('mergeStored', () => {
  it('appends to what another tab stored, without a duplicate, within the limit', () => {
    const stored = [
      { line: 'a', at: 1 },
      { line: 'b', at: 2 },
    ];
    expect(mergeStored(stored, { line: 'c', at: 3 }, 2).map((s) => s.line)).toEqual(['b', 'c']);
    expect(mergeStored(stored, { line: 'b', at: 3 }, 5).map((s) => s.line)).toEqual(['a', 'b']);
  });
});

describe('expand', () => {
  const ev = hist(['level 0 50%', 'tc 0 2700K', 'scene 1 recall 4', 'off 0']).lines;

  it('leaves a line with no reference alone', () => {
    expect(expand('level 0 10', ev)).toEqual({ kind: 'none' });
    expect(expand('echo hi! there', ev)).toEqual({ kind: 'none' });
    expect(expand('x != y', ev)).toEqual({ kind: 'none' });
    expect(expand('a!=b !(c)', ev)).toEqual({ kind: 'none' });
    expect(expand('end!', ev)).toEqual({ kind: 'none' });
  });

  it('expands the event forms', () => {
    expect(expand('!!', ev)).toMatchObject(ok('off 0'));
    expect(expand('!1', ev)).toMatchObject(ok('level 0 50%'));
    expect(expand('!-2', ev)).toMatchObject(ok('scene 1 recall 4'));
    expect(expand('!tc', ev)).toMatchObject(ok('tc 0 2700K'));
    expect(expand('!?recall?', ev)).toMatchObject(ok('scene 1 recall 4'));
    expect(expand('!?recall', ev)).toMatchObject(ok('scene 1 recall 4'));
    expect(expand('!?50?; echo', ev)).toMatchObject(ok('level 0 50%; echo'));
    expect(expand('echo !! and !!', ev)).toMatchObject(ok('echo off 0 and off 0'));
  });

  it('picks words', () => {
    const e = hist(['level 0 50%']).lines;
    expect(expand('query !^', e)).toMatchObject(ok('query 0'));
    expect(expand('echo !$', e)).toMatchObject(ok('echo 50%'));
    expect(expand('tc !*', e)).toMatchObject(ok('tc 0 50%'));
    expect(expand('x !!:$', e)).toMatchObject(ok('x 50%'));
    expect(expand('x !1:^', e)).toMatchObject(ok('x 0'));
    expect(expand('x !l:*', e)).toMatchObject(ok('x 0 50%'));
    expect(expand('x !$', hist(['off']).lines)).toEqual({
      kind: 'error',
      message: 'enlighten: bad word specifier',
    });
    expect(expand('x !*', hist(['off']).lines)).toMatchObject(ok('x '));
  });

  it('substitutes with :s, :gs, :& and ^old^new', () => {
    const e = hist(['level 0 50% fade 0']).lines;
    expect(expand('!!:s/0/1/', e)).toMatchObject(ok('level 1 50% fade 0'));
    expect(expand('!!:gs/0/1/', e)).toMatchObject(ok('level 1 51% fade 1'));
    expect(expand('!!:s/50/&&/', e)).toMatchObject(ok('level 0 5050% fade 0'));
    expect(expand('!!:s/50/\\&/', e)).toMatchObject(ok('level 0 &% fade 0'));
    expect(expand('!!:s|0|9', e)).toMatchObject(ok('level 9 50% fade 0'));
    expect(expand('^0^7', e)).toMatchObject(ok('level 7 50% fade 0'));
    expect(expand('^0^7^ x', e)).toMatchObject(ok('level 7 50% fade 0 x'));
    expect(expand('^0^7^:p', e)).toMatchObject(ok('level 7 50% fade 0', true));
    const first = expand('!!:s/fade/f/', e);
    expect(first.kind === 'ok' && first.sub).toEqual({ from: 'fade', to: 'f' });
    expect(expand('!!:&', e, { from: '0', to: '2' })).toMatchObject(ok('level 2 50% fade 0'));
    expect(expand('!!:g&', e, { from: '0', to: '2' })).toMatchObject(ok('level 2 52% fade 2'));
    expect(expand('!!:s//3/', e, { from: '50', to: 'x' })).toMatchObject(ok('level 0 3% fade 0'));
    expect(expand('!!:&', e)).toEqual({
      kind: 'error',
      message: 'enlighten: no previous substitution',
    });
    expect(expand('!!:x', e)).toMatchObject(ok('level 0 50% fade 0:x'));
  });

  it('prints without running with :p', () => {
    expect(expand('!!:p', ev)).toMatchObject(ok('off 0', true));
  });

  it('gives zsh errors', () => {
    expect(expand('!nosuch', ev)).toEqual({
      kind: 'error',
      message: 'enlighten: event not found: nosuch',
    });
    expect(expand('!?zzz?', ev)).toEqual({
      kind: 'error',
      message: 'enlighten: no such event: zzz',
    });
    expect(expand('!99', ev)).toEqual({ kind: 'error', message: 'enlighten: no such event: 99' });
    expect(expand('!-9', ev)).toEqual({ kind: 'error', message: 'enlighten: no such event: -9' });
    expect(expand('^nomatch^x', ev)).toEqual({
      kind: 'error',
      message: 'enlighten: substitution failed',
    });
    expect(expand('!!', [])).toEqual({ kind: 'error', message: 'enlighten: no such event: !' });
    expect(expand('!$', [])).toEqual({ kind: 'error', message: 'enlighten: no such event: !' });
    expect(expand('^a^b', [])).toEqual({ kind: 'error', message: 'enlighten: no such event: !' });
    expect(expand('!??', ev)).toEqual({ kind: 'error', message: 'enlighten: no such event: ' });
  });

  it('a backslash or single quotes keep a ! as it is', () => {
    expect(expand('echo \\!!', ev)).toMatchObject(ok('echo !!'));
    expect(expand("echo '!!' !!", ev)).toMatchObject(ok("echo '!!' off 0"));
  });

  it('does not nest, and refuses a line that grows too long', () => {
    const e = hist(['echo !!']).lines;
    expect(expand('!!', e)).toMatchObject(ok('echo !!'));
    const long = hist(['x'.repeat(300)]).lines;
    expect(expand('!! !!', long)).toEqual({
      kind: 'error',
      message: 'enlighten: the expanded line is too long',
    });
  });

  it('stops a substitution that grows the line before it grows again (S6-L2)', () => {
    const e = hist(['a']).lines;
    const t0 = performance.now();
    expect(expand(`!!:gs/a/aaaaaaaa/${':g&'.repeat(40)}`, e)).toEqual({
      kind: 'error',
      message: 'enlighten: the expanded line is too long',
    });
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('historyList', () => {
  const h = hist(Array.from({ length: 20 }, (_, i) => `level 0 ${String(i)}`));
  const time = (at: number) => `T${String(at)}`;

  it('lists the last 16 by default, numbered in five characters', () => {
    const r = historyList(h.lines, [], time);
    expect(r.ok && r.lines.length).toBe(16);
    expect(r.ok && r.lines[0]).toBe('    5  level 0 4');
  });

  it('takes a range, a count back, and the flags', () => {
    const one = historyList(h.lines, ['19'], time);
    expect(one.ok && one.lines).toEqual(['   19  level 0 18', '   20  level 0 19']);
    const back = historyList(h.lines, ['-2', '-n', '-r'], time);
    expect(back.ok && back.lines).toEqual(['level 0 19', 'level 0 18']);
    const range = historyList(h.lines, ['2', '3', '-i'], time);
    expect(range.ok && range.lines).toEqual(['    2  T1  level 0 1', '    3  T2  level 0 2']);
    expect(historyList(h.lines, ['-x'], time)).toEqual({
      ok: false,
      error: 'history: bad option: -x',
    });
    expect(historyList(h.lines, ['1', '2', '3'], time)).toEqual({
      ok: false,
      error: 'history: too many arguments',
    });
    expect(historyList([], [], time)).toEqual({ ok: true, lines: [] });
  });
});
