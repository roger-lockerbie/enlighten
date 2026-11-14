/**
 * P-panic: for any stream and any moment, after panic at most the frame already on the wire completes,
 * then TERMINATE and broadcast OFF are sent, nothing else follows until Resume, and the guard never
 * delays it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { framesForAll } from '../../src/dali/sequences.ts';
import { makeBench } from '../harness/bench.ts';
import { commands, timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

describe('P-panic', () => {
  it(
    'stops everything at once and latches',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(commands(), { minLength: 1, maxLength: 6 }),
          fc.integer({ min: 0, max: 400 }),
          fc.array(commands(), { minLength: 1, maxLength: 3 }),
          async (before, delay, after) => {
            const b = makeBench();
            await b.ready();
            await b.clock.advance(3000);
            const pending = before.map((cmds) =>
              b.submit({ frames: framesForAll(cmds), source: 'script' }),
            );
            await b.clock.advance(delay);
            const panicAt = b.clock.now();
            const logStart = b.sink.log.length;
            const done = b.scheduler.panic();
            // Work submitted after panic, before Resume.
            const late = after.map((cmds) =>
              b.submit({ frames: framesForAll(cmds), source: 'ui' }),
            );
            await b.drive(Promise.all([done, ...pending, ...late]));
            await b.clock.advance(5000);
            const sent = b.sink.log.slice(logStart);
            const firstPanic = sent.findIndex((l) => l.panic);
            // At most one frame, the one already on the wire, before panic's frames.
            expect(firstPanic).toBeGreaterThanOrEqual(0);
            expect(firstPanic).toBeLessThanOrEqual(1);
            const panicFrames = sent.slice(firstPanic);
            expect(panicFrames.map((l) => [l.frame.frame.a, l.frame.frame.b])).toEqual([
              [0xa1, 0x00],
              [0xff, 0x00],
            ]);
            // Not delayed by the guard: OFF within one frame on the wire and two panic frames.
            expect((panicFrames[1]?.at ?? Infinity) - panicAt).toBeLessThan(150);
            expect(b.governor.isLatched).toBe(true);
            // Every light is off.
            for (const u of b.sim.all) expect(u.gear.levelAt(b.clock.now())).toBe(0);
            // Resume, and things can be sent again.
            b.governor.resume('ui');
            const r = await b.run({
              frames: framesForAll([{ id: 'QUERY_STATUS', address: { kind: 'short', n: 0 } }]),
              source: 'ui',
            });
            expect(r.kind).toBe('done');
          },
        ),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});
