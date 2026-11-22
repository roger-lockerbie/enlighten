/**
 * The trace recorder samples every unit at the same times, so the room's sum adds outputs from one
 * moment (security findings S4-P4).
 */
import { describe, expect, it } from 'vitest';
import { broadcast } from '../../src/dali/address.ts';
import { da5l } from '../../src/sim/profile.ts';
import { Rig } from '../../src/sim/rig.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { rateProblems, TraceRecorder } from './checker.ts';

function bench(): { sim: Simulator; rig: Rig } {
  const sim = Simulator.of([
    { id: 'R1', profile: da5l('C5', 'tc', { physicalMinimum: 1 }), opts: { shortAddress: 1 } },
    { id: 'R2', profile: da5l('C1', 'tc', { physicalMinimum: 1 }), opts: { shortAddress: 2 } },
    { id: 'R0', profile: da5l('C2', 'tc', { physicalMinimum: 1 }), opts: { shortAddress: 0 } },
  ]);
  const rig = new Rig(sim, 0);
  rig.set('SET_FADE_TIME', 1, 4);
  rig.set('SET_FADE_TIME', 0, 1);
  rig.to('DAPC', 1, 246);
  return { sim, rig };
}

describe('TraceRecorder', () => {
  it('samples every unit at every unit’s breakpoints', () => {
    const { sim, rig } = bench();
    const rec = new TraceRecorder(sim, rig.t + 3000);
    rig.t += 3000;
    rig.to('DAPC', broadcast, 155);
    rec.record(rig.t + 3000);
    const times = [...rec.points.values()].map((ps) => ps.map((p) => p.t));
    expect(times[1]).toEqual(times[0]);
    expect(times[2]).toEqual(times[0]);
    // R0's 0.7 s fade ends between the grid's samples, and the other units are sampled there too.
    const end = sim.all[2]?.gear.planBreakpoints(rig.t, rig.t + 3000) ?? [];
    for (const b of end) expect(times[1]).toContain(b);
  });

  it('sees no room step when one fade ends while another runs', () => {
    const { sim, rig } = bench();
    const rec = new TraceRecorder(sim, rig.t + 3000);
    rig.t += 3000;
    rec.record(rig.t);
    rig.to('DAPC', broadcast, 155);
    rec.record(rig.t + 3000);
    // One step up (R2 at once) and one fall: two legs, which one swing a second allows.
    expect(rateProblems(rec, 1)).toEqual([]);
  });

  it('reads which changes are slow from the plans it kept (ADR 0016)', () => {
    // R1 fades in 2 s. A fade it runs to the end is slow inside, and its start is fast.
    const { sim, rig } = bench();
    const rec = new TraceRecorder(sim, rig.t + 3000);
    rig.t += 3000;
    rec.record(rig.t);
    rig.to('DAPC', 1, 155);
    const start = rig.t;
    rec.record(start + 3000);
    const slow = rec.slowTest('R1');
    expect(slow(start + 500, start + 510)).toBe(true);
    expect(slow(start - 50, start + 10)).toBe(false);
    // A second fade 0.3 s into the first cuts it short: the first ran under 0.7 s, so it was fast.
    rig.t = start + 3000;
    rig.to('DAPC', 1, 246);
    const second = rig.t;
    rig.t = second + 300;
    rig.to('DAPC', 1, 200);
    rec.record(rig.t + 3000);
    const after = rec.slowTest('R1');
    expect(after(second + 100, second + 110)).toBe(false);
    expect(after(rig.t + 1000, rig.t + 1010)).toBe(true);
  });

  it('dates a hard step where it happens, not where its run began', () => {
    // Y steps up at 1 s and drops 2.1 s later while X fades down slowly the whole time. The room's
    // fall from 1 s onwards is one run, and its hard step is the drop at 3.1 s: 2.1 s after the step
    // up, which the room's one hard step a second allows (Stage 6 property run).
    const rec = synthetic({
      X: (t) => 0.05 - t / 200_000,
      Y: (t) => (t < 1000 ? 0.02 : t < 3100 ? 0.4 : 0.001),
    });
    expect(rateProblems(rec, 1).filter((p) => p.rule === 'hard steps')).toEqual([]);
  });

  it('counts two hard steps in one run as two', () => {
    // A slow fall with two drops 0.8 s apart: one run, two hard steps in 2 s.
    const rec = synthetic({
      X: (t) => (t < 1000 ? 1 : t < 1800 ? 0.33 : 0.1) - t / 100_000,
    });
    expect(rateProblems(rec, 1)).toContainEqual({ scope: 'X', rule: 'hard steps', at: 975 });
  });

  it('pairs a RESET with its jump when the jump is dated just before it (S6-P9)', () => {
    // The RESET goes out at 1030 and its jump shows at the 1050 sample, so the jump is dated at the
    // 1025 sample before the RESET. Its OFF follows 350 ms on. The jump and the OFF are one hard step.
    const rec = synthetic({ Y: (t) => (t < 1040 ? 0.4 : t < 1380 ? 1 : 0) });
    rec.resets.push({ t: 1030, id: 'Y' });
    expect(rateProblems(rec, 1).filter((p) => p.rule === 'hard steps')).toEqual([]);
  });

  it('does not pair a RESET with a step that finished before it (S6-S17-2)', () => {
    // Another command took Y to full by the 1000 sample. The RESET at 1010 makes no jump, and its OFF
    // 350 ms on is a second hard step 0.4 s after the first.
    const rec = synthetic({ Y: (t) => (t < 990 ? 0.2 : t < 1360 ? 1 : 0) });
    rec.resets.push({ t: 1010, id: 'Y' });
    expect(rateProblems(rec, 1)).toContainEqual({ scope: 'Y', rule: 'hard steps', at: 975 });
  });
});

/** A recorder with made-up mono traces, sampled every 25 ms for 5 s. */
function synthetic(units: Record<string, (t: number) => number>): TraceRecorder {
  const rec = new TraceRecorder(Simulator.of([]), 0);
  for (const [id, f] of Object.entries(units)) {
    const pts = [];
    for (let t = 0; t <= 5000; t += 25) pts.push({ t, d: [f(t)] });
    rec.points.set(id, pts);
    rec.labels.set(id, ['mono']);
  }
  return rec;
}
