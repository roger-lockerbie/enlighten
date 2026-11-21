/**
 * Regression tests for the Stage 3 security review: each reproduces a finding's attack and shows it
 * is now refused.
 */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesForAll, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import { asSubmit, makeBench, type Bench } from '../../tests/harness/bench.ts';
import { Rig } from '../sim/rig.ts';
import { da5l } from '../sim/profile.ts';
import { Simulator } from '../sim/simulator.ts';
import { resetAndRestore } from './profile.ts';
import type { Transaction } from './types.ts';

const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});
const tx = (cmds: readonly Command[]): Transaction => ({
  frames: framesForAll(cmds),
  source: 'script',
});

/** Alternate two transactions every `ms` for a few seconds and count how many went out. */
async function strobe(
  b: Bench,
  a: Transaction,
  z: Transaction,
  ms: number,
  count = 30,
): Promise<number> {
  let done = 0;
  for (let i = 0; i < count; i++) {
    await b.clock.advance(ms);
    const r = await b.run(i % 2 === 0 ? a : z);
    if (r.kind === 'done') done++;
  }
  return done;
}

describe('C1: a hardware shadow that does not match the gear', () => {
  it('gear at addresses the default bench lacks cannot be strobed', async () => {
    const real = Simulator.of([
      { id: 'X', profile: da5l('C2'), opts: { shortAddress: 2 } },
      { id: 'Y', profile: da5l('C5', 'rgbwaf'), opts: { shortAddress: 3 } },
    ]);
    const b = makeBench({ sim: real, target: 'hardware' });
    await b.ready();
    await b.clock.advance(3000);
    const sent = await strobe(b, tx([c('DAPC', short(2), 220)]), tx([c('DAPC', short(2), 0)]), 71);
    // 30 tries over about 2 s: at most one hard step per 2 s gets through.
    expect(sent).toBeLessThanOrEqual(2);
  });
  it('gear in a group the default bench does not know cannot be strobed', async () => {
    const real = Simulator.bench();
    new Rig(real).to('ADD_TO_GROUP', 0, 3);
    const b = makeBench({ sim: real, target: 'hardware' });
    await b.ready();
    await b.clock.advance(3000);
    const sent = await strobe(b, tx([c('DAPC', group(3), 220)]), tx([c('DAPC', group(3), 0)]), 91);
    expect(sent).toBeLessThanOrEqual(2);
  });
  it('stored scenes cannot be used to strobe', async () => {
    const real = Simulator.bench();
    const r = new Rig(real);
    r.set('SET_SCENE', 0, 220, 3);
    const b = makeBench({ sim: real, target: 'hardware' });
    await b.ready();
    await b.clock.advance(3000);
    const sent = await strobe(b, tx([c('GO_TO_SCENE', short(0), 3)]), tx([c('OFF', short(0))]), 91);
    expect(sent).toBeLessThanOrEqual(3);
  });
});

describe('H1: unknown colour is remembered, not only judged', () => {
  it('a second command 300 ms later is refused while the colour is unknown', async () => {
    const b = makeBench({ target: 'hardware' });
    await b.ready();
    await b.clock.advance(3000);
    // A level is refused while the colour is unknown (ADR 0019), so the changes here are OFFs.
    expect((await b.run(tx([c('OFF', short(1))]))).kind).toBe('done');
    await b.clock.advance(300);
    expect((await b.run(tx([c('OFF', short(1))]))).kind).toBe('refused');
  });
  it('a colour that has been set is still not known, so each change waits out the window', async () => {
    const b = makeBench({ target: 'hardware' });
    await b.ready();
    // The profile's writes at the connect were light changes too, so the first change waits them out.
    await b.clock.advance(3500);
    // A colour and a level in one transaction would fade together from a colour not known.
    const both = await b.run(tx([...tcCommands(short(0), 300), c('DAPC', short(0), 150)]));
    expect(both.kind === 'refused' ? both.reason : both.kind).toMatch(/may still be fading/);
    expect((await b.run(tx(tcCommands(short(0), 300)))).kind).toBe('done');
    // Each change may move the gear for 300 ms, and the next waits 2 s after that.
    await b.clock.advance(2400);
    expect((await b.run(tx([c('DAPC', short(0), 150)]))).kind).toBe('done');
    await b.clock.advance(2400);
    expect((await b.run(tx(rgbwafCommands(short(1), [0, 0, 0, 254, 0, 0])))).kind).toBe('done');
    // A colour the session set is still not known on hardware (ADR 0019 amendment 1).
    expect(b.governor.addressInfo(0)?.colourKnown).toBe(false);
    expect(b.governor.addressInfo(1)?.colourKnown).toBe(false);
    await b.clock.advance(2400);
    const r1 = await b.run(tx([c('DAPC', short(0), 160)]));
    expect(r1.kind === 'refused' ? r1.reason : r1.kind).toBe('done');
    await b.clock.advance(300);
    // A second change 300 ms later is a second hard step for gear in an unknown state.
    const r2 = await b.run(tx([c('DAPC', short(0), 150)]));
    expect(r2.kind === 'refused' ? r2.reason : r2.kind).toMatch(/more than one hard step in 2 s/);
  });
});

describe('H3: several unaddressed drivers', () => {
  it('are found by the scan, so group and broadcast recalls are refused', async () => {
    const real = Simulator.of([
      { id: 'A', profile: da5l('C2'), opts: { shortAddress: 0 } },
      { id: 'U1', profile: da5l('C2') },
      { id: 'U2', profile: da5l('C2') },
    ]);
    const b = makeBench({ sim: real });
    await b.ready();
    expect(b.governor.judge(tx([c('RECALL_MAX_LEVEL', broadcast)]), b.clock.now()).kind).toBe(
      'refuse',
    );
  });
  it('two drivers sharing a short address are found', async () => {
    const real = Simulator.of([
      { id: 'A', profile: da5l('C2'), opts: { shortAddress: 0 } },
      { id: 'A2', profile: da5l('C2'), opts: { shortAddress: 0 } },
    ]);
    const b = makeBench({ sim: real });
    await b.ready();
    expect(b.governor.knownAddresses()).toEqual([0]);
  });
});

