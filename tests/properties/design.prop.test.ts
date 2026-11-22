/**
 * P-plan and P-effect (Stage 9, ADR 0020), run through the engine on the virtual-clock bench.
 *
 * P-plan: any sequence the check accepts runs on the simulator without a refusal and ends close to
 * its planned end.
 * P-effect: for any effect and any settings in range, the check refuses it, or it runs with no
 * refusal. Either way the simulator's output trace keeps every clause of S3, at the default swing
 * limit and with the rate unlock at three.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flushMicrotasks } from '../../src/bus/clock.ts';
import { broadcast, short } from '../../src/dali/address.ts';
import { EFFECTS, type EffectDef, type EffectId } from '../../src/design/effects.ts';
import type { LookColour } from '../../src/design/look.ts';
import type { Sequence, Step } from '../../src/design/sequence.ts';
import type { RunDef } from '../../src/engine/engine.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { simEngine } from '../harness/engine.ts';
import { timeout } from '../harness/gen.ts';
import '../harness/seed.ts';

/** Each case runs the scan, a check and a run on the bench, about 3 s, so fewer by default. */
const RUNS = Number(process.env['PROP_RUNS'] ?? 10);
/** A repeating effect is watched for this long before it is stopped. */
const WATCH_MS = 60_000;
/** The longest a planned run is followed. Longer plans are stopped there. */
const FOLLOW_MS = 400_000;

/** What each driver is set to before the run: off, or a level and a colour. */
interface Start {
  readonly arcs: readonly [number, number, number];
  readonly mirek: number;
  readonly extra: boolean;
}

const start: fc.Arbitrary<Start> = fc.record({
  arcs: fc.tuple(
    fc.oneof(fc.constant(0), fc.integer({ min: 86, max: 220 })),
    fc.oneof(fc.constant(0), fc.integer({ min: 86, max: 220 })),
    fc.oneof(fc.constant(0), fc.integer({ min: 86, max: 220 })),
  ),
  mirek: fc.integer({ min: 154, max: 370 }),
  extra: fc.boolean(),
});

const colour: fc.Arbitrary<LookColour> = fc.oneof(
  fc.constant<LookColour>({ kind: 'none' }),
  fc.integer({ min: 154, max: 370 }).map((mirek): LookColour => ({ kind: 'tc', mirek })),
  fc
    .tuple(
      fc.integer({ min: 0, max: 254 }),
      fc.integer({ min: 0, max: 254 }),
      fc.integer({ min: 0, max: 254 }),
      fc.integer({ min: 0, max: 254 }),
      fc.integer({ min: 0, max: 254 }),
    )
    .map(([r, g, b, w, a]): LookColour => ({ kind: 'rgbwaf', channels: [r, g, b, w, a, 255] })),
);

const step: fc.Arbitrary<Step> = fc
  .record({
    target: fc.constantFrom(short(0), short(1), short(7), broadcast),
    arc: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 254 })),
    colour,
    durationMs: fc.constantFrom(0, 300, 700, 1500, 4000, 20_000, 170_000),
    together: fc.boolean(),
  })
  .map(({ together, ...s }) => (together ? { ...s, together } : s));

const sequence: fc.Arbitrary<Sequence> = fc
  .array(step, { minLength: 1, maxLength: 6 })
  .map((steps) => ({ name: 'P', steps }));

const effect: fc.Arbitrary<EffectDef> = fc.constantFrom(...EFFECTS).chain((spec) =>
  fc.record({
    name: fc.constant('P'),
    type: fc.constant<EffectId>(spec.id),
    params: fc
      .tuple(
        ...spec.params.map((x) =>
          fc.integer({ min: 0, max: Math.round((x.max - x.min) / x.step) }),
        ),
      )
      .map((ns) =>
        Object.fromEntries(
          spec.params.map((x, i) => [
            x.key,
            Math.min(x.max, Math.round((x.min + (ns[i] ?? 0) * x.step) * 1000) / 1000),
          ]),
        ),
      ),
    targets: fc.shuffledSubarray([0, 1, 7], { minLength: 1 }),
  }),
);

interface Outcome {
  readonly started: boolean;
  readonly reason: string;
  readonly outcome: string | undefined;
  readonly text: string;
  readonly overMs: number;
  readonly problems: unknown[];
}

