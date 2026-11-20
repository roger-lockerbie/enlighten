/**
 * Counterexamples from the Stage 6 property runs and reviews (ADR 0015 and ADR 0016), kept as fixed
 * cases. The first two ran a hard step inside a run that a slow fade, or a short pause, kept going.
 */
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { withFloors } from '../../src/bus/timing.ts';
import { broadcast, group } from '../../src/dali/address.ts';
import { decode } from '../../src/dali/codec.ts';
import { Engine } from '../../src/engine/engine.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { SimTransport } from '../../src/transport/sim.ts';
import { makeBench } from '../harness/bench.ts';
import { scopeViolations } from '../../src/safety/rate/guard.ts';
import {
  directedEvents,
  events,
  mergeDirected,
  SAME_LEG_MS,
  type Sample,
  TIME_MARGIN_MS,
} from '../../src/safety/rate/legs.ts';
import { ROOM } from '../../src/safety/rate/trace.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { agrees, agreesAddress, trace } from '../harness/diff.ts';
import { play, type Step } from '../harness/gen.ts';
import s5p1 from './s5-p1.counterexample.json' with { type: 'json' };

describe('hard steps inside a run (ADR 0015)', () => {
  it('an unlocked RESET after a rise is held: the rise, the RESET and its OFF were a flash', async () => {
    // Driver A went from off to 40%, the RESET took it to full 0.7 s later, and its OFF to off 0.4 s
    // after that. The jump to full was folded into the rise, so dropping "the first hard step after
    // the RESET" dropped the OFF.
    const stream = [
      {
        kind: 'tx',
        dt: 2100,
        source: 'ui',
        cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 254 }],
      },
      {
        kind: 'tx',
        dt: 518,
        source: 'ui',
        cmds: [{ id: 'DAPC', address: { kind: 'group', n: 0 }, value: 140 }],
      },
      { kind: 'reset', dt: 92, n: 0 },
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    const start = b.sink.log.length;
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 3)).toEqual([]);
    const sent = b.sink.log.slice(start);
    const rise = sent.find((l) => decode(l.frame.frame)?.id === 'DAPC');
    const reset = sent.find((l) => decode(l.frame.frame)?.id === 'RESET');
    // Either the RESET waited out the 2 s hard-step window after the rise, or it was refused.
    if (rise !== undefined && reset !== undefined) expect(reset.at - rise.at).toBeGreaterThan(2000);
  });

  it('a RESET at full still counts its OFF as a hard step', async () => {
    // At full, the RESET makes no jump, so its OFF is the pair's one hard step. The old rule dropped
    // it, so a RESET 0.5 s after a hard rise passed, and the light went on and off within a second.
    const A = { kind: 'short', n: 0 };
    const stream = [
      { kind: 'tx', dt: 2100, source: 'ui', cmds: [{ id: 'DAPC', address: A, value: 254 }] },
      { kind: 'reset', dt: 500, n: 0 },
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    // At three swings a second the swing rule allows the rise and the OFF, so only the hard-step rule
    // decides.
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    const start = b.sink.log.length;
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 3)).toEqual([]);
    const sent = b.sink.log.slice(start);
    const rise = sent.find((l) => decode(l.frame.frame)?.id === 'DAPC');
    const reset = sent.find((l) => decode(l.frame.frame)?.id === 'RESET');
    expect(rise).toBeDefined();
    if (rise !== undefined && reset !== undefined) expect(reset.at - rise.at).toBeGreaterThan(2000);
  });

  it('a console drop at the end of a slow fade is dated where it happened', async () => {
    // The room's step up at 15.19 s and its drop 2.07 s later were 17 ms apart under the old dating,
    // because the drop ended a slow fade that began just after the step up.
    const ctx = { aliases: new Map<string, number>() };
    const clock = new VirtualClock(1000);
    const sim = Simulator.bench({ at: 1000 });
    const engine = new Engine({
      clock,
      sim,
      simTransport: new SimTransport(sim, clock, withFloors({})),
    });
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
    await drive(
      (async () => {
        while (engine.snapshot().jobs.length > 0) await Promise.resolve();
      })(),
    );
    await clock.advance(3000);
    const rec = new TraceRecorder(sim, clock.now());
    live.rec = rec;
    await drive(engine.console('level 1 0 fade 2s', ctx));
    await drive(engine.runScript('p', 'dapc 0,1 1\ndapc 0 125\ndtr0 0', ctx));
    await drive(engine.console('rgb 1 0 0 0', ctx));
    await drive(engine.console('dapc 0 0', ctx));
    const end = clock.now() + 4000;
    while (clock.now() < end) {
      await clock.advance(500);
      rec.record(clock.now());
    }
    engine.dispose();
    expect(rateProblems(rec, 1)).toEqual([]);
  });
});

