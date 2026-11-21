/**
 * The guard against the checker on made-up traces (ADR 0015, from its DALI review): whenever the
 * checker finds two hard steps too close, or too many small reversals, the guard's own reading of the
 * same light finds a breach of that rule too. The traces mix steps and fades with ratios near 2 and
 * levels near the 2% floor, fades either side of 0.7 s, and pauses either side of 1 s, which is where
 * the two readings can differ. A fade of 0.7 s or longer is slow, as the gear's plans would say
 * (ADR 0016). Both read the rule's grid (ADR 0019): every 25 ms of the clock, every breakpoint and
 * the moment before each. The guard reads it four times, once as the rule does and three times with
 * its margins, two of them on grids out of step.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { short } from '../../src/dali/address.ts';
import { rgbwafCommands, tcCommands } from '../../src/dali/sequences.ts';
import { EXACT } from '../../src/safety/rate/legs.ts';
import { predictEvents, ROOM, scopeOf, slowTest } from '../../src/safety/rate/trace.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { rateEvents, TraceRecorder } from '../harness/checker.ts';
import {
  agrees,
  agreesAddress,
  contained,
  sameReading,
  sourceOf,
  trace,
  type Seg,
} from '../harness/diff.ts';
import { timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);

const seg: fc.Arbitrary<Seg> = fc.record({
  flat: fc.oneof(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 900, max: 1100 })),
  fade: fc.oneof(
    fc.constant(0),
    fc.integer({ min: 20, max: 120 }),
    fc.integer({ min: 120, max: 600 }),
    fc.integer({ min: 600, max: 800 }),
    fc.integer({ min: 800, max: 2500 }),
  ),
  ratio: fc.oneof(
    fc.double({ min: 1.9, max: 2.1, noNaN: true }),
    fc.double({ min: 1.05, max: 1.9, noNaN: true }),
    fc.double({ min: 2.1, max: 40, noNaN: true }),
    // Near the leg border and the 0.5% change, where the reversal rule's readings can differ.
    fc.double({ min: 1.002, max: 1.02, noNaN: true }),
    fc.double({ min: 1.085, max: 1.115, noNaN: true }),
  ),
  up: fc.boolean(),
  off: fc.oneof(
    { weight: 7, arbitrary: fc.constant(false) },
    { weight: 3, arbitrary: fc.constant(true) },
  ),
});

const level = fc.oneof(fc.constant(0), fc.double({ min: 0.005, max: 1, noNaN: true }));

/**
 * Segments aimed at where one hard step can be dated differently (Stage 8b): slow lead-ins and fast
 * creeps of up to 0.8 s before a fade, steps a hair either side of 2, and pauses either side of the
 * 1 s and 2 s windows.
 */
const borderSeg: fc.Arbitrary<Seg> = fc.record({
  flat: fc.oneof(
    fc.integer({ min: 0, max: 120 }),
    fc.integer({ min: 880, max: 1120 }),
    fc.integer({ min: 1880, max: 2120 }),
  ),
  fade: fc.oneof(
    fc.constant(0),
    fc.integer({ min: 20, max: 400 }),
    fc.integer({ min: 400, max: 800 }),
  ),
  ratio: fc.oneof(
    fc.double({ min: 1.96, max: 2.04, noNaN: true }),
    fc.double({ min: 1.001, max: 1.3, noNaN: true }),
    fc.double({ min: 1.3, max: 1.96, noNaN: true }),
    fc.double({ min: 2.04, max: 12, noNaN: true }),
  ),
  up: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.boolean() }),
  off: fc.oneof(
    { weight: 8, arbitrary: fc.constant(false) },
    { weight: 2, arbitrary: fc.constant(true) },
  ),
});
/** A low start, so channels cross the 2% floor at their own moments. */
const low = fc.oneof(fc.constant(0), fc.double({ min: 0.004, max: 0.08, noNaN: true }));

