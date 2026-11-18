/**
 * The guard against the checker on made-up traces (ADR 0015, from its DALI review): whenever the
 * checker finds two hard steps too close, or too many small reversals, the guard's own reading of the
 * same light finds a breach of that rule too. The traces mix steps and fades with ratios near 2 and
 * levels near the 2% floor, fades either side of 0.7 s, and pauses either side of 1 s, which is where
 * the two readings can differ. A fade of 0.7 s or longer is slow, as the gear's plans would say
 * (ADR 0016). The guard samples every 10 ms, the checker every 25 ms, as each does on the bench.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scopeViolations } from '../../src/safety/rate/guard.ts';
import {
  directedEvents,
  events,
  mergeDirected,
  SAME_LEG_MS,
  TIME_MARGIN_MS,
  type TraceEvents,
} from '../../src/safety/rate/legs.ts';
import { ROOM, slowTest } from '../../src/safety/rate/trace.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { timeout } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 25);
const EMPTY: TraceEvents = { legs: [], hard: [], reversals: [] };

interface Seg {
  readonly flat: number;
  readonly fade: number;
  readonly ratio: number;
  readonly up: boolean;
  readonly off: boolean;
}

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

/** Breakpoints of a piecewise-linear trace: [time, value]. */
function trace(v0: number, segs: readonly Seg[]): [number, number][] {
  const pts: [number, number][] = [[0, v0]];
  let t = 0;
  let v = v0;
  for (const s of segs) {
    t += s.flat;
    pts.push([t, v]);
    let next = v <= 0 ? 0.01 * s.ratio : s.up ? v * s.ratio : v / s.ratio;
    if (s.off) next = v > 0 ? 0 : 0.03 * s.ratio;
    next = Math.min(1, Math.max(0, next));
    t += s.fade === 0 ? 0.001 : s.fade;
    pts.push([t, next]);
    v = next;
  }
  pts.push([t + 3000, v]);
  return pts;
}

function at(pts: readonly [number, number][], t: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [t1, v1] = pts[i] ?? [0, 0];
    const [t0, v0] = pts[i - 1] ?? [0, 0];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1]?.[1] ?? 0;
}

/** Sample times: every breakpoint, just before each, and a grid of `step` ms. */
function times(pts: readonly [number, number][], step: number): number[] {
  const end = pts[pts.length - 1]?.[0] ?? 0;
  const s = new Set<number>();
  for (const [t] of pts) {
    s.add(t);
    if (t > 0.001) s.add(t - 0.001);
  }
  for (let t = 0; t < end; t += step) s.add(t);
  return [...s].sort((a, b) => a - b);
}

/**
 * The slow test for a made-up trace: a change is slow when it lies inside a fade of 0.7 s or longer.
 * Breakpoints come in pairs, a fade's start and end, after the first.
 */
function slowOf(pts: readonly [number, number][]): (x: number, y: number) => boolean {
  const slow: [number, number][] = [];
  for (let i = 2; i < pts.length; i += 2) {
    const a = pts[i - 1]?.[0] ?? 0;
    const b = pts[i]?.[0] ?? 0;
    if (b - a >= 700) slow.push([a, b]);
  }
  return (x, y) => slow.some(([a, b]) => a <= x && y <= b);
}

/** The checker's breaches of a rule on trace X imply the guard's own, at the address and the room. */
function agrees(pts: readonly [number, number][]): void {
  const rec = new TraceRecorder(Simulator.of([]), 0);
  rec.points.set(
    'X',
    times(pts, 25).map((t) => ({ t, d: [at(pts, t)] })),
  );
  rec.labels.set('X', ['mono']);
  const slow = slowOf(pts);
  rec.slow.set('X', slow);
  const problems = rateProblems(rec, 3);
  const ts = times(pts, 10);
  const samples = ts.map((t, k) => ({ t, v: at(pts, t), slow: k > 0 && slow(ts[k - 1] ?? t, t) }));
  const e = events(samples);
  // An address's events go through the merge of its traces, as `predictEvents` does (S6-D17-1).
  const de = directedEvents(samples);
  const address: TraceEvents = {
    legs: mergeDirected([de.legs], SAME_LEG_MS - TIME_MARGIN_MS),
    hard: mergeDirected([de.hard], SAME_LEG_MS - TIME_MARGIN_MS),
    reversals: de.reversals,
  };
  const guard = (scope: string, rule: string) =>
    scopeViolations(scope, scope === ROOM ? e : address, EMPTY, 3).some((v) =>
      v.rule.includes(rule),
    );
  for (const [rule, guardRule] of [
    ['hard steps', 'hard step'],
    ['reversals', 'reversals'],
  ] as const) {
    const checker = problems.filter((p) => p.rule === rule);
    if (checker.some((p) => p.scope === 'X'))
      expect(guard('a0', guardRule), `${rule} at X`).toBe(true);
    if (checker.some((p) => p.scope === 'room'))
      expect(guard(ROOM, guardRule), `${rule} in the room`).toBe(true);
  }
}

const level = fc.oneof(fc.constant(0), fc.double({ min: 0.005, max: 1, noNaN: true }));

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
