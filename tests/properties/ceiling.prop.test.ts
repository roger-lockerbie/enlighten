/**
 * P-ceiling: for any stream from any mix of sources, with no confirmed raise, the simulator's output
 * never passes the ceiling. Run for both DA5-L light types on the bench and both colour presentations.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arcToFraction } from '../../src/dali/curve.ts';
import { da5l, type Presentation } from '../../src/sim/profile.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { makeBench } from '../harness/bench.ts';
import { maxMeasure } from '../harness/checker.ts';
import { play, steps, timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

describe('P-ceiling', () => {
  for (const [c2, c5] of [
    ['tc', 'rgbwaf'],
    ['rgbwaf', 'tc'],
  ] as [Presentation, Presentation][]) {
    it(
      `holds with C2 as ${c2} and C5 as ${c5}`,
      async () => {
        await fc.assert(
          fc.asyncProperty(steps({ lower: true }), async (stream) => {
            const sim = Simulator.bench({ a: da5l('C2', c2), b: da5l('C5', c5) });
            const b = makeBench({ sim });
            await b.ready();
            let checked = b.clock.now();
            let arc = b.governor.ceilingArc;
            const problems: string[] = [];
            await play(b, stream, {
              afterStep: () => {
                const now = b.clock.now();
                // A lowered ceiling applies once its rewrite has finished, which `play` waits for.
                const worst = maxMeasure(sim, checked, now);
                if (worst.v > arcToFraction(arc) + 1e-9)
                  problems.push(`${worst.id} at ${String(worst.t)}: ${String(worst.v)}`);
                arc = b.governor.ceilingArc;
                checked = now;
              },
            });
            const tail = maxMeasure(sim, checked, b.clock.now());
            if (tail.v > arcToFraction(arc) + 1e-9)
              problems.push(`tail ${tail.id}: ${String(tail.v)}`);
            expect(problems).toEqual([]);
            expect(b.sink.unapproved).toBe(false);
          }),
          { numRuns: RUNS },
        );
      },
      timeout(RUNS),
    );
  }
});
