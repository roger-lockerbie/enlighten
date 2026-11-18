/**
 * P-rate against slow runs (ADR 0015): one driver fades slowly for seconds, which keeps the room's
 * run, and its own, going, while hard steps and unlocked RESETs land on top of it. Before ADR 0015 the
 * guard dated a hard step at the start of its run and counted one a run, so a step inside a slow run
 * could pass inside the hard-step window. The checker dates every instant step where it happens.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { short } from '../../src/dali/address.ts';
import type { Command } from '../../src/dali/codec.ts';
import { makeBench } from '../harness/bench.ts';
import { rateProblems } from '../harness/checker.ts';
import { play, type Step, timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

const cmd = (id: string, n?: number, value?: number): Command => ({
  id,
  ...(n === undefined ? {} : { address: short(n) }),
  ...(value === undefined ? {} : { value }),
});

const slowRun = fc
  .tuple(
    fc.constantFrom(0, 1),
    fc.integer({ min: 5, max: 9 }),
    fc.integer({ min: 1, max: 254 }),
    fc.integer({ min: 0, max: 254 }),
  )
  .map(([n, fade, from, to]): Step[] => [
    { kind: 'tx', dt: 0, source: 'ui', cmds: [cmd('DAPC', n, from)] },
    {
      kind: 'tx',
      dt: 2100,
      source: 'ui',
      cmds: [cmd('DTR0', undefined, fade), cmd('SET_FADE_TIME', n)],
    },
    { kind: 'tx', dt: 0, source: 'ui', cmds: [cmd('DAPC', n, to)] },
  ]);

const hit: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(
        fc.integer({ min: 0, max: 1500 }),
        fc.constantFrom(0, 1),
        fc.oneof(fc.constantFrom(0, 1, 254), fc.integer({ min: 0, max: 254 })),
      )
      .map(([dt, n, v]): Step => ({
        kind: 'tx',
        dt,
        source: 'console',
        cmds: [cmd('DAPC', n, v)],
      })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.integer({ min: 0, max: 1500 }), fc.constantFrom(0, 1))
      .map(([dt, n]): Step => ({ kind: 'reset', dt, n })),
  },
  {
    // Fast fades on top of the slow one: fade time 0 with an extended fade of 100 to 600 ms, or
    // fade time 0 alone (DALI review of ADR 0015).
    weight: 2,
    arbitrary: fc
      .tuple(
        fc.integer({ min: 0, max: 1500 }),
        fc.constantFrom(0, 1),
        fc.option(fc.integer({ min: 0x10, max: 0x15 })),
      )
      .map(([dt, n, ext]): Step => ({
        kind: 'tx',
        dt,
        source: 'console',
        cmds: [
          cmd('DTR0', undefined, 0),
          cmd('SET_FADE_TIME', n),
          cmd('DTR0', undefined, ext ?? 0),
          cmd('SET_EXTENDED_FADE_TIME', n),
        ],
      })),
  },
);

const CE_RESET = [
  [
    {
      kind: 'tx',
      dt: 0,
      source: 'ui',
      cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 1 }],
    },
    {
      kind: 'tx',
      dt: 2100,
      source: 'ui',
      cmds: [
        { id: 'DTR0', value: 7 },
        { id: 'SET_FADE_TIME', address: { kind: 'short', n: 0 } },
      ],
    },
    {
      kind: 'tx',
      dt: 0,
      source: 'ui',
      cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 0 }],
    },
  ],
  [
    {
      kind: 'tx',
      dt: 0,
      source: 'console',
      cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 218 }],
    },
    {
      kind: 'tx',
      dt: 197,
      source: 'console',
      cmds: [{ id: 'DAPC', address: { kind: 'short', n: 1 }, value: 0 }],
    },
    {
      kind: 'tx',
      dt: 1287,
      source: 'console',
      cmds: [{ id: 'DAPC', address: { kind: 'short', n: 1 }, value: 254 }],
    },
    {
      kind: 'tx',
      dt: 723,
      source: 'console',
      cmds: [
        { id: 'DTR0', value: 0 },
        { id: 'SET_FADE_TIME', address: { kind: 'short', n: 0 } },
        { id: 'DTR0', value: 0 },
        { id: 'SET_EXTENDED_FADE_TIME', address: { kind: 'short', n: 0 } },
      ],
    },
    { kind: 'reset', dt: 1186, n: 1 },
    { kind: 'reset', dt: 0, n: 0 },
  ],
];

async function check(swings: number): Promise<void> {
  await fc.assert(
    fc.asyncProperty(slowRun, fc.array(hit, { minLength: 1, maxLength: 8 }), async (pre, hits) => {
      const b = makeBench();
      await b.ready();
      await b.clock.advance(3000);
      b.governor.unlock('reset', 'console', true);
      if (swings > 1) {
        b.governor.unlock('rate', 'ui', true);
        b.governor.setSwingLimit(swings, 'ui');
      }
      const { rec } = await play(b, [...pre, ...hits]);
      expect(rateProblems(rec, swings)).toEqual([]);
    }),
    {
      numRuns: RUNS,
      examples: [
        // B's RESET under A's slow fade: the room's jump passed 2 only with the fade's last 34 ms, so
        // the checker dated it before the RESET was sent (S6-P9). Found at 1,000 runs.
        CE_RESET as unknown as [Step[], Step[]],
      ],
    },
  );
}

describe('P-rate against slow runs', () => {
  it('default: one swing a second', () => check(1), timeout(RUNS));
  it('unlocked: three swings a second', () => check(3), timeout(RUNS));
});