describe('small reversals next to a run on the leg border', () => {
  it('counts the turn after a slow fall that is a leg only by the margin (rate-runs counterexample)', async () => {
    // A faded slowly to off while B stepped off, to arc 1, then to arc 86. The room fell by a ratio
    // just under 1.1, so the guard called the fall a leg and the turn after it not a small reversal.
    const A = { kind: 'short', n: 0 };
    const B = { kind: 'short', n: 1 };
    const stream = [
      { kind: 'tx', dt: 0, source: 'ui', cmds: [{ id: 'DAPC', address: A, value: 111 }] },
      {
        kind: 'tx',
        dt: 2100,
        source: 'ui',
        cmds: [
          { id: 'DTR0', value: 8 },
          { id: 'SET_FADE_TIME', address: A },
        ],
      },
      { kind: 'tx', dt: 0, source: 'ui', cmds: [{ id: 'DAPC', address: A, value: 0 }] },
      { kind: 'tx', dt: 407, source: 'console', cmds: [{ id: 'DAPC', address: B, value: 0 }] },
      { kind: 'tx', dt: 492, source: 'console', cmds: [{ id: 'DAPC', address: B, value: 1 }] },
      { kind: 'tx', dt: 41, source: 'console', cmds: [{ id: 'DAPC', address: B, value: 86 }] },
      { kind: 'tx', dt: 0, source: 'console', cmds: [{ id: 'DAPC', address: A, value: 0 }] },
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 3)).toEqual([]);
  });
});

describe('a new leg next to an old one', () => {
  it('a fall that starts 1 ms after an old rise is still a new leg (rate-runs counterexample)', async () => {
    // B faded slowly to off. A rose to full, then dropped to 195 31 ms later, which made the room's
    // slow fall after the rise a leg. The guard matched the new fall to the old rise, 1 ms apart, and
    // passed three legs in a second at the default of one swing.
    const A = { kind: 'short', n: 0 };
    const B = { kind: 'short', n: 1 };
    const stream = [
      { kind: 'tx', dt: 0, source: 'ui', cmds: [{ id: 'DAPC', address: B, value: 103 }] },
      {
        kind: 'tx',
        dt: 2100,
        source: 'ui',
        cmds: [
          { id: 'DTR0', value: 5 },
          { id: 'SET_FADE_TIME', address: B },
        ],
      },
      { kind: 'tx', dt: 0, source: 'ui', cmds: [{ id: 'DAPC', address: B, value: 0 }] },
      { kind: 'tx', dt: 518, source: 'console', cmds: [{ id: 'DAPC', address: A, value: 254 }] },
      { kind: 'tx', dt: 0, source: 'console', cmds: [{ id: 'DAPC', address: A, value: 195 }] },
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 1)).toEqual([]);
  });
});