describe('the guard and the checker on hard steps and reversals', () => {
  it(
    'the guard finds a hard-step or reversal breach wherever the checker does',
    async () => {
      await fc.assert(
        fc.asyncProperty(level, fc.array(seg, { minLength: 1, maxLength: 8 }), (v0, segs) => {
          agrees(trace(v0, segs));
          return Promise.resolve();
        }),
        {
          numRuns: RUNS * 40,
          examples: [
            // A slow fade to off, a fast fade, then two drops from off: found at 25 runs.
            [
              0.2674747474747476,
              [
                { flat: 1062, fade: 662, ratio: 1.002, up: false, off: true },
                { flat: 900, fade: 600, ratio: 1.9, up: false, off: false },
                { flat: 0, fade: 0, ratio: 1.085, up: false, off: true },
                { flat: 0, fade: 0, ratio: 2.1, up: false, off: true },
              ],
            ],
            // A fade from off to just over 2%, then a step: the checker's sample fell as the change
            // from the floor passed 2, and walked back over the fade (S6-P10).
            [
              0,
              [
                { flat: 14, fade: 610, ratio: 2.1, up: false, off: false },
                { flat: 143, fade: 20, ratio: 3.2619047619047605, up: true, off: false },
                { flat: 900, fade: 0, ratio: 1.085, up: false, off: false },
              ],
            ],
            // A small step, then a fast fade to off: the checker's sample fell in the 4.5 ms in which
            // only the sample before the small step was above 2 from the fade (S6-P10).
            [
              0.0544680216920296,
              [
                { flat: 145, fade: 757, ratio: 1.002, up: false, off: false },
                { flat: 170, fade: 0, ratio: 1.09280412371134, up: false, off: false },
                { flat: 159, fade: 97, ratio: 1.05, up: false, off: true },
                { flat: 0, fade: 600, ratio: 1.085, up: false, off: true },
              ],
            ],
            // A step up from off, then 4 ms later a fade down: the merge of the address's traces
            // took the two for one, since they were within 5 ms (S6-P11).
            [
              0,
              [
                { flat: 31, fade: 0, ratio: 4.115286657424818, up: false, off: false },
                { flat: 4, fade: 422, ratio: 4.721138814601888, up: false, off: false },
                { flat: 900, fade: 120, ratio: 1.05, up: false, off: false },
              ],
            ],
            // A doubling 724 ms after a step from off, which the guard joined to the step's span and
            // the checker, finding it late, counted as a span of its own (S6-P12).
            [
              0,
              [
                { flat: 900, fade: 0, ratio: 3.637666469072452, up: false, off: false },
                { flat: 61, fade: 600, ratio: 1.1107131659143774, up: true, off: false },
                { flat: 63, fade: 122, ratio: 2.000008196788498, up: true, off: false },
              ],
            ],
          ],
        },
      );
    },
    timeout(RUNS),
  );

  it(
    'and on quick small turns, with runs on the leg border',
    async () => {
      const turn = fc.record({
        flat: fc.integer({ min: 0, max: 150 }),
        fade: fc.oneof(fc.constant(0), fc.integer({ min: 20, max: 400 })),
        ratio: fc.oneof(
          fc.double({ min: 1.003, max: 1.02, noNaN: true }),
          fc.double({ min: 1.085, max: 1.115, noNaN: true }),
          fc.double({ min: 1.12, max: 1.6, noNaN: true }),
        ),
      });
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.05, max: 0.6, noNaN: true }),
          fc.boolean(),
          fc.array(turn, { minLength: 3, maxLength: 10 }),
          (v0, first, turns) => {
            const segs = turns.map((t, i) => ({
              ...t,
              up: i % 2 === 0 ? first : !first,
              off: false,
            }));
            agrees(trace(v0, segs));
            return Promise.resolve();
          },
        ),
        { numRuns: RUNS * 40 },
      );
    },
    timeout(RUNS),
  );
});

