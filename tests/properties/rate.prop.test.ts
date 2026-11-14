/**
 * P-rate and P-rate-fade: for any stream, with and without the rate unlock, the simulator's output
 * trace keeps every clause of S3. Measured on the trace, not on the guard's counters.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeBench } from '../harness/bench.ts';
import { rateProblems } from '../harness/checker.ts';
import { play, steps, type GenOptions, type Step, timeout } from '../harness/gen.ts';
import { broadcast, group } from '../../src/dali/address.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';

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
  it('default: one swing a second', () => check({ reset: true, lower: true }, 1), timeout(RUNS));
  it('unlocked: three swings a second', () => check({ reset: true }, 3), timeout(RUNS));
});

describe('P-rate-fade', () => {
  it(
    'random fade times, rates and extended fades, changed mid-stream',
    () => check({ fades: true }, 1),
    timeout(RUNS),
  );
  it('the same with the rate unlock at two', () => check({ fades: true }, 2), timeout(RUNS));
});

describe('P-rate on the hardware target', () => {
  it(
    'holds on the bus when the governor knows nothing at connect, and across reconnects',
    async () => {
      await fc.assert(
        fc.asyncProperty(steps({ reconnect: true, fades: true }), async (stream) => {
          const b = makeBench({ target: 'hardware' });
          await b.ready();
          const { rec } = await play(b, stream);
          expect(rateProblems(rec, 1)).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});

/** Real gear set up by hand before the app connects: addresses, groups, scenes, limits and levels the governor does not know. */
const realBench = fc.record({
  units: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }),
  light: fc.array(fc.constantFrom<'C1' | 'C2' | 'C5'>('C1', 'C2', 'C5'), {
    minLength: 3,
    maxLength: 3,
  }),
  groups: fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 3, maxLength: 3 }),
  scene: fc.array(fc.integer({ min: 0, max: 254 }), { minLength: 3, maxLength: 3 }),
  min: fc.array(fc.integer({ min: 85, max: 160 }), { minLength: 3, maxLength: 3 }),
  phys: fc.array(fc.integer({ min: 1, max: 85 }), { minLength: 3, maxLength: 3 }),
  level: fc.array(fc.integer({ min: 0, max: 254 }), { minLength: 3, maxLength: 3 }),
  fade: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 3, maxLength: 3 }),
});

describe('P-rate on hardware the governor has never seen', () => {
  it(
    'holds when the real gear differs from anything the shadow starts with',
    async () => {
      await fc.assert(
        fc.asyncProperty(realBench, steps({ fades: true }), async (cfg, stream) => {
          const real = Simulator.of(
            cfg.units.map((n, i) => ({
              id: `R${String(n)}`,
              profile: da5l(cfg.light[i] ?? 'C2', 'tc', { physicalMinimum: cfg.phys[i] ?? 85 }),
              opts: { shortAddress: n },
            })),
          );
          const r = new Rig(real, 0);
          cfg.units.forEach((n, i) => {
            for (let g = 0; g < 4; g++)
              if (((cfg.groups[i] ?? 0) >> g) & 1) r.to('ADD_TO_GROUP', n, g);
            r.set('SET_SCENE', n, cfg.scene[i] ?? 0, 0);
            r.set('SET_SCENE', n, cfg.scene[i] ?? 0, 3);
            r.set('SET_MIN_LEVEL', n, (cfg.min[i] ?? 85) - 84 + (cfg.phys[i] ?? 85) - 1);
            r.set('SET_FADE_TIME', n, cfg.fade[i] ?? 0);
            r.to('DAPC', n, cfg.level[i] ?? 0);
          });
          const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
          const extra: Step[] = [
            {
              kind: 'tx',
              dt: 0,
              source: 'script',
              cmds: [{ id: 'GO_TO_SCENE', address: group(3), value: 3 }],
            },
            {
              kind: 'tx',
              dt: 50,
              source: 'script',
              cmds: [{ id: 'GO_TO_SCENE', address: broadcast, value: 0 }],
            },
            { kind: 'tx', dt: 50, source: 'script', cmds: [{ id: 'OFF', address: group(1) }] },
          ];
          // The trace is checked from the connect: what the gear did before is not the app's doing.
          await b.ready();
          const { rec } = await play(b, [...extra, ...stream]);
          expect(rateProblems(rec, 1)).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});
