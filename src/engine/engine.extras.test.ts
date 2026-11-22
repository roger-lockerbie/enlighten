import { describe, expect, it } from 'vitest';
import { simEngine } from '../../tests/harness/engine.ts';
import { parseToWorker } from './protocol.ts';

describe('simulated drivers beyond the bench (R14.2)', () => {
  it('starts with the extras it was given, scanned and verified', async () => {
    const { engine, settle } = simEngine({ extras: [{ address: 5, lightType: 'C5' }] });
    await settle();
    const s = engine.snapshot();
    expect(s.extras).toEqual([{ address: 5, lightType: 'C5' }]);
    expect(s.devices.map((d) => d.address)).toEqual([0, 1, 5]);
    expect(s.devices.every((d) => d.verified)).toBe(true);
    expect(s.light.map((l) => l.address)).toEqual([0, 1, 5]);
  });

  it('adds, changes and takes away drivers, each time with a scan', async () => {
    const { engine, drive, settle } = simEngine();
    await settle();
    expect(
      await drive(
        engine.setExtras(
          [
            { address: 7, lightType: 'C2' },
            { address: 3, lightType: 'C5' },
          ],
          'ui',
        ),
      ),
    ).toEqual({ ok: true });
    await settle();
    expect(engine.snapshot().devices.map((d) => d.address)).toEqual([0, 1, 3, 7]);
    expect(engine.snapshot().devices.every((d) => d.verified)).toBe(true);
    // A change of light type is one driver going and one coming.
    expect((await drive(engine.setExtras([{ address: 7, lightType: 'C5' }], 'ui'))).ok).toBe(true);
    await settle();
    const s = engine.snapshot();
    expect(s.devices.map((d) => d.address)).toEqual([0, 1, 7]);
    expect(s.extras).toEqual([{ address: 7, lightType: 'C5' }]);
    expect((await drive(engine.setExtras([], 'ui'))).ok).toBe(true);
    await settle();
    expect(engine.snapshot().devices.map((d) => d.address)).toEqual([0, 1]);
  });

  it('turns a lit driver off before it takes it away', async () => {
    const { engine, sim, clock, drive, settle } = simEngine({
      extras: [{ address: 4, lightType: 'C2' }],
    });
    await settle();
    await clock.advance(3000);
    expect((await drive(engine.request({ kind: 'apply', address: 4, arc: 150 }, 'ui'))).ok).toBe(
      true,
    );
    await clock.advance(3000);
    const gear = sim.unit('X4')?.gear;
    expect(gear?.levelAt(clock.now())).toBeGreaterThan(0);
    expect((await drive(engine.setExtras([], 'ui'))).ok).toBe(true);
    // The gear that left was off when it went.
    expect(gear?.levelAt(clock.now())).toBe(0);
    expect(sim.unit('X4')).toBeUndefined();
    await settle();
  });

  it('refuses a change from anything but a person, an empty change, and a second at once', async () => {
    const { engine, drive, settle } = simEngine();
    await settle();
    expect(await drive(engine.setExtras([{ address: 2, lightType: 'C2' }], 'script'))).toEqual({
      ok: false,
      reason: 'Only a person changes the simulated drivers.',
    });
    expect(await drive(engine.setExtras([], 'ui'))).toEqual({
      ok: false,
      reason: 'Nothing to change.',
    });
    const first = engine.setExtras([{ address: 2, lightType: 'C2' }], 'ui');
    expect(await engine.setExtras([{ address: 3, lightType: 'C2' }], 'ui')).toEqual({
      ok: false,
      reason: 'The simulated bench is being rebuilt. Try again when it is done.',
    });
    expect((await drive(first)).ok).toBe(true);
    await settle();
  });

  it('checks the list in the protocol', () => {
    const call = (extras: unknown) => {
      const m = parseToWorker({ type: 'call', id: 1, call: { op: 'extras', extras } });
      return m?.type === 'call' ? m.call : undefined;
    };
    expect(call([{ address: 9, lightType: 'C2' }])).toEqual({
      op: 'extras',
      extras: [{ address: 9, lightType: 'C2' }],
    });
    expect(call([{ address: 1, lightType: 'C2' }])).toBeUndefined();
    expect(call('x')).toBeUndefined();
    expect(parseToWorker({ type: 'init', extras: [{ address: 9, lightType: 'C5' }] })).toEqual({
      type: 'init',
      extras: [{ address: 9, lightType: 'C5' }],
    });
    expect(
      parseToWorker({ type: 'init', extras: [{ address: 64, lightType: 'C5' }] }),
    ).toBeUndefined();
  });
});