describe('fast change that no fade of 0.7 s made (ADR 0016)', () => {
  it('a fast fade inside a longer run is a hard step, so the next comes 2 s later (S6-R4)', async () => {
    // With a 200 ms extended fade, a one-step nudge starts the run and a fade by about 8.7 follows
    // 0.9 s later, up and then down. No 50 ms of a fade changes by 2 and each run takes over 0.7 s,
    // so the old rule found no hard step and the light flashed once a second.
    const A = { kind: 'short', n: 0 };
    const dapc = (dt: number, value: number) => ({
      kind: 'tx',
      dt,
      source: 'ui',
      cmds: [{ id: 'DAPC', address: A, value }],
    });
    const stream = [
      dapc(0, 100),
      {
        kind: 'tx',
        dt: 2100,
        source: 'ui',
        cmds: [
          { id: 'DTR0', value: 0x11 },
          { id: 'SET_EXTENDED_FADE_TIME', address: A },
          { id: 'DTR0', value: 0 },
          { id: 'SET_FADE_TIME', address: A },
        ],
      },
      dapc(0, 101),
      dapc(900, 180),
      dapc(160, 179),
      dapc(900, 100),
      dapc(160, 101),
      dapc(900, 180),
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    const start = b.sink.log.length;
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 1)).toEqual([]);
    const big = b.sink.log
      .slice(start)
      .filter((l) => {
        const c = decode(l.frame.frame);
        return c?.id === 'DAPC' && (c.value === 180 || c.value === 100);
      })
      .map((l) => l.at);
    // The first is the setup's DAPC 100. Each big fade after it comes 2 s or more after the last.
    for (let i = 2; i < big.length; i++)
      expect((big[i] ?? 0) - (big[i - 1] ?? 0)).toBeGreaterThanOrEqual(2000);
  });

  it("the tail of a slow fade is not a hard step when another driver splits the room's run", async () => {
    // A faded from arc 1 to 188 over 2.8 s. B's RESET and its OFF came during the fade, which left the
    // room's last rise under 0.7 s long. The old checker read it as a fast leg (P-rate-slow, 1,000 runs).
    const stream = [
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
          { id: 'DTR0', value: 5 },
          { id: 'SET_FADE_TIME', address: { kind: 'short', n: 0 } },
        ],
      },
      {
        kind: 'tx',
        dt: 0,
        source: 'ui',
        cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 188 }],
      },
      {
        kind: 'tx',
        dt: 939,
        source: 'console',
        cmds: [
          { id: 'DTR0', value: 0 },
          { id: 'SET_FADE_TIME', address: { kind: 'short', n: 0 } },
          { id: 'DTR0', value: 0 },
          { id: 'SET_EXTENDED_FADE_TIME', address: { kind: 'short', n: 0 } },
        ],
      },
      { kind: 'reset', dt: 571, n: 1 },
      {
        kind: 'tx',
        dt: 0,
        source: 'console',
        cmds: [{ id: 'DAPC', address: { kind: 'short', n: 0 }, value: 0 }],
      },
    ] as unknown as Step[];
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 1)).toEqual([]);
  });
});

describe('a span on the border, then a real one (DALI review S6-D16-1)', () => {
  it('the guard finds the hard steps the checker does when a borderline rise runs into a fast one', () => {
    // A rise of 1.99 over 720 ms, which the guard may count as a span and the checker does not, runs
    // straight into a rise of 3 over 300 ms, then a drop by 3 comes 2.0 to 2.1 s later. The guard let
    // the real span join the border one and dated it 0.7 s too early, so it missed the checker's breach.
    for (let gap = 1900; gap <= 2200; gap += 5) {
      const pts: Sample[] = [];
      for (let t = -1000; t <= 0; t += 10) pts.push({ t, v: 0.1 });
      for (let t = 10; t <= 720; t += 10) pts.push({ t, v: 0.1 * 1.99 ** (t / 720) });
      for (let t = 10; t <= 300; t += 10) pts.push({ t: 720 + t, v: 0.199 * 3 ** (t / 300) });
      const top = 0.199 * 3;
      for (let t = 1030; t < gap - 0.001; t += 10) pts.push({ t, v: top });
      pts.push({ t: gap - 0.001, v: top }, { t: gap, v: top / 3 });
      for (let t = gap + 10; t < gap + 2500; t += 10) pts.push({ t, v: top / 3 });
      const rec = new TraceRecorder(Simulator.of([]), -1000);
      rec.points.set(
        'X',
        pts.map((p) => ({ t: p.t, d: [p.v] })),
      );
      rec.labels.set('X', ['mono']);
      rec.slow.set('X', () => false);
      const checker = rateProblems(rec, 1).some((p) => p.rule === 'hard steps');
      const empty = { legs: [], hard: [], reversals: [] };
      const guard = scopeViolations('a0', events(pts), empty, 1).some((v) =>
        v.rule.includes('hard step'),
      );
      if (checker) expect(guard, `drop at ${String(gap)} ms`).toBe(true);
    }
  });
});

