/**
 * Counterexamples from the Stage 6 property runs and reviews (ADR 0015 and ADR 0016), kept as fixed
 * cases. The first two ran a hard step inside a run that a slow fade, or a short pause, kept going.
 */
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../../src/bus/clock.ts';
import { withFloors } from '../../src/bus/timing.ts';
import { broadcast, group, short } from '../../src/dali/address.ts';
import { decode, encode } from '../../src/dali/codec.ts';
import { rgbwafCommands, tcCommands } from '../../src/dali/sequences.ts';
import { Engine } from '../../src/engine/engine.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { SimTransport } from '../../src/transport/sim.ts';
import { makeBench } from '../harness/bench.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import {
  agrees,
  agreesAddress,
  agreesSource,
  checkerReads,
  guardReads,
  sameReading,
  sourceOf,
  trace,
  type Source,
} from '../harness/diff.ts';
import { play, type Step } from '../harness/gen.ts';
import s5p1 from './s5-p1.counterexample.json' with { type: 'json' };
import s6p16 from './s6-p16.counterexample.json' with { type: 'json' };

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

/** A one-channel source from a function, for the cases below. */
function fn(
  at: (t: number) => number,
  bps: readonly number[],
  from: number,
  to: number,
  slow: (x: number, y: number) => boolean = () => false,
): Source {
  return { at: (t) => [at(t)], bps, slow: () => slow, from, to };
}

describe('a span on the border, then a real one (DALI review S6-D16-1)', () => {
  it('the guard finds the hard steps the checker does when a borderline rise runs into a fast one', () => {
    // A rise of 1.99 over 720 ms, which a cautious reading counts as a span and the rule does not,
    // runs straight into a rise of 3 over 300 ms, then a drop by 3 comes 1.9 to 2.2 s later. The guard
    // once let the real span join the border one and dated it 0.7 s too early.
    for (let gap = 1900; gap <= 2200; gap += 5) {
      const top = 0.199 * 3;
      const at = (t: number) =>
        t <= 0
          ? 0.1
          : t <= 720
            ? 0.1 * 1.99 ** (t / 720)
            : t <= 1020
              ? 0.199 * 3 ** ((t - 720) / 300)
              : t < gap
                ? top
                : top / 3;
      agreesSource(fn(at, [0, 720, 1020, gap], -1000, gap + 2500), 0, 1);
    }
  });
});

describe('a span found by an instant step near 2 (security review S6-S17-1)', () => {
  it('the guard counts the earlier date the rule gives when a small step came first', () => {
    // A step by 5, a nudge by 1.015 0.8 s later, and a step by 1.9803 0.6 s after that. The last step
    // alone is above 2 × 0.99, so a cautious reading dates the span just before it. The rule dates it
    // before the nudge, 0.8 s after the first step: a breach of one hard step a second for the room.
    const steps: [number, number][] = [
      [-800, 5],
      [0, 1.015],
      [600, 1.9803],
    ];
    const at = (t: number) => steps.reduce((x, [s, r]) => (t >= s ? x * r : x), 0.05);
    const problems = agreesSource(
      fn(
        at,
        steps.map(([t]) => t),
        -2000,
        3000,
      ),
      0,
      1,
    );
    expect(problems.some((p) => p.scope === 'room' && p.rule === 'hard steps')).toBe(true);
  });
});

