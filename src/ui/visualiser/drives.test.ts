import { describe, expect, it } from 'vitest';
import type { LightView } from '../../engine/engine.ts';
import { drivesFor } from './drives.ts';

const view = (address: number, unit: string, terminals: number[]): LightView => ({
  address,
  unit,
  level: 0,
  target: 0,
  mirek: 0,
  channels: [],
  fadeTime: 0,
  extendedFade: 0,
  fastFade: 0,
  fast27Ms: 0,
  fading: false,
  terminals,
  labels: terminals.map(() => 'WW'),
});

describe('drivesFor', () => {
  it('keys each drive by short address, whatever the unit is called', () => {
    const d = drivesFor([view(1, 'B', [0.5]), view(0, 'hw0', [0.25])]);
    expect([...d.keys()].sort()).toEqual([0, 1]);
    expect(d.get(0)?.terminals).toEqual([0.25]);
    expect(d.get(1)?.terminals).toEqual([0.5]);
  });

  it('has no drive for an address with no driver', () => {
    expect(drivesFor([view(0, 'A', [1])]).get(5)).toBeUndefined();
    expect(drivesFor([]).size).toBe(0);
  });
});