describe('a span found by an instant step near 2 (security review S6-S17-1)', () => {
  it('the guard counts the earlier date the rule gives when a small step came first', () => {
    // A step by 5, a nudge by 1.015 0.8 s later, and a step by 1.9803 0.6 s after that. The last step
    // alone is above 2 × 0.99, so the guard dated the span just before it. The rule dates it before
    // the nudge, 0.8 s after the first step: a breach of one hard step a second for the room.
    const steps: [number, number][] = [
      [-800, 5],
      [0, 1.015],
      [600, 1.9803],
    ];
    const at = (t: number) => steps.reduce((x, [s, r]) => (t >= s ? x * r : x), 0.05);
    const pts: Sample[] = [];
    for (let t = -2000; t <= 3000; t += 10) pts.push({ t, v: at(t) });
    for (const [st] of steps) pts.push({ t: st - 0.001, v: at(st - 0.001) });
    pts.sort((a, b) => a.t - b.t);
    const rec = new TraceRecorder(Simulator.of([]), -2000);
    rec.points.set(
      'X',
      pts
        .filter((p) => p.t % 25 === 0 || !Number.isInteger(p.t))
        .map((p) => ({ t: p.t, d: [p.v] })),
    );
    rec.labels.set('X', ['mono']);
    rec.slow.set('X', () => false);
    expect(rateProblems(rec, 1).some((p) => p.scope === 'room' && p.rule === 'hard steps')).toBe(
      true,
    );
    const empty = { legs: [], hard: [], reversals: [] };
    expect(
      scopeViolations(ROOM, events(pts), empty, 1).some((v) => v.rule.includes('hard step')),
    ).toBe(true);
  });
});

describe('the rule’s own samples after an instant step near 2 (security review S6-S18-1)', () => {
  it('the guard counts the date of the checker’s last sample before the guard’s sure one', () => {
    // A step by 5 at T0, a slow lead-in, a fast fade by 1.2 that ends at 975, and a step by 1.99 at
    // 1000. The latest guard sample the change is surely above 2 from is about 964. The checker,
    // every 25 ms, has none between 950 and 975, so it dates the span at 950, less than 2 s after T0.
    for (const t0 of [-1049, -1045, -1041]) {
      const at = (t: number): number => {
        let x = 0.05;
        if (t >= t0) x *= 5;
        if (t > 0) x *= 1.05 ** (Math.min(t, 875) / 875);
        if (t > 875) x *= 1.2 ** ((Math.min(t, 975) - 875) / 100);
        if (t >= 1000) x *= 1.99;
        return x;
      };
      const slow = (x: number, y: number) => x >= 0 && y <= 875;
      const bps = [t0, 0, 875, 975, 1000];
      const gt = new Set<number>(bps.flatMap((b) => [b, b - 0.001]));
      for (let t = -2000; t <= 3000; t += 10) gt.add(t);
      const ct = new Set<number>(bps.flatMap((b) => [b, b - 0.001]));
      for (let t = -2000; t <= 3000; t += 25) ct.add(t);
      const gts = [...gt].sort((a, b) => a - b);
      const pts: Sample[] = gts.map((t, k) => ({
        t,
        v: at(t),
        slow: k > 0 && slow(gts[k - 1] ?? t, t),
      }));
      const rec = new TraceRecorder(Simulator.of([]), -2000);
      rec.points.set(
        'X',
        [...ct].sort((a, b) => a - b).map((t) => ({ t, d: [at(t)] })),
      );
      rec.labels.set('X', ['mono']);
      rec.slow.set('X', slow);
      const checker = rateProblems(rec, 1).filter(
        (p) => p.scope === 'X' && p.rule === 'hard steps',
      );
      expect(checker.length, `T0 ${String(t0)}`).toBeGreaterThan(0);
      const empty = { legs: [], hard: [], reversals: [] };
      expect(
        scopeViolations('a0', events(pts), empty, 1).some((v) => v.rule.includes('hard step')),
        `T0 ${String(t0)}`,
      ).toBe(true);
    }
  });
});

