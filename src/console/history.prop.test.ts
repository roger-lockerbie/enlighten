/** P-history: expansion never throws, and a line with no `!` or leading `^` comes back as it is. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expand, History, MAX_LINE } from './history.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

const piece = fc.constantFrom(
  '!',
  '!!',
  '^',
  ':',
  's',
  'g',
  '&',
  'p',
  '?',
  '$',
  '*',
  '-',
  '/',
  '\\',
  "'",
  '"',
  ' ',
  '0',
  '1',
  'a',
  'level',
);
const line = fc.array(piece, { maxLength: 30 }).map((a) => a.join(''));
const events = fc.array(fc.oneof(line, fc.string({ maxLength: 40 })), { maxLength: 8 });

describe('P-history', () => {
  it('expansion never throws, and never returns a line over the limit', () => {
    fc.assert(
      fc.property(fc.oneof(line, fc.string({ maxLength: MAX_LINE })), events, (l, ev) => {
        const h = new History([], { limit: 1000, ignoreSpace: false });
        ev.forEach((e, i) => h.add(e, i));
        const r = expand(l, h.lines);
        if (r.kind === 'ok') expect(r.line.length).toBeLessThanOrEqual(MAX_LINE);
      }),
      { numRuns: runs },
    );
  });

  it('chained substitutions stay within the limit at every step (S6-L2)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 4 }),
        fc.string({ maxLength: 40 }),
        fc.integer({ min: 0, max: 60 }),
        (from, to, n) => {
          const h = new History([], { limit: 1000, ignoreSpace: false });
          h.add(`echo ${from}`, 0);
          const d =
            ['/', '|', '#', ','].find((c) => !from.includes(c) && !to.includes(c)) ?? '\u0001';
          const r = expand(`!!:gs${d}${from}${d}${to}${d}${':g&'.repeat(n)}`, h.lines);
          if (r.kind === 'ok') expect(r.line.length).toBeLessThanOrEqual(MAX_LINE);
        },
      ),
      { numRuns: runs },
    );
  });

  it('a line with no ! and no leading ^ is the line', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: MAX_LINE }).filter((s) => !s.includes('!') && !s.startsWith('^')),
        events,
        (l, ev) => {
          const h = new History([], { limit: 1000, ignoreSpace: false });
          ev.forEach((e, i) => h.add(e, i));
          expect(expand(l, h.lines)).toEqual({ kind: 'none' });
        },
      ),
      { numRuns: runs },
    );
  });
});
