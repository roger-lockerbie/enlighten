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
    const end = sim.all[2]?.gear.breakpoints(rig.t, rig.t + 3000) ?? [];
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
});