describe('an instant step near 2 after a fast fade (security review S6-S18-1)', () => {
  it('the guard counts the date the rule gives the span', () => {
    // A step by 5 at T0, a slow lead-in, a fast fade by 1.2 that ends at 975, and a step by 1.99 at
    // 1000. The rule dates the span at its 950 sample, less than 2 s after T0.
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
      const problems = agreesSource(fn(at, [t0, 0, 875, 975, 1000], -2000, 3000, slow), 0, 1);
      expect(
        problems.filter((p) => p.scope === 'X' && p.rule === 'hard steps').length,
        `T0 ${String(t0)}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('a hard step after a nudge and the merge of an address’s traces (DALI review S6-D17-1)', () => {
  it('the drop 2 s after the span is judged against the span’s own date', () => {
    // A slow lead-in, a nudge by 1.01, then 50 ms on a fast fade by 10 and a drop about 2 s after
    // that. An early date at the nudge once absorbed the span's own date in the address's merge.
    for (let gap = 1980; gap <= 2000; gap += 1) {
      const end = 1050 + gap;
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
      agreesSource(fn(at, [200, 1000, 1000.001, 1050, 1150, end], 0, end + 3000, slow), 0, 1);
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
 * Stage 8b: the cases still open when the rate guard got a stage of its own. Each failed before
 * ADR 0019 was built: the guard sampled every 10 ms and the checker every 25 ms, and they dated one
 * hard step differently. Both now read one grid.
 */
describe('one hard step dated differently by where the samples fall (Stage 8b)', () => {
  const seg = (flat: number, fade: number, ratio: number, up: boolean, off = false) => ({
    flat,
    fade,
    ratio,
    up,
    off,
  });

  it('a slow lead-in, a fast creep, then a fast fade: a drop 1 s later in the room (S6-D18-1)', () => {
    agrees(
      trace(0.02, [
        seg(50, 700, 1.2, true),
        seg(0, 250, 1.15, true),
        seg(0, 300, 3, true),
        seg(500, 0, 3, false),
      ]),
    );
  });

  it('the same family at one address, with the drop 2 s later (S6-D18-1)', () => {
    agrees(
      trace(0.05, [
        seg(50, 700, 1.6, true),
        seg(0, 550, 1.5, true),
        seg(0, 300, 3, true),
        seg(1269, 0, 3, false),
      ]),
    );
  });

  it('a fast rise from off, a fast fade, then a step to off 1,975 ms on (S6-P14)', () => {
    agrees(
      trace(0, [
        seg(910, 393, 1.002, false, true),
        seg(95, 583, 1.7961029733595697, true),
        seg(969, 0, 2.1, false, true),
      ]),
    );
  });

  it('the same shape with the checker’s grid 3 ms out of step with the clock’s', () => {
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

interface RealBench {
  units: number[];
  light: ('C1' | 'C2' | 'C5')[];
  groups: number[];
  min: number[];
  phys: number[];
  level: number[];
  fade: number[];
}

/** Play a saved counterexample of the never-seen hardware property, as that property sets it up. */
async function playUnseen(saved: unknown): Promise<TraceRecorder> {
  const [cfg, stream] = saved as [RealBench, Step[]];
  const real = Simulator.of(
    cfg.units.map((n, i) => ({
      id: `R${String(n)}`,
      profile: da5l(cfg.light[i] ?? 'C2', 'tc', { physicalMinimum: cfg.phys[i] ?? 85 }),
      opts: { shortAddress: n },
    })),
  );
  const r = new Rig(real, 0);
  cfg.units.forEach((n, i) => {
    for (let g = 0; g < 4; g++) if (((cfg.groups[i] ?? 0) >> g) & 1) r.to('ADD_TO_GROUP', n, g);
    r.set('SET_SCENE', n, 0, 0);
    r.set('SET_SCENE', n, 0, 3);
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
  await b.ready();
  const { rec } = await play(b, [...extra, ...stream]);
  return rec;
}

describe('a level and a colour fading together on gear whose colour the shadow lost (S5-P1)', () => {
  it('a temporary colour loaded before a rescan does not make three legs in a second', async () => {
    expect(rateProblems(await playUnseen(s5p1), 1)).toEqual([]);
  });
});

describe('gear seen fading in its scan, switched off at the end of a slow fade (S6-P16)', () => {
  it('the switch off at the fade’s end and a level sent 1.4 s later are not two hard steps', async () => {
    // The guard counted the fade to off as a hard step when it was sent. The light made it 2.8 s
    // later, when the fade ended and the gear switched off.
    expect(rateProblems(await playUnseen(s6p16), 1)).toEqual([]);
  });
});

describe('a scene recall that fades a level and a colour together (S8b-1)', () => {
  it('goes only with no fade time, so the guard counts every swing it makes', async () => {
    // The scan reads a scene's level and not its colour. Recalled with a fade of 1 s, the level fell
    // while red faded to blue: three legs at one address in a second, and the guard counted one.
    for (const fade of [0, 2]) {
      const real = Simulator.of([
        {
          id: 'R1',
          profile: da5l('C5', 'rgbwaf', { physicalMinimum: 1 }),
          opts: { shortAddress: 1 },
        },
      ]);
      const r = new Rig(real, 0);
      r.run(rgbwafCommands(short(1), [0, 0, 254, 0, 0, 0], false));
      r.set('SET_SCENE', 1, 120, 3);
      r.set('SET_FADE_TIME', 1, fade);
      r.to('OFF', 1);
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 3000 });
      await b.ready();
      const a = { kind: 'short', n: 1 };
      const tx = (dt: number, cmds: unknown[]) =>
        ({ kind: 'tx', dt, source: 'ui', cmds }) as unknown as Step;
      const { rec } = await play(b, [
        tx(3000, rgbwafCommands(short(1), [254, 0, 0, 0, 0, 0])),
        tx(4000, [{ id: 'DAPC', address: a, value: 254 }]),
        tx(6000, [{ id: 'GO_TO_SCENE', address: a, value: 3 }]),
        tx(8000, []),
      ]);
      expect(rateProblems(rec, 1), `fade time ${String(fade)}`).toEqual([]);
      const level = real.unit('R1')?.gear.levelAt(b.clock.now());
      // With no fade the recall went. With one it was refused, and the level stayed.
      if (fade === 0) expect(level).toBe(120);
      else expect(level).not.toBe(120);
    }
  });
});

describe('ways round the colour rule the second review found (S8b-R2)', () => {
  const A1 = short(1);
  const a = { kind: 'short', n: 1 };
  const tx = (dt: number, cmds: unknown[]) =>
    ({ kind: 'tx', dt, source: 'console', cmds }) as unknown as Step;
  const gear = (kind: 'rgbwaf' | 'tc', more: object = {}) =>
    Simulator.of([
      {
        id: 'R1',
        profile: da5l(kind === 'tc' ? 'C2' : 'C5', kind, { physicalMinimum: 1, ...more }),
        opts: { shortAddress: 1 },
      },
    ]);

  it('COPY REPORT TO TEMPORARY before ACTIVATE leaves the colour unknown (S8b-R2-H1)', async () => {
    // Blue gear at 220 with a 1 s fade. White is loaded, the report is copied over it and
    // activated: the gear stays blue. White with a level then made three legs in half a second.
    const real = gear('rgbwaf');
    const r = new Rig(real, 0);
    r.run(rgbwafCommands(A1, [0, 0, 254, 0, 0, 0]));
    r.set('SET_FADE_TIME', 1, 2);
    r.to('DAPC', 1, 220);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 3000, ceilingArc: 254 });
    await b.ready();
    const white = rgbwafCommands(A1, [254, 254, 254, 0, 0, 0], false);
    const act = { id: 'DT8_ACTIVATE', address: a };
    const { rec } = await play(b, [
      tx(3000, [...white, { id: 'DT8_COPY_REPORT_TO_TEMPORARY', address: a }, act]),
      tx(3000, [...white, act, { id: 'DAPC', address: a, value: 60 }]),
      tx(3000, []),
    ]);
    expect(b.governor.addressInfo(1)?.colourKnown).not.toBe(true);
    expect(rateProblems(rec, 1)).toEqual([]);
    expect(real.unit('R1')?.gear.levelAt(b.clock.now())).toBe(220);
  });

  it('gear that did not answer a rescan takes no level (S8b-R2-H2)', async () => {
    // Red gear at 254. Another controller leaves blue pending, and a rescan loses the gear's
    // answer. DAPC 100 then faded the level and brought blue in: three legs in a third of a second.
    const real = gear('rgbwaf');
    const r = new Rig(real, 0);
    r.run(rgbwafCommands(A1, [254, 0, 0, 0, 0, 0]));
    r.set('SET_FADE_TIME', 1, 1);
    r.to('DAPC', 1, 254);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 3000, ceilingArc: 254 });
    await b.ready();
    const other = new Rig(real, b.clock.now());
    other.run(rgbwafCommands(A1, [0, 0, 254, 0, 0, 0], false));
    await b.clock.advance(Math.ceil(other.t - b.clock.now()) + 10);
    b.governor.beginScan(1);
    b.governor.observe(
      {
        frame: {
          frame: encode({ id: 'QUERY_CONTROL_GEAR_PRESENT', address: A1 }).frame,
          sendTwice: false,
          expectReply: true,
        },
        at: b.clock.now(),
        source: 'internal',
      },
      { kind: 'no-reply' },
    );
    const { rec } = await play(b, [
      tx(3000, [{ id: 'DAPC', address: a, value: 100 }]),
      tx(3000, []),
    ]);
    expect(rateProblems(rec, 1)).toEqual([]);
    expect(real.unit('R1')?.gear.levelAt(b.clock.now())).toBe(254);
  });

  it('a colour set twice in half a second is two hard steps, whatever the shadow had (S8b-R2-D1)', async () => {
    // Real red 60 at 220. Red 130 and then red 50, 444 ms apart, were both allowed: the shadow came
    // from 254 and read one fall. Red 180, 110 and 160 made three legs in 0.6 s.
    for (const [start, reds] of [
      [60, [130, 50]],
      [100, [180, 110, 160]],
    ] as const) {
      const real = Simulator.of([
        { id: 'R0', profile: da5l('C5', 'rgbwaf', {}), opts: { shortAddress: 0 } },
      ]);
      const r = new Rig(real, 0);
      r.run(rgbwafCommands(short(0), [start, 0, 0, 0, 0, 0]));
      r.to('DAPC', 0, 220);
      r.wait(5000);
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
      await b.ready();
      const a0 = { kind: 'short', n: 0 };
      const red = (v: number) => [
        { id: 'DTR0', value: v },
        { id: 'DT8_SET_TEMPORARY_RGB', address: a0 },
        { id: 'DT8_ACTIVATE', address: a0 },
      ];
      const { rec } = await play(b, [
        tx(4000, rgbwafCommands(short(0), [reds[0], 0, 0, 0, 0, 0])),
        ...reds.slice(1).map((v, k) => tx(k === 0 ? 444 : 144, red(v))),
        tx(4000, []),
      ]);
      expect(rateProblems(rec, 1), String(start)).toEqual([]);
      // Only the first colour went.
      expect(real.unit('R0')?.gear.colourAt(b.clock.now()).ch[0]).toBe(reds[0]);
    }
  });

  it('a level that becomes known does not make the time before it known (S8b-R2-D1)', async () => {
    // GO TO LAST ACTIVE LEVEL, then DAPC 180 and DAPC 130 a third of a second apart: the shadow
    // read one fall from a level the gear never had, and the light rose and fell.
    for (const gap of [300, 350, 400]) {
      const real = Simulator.of([
        { id: 'R0', profile: da5l('C1', 'tc', {}), opts: { shortAddress: 0 } },
      ]);
      const r = new Rig(real, 0);
      r.to('DAPC', 0, 150);
      r.to('OFF', 0);
      r.wait(5000);
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
      await b.ready();
      const a0 = { kind: 'short', n: 0 };
      const { rec } = await play(b, [
        tx(3000, [{ id: 'DT8_ACTIVATE', address: a0 }]),
        tx(3000, [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a0 }]),
        tx(3000, [{ id: 'DAPC', address: a0, value: 180 }]),
        tx(gap, [{ id: 'DAPC', address: a0, value: 130 }]),
        tx(0, [{ id: 'DAPC', address: a0, value: 170 }]),
        tx(4000, []),
      ]);
      expect(rateProblems(rec, 1), String(gap)).toEqual([]);
    }
  });

  it('C5 gear presented as Tc: a colour temperature does not make its RGB known (S8b-R2-D2)', async () => {
    // Real RGB 60 beside the colour temperature. Tc 300, DAPC 220 and then RGB 130 were all
    // allowed: the shadow had RGB at 254 and read 254 to 130 as no hard step.
    for (const [u, c1, lvl] of [
      [60, 130, 220],
      [50, 120, 220],
    ] as const) {
      const real = Simulator.of([
        { id: 'R0', profile: da5l('C5', 'tc', {}), opts: { shortAddress: 0 } },
      ]);
      const r = new Rig(real, 0);
      r.run(rgbwafCommands(short(0), [u, u, u, 255, 255, 255]));
      r.to('DAPC', 0, 100);
      r.wait(5000);
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
      await b.ready();
      const a0 = { kind: 'short', n: 0 };
      const { rec } = await play(b, [
        tx(3000, tcCommands(short(0), 300)),
        tx(3000, [{ id: 'DAPC', address: a0, value: lvl }]),
        tx(600, [
          { id: 'DTR0', value: c1 },
          { id: 'DTR1', value: c1 },
          { id: 'DTR2', value: c1 },
          { id: 'DT8_SET_TEMPORARY_RGB', address: a0 },
          { id: 'DT8_ACTIVATE', address: a0 },
        ]),
        tx(4000, []),
      ]);
      expect(rateProblems(rec, 1), String(u)).toEqual([]);
    }
  });

  it('a colour temperature the shadow would clamp does not go with a level (S8b-R2-M1)', async () => {
    // Gear with limits of 50 to 1000 mirek, which the scan does not read. The shadow has 154 to
    // 370, so 100 mirek with a level moved the gear's colour where the shadow's stood still. A
    // colour and a level no longer go together at all (ADR 0019 amendment 1).
    const real = gear('tc', {
      tcLimits: { coolest: 50, warmest: 1000, physicalCoolest: 50, physicalWarmest: 1000 },
    });
    const r = new Rig(real, 0);
    r.set('SET_FADE_TIME', 1, 1);
    r.run(tcCommands(A1, 370));
    r.to('DAPC', 1, 120);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 5000, ceilingArc: 254 });
    await b.ready();
    const { rec } = await play(b, [
      tx(3000, tcCommands(A1, 370)),
      tx(4000, [...tcCommands(A1, 100), { id: 'DAPC', address: a, value: 220 }]),
      tx(4000, []),
    ]);
    expect(rateProblems(rec, 1)).toEqual([]);
    expect(real.unit('R1')?.gear.levelAt(b.clock.now())).toBe(120);
  });
});

describe('the shadow standing in for hardware it cannot read (S8b-R3, ADR 0019 amendment 2)', () => {
  const a0 = { kind: 'short', n: 0 };
  const a1 = { kind: 'short', n: 1 };
  const tx = (dt: number, cmds: unknown[]) =>
    ({ kind: 'tx', dt, source: 'console', cmds }) as unknown as Step;
  /** One driver at A0, set up by hand before the app connects, then the steps. No rate problem may show. */
  const one = async (
    kind: 'C1' | 'C2' | 'C3',
    pres: 'tc' | 'rgbwaf',
    more: object,
    prep: (r: Rig) => void,
    stepsToPlay: Step[],
    ceilingArc = 220,
  ) => {
    const real = Simulator.of([
      { id: 'R0', profile: da5l(kind, pres, more), opts: { shortAddress: 0 } },
    ]);
    const r = new Rig(real, 0);
    prep(r);
    r.wait(5000);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100, ceilingArc });
    await b.ready();
    const { rec } = await play(b, [...stepsToPlay, tx(4000, [])]);
    expect(rateProblems(rec, 1)).toEqual([]);
  };

  it('a colour fade at a steady level turns more than once, so a colour goes only with no fade (S8b-R3-1)', async () => {
    // Green at 220 with fade time 2, sent red with some blue: three legs in 914 ms.
    await one(
      'C3',
      'rgbwaf',
      {},
      (r) => {
        r.run(rgbwafCommands(short(0), [0, 254, 0, 0, 0, 0]));
        r.set('SET_FADE_TIME', 0, 2);
        r.to('DAPC', 0, 220);
      },
      [tx(4000, rgbwafCommands(short(0), [254, 0, 71, 0, 0, 0]))],
    );
    // Tc 154 mirek at 254 with fade time 1, sent 370: hard steps 600 ms apart.
    await one(
      'C2',
      'tc',
      {},
      (r) => {
        r.run(tcCommands(short(0), 154));
        r.set('SET_FADE_TIME', 0, 1);
        r.to('DAPC', 0, 254);
      },
      [tx(4000, tcCommands(short(0), 370))],
      254,
    );
    // The profile's other settings for the Tc mix and the channel law, with an extended fade.
    await one(
      'C2',
      'tc',
      { tcMix: 'both-high-middle' },
      (r) => {
        r.run(tcCommands(short(0), 154));
        r.set('SET_EXTENDED_FADE_TIME', 0, 0x14);
        r.to('DAPC', 0, 220);
      },
      [tx(4000, tcCommands(short(0), 370))],
    );
    await one(
      'C3',
      'rgbwaf',
      { channelLaw: 'curve' },
      (r) => {
        r.run(rgbwafCommands(short(0), [254, 0, 0, 0, 0, 0]));
        r.set('SET_EXTENDED_FADE_TIME', 0, 0x14);
        r.to('DAPC', 0, 220);
      },
      [tx(4000, rgbwafCommands(short(0), [0, 254, 0, 0, 0, 0]))],
    );
  });

  it('a rescan does not forget what was sent before it (S8b-R3-2)', async () => {
    // DAPC 220, a rescan, then OFF or a low level 1.6 s after the DAPC.
    for (const second of [
      { id: 'OFF', address: a0 },
      { id: 'DAPC', address: a0, value: 86 },
    ])
      await one('C1', 'tc', {}, (r) => r.to('OFF', 0), [
        tx(4000, [{ id: 'DAPC', address: a0, value: 220 }]),
        { kind: 'rescan', dt: 0 },
        tx(0, [second]),
      ]);
  });

  it('a level read back does not make the time before it known (S8b-R3-3)', async () => {
    // GO TO LAST ACTIVE LEVEL, QUERY ACTUAL LEVEL, then OFF: on and off 78 ms apart.
    for (const last of [1, 100, 150])
      for (const next of [
        { id: 'OFF', address: a0 },
        { id: 'DAPC', address: a0, value: 86 },
      ])
        await one(
          'C1',
          'tc',
          {},
          (r) => {
            r.to('DAPC', 0, last);
            r.to('OFF', 0);
          },
          [
            tx(0, [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a0 }]),
            tx(0, [{ id: 'QUERY_ACTUAL_LEVEL', address: a0 }]),
            tx(0, [next]),
          ],
        );
  });

  it('a scene recall leaves a colour waiting when ACTIVATE keeps the temporary colour (S8b-R3-4)', async () => {
    // Red with ACTIVATE, a scene of blue with no fade, a fade time, then a level: the kept red came
    // back in the level's fade, three legs in 911 ms.
    await one(
      'C3',
      'rgbwaf',
      { temporaryClearedAfterActivate: false },
      (r) => {
        r.run(rgbwafCommands(short(0), [0, 0, 254, 0, 0, 0]));
        r.to('DAPC', 0, 120);
        r.set('SET_SCENE', 0, 120, 3);
        r.run(rgbwafCommands(short(0), [0, 254, 0, 0, 0, 0]));
      },
      [
        tx(3000, rgbwafCommands(short(0), [254, 0, 0, 0, 0, 0])),
        tx(3000, [{ id: 'GO_TO_SCENE', address: a0, value: 3 }]),
        tx(3000, [
          { id: 'DTR0', value: 2 },
          { id: 'SET_FADE_TIME', address: a0 },
        ]),
        tx(3000, [{ id: 'DAPC', address: a0, value: 200 }]),
      ],
    );
  });

  it('small steps up and down are each a swing, however old the run before them (S8b-R3-5)', async () => {
    for (const gap of [200, 250, 300]) {
      const s = (id: string) => tx(gap, [{ id, address: a0 }]);
      await one(
        'C1',
        'tc',
        {},
        (r) => {
          r.to('DAPC', 0, 160);
          r.to('OFF', 0);
        },
        [
          tx(3000, [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a0 }]),
          tx(3000, [{ id: 'DAPC', address: a0, value: 190 }]),
          tx(3000, [{ id: 'STEP_DOWN', address: a0 }]),
          s('STEP_UP'),
          s('STEP_DOWN'),
          s('STEP_UP'),
          s('STEP_DOWN'),
        ],
      );
    }
  });

  it('gear moved onto another address takes no level until a rescan (S8b-R3-7)', async () => {
    // Two C5 drivers. A1 is red with a fade and has blue waiting. Moved onto A0, which had its
    // ACTIVATE, a DAPC brought the blue in with the level.
    for (const [lvl, x, fade] of [
      [220, 60, 2],
      [220, 120, 3],
    ] as const) {
      const real = Simulator.of([
        { id: 'R0', profile: da5l('C5', 'rgbwaf', {}), opts: { shortAddress: 0 } },
        { id: 'R1', profile: da5l('C5', 'rgbwaf', {}), opts: { shortAddress: 1 } },
      ]);
      const r = new Rig(real, 0);
      r.run(rgbwafCommands(short(1), [254, 0, 0, 0, 0, 0]));
      r.set('SET_FADE_TIME', 1, fade);
      r.to('DAPC', 1, lvl);
      r.wait(5000);
      const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100, ceilingArc: 254 });
      await b.ready();
      await play(b, [
        tx(3000, [{ id: 'DT8_ACTIVATE', address: a0 }]),
        tx(3000, rgbwafCommands(short(1), [0, 0, 254, 0, 0, 0], false)),
      ]);
      expect(b.governor.unlock('reset', 'console', true).ok).toBe(true);
      const { rec } = await play(b, [
        tx(3000, [
          { id: 'DTR0', value: 1 },
          { id: 'SET_SHORT_ADDRESS', address: a1 },
        ]),
        tx(3000, [{ id: 'DAPC', address: a0, value: x }]),
        tx(4000, []),
      ]);
      expect(rateProblems(rec, 1), String(fade)).toEqual([]);
    }
  });
});

describe('what the gear did not take, or did not answer (S8b-R4, ADR 0019 amendment 2)', () => {
  const a0 = { kind: 'short', n: 0 };
  const tx = (dt: number, cmds: unknown[]) =>
    ({ kind: 'tx', dt, source: 'console', cmds }) as unknown as Step;
  type Send = Simulator['send'];
  /** The gear ignores the second copy of these commands, so a setting sent twice is not stored. */
  const ignores = (real: Simulator, id: string) => {
    const send = real.send.bind(real);
    const lossy: Send = (f, at, gap) =>
      f.sendTwice && decode(f.frame)?.id === id
        ? send({ ...f, sendTwice: false }, at, gap)
        : send(f, at, gap);
    real.send = lossy;
  };
  /** The next reply to QUERY CONTROL GEAR PRESENT is lost on the wire. */
  const losesOnePresenceReply = (real: Simulator) => {
    const send = real.send.bind(real);
    let lost = false;
    const lossy: Send = (f, at, gap) => {
      const reply = send(f, at, gap);
      if (lost || decode(f.frame)?.id !== 'QUERY_CONTROL_GEAR_PRESENT') return reply;
      lost = true;
      return { kind: 'none' };
    };
    real.send = lossy;
  };
  const bench = async (
    kind: 'C1' | 'C2' | 'C3',
    prep: (r: Rig) => void,
    ceilingArc = 220,
  ): Promise<{ real: Simulator; b: ReturnType<typeof makeBench> }> => {
    const real = Simulator.of([
      {
        id: 'R0',
        profile: da5l(kind, kind === 'C3' ? 'rgbwaf' : 'tc', {}),
        opts: { shortAddress: 0 },
      },
    ]);
    const r = new Rig(real, 0);
    prep(r);
    r.wait(30_000);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100, ceilingArc });
    await b.ready();
    return { real, b };
  };
  const noFade = [
    { id: 'DTR0', value: 0 },
    { id: 'SET_FADE_TIME', address: a0 },
  ];

  it('a fade time the gear did not take is not taken as set: a level (S8b-R4-1)', async () => {
    // Fade time 6 (4 s). SET FADE TIME 0 is sent and ignored. DAPC 0 then switched off 4 s later,
    // and DAPC 200 went 100 ms after that: off then on.
    for (const after of [100, 300]) {
      const { real, b } = await bench('C1', (r) => {
        r.set('SET_FADE_TIME', 0, 6);
        r.to('DAPC', 0, 200);
      });
      ignores(real, 'SET_FADE_TIME');
      const { rec } = await play(b, [
        tx(20_000, noFade),
        tx(4000, [{ id: 'DAPC', address: a0, value: 0 }]),
        tx(4000 + after - 20, [{ id: 'DAPC', address: a0, value: 200 }]),
        tx(6000, []),
      ]);
      expect(rateProblems(rec, 1), String(after)).toEqual([]);
    }
  });

  it('a fade time the gear did not take is not taken as set: a colour (S8b-R4-1)', async () => {
    const tc = await bench(
      'C2',
      (r) => {
        r.run(tcCommands(short(0), 154));
        r.set('SET_FADE_TIME', 0, 1);
        r.to('DAPC', 0, 254);
      },
      254,
    );
    ignores(tc.real, 'SET_FADE_TIME');
    const first = await play(tc.b, [
      tx(20_000, noFade),
      tx(4000, tcCommands(short(0), 370)),
      tx(6000, []),
    ]);
    expect(rateProblems(first.rec, 1)).toEqual([]);
    const rgb = await bench('C3', (r) => {
      r.run(rgbwafCommands(short(0), [0, 254, 0, 0, 0, 0]));
      r.set('SET_FADE_TIME', 0, 2);
      r.to('DAPC', 0, 220);
    });
    ignores(rgb.real, 'SET_FADE_TIME');
    const second = await play(rgb.b, [
      tx(20_000, noFade),
      tx(4000, rgbwafCommands(short(0), [254, 0, 71, 0, 0, 0])),
      tx(6000, []),
    ]);
    expect(rateProblems(second.rec, 1)).toEqual([]);
  });

  it('a fade time read back as 0 lets a colour go', async () => {
    const { real, b } = await bench(
      'C2',
      (r) => {
        r.run(tcCommands(short(0), 154));
        r.set('SET_FADE_TIME', 0, 1);
        r.to('DAPC', 0, 200);
      },
      254,
    );
    const { rec } = await play(b, [
      tx(20_000, [
        ...noFade,
        { id: 'QUERY_FADE_TIME_FADE_RATE', address: a0 },
        { id: 'QUERY_EXTENDED_FADE_TIME', address: a0 },
      ]),
      tx(4000, tcCommands(short(0), 370)),
      tx(6000, []),
    ]);
    expect(rateProblems(rec, 1)).toEqual([]);
    expect(real.unit('R0')?.gear.colourAt(b.clock.now()).tc).toBe(370);
  });

  it('one lost presence reply does not take gear out of the rules (S8b-R4-2)', async () => {
    const tc = await bench(
      'C2',
      (r) => {
        r.run(tcCommands(short(0), 154));
        r.set('SET_FADE_TIME', 0, 1);
        r.to('DAPC', 0, 254);
      },
      254,
    );
    losesOnePresenceReply(tc.real);
    const first = await play(tc.b, [
      tx(4000, [{ id: 'QUERY_CONTROL_GEAR_PRESENT', address: a0 }]),
      tx(100, tcCommands(short(0), 370)),
      tx(6000, []),
    ]);
    expect(tc.b.governor.addressInfo(0)?.present).toBe(false);
    expect(rateProblems(first.rec, 1)).toEqual([]);
    // Ranges keep their length: a fade to off, then a level just after the gear switched off.
    const dt6 = await bench('C1', (r) => {
      r.set('SET_FADE_TIME', 0, 6);
      r.to('DAPC', 0, 200);
    });
    losesOnePresenceReply(dt6.real);
    const second = await play(dt6.b, [
      tx(20_000, [{ id: 'QUERY_CONTROL_GEAR_PRESENT', address: a0 }]),
      tx(100, [{ id: 'DAPC', address: a0, value: 0 }]),
      tx(4100, [{ id: 'DAPC', address: a0, value: 200 }]),
      tx(6000, []),
    ]);
    expect(rateProblems(second.rec, 1)).toEqual([]);
  });
});

describe('the refusals ADR 0016 listed, with a hard step counted once (ADR 0019)', () => {
  const seg = (flat: number, fade: number, ratio: number) => ({
    flat,
    fade,
    ratio,
    up: true,
    off: false,
  });
  /** How many hard steps the rule and the guard count at the address for a trace from 5%. */
  const counts = (segs: ReturnType<typeof seg>[]) => {
    const src = sourceOf([trace(0.05, segs)]);
    return {
      rule: checkerReads(src).events.get('X')?.hard.length ?? 0,
      guard: guardReads(src).address.hard.length,
    };
  };

  it('a small fast change, then a fast fade that passes 2 within 0.64 s, is one hard step (S6-P10)', () => {
    for (let gap = 0; gap <= 640; gap += 20)
      for (const fade of [100, 300, 500, 650]) {
        expect(counts([seg(1000, 0, 1.03), seg(gap, fade, 2.5)]), `gap ${String(gap)}`).toEqual({
          rule: 1,
          guard: 1,
        });
        expect(counts([seg(1000, 200, 1.05), seg(gap, fade, 2.2)]).guard).toBe(1);
      }
  });

  it('an instant step of 1.98 to 2.02 after a small fast change is one hard step at most (S6-S17-1)', () => {
    for (let gap = 0; gap <= 740; gap += 20)
      for (const r of [1.981, 1.99, 2.0, 2.01, 2.02])
        expect(counts([seg(1000, 0, 1.015), seg(gap, 0, r)]).guard, `gap ${String(gap)}`).toBe(1);
  });

  it('a leg of 690 to 710 ms whose fast movement began before its span is one hard step (S6-P8)', () => {
    for (let total = 690; total <= 710; total += 1)
      for (const lead of [50, 100, 200])
        expect(
          counts([seg(1000, 0, 1.02), seg(lead, total - lead, 3)]).guard,
          `${String(total)} ms`,
        ).toBe(1);
  });

  it('a movement 0.66 to 0.7 s after the last span still counts on its own (S6-P12): this one stays', () => {
    // The rule joins a movement that starts within 0.7 s of the last span. A cautious reading joins
    // it only with the time margin to spare, since a frame a little late would put it past 0.7 s.
    const after = (ms: number) => counts([seg(1000, 0, 3.6), seg(ms, 120, 2.5)]);
    expect(after(600)).toEqual({ rule: 1, guard: 1 });
    expect(after(680)).toEqual({ rule: 1, guard: 2 });
    expect(after(720)).toEqual({ rule: 2, guard: 2 });
  });
});

describe('corners mutation testing found unpinned (Stage 8b)', () => {
  it('a step just under 2 long after a hard step is not folded into it', () => {
    // Off the floor by 3 at 100, a step by 1.99 at 600 and one by 2.5 at 620, then a small one at
    // 1000 so the run lasts over 0.7 s. The step by 2.5 is its own hard step. Folding the 1.99 into
    // the first, 0.5 s after it, would join the 2.5 to it too.
    const v = [0.05, 0.15, 0.15 * 1.99, 0.15 * 1.99 * 2.5, 0.15 * 1.99 * 2.5 * 1.2] as const;
    const src = sourceOf([
      [
        [0, v[0]],
        [100, v[0]],
        [100.001, v[1]],
        [600, v[1]],
        [600.001, v[2]],
        [620, v[2]],
        [620.001, v[3]],
        [1000, v[3]],
        [1000.001, v[4]],
        [3000, v[4]],
        [3000, v[4]],
      ],
    ]);
    expect(guardReads(src, (i) => i === 0).address.hard.map((r) => r.lo)).toEqual([100, 620]);
    sameReading(src);
  });
  it('each shifted reading finds a hard step on the border that the clock’s grid does not', () => {
    // Two fast fades whose change within 0.7 s is between 1.98 and 2. Only a reading whose grid has
    // a sample early enough in the window sees it above the margin.
    const by17 = sourceOf([
      [
        [0, 0.05],
        [109, 0.05],
        [619, 0.091],
        [849, 0.091],
        [1149, 0.14833],
        [4319, 0.14833],
        [4319, 0.14833],
      ],
    ]);
    const by8 = sourceOf([
      [
        [0, 0.05],
        [101, 0.05],
        [391, 0.091],
        [751, 0.091],
        [961, 0.11284],
        [4061, 0.11284],
        [4061, 0.11284],
      ],
    ]);
    const count = (src: Source, only: (i: number) => boolean) =>
      guardReads(src, only).address.hard.length;
    expect(count(by17, (i) => i !== 3)).toBe(0);
    expect(count(by17, () => true)).toBe(1);
    expect(count(by8, (i) => i !== 2)).toBe(0);
    expect(count(by8, () => true)).toBe(1);
  });
});