describe('a border date and the merge of an address’s traces (DALI review S6-D17-1)', () => {
  it('merging an address’s hard steps keeps the span’s own date beside its early one', () => {
    // A slow lead-in, a nudge by 1.01, then 50 ms on a fast fade by 10 and a drop 2 s after that.
    // The early date, at the nudge, absorbed the span's own date in the 60 ms merge, so the drop
    // 1,990 ms after the span passed the address's 2 s rule, which the checker read as a breach.
    for (let gap = 1980; gap <= 2000; gap += 1) {
      const end = 1050 + gap;
      const pts: Sample[] = [];
      const at = (t: number) =>
        t <= 200
          ? 0.09
          : t <= 1000
            ? 0.09 + ((t - 200) / 800) * 0.01
            : t < 1050
              ? 0.101
              : t < 1150
                ? 0.101 + ((t - 1050) / 100) * 0.899
                : t < end
                  ? 1
                  : 0.3;
      const slow = (x: number, y: number) => x >= 200 && y <= 1000;
      const ts = new Set<number>([1000.001, end - 0.001]);
      for (let t = 0; t <= end + 3000; t += 10) ts.add(t);
      for (const t of [...ts].sort((a, b) => a - b)) pts.push({ t, v: at(t) });
      const samples = pts.map((p, k) => ({
        ...p,
        slow: k > 0 && slow(pts[k - 1]?.t ?? p.t, p.t),
      }));
      const rec = new TraceRecorder(Simulator.of([]), 0);
      rec.points.set(
        'X',
        samples
          .filter((p) => p.t % 25 === 0 || !Number.isInteger(p.t))
          .map((p) => ({ t: p.t, d: [p.v] })),
      );
      rec.labels.set('X', ['mono']);
      rec.slow.set('X', slow);
      const checker = rateProblems(rec, 1).some((p) => p.scope === 'X' && p.rule === 'hard steps');
      const de = directedEvents(samples);
      const merged = {
        legs: mergeDirected([de.legs], SAME_LEG_MS - TIME_MARGIN_MS),
        hard: mergeDirected([de.hard], SAME_LEG_MS - TIME_MARGIN_MS),
        reversals: de.reversals,
      };
      const empty = { legs: [], hard: [], reversals: [] };
      const guard = scopeViolations('a0', merged, empty, 1).some((v) =>
        v.rule.includes('hard step'),
      );
      if (checker) expect(guard, `drop at ${String(gap)} ms`).toBe(true);
    }
  });
});

describe('gear the guard does not know, moving with other gear (ADR 0016)', () => {
  it('a broadcast that moves unmodelled gear with modelled gear is refused', async () => {
    // R0 was fading during the scan, so the shadow has no model of it. A broadcast DAPC lifted R1 at
    // once, faded R2 up over 0.7 s and R0 down over 2.8 s: four room legs in 0.7 s, where the guard
    // counted one (P-rate on hardware the governor has never seen, 1,000 runs).
    const light = ['C5', 'C1', 'C1'] as const;
    const real = Simulator.of(
      [0, 1, 2].map((n) => ({
        id: `R${String(n)}`,
        profile: da5l(light[n] ?? 'C1', 'tc', { physicalMinimum: 1 }),
        opts: { shortAddress: n },
      })),
    );
    const r = new Rig(real, 0);
    [203, 0, 0].forEach((level, n) => {
      r.set('SET_SCENE', n, 0, 0);
      r.set('SET_SCENE', n, 0, 3);
      r.set('SET_MIN_LEVEL', n, 1);
      r.set('SET_FADE_TIME', n, [5, 0, 1][n] ?? 0);
      r.to('DAPC', n, level);
    });
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
    await b.ready();
    const A0 = { kind: 'short', n: 0 };
    const stream = [
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
      { kind: 'tx', dt: 500, source: 'ui', cmds: [{ id: 'DAPC', address: A0, value: 0 }] },
      { kind: 'tx', dt: 3500, source: 'ui', cmds: [{ id: 'DAPC', address: A0, value: 203 }] },
      {
        kind: 'tx',
        dt: 3500,
        source: 'ui',
        cmds: [{ id: 'DAPC', address: broadcast, value: 140 }],
      },
    ] as unknown as Step[];
    const start = b.sink.log.length;
    const { rec } = await play(b, stream);
    expect(rateProblems(rec, 1)).toEqual([]);
    const sent = b.sink.log.slice(start).map((l) => decode(l.frame.frame));
    expect(sent.some((c) => c?.id === 'DAPC' && c.value === 140)).toBe(false);
  });
});