describe('M1: an approval fixes what it approved', () => {
  it('changing the transaction after judging does not change what is sent', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    const frames = framesForAll([c('DTR0', undefined, 1), c('DAPC', short(0), 100)]);
    const t: Transaction = { frames: [...frames], source: 'script' };
    const p = b.submit(t);
    await b.clock.advance(20);
    (t.frames as unknown as { frame: { a: number; b: number } }[])[1] = { frame: { a: 0, b: 254 } };
    await b.drive(p);
    expect(b.sim.unit('A')?.gear.levelAt(b.clock.now())).toBe(100);
    expect(b.sink.unapproved).toBe(false);
  });
});

describe('M2: the OFF after an unlocked RESET', () => {
  it('falls back to panic when it cannot go out', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    // Latch during the wait, so the OFF is refused.
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        b.clock.at(b.clock.now() + ms, () => {
          b.governor.latch();
          resolve();
        });
      });
    const r = await b.drive(
      resetAndRestore(0, b.governor, asSubmit(b), wait, 'console', () => b.scheduler.panic()),
    );
    expect(r.ok).toBe(false);
    expect(b.sim.unit('A')?.gear.levelAt(b.clock.now())).toBe(0);
  });
  it('goes ahead of work already queued', async () => {
    const b = makeBench();
    await b.ready();
    const order: string[] = [];
    const a = b.scheduler.submit(tx([c('QUERY_STATUS', short(1))])).then(() => order.push('first'));
    const q2 = b.scheduler
      .submit(tx([c('QUERY_STATUS', short(1))]))
      .then(() => order.push('queued'));
    const u = b.scheduler
      .submit(tx([c('QUERY_STATUS', short(0))]), 'urgent')
      .then(() => order.push('urgent'));
    await b.drive(Promise.all([a, q2, u]));
    expect(order).toEqual(['first', 'urgent', 'queued']);
  });
});

describe('L2 and L3', () => {
  it('a confirmed command travels on its own', async () => {
    const b = makeBench();
    await b.ready();
    b.governor.unlock('reset', 'console', true);
    const v = b.governor.judge(
      { frames: framesForAll([c('RESET', short(0)), c('DAPC', short(1), 200)]), source: 'console' },
      b.clock.now(),
    );
    expect(v.kind === 'refuse' ? v.reason : '').toMatch(/on their own/);
    // So do the expert commands that can raise output past the ceiling.
    b.governor.unlock('expert', 'console', true);
    const dtrs = [c('DTR0', undefined, 1), c('DTR1', undefined, 1), c('DTR2', undefined, 1)];
    for (const [id, a] of [
      ['DT6_SELECT_DIMMING_CURVE', short(0)],
      ['DT8_STORE_TC_LIMIT', short(1)],
      ['DT8_STORE_GEAR_FEATURES', short(1)],
    ] as const) {
      const w = b.governor.judge(
        { frames: framesForAll([...dtrs, c(id, a), c('DAPC', short(0), 100)]), source: 'console' },
        b.clock.now() + 5000,
      );
      expect(w.kind === 'refuse' ? w.reason : '').toBe(
        'Send RESET and the other unlocked commands on their own.',
      );
    }
  });
  it('a hardware governor needs the time of the connect', async () => {
    const { Governor } = await import('./governor.ts');
    expect(() => new Governor({ target: 'hardware', shadow: new Simulator([]) })).toThrow(
      /connect/,
    );
  });
});

describe('N1 (re-review): writes during a rescan', () => {
  it('a SET SCENE during a rescan leaves the address unmodelled, so the scene cannot be strobed', async () => {
    const real = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const b = makeBench({ sim: real, target: 'hardware' });
    await b.ready();
    await b.clock.advance(3000);
    const { scan } = await import('./profile.ts');
    // The write lands part way through the scan's queries.
    const write = new Promise((resolve) => {
      b.clock.at(b.clock.now() + 400, () => {
        resolve(b.submit(tx([c('DTR0', undefined, 220), c('SET_SCENE', short(0), 3)])));
      });
    });
    await b.drive(Promise.all([scan(b.governor, asSubmit(b), [0]), write]));
    expect(b.governor.addressInfo(0)?.modelled).toBe(false);
    await b.clock.advance(3000);
    const sent = await strobe(b, tx([c('GO_TO_SCENE', short(0), 3)]), tx([c('OFF', short(0))]), 91);
    expect(sent).toBeLessThanOrEqual(3);
  });
  it('a scan of gear that is fading does not model it', async () => {
    const real = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const r = new Rig(real, 0);
    r.set('SET_FADE_TIME', 0, 15);
    r.to('DAPC', 0, 200);
    const b = makeBench({ sim: real, target: 'hardware', start: r.t + 100 });
    await b.ready();
    expect(b.governor.addressInfo(0)?.modelled).toBe(false);
  });
});

describe('second re-review follow-ups', () => {
  it('single-colour gear is held to the ceiling, not to a seven-channel mix', async () => {
    const real = Simulator.of([{ id: 'X', profile: da5l('C1'), opts: { shortAddress: 0 } }]);
    const b = makeBench({ sim: real });
    await b.ready();
    const v = b.governor.judge(tx([c('DAPC', short(0), 220)]), b.clock.now());
    expect(v.kind).toBe('allow');
  });
});
