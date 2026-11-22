import { describe, expect, it } from 'vitest';
import { simEngine } from '../../tests/harness/engine.ts';
import { driversFrom } from './drivers.ts';
import type { DeviceView } from './engine.ts';

describe('what the planner knows about each driver', () => {
  it('comes from the scan and the light, for verified drivers that have been read', async () => {
    const b = simEngine({ extras: [{ address: 9, lightType: 'C2' }] });
    // Before the scan there is nothing to plan for.
    expect(driversFrom(b.engine.snapshot().devices, b.engine.snapshot().light)).toEqual([]);
    await b.settle();
    await b.clock.advance(3000);
    await b.drive(b.engine.request({ kind: 'apply', address: 0, arc: 150, mirek: 200 }, 'ui'));
    await b.clock.advance(3000);
    const s = b.engine.snapshot();
    const drivers = driversFrom(s.devices, s.light);
    expect(drivers.map((d) => [d.address, d.drive])).toEqual([
      [0, 'tc'],
      [1, 'rgbwaf'],
      [9, 'tc'],
    ]);
    expect(drivers[0]).toMatchObject({ arc: 150, colour: { kind: 'tc', mirek: 200 }, groups: 0 });
    expect(drivers[0]?.minArc).toBeGreaterThan(0);
    expect(drivers[0]?.auto).toBe(true);
    // Driver B has five channels: the sixth is "no change".
    expect(drivers[1]?.colour.kind).toBe('rgbwaf');
    expect(drivers[1]?.colour.kind === 'rgbwaf' && drivers[1].colour.channels[5]).toBe(255);
    expect(drivers[1]?.arc).toBe(0);
  });

  it('leaves out a driver with no facts, and gives no colour without a light to read', async () => {
    const b = simEngine();
    await b.settle();
    const s = b.engine.snapshot();
    const [first, second] = s.devices;
    if (first?.facts === undefined || second === undefined) throw new Error('no devices');
    const bare: DeviceView = {
      address: first.address,
      verified: true,
      ceiling: 'verified',
      modelled: first.modelled,
    };
    expect(driversFrom([bare, { ...second, verified: false }], s.light)).toEqual([]);
    const alone = driversFrom([first], []);
    expect(alone[0]).toMatchObject({ arc: 0, colour: { kind: 'none' } });
    // Gear that takes only a level has no colour.
    const plain = driversFrom([{ ...first, facts: { ...first.facts, drive: 'level' } }], s.light);
    expect(plain[0]?.colour).toEqual({ kind: 'none' });
  });
});