describe('one hard step, dated as a range and counted once (ADR 0019)', () => {
  it(
    'the guard finds the checker’s breaches on traces built around the borders',
    async () => {
      // Both read the rule's grid, as on the bench. With the checker's grid out of step the rule
      // itself can date one movement as two hard steps, which the guard's shifted readings sample
      // and do not always cover (finding S8b-2). The examples keep two such cases that are covered.
      await fc.assert(
        fc.asyncProperty(
          level,
          fc.array(borderSeg, { minLength: 2, maxLength: 7 }),
          fc.constant(0),
          (v0, segs, ph) => {
            agreesAddress([trace(v0, segs)], ph);
            return Promise.resolve();
          },
        ),
        {
          numRuns: RUNS * 40,
          examples: [
            // S6-P14: a fast rise from off, a fast fade, then a step to off 1,975 ms on.
            [
              0,
              [
                { flat: 910, fade: 393, ratio: 1.002, up: false, off: true },
                { flat: 95, fade: 583, ratio: 1.7961029733595697, up: true, off: false },
                { flat: 969, fade: 0, ratio: 2.1, up: false, off: true },
              ],
              0,
            ],
            // Its shape with the checker's grid 3 ms out of step.
            [
              0,
              [
                { flat: 910, fade: 393, ratio: 1.002, up: false, off: true },
                { flat: 95, fade: 583, ratio: 1.8, up: true, off: false },
                { flat: 0, fade: 60, ratio: 1.3, up: true, off: false },
                { flat: 909, fade: 0, ratio: 2.1, up: false, off: true },
              ],
              3,
            ],
            // S6-D18-1: a slow lead-in, a fast creep, a fast fade, and a drop 2 s later.
            [
              0.05,
              [
                { flat: 50, fade: 700, ratio: 1.6, up: true, off: false },
                { flat: 0, fade: 550, ratio: 1.5, up: true, off: false },
                { flat: 0, fade: 300, ratio: 3, up: true, off: false },
                { flat: 1269, fade: 0, ratio: 3, up: false, off: false },
              ],
              0,
            ],
          ],
        },
      );
    },
    timeout(RUNS),
  );

  it(
    'and on an address with two channels that cross the 2% floor apart',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          low,
          low,
          fc.array(borderSeg, { minLength: 1, maxLength: 5 }),
          fc.array(borderSeg, { minLength: 1, maxLength: 5 }),
          (a0, b0, a, b) => {
            agreesAddress([trace(a0, a), trace(b0, b)]);
            return Promise.resolve();
          },
        ),
        { numRuns: RUNS * 40 },
      );
    },
    timeout(RUNS),
  );

  it(
    'every hard step the checker dates lies inside one of the guard’s ranges',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          low,
          low,
          fc.array(fc.oneof(seg, borderSeg), { minLength: 1, maxLength: 6 }),
          fc.array(fc.oneof(seg, borderSeg), { minLength: 0, maxLength: 4 }),
          (a0, b0, a, b) => {
            contained(sourceOf(b.length === 0 ? [trace(a0, a)] : [trace(a0, a), trace(b0, b)]));
            return Promise.resolve();
          },
        ),
        { numRuns: RUNS * 40 },
      );
    },
    timeout(RUNS),
  );

  it(
    'the guard’s exact reading gives the checker’s events at the checker’s dates on made-up traces',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          level,
          low,
          fc.array(fc.oneof(seg, borderSeg), { minLength: 1, maxLength: 8 }),
          fc.array(fc.oneof(seg, borderSeg), { minLength: 0, maxLength: 4 }),
          (a0, b0, a, b) => {
            sameReading(sourceOf(b.length === 0 ? [trace(a0, a)] : [trace(a0, a), trace(b0, b)]));
            return Promise.resolve();
          },
        ),
        { numRuns: RUNS * 40 },
      );
    },
    timeout(RUNS),
  );
});

