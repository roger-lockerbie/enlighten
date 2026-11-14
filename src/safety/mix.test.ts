/** U-safety: the ceiling's measure and panic's two halves. */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { framesForAll } from '../dali/sequences.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';
import { maxArcForMix, measure, mixSum, WORST_FACTS } from './mix.ts';
import { panic, resume } from './panic.ts';

describe('the mix measure', () => {
  it('assumes Tc and all six channels when the gear has not said', () => {
    expect(WORST_FACTS).toEqual({ tc: true, channels: 6 });
    expect(mixSum(WORST_FACTS, [])).toBe(7);
    expect(measure(0.5, WORST_FACTS, [])).toBe(3.5);
  });
  it('a mix sum of one or less leaves the ceiling as it is', () => {
    for (const arc of [1, 85, 170, 220, 254]) {
      expect(maxArcForMix(arc, 1)).toBe(arc);
      expect(maxArcForMix(arc, 0.5)).toBe(arc);
      expect(maxArcForMix(arc, 0)).toBe(arc);
    }
    expect(maxArcForMix(220, 2)).toBeLessThan(220);
  });
});

describe('panic and resume', () => {
  it('panic latches the governor even before the scheduler finishes', async () => {
    const g = new Governor({ target: 'simulator', shadow: Simulator.bench() });
    let release: () => void = () => undefined;
    const done = panic({ panic: () => new Promise<void>((r) => (release = r)) }, g);
    expect(g.isLatched).toBe(true);
    const v = g.judge(
      { frames: framesForAll([{ id: 'OFF', address: short(0) }]), source: 'ui' },
      0,
    );
    expect(v.kind).toBe('refuse');
    release();
    await done;
    expect(resume(g, 'script').ok).toBe(false);
    expect(g.isLatched).toBe(true);
    expect(resume(g, 'ui').ok).toBe(true);
    expect(g.isLatched).toBe(false);
  });
});
