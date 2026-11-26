/**
 * P-switch against the rate guard: a plate mashed by a person, with every button type and with
 * timers anywhere in their ranges, sends only through the governor, so the light never swings faster
 * than S3 allows. The checker measures the simulator's output, apart from the guard.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { short } from '../../src/dali/address.ts';
import { framesForAll } from '../../src/dali/sequences.ts';
import { Controller, type Host } from '../../src/switch/controller.ts';
import { presetPlate } from '../../src/switch/presets.ts';
import type { Family, Layout } from '../../src/switch/plate.ts';
import { makeBench } from '../harness/bench.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

const input = fc.record({
  dt: fc.oneof(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 1500 })),
  button: fc.integer({ min: 0, max: 3 }),
});

async function check(family: Family, layout: Layout, swings: number): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(input, { minLength: 1, maxLength: 40 }),
      fc.integer({ min: 0, max: 1 }),
      async (inputs, n) => {
        const b = makeBench();
        await b.ready();
        await b.clock.advance(3000);
        if (swings > 1) {
          b.governor.unlock('rate', 'ui', true);
          b.governor.setSwingLimit(swings, 'ui');
        }
        const unit = n === 0 ? 'A' : 'B';
        const levelOf = () => b.sim.unit(unit)?.gear.levelAt(b.clock.now()) ?? 0;
        const host: Host = {
          isOn: () => levelOf() > 0,
          blocked: () => undefined,
          send: async (commands, label) => {
            const r = await b.scheduler.submit({
              frames: framesForAll(commands),
              source: 'switch',
              label,
            });
            return r.kind === 'done' ? { ok: true } : { ok: false, reason: r.reason };
          },
          recall: () => Promise.resolve({ ok: true }),
          run: () => Promise.resolve({ ok: true }),
          stopRun: () => undefined,
          say: () => undefined,
        };
        const c = new Controller(b.clock, host);
        c.setPlates([presetPlate('p', family, layout, short(n))]);
        const rec = new TraceRecorder(b.sim, b.clock.now());
        const down = new Set<number>();
        for (const i of inputs) {
          const button = i.button % layout;
          await b.clock.advance(i.dt);
          rec.record(b.clock.now());
          if (down.has(button)) {
            down.delete(button);
            c.input('p', button, false);
          } else {
            down.add(button);
            c.input('p', button, true);
          }
        }
        for (const button of down) c.input('p', button, false);
        const end = b.clock.now() + 30_000;
        while (b.clock.now() < end) {
          await b.clock.advance(250);
          rec.record(b.clock.now());
        }
        expect(rateProblems(rec, swings)).toEqual([]);
        expect(b.sink.unapproved).toBe(false);
      },
    ),
    { numRuns: RUNS },
  );
}

describe('P-switch against the rate guard', () => {
  for (const [family, layout] of [
    ['zencontrol', 4],
    ['coupler', 4],
    ['knx', 2],
  ] as const) {
    it(
      `${family} ${String(layout)} buttons: one swing a second`,
      () => check(family, layout, 1),
      timeout(RUNS),
    );
  }
  it('unlocked: three swings a second', () => check('zencontrol', 4, 3), timeout(RUNS));
});
