/**
 * P-rate through the console (S6-L3): typed lines and scripts, with repeats, raw frames and the
 * console's wait for the rate guard, run through the engine. The simulator's output trace keeps
 * every clause of S3, at the default limit and with the rate unlock at three.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { withFloors } from '../../src/bus/timing.ts';
import { Engine } from '../../src/engine/engine.ts';
import { SimTransport } from '../../src/transport/sim.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { consoleSteps } from '../harness/console-gen.ts';
import { timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

async function check(swings: number): Promise<void> {
  const ctx = { aliases: new Map<string, number>() };
  await fc.assert(
    fc.asyncProperty(consoleSteps({ panic: false }), async (stream) => {
      const clock = new VirtualClock(1000);
      const sim = Simulator.bench({ at: 1000 });
      const engine = new Engine({
        clock,
        sim,
        simTransport: new SimTransport(sim, clock, withFloors({})),
      });
      // The recorder starts once the room is quiet. Until then the drive loop has none.
      const live: { rec?: TraceRecorder } = {};
      const drive = async (p: Promise<unknown>) => {
        const st = { done: false };
        const done = () => st.done;
        void p.then(() => {
          st.done = true;
        });
        for (let i = 0; i < 100_000 && !done(); i++) {
          await flushMicrotasks();
          if (done()) break;
          const n = clock.next();
          if (n === undefined) break;
          await clock.advanceTo(n);
          live.rec?.record(clock.now());
        }
      };
      // The start-up scan and safety profile, then a quiet room.
      await drive(
        (async () => {
          while (engine.snapshot().jobs.length > 0) await Promise.resolve();
        })(),
      );
      await clock.advance(3000);
      if (swings > 1) {
        expect(engine.unlock('rate', 'ui', true).ok).toBe(true);
        expect(engine.setSwingLimit(swings, 'ui').ok).toBe(true);
      }
      const rec = new TraceRecorder(sim, clock.now());
      live.rec = rec;
      for (const s of stream) {
        if (s.kind === 'line') await drive(engine.console(s.text, ctx));
        else await drive(engine.runScript('p', s.lines.join('\n'), ctx));
        rec.record(clock.now());
      }
      const end = Math.min(sim.settlesAt(), clock.now() + 20_000);
      while (clock.now() < end) {
        await clock.advance(Math.min(1000, end - clock.now()));
        rec.record(clock.now());
      }
      engine.dispose();
      expect(rateProblems(rec, swings)).toEqual([]);
    }),
    { numRuns: RUNS },
  );
}

describe('P-rate for console lines and script steps', () => {
  it('default: one swing a second', () => check(1), timeout(RUNS));
  it('unlocked: three swings a second', () => check(3), timeout(RUNS));
});
