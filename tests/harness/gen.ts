/**
 * Generators of command streams for the property tests (docs/TEST_PLAN.md section 3), and a runner
 * that plays a stream on the bench while recording the simulator's output.
 */
import fc from 'fast-check';
import { broadcast, group, short, unaddressed, type Address } from '../../src/dali/address.ts';
import { decode, type Command } from '../../src/dali/codec.ts';
import { COMMANDS } from '../../src/dali/commands.ts';
import {
  framesForAll,
  rgbwafCommands,
  tcCommands,
  type TxFrame,
} from '../../src/dali/sequences.ts';
import { lowerCeiling } from '../../src/safety/ceiling.ts';
import { resetAndRestore, scan } from '../../src/safety/profile.ts';
import type { Source } from '../../src/safety/types.ts';
import { asSubmit, type Bench } from './bench.ts';
import { TraceRecorder } from './checker.ts';

export type Step =
  | {
      readonly kind: 'tx';
      readonly dt: number;
      readonly source: Source;
      readonly cmds: readonly Command[];
    }
  | {
      readonly kind: 'burst';
      readonly dt: number;
      readonly txs: readonly { source: Source; cmds: readonly Command[] }[];
    }
  | {
      readonly kind: 'raw';
      readonly dt: number;
      readonly source: Source;
      readonly frames: readonly TxFrame[];
    }
  | { readonly kind: 'fault'; readonly dt: number; readonly reached: boolean }
  | { readonly kind: 'rescan'; readonly dt: number }
  | { readonly kind: 'reset'; readonly dt: number; readonly n: number }
  | { readonly kind: 'lower'; readonly dt: number; readonly arc: number }
  | { readonly kind: 'panic'; readonly dt: number }
  | { readonly kind: 'resume'; readonly dt: number }
  | { readonly kind: 'reconnect'; readonly dt: number };

export interface GenOptions {
  /** Include RESET under the unlock. */
  readonly reset?: boolean;
  readonly panic?: boolean;
  readonly lower?: boolean;
  /** Weight fade changes more heavily (P-rate-fade). */
  readonly fades?: boolean;
  /** Include reconnects (the hardware target). */
  readonly reconnect?: boolean;
}

const SOURCES: Source[] = [
  'ui',
  'console',
  'script',
  'sequence',
  'effect',
  'switch',
  'import',
  'internal',
];
const source = fc.constantFrom(...SOURCES);
const A = short(0);
const B = short(1);
const address: fc.Arbitrary<Address> = fc.constantFrom(
  A,
  B,
  broadcast,
  group(0),
  group(1),
  short(5),
  unaddressed,
);
const level = fc.oneof(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 140, max: 170 }),
  fc.constantFrom(0, 254, 255),
);
const byte = fc.integer({ min: 0, max: 255 });
const dt = fc.oneof(
  fc.integer({ min: 0, max: 120 }),
  fc.integer({ min: 0, max: 1500 }),
  fc.constant(2100),
);

const c = (id: string, a?: Address, value?: number): Command => ({
  id,
  ...(a === undefined ? {} : { address: a }),
  ...(value === undefined ? {} : { value }),
});

const indirect = fc.constantFrom(
  'UP',
  'DOWN',
  'STEP_UP',
  'STEP_DOWN',
  'STEP_DOWN_AND_OFF',
  'ON_AND_STEP_UP',
  'RECALL_MAX_LEVEL',
  'RECALL_MIN_LEVEL',
  'GO_TO_LAST_ACTIVE_LEVEL',
  'CONTINUOUS_UP',
  'CONTINUOUS_DOWN',
);

const mix = fc.tuple(byte, byte, byte, byte, byte, byte);

const fadeChange = fc
  .tuple(
    fc.constantFrom('SET_FADE_TIME', 'SET_FADE_RATE', 'SET_EXTENDED_FADE_TIME'),
    fc.integer({ min: 0, max: 0x5f }),
    address,
  )
  .map(([id, v, a]) => [
    c('DTR0', undefined, id === 'SET_EXTENDED_FADE_TIME' ? v : v & 0x0f),
    c(id, a),
  ]);

