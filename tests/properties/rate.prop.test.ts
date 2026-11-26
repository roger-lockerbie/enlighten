/**
 * P-rate and P-rate-fade: for any stream, with and without the rate unlock, the simulator's output
 * trace keeps every clause of S3. Measured on the trace, not on the guard's counters.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeBench } from '../harness/bench.ts';
import { rateProblems } from '../harness/checker.ts';
import { play, steps, type GenOptions, type Step, timeout } from '../harness/gen.ts';
import type { Command } from '../../src/dali/codec.ts';
import { broadcast, group, short } from '../../src/dali/address.ts';
import { rgbwafCommands, tcCommands } from '../../src/dali/sequences.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import s5p1 from './s5-p1.counterexample.json' with { type: 'json' };
import s6p16 from './s6-p16.counterexample.json' with { type: 'json' };

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
  // What the shadow cannot know of the gear's colour (S8b-R2-L2): the colour it shows, a temporary
  // colour left waiting in it, colour temperature limits wider than the profile's, and a last
  // active level from before it was switched off.
  rgb: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
  mix: fc.array(fc.array(fc.integer({ min: 0, max: 254 }), { minLength: 6, maxLength: 6 }), {
    minLength: 3,
    maxLength: 3,
  }),
  mirek: fc.array(fc.integer({ min: 60, max: 900 }), { minLength: 3, maxLength: 3 }),
  wide: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
  waiting: fc.array(fc.option(fc.integer({ min: 0, max: 254 }), { nil: undefined }), {
    minLength: 3,
    maxLength: 3,
  }),
  off: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
  // What the third review said the generators could not reach (S8b-R3-8): C3 and C4 tapes, a ceiling
  // at the top, the profile's other settings where research is not sure, and the reset unlock.
  tape: fc.array(fc.constantFrom<'C3' | 'C4' | undefined>(undefined, 'C3', 'C4'), {
    minLength: 3,
    maxLength: 3,
  }),
  top: fc.boolean(),
  kept: fc.boolean(),
  curve: fc.boolean(),
  middle: fc.boolean(),
  unlocked: fc.boolean(),
});
const WIDE = { coolest: 50, warmest: 1000, physicalCoolest: 50, physicalWarmest: 1000 };
type Mix = [number, number, number, number, number, number];
/** A counterexample saved from a run: the bench and the steps played on it. */
type Real = typeof realBench extends fc.Arbitrary<infer T> ? T : never;
type Later =
  | 'rgb'
  | 'mix'
  | 'mirek'
  | 'wide'
  | 'waiting'
  | 'off'
  | 'tape'
  | 'top'
  | 'kept'
  | 'curve'
  | 'middle'
  | 'unlocked';
/** Counterexamples saved before Stage 8b's second review have none of the colour fields. */
type Saved = [Omit<Real, Later> & Partial<Pick<Real, Later>>, Step[]];

/** Connect to a real bench the governor has never seen, play the steps, and check the light. */
async function unseen(cfg: Saved[0], stream: readonly Step[], unlock = false): Promise<void> {
  const real = Simulator.of(
    cfg.units.map((n, i) => ({
      id: `R${String(n)}`,
      profile: da5l(
        cfg.tape?.[i] ?? cfg.light[i] ?? 'C2',
        cfg.light[i] === 'C5' && cfg.rgb?.[i] === true ? 'rgbwaf' : 'tc',
        {
          physicalMinimum: cfg.phys[i] ?? 85,
          ...(cfg.wide?.[i] === true ? { tcLimits: WIDE } : {}),
          ...(cfg.kept === true ? { temporaryClearedAfterActivate: false } : {}),
          ...(cfg.curve === true ? { channelLaw: 'curve' as const } : {}),
          ...(cfg.middle === true ? { tcMix: 'both-high-middle' as const } : {}),
        },
      ),
      opts: { shortAddress: n },
    })),
  );
  const r = new Rig(real, 0);
  cfg.units.forEach((n, i) => {
    const mix = cfg.mix?.[i] as Mix | undefined;
    if (mix !== undefined) r.run(rgbwafCommands(short(n), mix));
    if (cfg.mirek?.[i] !== undefined) r.run(tcCommands(short(n), cfg.mirek[i] ?? 300));
    for (let g = 0; g < 4; g++) if (((cfg.groups[i] ?? 0) >> g) & 1) r.to('ADD_TO_GROUP', n, g);
    r.set('SET_SCENE', n, cfg.scene[i] ?? 0, 0);
    r.set('SET_SCENE', n, cfg.scene[i] ?? 0, 3);
    r.set('SET_MIN_LEVEL', n, (cfg.min[i] ?? 85) - 84 + (cfg.phys[i] ?? 85) - 1);
    r.set('SET_FADE_TIME', n, cfg.fade[i] ?? 0);
    r.to('DAPC', n, cfg.level[i] ?? 0);
    if (cfg.off?.[i] === true) r.to('OFF', n);
    const w = cfg.waiting?.[i];
    if (w !== undefined) {
      r.run(rgbwafCommands(short(n), [w, 254 - w, w, 254 - w, w, 254 - w], false));
      r.run(tcCommands(short(n), 100 + 3 * w, false));
    }
  });
  const b = makeBench({
    sim: real,
    target: 'hardware',
    start: r.t + 100,
    ...(cfg.top === true ? { ceilingArc: 254 } : {}),
  });
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
  if (unlock) b.governor.unlock('reset', 'console', true);
  // The wait at the end puts the last step's fade in the trace.
  const { rec } = await play(b, [
    ...extra,
    ...stream,
    { kind: 'tx', dt: 6000, source: 'ui', cmds: [] },
  ]);
  expect(rateProblems(rec, 1)).toEqual([]);
}

