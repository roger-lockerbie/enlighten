/** U-safety: each rule of the rate guard (SPEC S3) through the governor, on the simulated bench. */
import { beforeEach, describe, expect, it } from 'vitest';
import { short } from '../../dali/address.ts';
import type { Command } from '../../dali/codec.ts';
import { framesForAll, rgbwafCommands } from '../../dali/sequences.ts';
import { makeBench, type Bench } from '../../../tests/harness/bench.ts';
import type { Transaction, Verdict } from '../types.ts';
import { scopeViolations, swingLimit, withExtra } from './guard.ts';

const A = short(0);
const B = short(1);
const tx = (cmds: readonly Command[]): Transaction => ({
  frames: framesForAll(cmds),
  source: 'ui',
});
const dapc = (a: typeof A, v: number): Command => ({ id: 'DAPC', address: a, value: v });
const reason = (v: Verdict) => (v.kind === 'refuse' ? v.reason : '');

let b: Bench;

/** Send at a time, after moving the clock there. */
async function at(t: number, cmds: readonly Command[]) {
  await b.clock.advanceTo(t);
  return b.run(tx(cmds));
}

beforeEach(async () => {
  b = makeBench();
  await b.ready();
  await b.clock.advance(5000);
  // Start from a known level with no fade.
  await b.run(tx([dapc(A, 150)]));
  await b.clock.advance(5000);
});

