/**
 * P-ceiling: for any stream from any mix of sources, with no confirmed raise, the simulator's output
 * never passes the ceiling. Run for both DA5-L light types on the bench and both colour presentations.
 * The second property runs typed console lines and scripts through the engine (ADR 0014).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { withFloors } from '../../src/bus/timing.ts';
import { arcToFraction } from '../../src/dali/curve.ts';
import { Engine } from '../../src/engine/engine.ts';
import { SimTransport } from '../../src/transport/sim.ts';
import { da5l, type Presentation } from '../../src/sim/profile.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { makeBench } from '../harness/bench.ts';
import { maxMeasure } from '../harness/checker.ts';
import { consoleSteps } from '../harness/console-gen.ts';
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

describe('P-ceiling for console lines and script steps', () => {
  const ctx = { aliases: new Map<string, number>() };
  for (const [c2, c5] of [
    ['tc', 'rgbwaf'],
    ['rgbwaf', 'tc'],
  ] as [Presentation, Presentation][]) {
    it(
      `holds with C2 as ${c2} and C5 as ${c5}`,
      async () => {
        await fc.assert(
          fc.asyncProperty(consoleSteps(), async (stream) => {
            const clock = new VirtualClock(1000);
            const sim = Simulator.bench({ at: 1000, a: da5l('C2', c2), b: da5l('C5', c5) });
            const engine = new Engine({
              clock,
              sim,
              simTransport: new SimTransport(sim, clock, withFloors({})),
              ceilingArc: 180,
            });
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
              }
            };
            // The start-up scan and safety profile.
            await drive(
              (async () => {
                while (engine.snapshot().jobs.length > 0) await Promise.resolve();
              })(),
            );
            let checked = clock.now();
            let arc = engine.snapshot().ceilingArc;
            const problems: string[] = [];
            const check = (what: string) => {
              const now = clock.now();
              const worst = maxMeasure(sim, checked, now);
              if (worst.v > arcToFraction(arc) + 1e-9)
                problems.push(`${what}: ${worst.id} at ${String(worst.t)}: ${String(worst.v)}`);
              arc = engine.snapshot().ceilingArc;
              checked = now;
            };
            for (const s of stream) {
              if (s.kind === 'line') await drive(engine.console(s.text, ctx));
              else await drive(engine.runScript('p', s.lines.join('\n'), ctx));
              check(s.kind === 'line' ? s.text : s.lines.join('; '));
            }
            await clock.advance(5000);
            check('tail');
            engine.dispose();
            expect(problems).toEqual([]);
          }),
          { numRuns: RUNS },
        );
      },
      timeout(RUNS),
    );
  }
});