/** One transaction's commands. */
export function commands(o: GenOptions = {}): fc.Arbitrary<Command[]> {
  const weighted: fc.WeightedArbitrary<Command[]>[] = [
    { weight: 8, arbitrary: fc.tuple(address, level).map(([a, v]) => [c('DAPC', a, v)]) },
    { weight: 2, arbitrary: address.map((a) => [c('OFF', a)]) },
    { weight: 3, arbitrary: fc.tuple(indirect, address).map(([id, a]) => [c(id, a)]) },
    { weight: o.fades === true ? 8 : 2, arbitrary: fadeChange },
    {
      weight: 1,
      arbitrary: fc
        .tuple(byte, address)
        .map(([v, a]) => [c('DTR0', undefined, v), c('SET_MIN_LEVEL', a)]),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(byte, address)
        .map(([v, a]) => [c('DTR0', undefined, v), c('SET_MAX_LEVEL', a)]),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(byte, fc.integer({ min: 0, max: 3 }), address)
        .map(([v, k, a]) => [c('DTR0', undefined, v), c('SET_SCENE', a, k)]),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(fc.integer({ min: 0, max: 3 }), address)
        .map(([k, a]) => [c('GO_TO_SCENE', a, k)]),
    },
    {
      weight: 3,
      arbitrary: fc
        .tuple(fc.integer({ min: 100, max: 450 }), fc.boolean())
        .map(([m, act]) => tcCommands(A, m, act)),
    },
    {
      weight: 3,
      arbitrary: fc.tuple(mix, fc.boolean()).map(([m, act]) => rgbwafCommands(B, m, act)),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(mix, level)
        .map(([m, v]) => [...rgbwafCommands(B, m, false), c('DAPC', B, v)]),
    },
    { weight: 1, arbitrary: address.map((a) => [c('ENABLE_DAPC_SEQUENCE', a)]) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(address, fc.integer({ min: 0, max: 1 }))
        .map(([a, g]) => [c('ADD_TO_GROUP', a, g)]),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(byte, address)
        .map(([v, a]) => [c('DTR0', undefined, v), c('STORE_ACTUAL_LEVEL_IN_DTR0', a)]),
    },
    {
      weight: 2,
      arbitrary: fc
        .tuple(
          fc.constantFrom(
            ...COMMANDS.filter(
              (s) => s.reply !== 'none' && s.kind === 'standard' && s.param === 'none',
            ).map((s) => s.id),
          ),
          address,
        )
        .map(([id, a]) => [c(id, a)]),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(byte, byte, byte)
        .map(([x, y, z]) => [
          c('DTR0', undefined, x),
          c('DTR1', undefined, y),
          c('DTR2', undefined, z),
        ]),
    },
  ];
  return fc.oneof(...weighted);
}

/** A raw frame: random bytes, or a real command with its flags, sometimes wrong. */
const raw: fc.Arbitrary<TxFrame[]> = fc.oneof(
  fc
    .tuple(byte, byte, fc.boolean(), fc.boolean())
    .map(([a, b, st, er]) => [{ frame: { a, b }, sendTwice: st, expectReply: er }]),
  commands().map((cmds) => framesForAll(cmds)),
);