/**
 * Steps aimed at what a scan cannot read (S8b-R2-D1, S8b-R2-D2): colours, parts of colours, levels,
 * recalls and switch-offs to two addresses, from 0 to 3 s apart and often close together. And what
 * the third review added (S8b-R3-8): queries, rescans, groups and broadcast, steps, fade settings and,
 * under the reset unlock, gear moved from one address onto the other. Stage 11 added fade settings
 * read back, DAPC sequences and DOWN (S8b-R4-D1).
 */
const aimed: fc.Arbitrary<Step[]> = fc.array(
  fc
    .tuple(
      fc.oneof(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 3000 })),
      fc.integer({ min: 0, max: 1 }),
      fc.constantFrom(
        ...(['rgb', 'red', 'tc', 'act', 'level', 'level', 'last', 'off', 'both'] as const),
        ...(['query', 'rescan', 'group', 'all', 'alloff', 'scene', 'up', 'down'] as const),
        ...(['cooler', 'fade0', 'fade0', 'fade2', 'move'] as const),
        // Stage 11 (S8b-R4-D1, ADR 0022): fade settings read back, so a level can meet a fade the
        // guard knows of, and the level commands that fade whatever the fade time is.
        ...(['read', 'read', 'fade2read', 'sequence', 'dim', 'pink', 'pink'] as const),
      ),
      fc.array(fc.integer({ min: 0, max: 254 }), { minLength: 6, maxLength: 6 }),
      fc.integer({ min: 60, max: 900 }),
    )
    .map(([dt, n, what, mix, mirek]): Step => {
      const a = short(n);
      const level = { id: 'DAPC', address: a, value: mix[3] ?? 0 };
      if (what === 'rescan') return { kind: 'rescan', dt };
      const other: Record<string, Command[]> = {
        query: [{ id: 'QUERY_ACTUAL_LEVEL', address: a }],
        group: [{ id: 'DAPC', address: group(n), value: mix[3] ?? 0 }],
        all: [{ id: 'DAPC', address: broadcast, value: mix[3] ?? 0 }],
        alloff: [{ id: 'OFF', address: broadcast }],
        scene: [{ id: 'GO_TO_SCENE', address: a, value: 3 }],
        up: [{ id: 'STEP_UP', address: a }],
        down: [{ id: 'STEP_DOWN', address: a }],
        cooler: [{ id: 'DT8_TC_STEP_COOLER', address: a }],
        fade0: [
          { id: 'DTR0', value: 0 },
          { id: 'SET_FADE_TIME', address: a },
        ],
        fade2: [
          { id: 'DTR0', value: 2 },
          { id: 'SET_FADE_TIME', address: a },
        ],
        read: [
          { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
          { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
        ],
        fade2read: [
          { id: 'DTR0', value: 2 },
          { id: 'SET_FADE_TIME', address: a },
          { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
          { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
        ],
        sequence: [{ id: 'ENABLE_DAPC_SEQUENCE', address: a }, level],
        dim: [{ id: 'DOWN', address: a }],
        // Red full and the others near it: a level fade then takes red in and out of saturation.
        pink: rgbwafCommands(a, [
          254,
          180 + ((mix[1] ?? 0) % 60),
          180 + ((mix[2] ?? 0) % 60),
          0,
          0,
          0,
        ]),
        // Under the reset unlock: the gear at one address moves onto the other.
        move: [
          { id: 'DTR0', value: ((1 - n) << 1) | 1 },
          { id: 'SET_SHORT_ADDRESS', address: a },
        ],
      };
      const more = other[what];
      if (more !== undefined) return { kind: 'tx', dt, source: 'console', cmds: more };
      const cmds =
        what === 'rgb'
          ? rgbwafCommands(a, mix as Mix)
          : what === 'red'
            ? [
                { id: 'DTR0', value: mix[0] ?? 0 },
                { id: 'DT8_SET_TEMPORARY_RGB', address: a },
                { id: 'DT8_ACTIVATE', address: a },
              ]
            : what === 'tc'
              ? tcCommands(a, mirek)
              : what === 'act'
                ? [{ id: 'DT8_ACTIVATE', address: a }]
                : what === 'level'
                  ? [level]
                  : what === 'last'
                    ? [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a }]
                    : what === 'off'
                      ? [{ id: 'OFF', address: a }]
                      : [...tcCommands(a, mirek), level];
      return { kind: 'tx', dt, source: 'ui', cmds };
    }),
  { minLength: 2, maxLength: 9 },
);

describe('P-rate on hardware the governor has never seen', () => {
  it(
    'holds when the real gear differs from anything the shadow starts with',
    async () => {
      await fc.assert(
        fc.asyncProperty(realBench, steps({ fades: true }), async (given, stream) => {
          await unseen(given, stream);
        }),
        {
          numRuns: RUNS,
          // Found by the Stage 4 run at 1,000: A0 off by a group scene, then a broadcast scene that
          // lifts A1 at once while A2 fades out. The room rises and falls from one moment, and the
          // guard had merged the two legs into one.
          examples: [
            [
              {
                units: [1, 0, 2],
                light: ['C1', 'C1', 'C1'],
                groups: [0, 8, 0],
                scene: [161, 0, 0],
                min: [85, 85, 85],
                phys: [1, 1, 1],
                level: [0, 136, 137],
                fade: [0, 0, 1],
              },
              [
                {
                  kind: 'tx',
                  dt: 2100,
                  source: 'ui',
                  cmds: [
                    { id: 'DTR0', value: 0 },
                    { id: 'SET_FADE_TIME', address: { kind: 'short', n: 0 } },
                  ],
                },
              ],
            ],
            // Found by the second Stage 4 run at 1,000, and these two guard the checker, not the
            // guard: one driver steps up at once, one fades up and one fades down. The checker once
            // summed samples from different times and saw a room step the light never made (S4-P4).
            [
              {
                units: [1, 2, 0],
                light: ['C5', 'C1', 'C2'],
                groups: [0, 0, 0],
                scene: [0, 0, 0],
                min: [85, 146, 85],
                phys: [1, 51, 1],
                level: [254, 0, 0],
                fade: [4, 3, 1],
              },
              [
                {
                  kind: 'tx',
                  dt: 438,
                  source: 'ui',
                  cmds: [{ id: 'DAPC', address: { kind: 'broadcast' }, value: 155 }],
                },
              ],
            ],
            [
              {
                units: [1, 2, 0],
                light: ['C5', 'C1', 'C2'],
                groups: [0, 0, 0],
                scene: [0, 0, 0],
                min: [85, 85, 85],
                phys: [1, 1, 1],
                level: [246, 0, 0],
                fade: [4, 0, 1],
              },
              [
                {
                  kind: 'tx',
                  dt: 438,
                  source: 'ui',
                  cmds: [{ id: 'DAPC', address: { kind: 'broadcast' }, value: 155 }],
                },
              ],
            ],
            // S5-P1, found at 1,000 runs in Stage 5: a temporary colour loaded before a rescan, then
            // a colour and a level fading together on a C5 driver (ADR 0019).
            s5p1 as unknown as Saved,
            // S6-P16, found at 1,000 runs in Stage 6: gear seen fading in its scan, switched off at
            // the end of a slow fade, and a level 1.4 s after that (ADR 0019).
            s6p16 as unknown as Saved,
          ],
        },
      );
    },
    timeout(RUNS),
  );

  it(
    'holds for colours, levels and recalls sent close together to gear whose colour differs',
    async () => {
      await fc.assert(
        fc.asyncProperty(realBench, aimed, async (given, stream) => {
          // Two addresses, so the aimed steps reach gear that is there.
          await unseen({ ...given, units: [0, 1] }, stream, given.unlocked);
        }),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});

/**
 * Aimed at S8b-R4-D1 (ADR 0022), from the Stage 11 DALI review: one colour driver whose colour is
 * near saturated red, set through the app and activated, then a short tail of fade settings with
 * their read-backs, levels, a DAPC sequence, UP, DOWN, the continuous commands, steps and OFF. A
 * faded level there takes red in and out of saturation. On the rule before this fails within a few
 * dozen cases.
 */
const redTail: fc.Arbitrary<Step[]> = (() => {
  const a = short(0);
  const read: Command[] = [
    { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
    { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
  ];
  const fadeTime = (t: number): Command[] => [
    { id: 'DTR0', value: t },
    { id: 'SET_FADE_TIME', address: a },
  ];
  const extended = (v: number): Command[] => [
    { id: 'DTR0', value: v },
    { id: 'SET_EXTENDED_FADE_TIME', address: a },
  ];
  return fc.array(
    fc
      .tuple(
        fc.oneof(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 2000, max: 4500 })),
        fc.constantFrom(
          ...(['fade', 'fade', 'ext', 'zero', 'read', 'level', 'level', 'level'] as const),
          ...(['sequence', 'dim', 'up', 'cup', 'cdown', 'last', 'step', 'off', 'act'] as const),
        ),
        fc.integer({ min: 1, max: 254 }),
        fc.integer({ min: 1, max: 6 }),
      )
      .map(([dt, what, v, f]): Step => {
        const level: Command = { id: 'DAPC', address: a, value: v };
        const table: Record<typeof what, Command[]> = {
          fade: [...fadeTime(f), ...read],
          zero: [...fadeTime(0), ...extended(0), ...read],
          ext: [...fadeTime(0), ...extended(0x10 | f), ...read],
          read,
          level: [level],
          sequence: [{ id: 'ENABLE_DAPC_SEQUENCE', address: a }, level],
          dim: [{ id: 'DOWN', address: a }],
          up: [{ id: 'UP', address: a }],
          cup: [{ id: 'CONTINUOUS_UP', address: a }],
          cdown: [{ id: 'CONTINUOUS_DOWN', address: a }],
          last: [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a }],
          step: [{ id: 'STEP_DOWN', address: a }],
          off: [{ id: 'OFF', address: a }],
          act: [{ id: 'DT8_ACTIVATE', address: a }],
        };
        return { kind: 'tx', dt, source: 'console', cmds: table[what] };
      }),
    { minLength: 1, maxLength: 6 },
  );
})();
const redBench = fc.record({
  tape: fc.constantFrom<'C3' | 'C4' | 'C5'>('C3', 'C4', 'C5'),
  green: fc.integer({ min: 150, max: 254 }),
  blue: fc.integer({ min: 150, max: 254 }),
  level: fc.integer({ min: 150, max: 220 }),
  fade: fc.integer({ min: 0, max: 4 }),
});

describe('P-rate on hardware colour gear near saturated red (ADR 0022)', () => {
  it(
    'holds for levels, fades, sequences and dims after the colour is activated',
    async () => {
      await fc.assert(
        fc.asyncProperty(redBench, redTail, async (cfg, stream) => {
          const a = short(0);
          const mix: Mix = [254, cfg.green, cfg.blue, 0, 0, 0];
          const real = Simulator.of([
            {
              id: 'R0',
              profile: da5l(cfg.tape, 'rgbwaf', { physicalMinimum: 1 }),
              opts: { shortAddress: 0 },
            },
          ]);
          const r = new Rig(real, 0);
          r.run(rgbwafCommands(a, mix));
          r.set('SET_FADE_TIME', 0, cfg.fade);
          r.to('DAPC', 0, cfg.level);
          r.wait(20_000);
          const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100, ceilingArc: 254 });
          await b.ready();
          const tx = (dt: number, cmds: Command[]): Step => ({
            kind: 'tx',
            dt,
            source: 'console',
            cmds,
          });
          // The colour goes through the app with no fade, then a rescan and a bare ACTIVATE, so
          // nothing waits in the gear and the governor takes a level (see hard-steps.test.ts).
          const { rec } = await play(b, [
            tx(4000, [
              { id: 'DTR0', value: 0 },
              { id: 'SET_FADE_TIME', address: a },
              { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
              { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
            ]),
            tx(4000, rgbwafCommands(a, mix)),
            { kind: 'rescan', dt: 4000 },
            tx(1000, [{ id: 'DT8_ACTIVATE', address: a }]),
            ...stream,
            tx(8000, []),
          ]);
          expect(rateProblems(rec, 1)).toEqual([]);
        }),
        { numRuns: RUNS },
      );
    },
    timeout(RUNS),
  );
});
