/**
 * P-parser: the script parser never throws, never returns more than the step limit, and every
 * accepted script prints back to an equivalent script.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParseContext } from '../console/parse.ts';
import { MAX_STEPS, parseScript } from './parse.ts';
import { printScript } from './print.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);
const ctx: ParseContext = { aliases: new Map([['tw', 0]]) };

const statement = fc.constantFrom(
  'level 0 50%',
  'level tw 128 fade 2s',
  'off all',
  'on g1',
  'tc 0 2700K 40%',
  'rgb 1 254 0 0 w 3',
  'rgb 1 #00ff00',
  'scene 0 recall 3',
  'query 0 level',
  'dapc 0..1 100',
  'dtr0 3',
  'raw ff 00 x2',
  'wait 300ms',
  'pause "look  here"',
  'echo "a # b" c',
  'cap 30%',
  '# comment',
  '',
  'frob',
  'unlock rate',
  'level 0',
  'echo "open',
  'end',
);

/** Lines with repeat blocks, sometimes unbalanced. */
const script = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: statement },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 1200 }).map((n) => `repeat ${String(n)}`) },
      { weight: 1, arbitrary: fc.constant('end') },
    ),
    { maxLength: 40 },
  )
  .map((lines) => lines.join('\n'));

describe('P-parser', () => {
  it('never throws, and never passes the step limit', () => {
    fc.assert(
      fc.property(fc.oneof(script, fc.string({ maxLength: 2000 })), (text) => {
        const r = parseScript(text, ctx);
        if (r.ok) expect(r.steps.length).toBeLessThanOrEqual(MAX_STEPS);
        else expect(r.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: runs },
    );
  });

  it('an accepted script prints back to one with the same steps', () => {
    fc.assert(
      fc.property(script, (text) => {
        const r = parseScript(text, ctx);
        if (!r.ok) return;
        const again = parseScript(printScript(r.items), ctx);
        expect(again.ok).toBe(true);
        if (again.ok)
          expect(again.steps.map((s) => s.command)).toEqual(r.steps.map((s) => s.command));
      }),
      { numRuns: runs },
    );
  });
});