describe('rate guard', () => {
  it('hard steps: at most one in 2 s per address, then allowed at retryAt', async () => {
    const t0 = b.clock.now();
    expect((await at(t0, [{ id: 'OFF', address: A }])).kind).toBe('done');
    const v = b.governor.judge(tx([dapc(A, 200)]), b.clock.now() + 50);
    expect(reason(v)).toMatch(/hard step/);
    if (v.kind !== 'refuse' || v.retryAt === undefined) throw new Error('no retryAt');
    expect(v.retryAt).toBeGreaterThan(t0 + 1900);
    expect(b.governor.judge(tx([dapc(A, 200)]), v.retryAt).kind).not.toBe('refuse');
  });
  it('a fade of 0.7 s or more makes a large change ordinary', async () => {
    await b.run(
      tx([
        { id: 'DTR0', value: 1 },
        { id: 'SET_FADE_TIME', address: A },
      ]),
    );
    const t0 = b.clock.now() + 1000;
    expect((await at(t0, [dapc(A, 100)])).kind).toBe('done');
    expect((await at(t0 + 1500, [dapc(A, 200)])).kind).toBe('done');
  });
  it('legs: one swing a second by default', async () => {
    const t0 = b.clock.now();
    expect((await at(t0, [dapc(A, 160)])).kind).toBe('done');
    expect((await at(t0 + 300, [dapc(A, 150)])).kind).toBe('done');
    expect(reason(b.governor.judge(tx([dapc(A, 160)]), t0 + 600))).toMatch(/swing/);
    expect(b.governor.judge(tx([dapc(A, 160)]), t0 + 1100).kind).not.toBe('refuse');
  });
  it('with the rate unlock: up to three swings a second, leading edges 360 ms apart', async () => {
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    const t0 = b.clock.now();
    expect((await at(t0, [dapc(A, 160)])).kind).toBe('done');
    expect((await at(t0 + 100, [dapc(A, 150)])).kind).toBe('done');
    expect(reason(b.governor.judge(tx([dapc(A, 160)]), t0 + 250))).toMatch(/360 ms/);
    expect((await at(t0 + 400, [dapc(A, 160)])).kind).toBe('done');
  });
  it('small changes: three reversals a second', async () => {
    const t0 = b.clock.now();
    for (const [dt, v] of [
      [0, 151],
      [100, 150],
      [200, 151],
      [300, 150],
    ] as const) {
      expect((await at(t0 + dt, [dapc(A, v)])).kind).toBe('done');
    }
    expect(reason(b.governor.judge(tx([dapc(A, 151)]), t0 + 400))).toMatch(/reversals/);
  });
  it('a swap between colours at a constant level counts as a leg', async () => {
    // With a fade of 0.7 s the swap is not a hard step, but each channel's change is still a leg.
    await b.run(
      tx([
        { id: 'DTR0', value: 1 },
        { id: 'SET_FADE_TIME', address: B },
      ]),
    );
    await b.run(tx([...rgbwafCommands(B, [0, 0, 0, 254, 0, 0]), dapc(B, 150)]));
    await b.clock.advance(5000);
    const t0 = b.clock.now();
    expect((await at(t0, rgbwafCommands(B, [0, 0, 0, 0, 254, 0]))).kind).toBe('done');
    expect((await at(t0 + 300, rgbwafCommands(B, [0, 0, 0, 254, 0, 0]))).kind).toBe('done');
    expect(reason(b.governor.judge(tx(rgbwafCommands(B, [0, 0, 0, 0, 254, 0])), t0 + 600))).toMatch(
      /swing/,
    );
  });
  it('an instant swap between colours is a hard step', async () => {
    await b.run(tx([...rgbwafCommands(B, [0, 0, 0, 254, 0, 0]), dapc(B, 150)]));
    await b.clock.advance(5000);
    const t0 = b.clock.now();
    expect((await at(t0, rgbwafCommands(B, [0, 0, 0, 0, 254, 0]))).kind).toBe('done');
    expect(reason(b.governor.judge(tx(rgbwafCommands(B, [0, 0, 0, 254, 0, 0])), t0 + 300))).toMatch(
      /hard step/,
    );
  });
  it('a move to or from saturated red counts as a leg', async () => {
    // Level 203 is about 25%. Red at 254 is saturated while green stays at or under 10%: green at 102 is
    // 9.9% and at 103 is 10.04%. Those changes are far too small to be legs by ratio.
    await b.run(tx([...rgbwafCommands(B, [254, 102, 0, 0, 0, 0]), dapc(B, 203)]));
    await b.clock.advance(5000);
    const t0 = b.clock.now();
    expect((await at(t0, rgbwafCommands(B, [254, 103, 0, 0, 0, 0]))).kind).toBe('done');
    expect((await at(t0 + 300, rgbwafCommands(B, [254, 102, 0, 0, 0, 0]))).kind).toBe('done');
    expect(
      reason(b.governor.judge(tx(rgbwafCommands(B, [254, 103, 0, 0, 0, 0])), t0 + 600)),
    ).toMatch(/swing/);
  });
  it('a fast repeating pattern stops after 5 s', async () => {
    b.governor.unlock('rate', 'ui', true);
    b.governor.setSwingLimit(3, 'ui');
    const t0 = b.clock.now();
    let refusedAt: number | undefined;
    for (let k = 0; k < 20; k++) {
      const t = t0 + k * 400;
      const r = await at(t, [dapc(A, k % 2 === 0 ? 160 : 150)]);
      if (r.kind === 'refused') {
        expect(r.reason).toMatch(/pattern/);
        refusedAt = t - t0;
        break;
      }
    }
    expect(refusedAt).toBeGreaterThanOrEqual(5000);
    expect(refusedAt).toBeLessThan(6000);
  });
  it('the room counts one broadcast once, and at most one hard step a second', async () => {
    const t0 = b.clock.now();
    expect((await at(t0, [{ id: 'OFF', address: { kind: 'broadcast' } }])).kind).toBe('done');
    const v = b.governor.judge(tx([dapc(B, 200)]), t0 + 300);
    expect(reason(v)).toMatch(/hard step/);
  });
});

describe('guard checks in isolation', () => {
  it('clamps the swing limit to one to three', () => {
    expect([swingLimit(0), swingLimit(2), swingLimit(7)]).toEqual([1, 2, 3]);
  });
  it('counts only breaches that involve a new event', () => {
    const old = { legs: [0, 100, 200], hard: [], reversals: [] };
    expect(scopeViolations('a0', old, old, 1000, 1)).toEqual([]);
    const cand = { legs: [0, 100, 200, 1250], hard: [], reversals: [] };
    expect(scopeViolations('a0', cand, old, 1000, 1)).toEqual([]);
    const close = { legs: [600, 700, 1001], hard: [], reversals: [] };
    expect(
      scopeViolations('a0', close, { legs: [600, 700], hard: [], reversals: [] }, 1000, 1),
    ).not.toEqual([]);
  });
  it('adds unknown and phantom events to their scope and to the room', () => {
    const m = withExtra(new Map(), [{ t: 5, scope: 'phantom' }]);
    expect(m.get('phantom')?.hard).toEqual([5]);
    expect(m.get('room')?.legs).toEqual([5]);
  });
});