describe('the guard’s exact reading and the checker on the simulated bench (ADR 0019)', () => {
  it(
    'give the same legs, hard steps and reversals at the same dates, from the gear’s own plans',
    async () => {
      const cmd = fc.oneof(
        fc.record({ id: fc.constant('DAPC'), value: fc.integer({ min: 0, max: 254 }) }),
        // Fades of up to 4 s: under the 20 s past which the guard reads a thinner grid.
        fc.record({ id: fc.constant('SET_FADE_TIME'), value: fc.integer({ min: 0, max: 6 }) }),
        fc.record({
          id: fc.constant('SET_EXTENDED_FADE_TIME'),
          value: fc.constantFrom(0x03, 0x06, 0x07, 0x10, 0x11),
        }),
        fc.record({
          id: fc.constantFrom('OFF', 'UP', 'DOWN', 'RECALL_MAX_LEVEL', 'IDENTIFY_DEVICE'),
          value: fc.constant(-1),
        }),
        // A colour, which fades with the fade time: a level and a colour can then cross.
        fc.record({ id: fc.constant('COLOUR'), value: fc.integer({ min: 0, max: 254 }) }),
      );
      const step = fc.record({
        n: fc.integer({ min: 0, max: 1 }),
        cmd,
        wait: fc.oneof(
          fc.integer({ min: 0, max: 300 }),
          fc.integer({ min: 600, max: 1100 }),
          fc.integer({ min: 1900, max: 2100 }),
        ),
      });
      await fc.assert(
        // Seven steps at most: the gear keeps 20 s of its plans, and the guard reads from the start.
        fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 7 }), (steps) => {
          const sim = Simulator.bench({ at: 1000 });
          const r = new Rig(sim, 1000);
          const rec = new TraceRecorder(sim, 1000);
          for (const st of steps) {
            if (st.cmd.id.startsWith('SET_')) r.set(st.cmd.id, st.n, st.cmd.value);
            else if (st.cmd.id === 'COLOUR')
              r.run(
                st.n === 0
                  ? tcCommands(short(0), 153 + st.cmd.value)
                  : rgbwafCommands(short(1), [st.cmd.value, 254 - st.cmd.value, 0, 30, 0, 0]),
              );
            else if (st.cmd.value < 0) r.to(st.cmd.id, st.n);
            else r.to(st.cmd.id, st.n, st.cmd.value);
            r.wait(st.wait);
            // Recording stops and starts at any moment, and the grid does not move with it.
            rec.record(r.t);
          }
          r.wait(3000);
          rec.record(r.t);
          const checker = rateEvents(rec);
          // The whole room is read at every time, and nothing moves where the guard leaves a grid
          // time out, so the two see the same samples wherever something changes.
          const guard = predictEvents(sim, 1000, r.t, false, [EXACT]);
          for (const [id, scope] of [
            ...sim.all.map((u) => [u.id, scopeOf(u.id, u.gear.shortAddress)] as const),
            ['room', ROOM] as const,
          ]) {
            const c = checker.get(id);
            const g = guard.get(scope);
            expect(g?.legs, `${id} legs`).toEqual(c?.legs);
            expect(
              g?.hard.map((h) => h.lo),
              `${id} hard steps`,
            ).toEqual(c?.hard);
            expect(g?.reversals, `${id} reversals`).toEqual(c?.reversals);
          }
          return Promise.resolve();
        }),
        { numRuns: RUNS * 8 },
      );
    },
    timeout(RUNS),
  );
});

describe('the guard and the checker on which changes are slow', () => {
  it(
    'read the same plans the same way, as fades start, end and cut each other short',
    async () => {
      const cmd = fc.oneof(
        fc.record({ id: fc.constant('DAPC'), value: fc.integer({ min: 0, max: 254 }) }),
        fc.record({ id: fc.constant('SET_FADE_TIME'), value: fc.integer({ min: 0, max: 3 }) }),
        fc.record({
          id: fc.constant('SET_EXTENDED_FADE_TIME'),
          value: fc.constantFrom(0x03, 0x06, 0x07, 0x10, 0x11),
        }),
        fc.record({
          id: fc.constantFrom('OFF', 'UP', 'DOWN', 'RECALL_MAX_LEVEL', 'IDENTIFY_DEVICE'),
          value: fc.constant(-1),
        }),
      );
      const step = fc.record({
        n: fc.integer({ min: 0, max: 1 }),
        cmd,
        wait: fc.oneof(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 600, max: 900 })),
      });
      await fc.assert(
        fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), (steps) => {
          const sim = Simulator.bench({ at: 1000 });
          const r = new Rig(sim, 1000);
          const rec = new TraceRecorder(sim, 1000);
          for (const st of steps) {
            if (st.cmd.id.startsWith('SET_')) r.set(st.cmd.id, st.n, st.cmd.value);
            else if (st.cmd.value < 0) r.to(st.cmd.id, st.n);
            else r.to(st.cmd.id, st.n, st.cmd.value);
            r.wait(st.wait);
            rec.record(r.t);
          }
          r.wait(3000);
          rec.record(r.t);
          for (const u of sim.all) {
            const guard = slowTest(u.gear.plans());
            const checker = rec.slowTest(u.id);
            const pts = rec.points.get(u.id) ?? [];
            for (let k = 1; k < pts.length; k++) {
              const x = pts[k - 1]?.t ?? 0;
              const y = pts[k]?.t ?? 0;
              // The guard asks a fade to run 5 ms longer, so it never calls slow what the checker
              // calls fast (S6-D16-6).
              if (guard(x, y))
                expect(checker(x, y), `${u.id} from ${String(x)} to ${String(y)}`).toBe(true);
            }
          }
          return Promise.resolve();
        }),
        { numRuns: RUNS * 4 },
      );
    },
    timeout(RUNS),
  );
});
