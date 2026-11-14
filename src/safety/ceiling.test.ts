/** U-safety: lowering and raising the ceiling (SPEC R6), and panic helpers. */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { framesForAll } from '../dali/sequences.ts';
import { asSubmit, makeBench } from '../../tests/harness/bench.ts';
import { lowerCeiling, raiseCeiling } from './ceiling.ts';
import { panic, resume } from './panic.ts';
import { resetAndRestore } from './profile.ts';
import type { Bench } from '../../tests/harness/bench.ts';

const waiter = (b: Bench) => (ms: number) =>
  new Promise<void>((r) => {
    b.clock.at(b.clock.now() + ms, r);
  });

describe('the ceiling', () => {
  it('lowering takes effect at once, rewrites MAX LEVEL, pulls the level down and verifies again', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    await b.run({
      frames: framesForAll([{ id: 'DAPC', address: short(0), value: 220 }]),
      source: 'ui',
    });
    await b.clock.advance(3000);
    const r = await b.drive(
      lowerCeiling(b.governor, 180, asSubmit(b), 'script', () => b.clock.now(), waiter(b)),
    );
    expect(r.ok).toBe(true);
    expect(b.governor.ceilingArc).toBe(180);
    const g = b.sim.unit('A')?.gear;
    expect(g?.snapshot().maxLevel).toBe(180);
    expect(g?.levelAt(b.clock.now())).toBeLessThanOrEqual(180);
    expect(b.governor.addressInfo(0)?.verified).toBe(true);
    expect(b.governor.addressInfo(1)?.verified).toBe(true);
  });
  it('lowering refuses a value that is not lower', async () => {
    const b = makeBench();
    const r = await b.drive(
      lowerCeiling(b.governor, 230, asSubmit(b), 'ui', () => b.clock.now(), waiter(b)),
    );
    expect(r.ok).toBe(false);
  });
  it('raising needs a confirmed person, then rewrites MAX LEVEL', async () => {
    const b = makeBench();
    await b.ready();
    expect((await b.drive(raiseCeiling(b.governor, 240, asSubmit(b), 'script', true))).ok).toBe(
      false,
    );
    expect((await b.drive(raiseCeiling(b.governor, 240, asSubmit(b), 'ui', false))).ok).toBe(false);
    expect((await b.drive(raiseCeiling(b.governor, 200, asSubmit(b), 'ui', true))).ok).toBe(false);
    const r = await b.drive(raiseCeiling(b.governor, 240, asSubmit(b), 'ui', true));
    expect(r.ok).toBe(true);
    expect(b.sim.unit('A')?.gear.snapshot().maxLevel).toBe(240);
    expect(b.governor.addressInfo(0)?.verified).toBe(true);
  });
});

describe('panic helpers and RESET under the unlock', () => {
  it('panic latches and resume needs a person', async () => {
    const b = makeBench();
    await b.drive(panic(b.scheduler, b.governor));
    expect(b.governor.isLatched).toBe(true);
    expect(resume(b.governor, 'script').ok).toBe(false);
    expect(resume(b.governor, 'console').ok).toBe(true);
  });
  it('RESET, wait, OFF, then the profile again', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        b.clock.at(b.clock.now() + ms, r);
      });
    const r = await b.drive(resetAndRestore(0, b.governor, asSubmit(b), wait, 'console'));
    expect(r.ok).toBe(true);
    const g = b.sim.unit('A')?.gear.snapshot();
    expect([g?.maxLevel, g?.powerOnLevel, g?.systemFailureLevel]).toEqual([220, 0, 255]);
    expect(b.sim.unit('A')?.gear.levelAt(b.clock.now())).toBe(0);
    const again = await b.drive(resetAndRestore(0, b.governor, asSubmit(b), wait, 'console'));
    expect(again.ok).toBe(false);
  });
  it('RESET is refused without the unlock', async () => {
    const b = makeBench();
    await b.ready();
    const wait = () => Promise.resolve();
    const r = await b.drive(resetAndRestore(0, b.governor, asSubmit(b), wait, 'console'));
    expect(r.ok).toBe(false);
  });
});