export function steps(o: GenOptions = {}, max = 30): fc.Arbitrary<Step[]> {
  const step: fc.WeightedArbitrary<Step>[] = [
    {
      weight: 20,
      arbitrary: fc
        .tuple(dt, source, commands(o))
        .map(([d, s, cmds]) => ({ kind: 'tx', dt: d, source: s, cmds })),
    },
    {
      weight: 3,
      arbitrary: fc
        .tuple(dt, fc.array(fc.tuple(source, commands(o)), { minLength: 2, maxLength: 3 }))
        .map(([d, list]) => ({
          kind: 'burst',
          dt: d,
          txs: list.map(([s, cmds]) => ({ source: s, cmds })),
        })),
    },
    {
      weight: 3,
      arbitrary: fc
        .tuple(dt, source, raw)
        .map(([d, s, frames]) => ({ kind: 'raw', dt: d, source: s, frames })),
    },
    {
      weight: 1,
      arbitrary: fc
        .tuple(dt, fc.boolean())
        .map(([d, reached]) => ({ kind: 'fault', dt: d, reached })),
    },
    { weight: 1, arbitrary: dt.map((d) => ({ kind: 'rescan', dt: d })) },
  ];
  if (o.reset === true)
    step.push({
      weight: 1,
      arbitrary: fc.tuple(dt, fc.constantFrom(0, 1)).map(([d, n]) => ({ kind: 'reset', dt: d, n })),
    });
  if (o.lower === true)
    step.push({
      weight: 1,
      arbitrary: fc
        .tuple(dt, fc.integer({ min: 90, max: 219 }))
        .map(([d, arc]) => ({ kind: 'lower', dt: d, arc })),
    });
  if (o.reconnect === true)
    step.push({ weight: 1, arbitrary: dt.map((d) => ({ kind: 'reconnect', dt: d })) });
  if (o.panic === true) {
    step.push({ weight: 1, arbitrary: dt.map((d) => ({ kind: 'panic', dt: d })) });
    step.push({ weight: 1, arbitrary: dt.map((d) => ({ kind: 'resume', dt: d })) });
  }
  return fc.array(fc.oneof(...step), { minLength: 1, maxLength: max });
}

export interface Played {
  readonly rec: TraceRecorder;
  /** Ceiling arc in force after each step, with the time it took effect. */
  readonly ceilings: { t: number; arc: number }[];
}

/** Play a stream on a ready bench, recording the simulator's output as it goes. */
export async function play(
  b: Bench,
  stream: readonly Step[],
  hooks: { afterStep?: () => void } = {},
): Promise<Played> {
  const rec = new TraceRecorder(b.sim, b.clock.now());
  const ceilings = [{ t: b.clock.now(), arc: b.governor.ceilingArc }];
  const submit = asSubmit(b);
  const wait = (ms: number) =>
    new Promise<void>((r) => {
      b.clock.at(b.clock.now() + ms, r);
    });
  for (const s of stream) {
    await b.clock.advance(s.dt);
    rec.record(b.clock.now());
    switch (s.kind) {
      case 'tx':
        await b.run({ frames: framesForAll(s.cmds), source: s.source });
        break;
      case 'burst':
        await b.drive(
          Promise.all(
            s.txs.map((t) => b.submit({ frames: framesForAll(t.cmds), source: t.source })),
          ),
        );
        break;
      case 'raw':
        await b.run({ frames: s.frames, source: s.source });
        break;
      case 'fault': {
        let used = false;
        b.sink.fault = () => {
          if (used) return undefined;
          used = true;
          return { reached: s.reached };
        };
        break;
      }
      case 'rescan':
        // A fault mid-scan fails the scan; the stream carries on.
        await b.drive(scan(b.governor, submit, [0, 1]).catch(() => []));
        break;
      case 'reset': {
        const before = b.sink.log.length;
        await b.drive(resetAndRestore(s.n, b.governor, submit, wait, 'console'));
        for (const l of b.sink.log.slice(before)) {
          if (decode(l.frame.frame)?.id === 'RESET')
            rec.resets.push({ t: l.at, id: s.n === 0 ? 'A' : 'B' });
        }
        break;
      }
      case 'lower': {
        const r = await b.drive(
          lowerCeiling(b.governor, s.arc, submit, 'script', () => b.clock.now(), wait),
        );
        if (r.ok) ceilings.push({ t: b.clock.now(), arc: s.arc });
        break;
      }
      case 'panic':
        await b.drive(b.scheduler.panic());
        break;
      case 'resume':
        b.governor.resume('ui');
        break;
      case 'reconnect':
        b.reconnect();
        // A fault mid-scan leaves the gear unverified; the stream carries on.
        await b.ready().catch(() => undefined);
        break;
    }
    rec.record(b.clock.now());
    hooks.afterStep?.();
  }
  // Let every fade finish.
  const end = Math.min(b.sim.settlesAt(), b.clock.now() + 20_000);
  while (b.clock.now() < end) {
    await b.clock.advance(Math.min(1000, end - b.clock.now()));
    rec.record(b.clock.now());
  }
  return { rec, ceilings };
}