/** Set the bench up, run one definition, and record the simulator's output throughout. */
async function runOne(def: RunDef, from: Start, swings: number): Promise<Outcome> {
  const b = simEngine({ extras: from.extra ? [{ address: 7, lightType: 'C2' }] : [] });
  const live: { rec?: TraceRecorder } = {};
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    const st: { done: boolean; value?: T } = { done: false };
    const done = () => st.done;
    void p.then((v) => {
      st.done = true;
      st.value = v;
    });
    for (let i = 0; i < 2_000_000 && !done(); i++) {
      await flushMicrotasks();
      if (done()) break;
      const n = b.clock.next();
      if (n === undefined) break;
      await b.clock.advanceTo(n);
      live.rec?.record(b.clock.now());
    }
    return st.value as T;
  };
  const idle = async () => {
    await drive(
      (async () => {
        while (b.engine.snapshot().jobs.length > 0) await Promise.resolve();
      })(),
    );
  };
  const pass = async (ms: number) => {
    const end = b.clock.now() + ms;
    while (b.clock.now() < end) {
      await b.clock.advance(Math.min(500, end - b.clock.now()));
      live.rec?.record(b.clock.now());
    }
  };
  await idle();
  await pass(3000);
  // The starting levels, each with a fade and time for the guard between them.
  const addresses = from.extra ? [0, 1, 7] : [0, 1];
  for (const [i, n] of addresses.entries()) {
    const arc = from.arcs[i] ?? 0;
    if (arc === 0) continue;
    await drive(
      b.engine.request(
        {
          kind: 'apply',
          address: n,
          arc,
          fade: { kind: 'standard', value: 2 },
          ...(n === 1 ? {} : { mirek: from.mirek }),
        },
        'ui',
      ),
    );
    await pass(3000);
  }
  if (swings > 1) {
    expect(b.engine.unlock('rate', 'ui', true).ok).toBe(true);
    expect(b.engine.setSwingLimit(swings, 'ui').ok).toBe(true);
  }
  const rec = new TraceRecorder(b.sim, b.clock.now());
  live.rec = rec;
  const r = await drive(b.engine.runDesign(def, 'ui'));
  const began = b.engine.snapshot().run;
  let overMs = 0;
  if (r.ok && began !== undefined) {
    const startedAt = began.startedAt;
    const limit = began.endMs === undefined ? WATCH_MS : Math.min(began.endMs + 5000, FOLLOW_MS);
    while (b.engine.snapshot().run !== undefined && b.clock.now() - startedAt < limit)
      await pass(250);
    if (b.engine.snapshot().run !== undefined) b.engine.stopRun();
    else if (began.endMs !== undefined) overMs = b.clock.now() - startedAt - began.endMs;
    await idle();
  }
  // What was sent runs out, up to a limit, with the recorder following.
  const settle = Math.min(Math.max(b.sim.settlesAt(), b.clock.now()) + 500, b.clock.now() + 30_000);
  await pass(Math.max(0, settle - b.clock.now()));
  const last = b.engine.snapshot().lastRun;
  b.engine.dispose();
  return {
    started: r.ok,
    reason: r.ok ? '' : r.reason,
    outcome: last?.outcome,
    text: last?.text ?? '',
    overMs,
    problems: rateProblems(rec, swings),
  };
}

describe('P-plan: a sequence the check accepts runs as planned', () => {
  for (const swings of [1, 3])
    it(
      `keeps the rate rules and is never refused part way, at a swing limit of ${String(swings)}`,
      async () => {
        await fc.assert(
          fc.asyncProperty(sequence, start, async (seq, from) => {
            const o = await runOne({ kind: 'sequence', sequence: seq }, from, swings);
            expect(o.problems).toEqual([]);
            if (!o.started) return;
            // Stopped only by this test, at its limit: never by a refusal.
            expect(o.outcome === 'refused' ? o.text : 'not refused').toBe('not refused');
            // A run that finished ended within two seconds of its planned end (SPEC S5.3).
            if (o.outcome === 'finished') expect(o.overMs).toBeLessThan(2000);
          }),
          { numRuns: RUNS },
        );
      },
      timeout(RUNS, 4000),
    );
});

describe('P-effect: the check refuses an effect, or it runs clean', () => {
  for (const swings of [1, 3])
    it(
      `keeps the rate rules for any effect and settings, at a swing limit of ${String(swings)}`,
      async () => {
        await fc.assert(
          fc.asyncProperty(effect, start, async (def, from) => {
            const o = await runOne({ kind: 'effect', effect: def }, from, swings);
            expect(o.problems).toEqual([]);
            if (!o.started) return;
            expect(o.outcome === 'refused' ? o.text : 'not refused').toBe('not refused');
          }),
          { numRuns: RUNS },
        );
      },
      timeout(RUNS, 4000),
    );
});
