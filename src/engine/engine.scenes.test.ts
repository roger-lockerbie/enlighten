/**
 * U-engine for Stage 9: the drivers' scene slots (SPEC R5.2, R5.3). A look is written and read back,
 * recalled by address, group and broadcast, and removed, all through the governor.
 */
import { describe, expect, it } from 'vitest';
import { simEngine } from '../../tests/harness/engine.ts';
import { broadcast, group, short } from '../dali/address.ts';
import type { Look } from '../design/look.ts';

const warm: Look = { name: 'Warm low', arc: 120, colour: { kind: 'tc', mirek: 370 } };
const rose: Look = {
  name: 'Rose',
  arc: 100,
  colour: { kind: 'rgbwaf', channels: [200, 40, 60, 0, 0, 255] },
};
const plain: Look = { name: 'Plain', arc: 90, colour: { kind: 'none' } };

async function ready() {
  const b = simEngine();
  await b.settle();
  // Past the hold that follows the scan's profile writes.
  await b.clock.advance(3000);
  return b;
}

const device = (b: Awaited<ReturnType<typeof ready>>, n: number) =>
  b.engine.snapshot().devices.find((d) => d.address === n);

describe('scene slots', () => {
  it('writes a look, reads its level back, and shows it in the device view', async () => {
    const b = await ready();
    expect(device(b, 0)?.scenes?.every((v) => v === 255)).toBe(true);
    expect(await b.drive(b.engine.sceneWrite(0, 3, warm, 'ui'))).toEqual({ ok: true });
    expect(device(b, 0)?.scenes?.[3]).toBe(120);
    expect(await b.drive(b.engine.sceneWrite(1, 3, rose, 'ui'))).toEqual({ ok: true });
    expect(device(b, 1)?.scenes?.[3]).toBe(100);
    // Nothing lit: a store changes no light.
    expect(b.sim.unit('A')?.gear.levelAt(b.clock.now())).toBe(0);
    expect(b.engine.snapshot().jobs).toEqual([]);
  });

  it('recalls a slot by address, and the stored colour comes with the level', async () => {
    const b = await ready();
    await b.drive(b.engine.sceneWrite(0, 2, warm, 'ui'));
    await b.clock.advance(3000);
    expect(await b.drive(b.engine.sceneRecall(short(0), 2, undefined, 'ui'))).toEqual({ ok: true });
    await b.clock.advance(3000);
    const gear = b.sim.unit('A')?.gear;
    expect(gear?.levelAt(b.clock.now())).toBe(120);
    expect(Math.round(gear?.colourAt(b.clock.now()).tc ?? 0)).toBe(370);
  });

  it('leaves no temporary colour behind, so a later level keeps the colour that is showing', async () => {
    const b = await ready();
    // Show a cool white, then store a warm look without recalling it.
    expect(
      (await b.drive(b.engine.request({ kind: 'apply', address: 0, arc: 150, mirek: 200 }, 'ui')))
        .ok,
    ).toBe(true);
    await b.clock.advance(3000);
    await b.drive(b.engine.sceneWrite(0, 5, warm, 'ui'));
    await b.clock.advance(3000);
    expect(
      (await b.drive(b.engine.request({ kind: 'apply', address: 0, arc: 100 }, 'ui'))).ok,
    ).toBe(true);
    await b.clock.advance(3000);
    const gear = b.sim.unit('A')?.gear;
    expect(gear?.levelAt(b.clock.now())).toBe(100);
    expect(Math.round(gear?.colourAt(b.clock.now()).tc ?? 0)).toBe(200);
  });

  it('stores "no change" for a look with no colour, whatever temporary colour was waiting', async () => {
    const b = await ready();
    await b.drive(b.engine.request({ kind: 'apply', address: 0, arc: 150, mirek: 200 }, 'ui'));
    await b.clock.advance(3000);
    await b.drive(b.engine.sceneWrite(0, 1, plain, 'ui'));
    await b.clock.advance(3000);
    await b.drive(b.engine.sceneRecall(short(0), 1, undefined, 'ui'));
    await b.clock.advance(3000);
    const gear = b.sim.unit('A')?.gear;
    expect(gear?.levelAt(b.clock.now())).toBe(90);
    expect(Math.round(gear?.colourAt(b.clock.now()).tc ?? 0)).toBe(200);
  });

  it('recalls by broadcast and by group, with the fade set first', async () => {
    const b = await ready();
    await b.drive(b.engine.sceneWrite(0, 4, warm, 'ui'));
    await b.drive(b.engine.sceneWrite(1, 4, rose, 'ui'));
    await b.clock.advance(3000);
    const fade = { kind: 'standard', value: 4 } as const; // 2 s
    expect(await b.drive(b.engine.sceneRecall(broadcast, 4, fade, 'ui'))).toEqual({ ok: true });
    const a = b.sim.unit('A')?.gear;
    const bGear = b.sim.unit('B')?.gear;
    // Part way through the fade, neither has arrived.
    await b.clock.advance(1000);
    expect(a?.levelAt(b.clock.now())).toBeLessThan(120);
    expect(a?.levelAt(b.clock.now())).toBeGreaterThan(0);
    await b.clock.advance(3000);
    expect(a?.levelAt(b.clock.now())).toBe(120);
    expect(bGear?.levelAt(b.clock.now())).toBe(100);
    expect(device(b, 0)?.facts?.fadeTime).toBeDefined();
    // A group nobody is in changes nothing, and is allowed.
    expect(await b.drive(b.engine.sceneRecall(group(3), 4, undefined, 'ui'))).toEqual({ ok: true });
  });

  it('removes a look from a slot, and reads the slots again on request', async () => {
    const b = await ready();
    await b.drive(b.engine.sceneWrite(0, 7, warm, 'ui'));
    expect(await b.drive(b.engine.sceneRemove(0, 7, 'ui'))).toEqual({ ok: true });
    expect(device(b, 0)?.scenes?.[7]).toBe(255);
    expect(await b.drive(b.engine.sceneRead(0, 'ui'))).toEqual({ ok: true });
    expect(device(b, 0)?.scenes).toHaveLength(16);
  });

  it('refuses a look the driver cannot take, a level above the ceiling, and a write that is not a person’s', async () => {
    const b = await ready();
    expect(await b.drive(b.engine.sceneWrite(0, 0, rose, 'ui'))).toEqual({
      ok: false,
      reason: 'This look has RGBWAF channel levels, and the driver does not take them.',
    });
    expect(await b.drive(b.engine.sceneWrite(1, 0, warm, 'ui'))).toEqual({
      ok: false,
      reason: 'This look has a colour temperature, and the driver does not take one.',
    });
    expect(await b.drive(b.engine.sceneWrite(9, 0, warm, 'ui'))).toEqual({
      ok: false,
      reason: 'A9 has not been read yet. Scan first.',
    });
    const high = await b.drive(b.engine.sceneWrite(0, 0, { ...warm, arc: 250 }, 'ui'));
    expect(high.ok).toBe(false);
    expect(device(b, 0)?.scenes?.[0]).toBe(255);
    expect(await b.drive(b.engine.sceneWrite(0, 0, warm, 'script'))).toEqual({
      ok: false,
      reason: 'Only a person writes a look to a driver.',
    });
    expect(await b.drive(b.engine.sceneRemove(0, 0, 'effect'))).toEqual({
      ok: false,
      reason: 'Only a person removes a look from a driver.',
    });
  });

  it('stops at panic', async () => {
    const b = await ready();
    await b.drive(b.engine.panic());
    const r = await b.drive(b.engine.sceneRecall(short(0), 1, undefined, 'ui'));
    expect(r.ok).toBe(false);
  });
});
