/**
 * P-rate and P-rate-fade: for any stream, with and without the rate unlock, the simulator's output
 * trace keeps every clause of S3. Measured on the trace, not on the guard's counters.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeBench } from '../harness/bench.ts';
import { rateProblems } from '../harness/checker.ts';
import { play, steps, type GenOptions } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

async function check(o: GenOptions, swings: number) {
  await fc.assert(
    fc.asyncProperty(steps(o), async (stream) => {
      const b = makeBench();
      await b.ready();
      await b.clock.advance(3000);
      if (o.reset === true) b.governor.unlock('reset', 'console', true);
      if (swings > 1) {
        b.governor.unlock('rate', 'ui', true);
        b.governor.setSwingLimit(swings, 'ui');
      }
      const { rec } = await play(b, stream);
      expect(rateProblems(rec, swings)).toEqual([]);
    }),
    { numRuns: RUNS },
  );
}

describe('P-rate', () => {
  it('default: one swing a second', () => check({ reset: true, lower: true }, 1), 240_000);
  it('unlocked: three swings a second', () => check({ reset: true }, 3), 240_000);
});

describe('P-rate-fade', () => {
  it(
    'random fade times, rates and extended fades, changed mid-stream',
    () => check({ fades: true }, 1),
    240_000,
  );
  it('the same with the rate unlock at two', () => check({ fades: true }, 2), 240_000);
});

describe('P-rate on the hardware target', () => {
  it('holds on the bus when the governor knows nothing at connect, and across reconnects', async () => {
    await fc.assert(
      fc.asyncProperty(steps({ reconnect: true, fades: true }), async (stream) => {
        const b = makeBench({ target: 'hardware' });
        await b.ready();
        const { rec } = await play(b, stream);
        expect(rateProblems(rec, 1)).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  }, 240_000);
});