/**
 * Stage 8b: the cases still open when the rate guard got a stage of its own. Each is marked as
 * failing until ADR 0019 is built, and becomes a plain test then.
 */
describe('one hard step dated differently by where the samples fall (Stage 8b)', () => {
  const seg = (flat: number, fade: number, ratio: number, up: boolean, off = false) => ({
    flat,
    fade,
    ratio,
    up,
    off,
  });

  it.fails(
    'a slow lead-in, a fast creep, then a fast fade: a drop 1 s later in the room (S6-D18-1)',
    () => {
      agrees(
        trace(0.02, [
          seg(50, 700, 1.2, true),
          seg(0, 250, 1.15, true),
          seg(0, 300, 3, true),
          seg(500, 0, 3, false),
        ]),
      );
    },
  );

  it.fails('the same family at one address, with the drop 2 s later (S6-D18-1)', () => {
    agrees(
      trace(0.05, [
        seg(50, 700, 1.6, true),
        seg(0, 550, 1.5, true),
        seg(0, 300, 3, true),
        seg(1269, 0, 3, false),
      ]),
    );
  });

  it.fails('a fast rise from off, a fast fade, then a step to off 1,975 ms on (S6-P14)', () => {
    agrees(
      trace(0, [
        seg(910, 393, 1.002, false, true),
        seg(95, 583, 1.7961029733595697, true),
        seg(969, 0, 2.1, false, true),
      ]),
    );
  });

  it.fails('the same shape with the checker’s samples 3 ms out of step with the guard’s', () => {
    agreesAddress(
      [
        trace(0, [
          seg(910, 393, 1.002, false, true),
          seg(95, 583, 1.8, true),
          seg(0, 60, 1.3, true),
          seg(909, 0, 2.1, false, true),
        ]),
      ],
      3,
    );
  });
});

describe('a level and a colour fading together on gear whose colour the shadow lost (S5-P1)', () => {
  it.fails(
    'a temporary colour loaded before a rescan does not make three legs in a second',
    async () => {
      const [cfg, stream] = s5p1 as unknown as [
        { units: number[]; light: ('C1' | 'C2' | 'C5')[]; level: number[]; fade: number[] },
        Step[],
      ];
      const real = Simulator.of(
        cfg.units.map((n, i) => ({
          id: `R${String(n)}`,
          profile: da5l(cfg.light[i] ?? 'C2', 'tc', { physicalMinimum: 1 }),
          opts: { shortAddress: n },
        })),
      );
      const r = new Rig(real, 0);
      cfg.units.forEach((n, i) => {
        r.set('SET_SCENE', n, 0, 0);
        r.set('SET_SCENE', n, 0, 3);
        r.set('SET_MIN_LEVEL', n, 1);
        r.set('SET_FADE_TIME', n, cfg.fade[i] ?? 0);
        r.to('DAPC', n, cfg.level[i] ?? 0);
      });
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
      await b.ready();
      const { rec } = await play(b, stream);
      expect(rateProblems(rec, 1)).toEqual([]);
    },
  );
});
