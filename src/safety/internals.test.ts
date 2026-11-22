/**
 * U-safety: the governor's less travelled paths. What it learns from replies, deafness after RESET,
 * phantom gear, the mix rule's edges and the safety profile on other light types.
 */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import { encode, type Command } from '../dali/codec.ts';
import {
  framesFor,
  framesForAll,
  rgbwafCommands,
  tcCommands,
  type TxFrame,
} from '../dali/sequences.ts';
import { asSubmit, makeBench } from '../../tests/harness/bench.ts';
import { da5l } from '../sim/profile.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';
import { maxArcForMix, mixSum } from './mix.ts';
import { applySafetyProfile, patient, resetAndRestore, scan, scanAddress } from './profile.ts';
import { lowerCeiling } from './ceiling.ts';
import type { SendResult, Source, Transaction } from './types.ts';

const A = short(0);
const B = short(1);
const tx = (cmds: readonly Command[], source: Source = 'ui'): Transaction => ({
  frames: framesForAll(cmds),
  source,
});
const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});
const one = (cmd: Command): TxFrame => {
  const e = encode(cmd);
  return { frame: e.frame, sendTwice: e.sendTwice, expectReply: e.reply !== 'none' };
};
const reasonOf = (o: { ok: boolean; reason?: string }) => (o.ok ? '' : (o.reason ?? ''));
const reason = (v: { kind: string; reason?: string }) =>
  v.kind === 'refuse' ? (v.reason ?? '') : '';

function bare(target: 'simulator' | 'hardware' = 'simulator') {
  return new Governor({ target, shadow: Simulator.bench(), connectedAt: -10_000 });
}

function tell(g: Governor, cmd: Command, result: SendResult, at = 100) {
  const frames = framesFor(cmd);
  frames.forEach((f, i) => {
    g.observe(
      { frame: f, at: at + i, source: 'internal' },
      i === frames.length - 1 ? result : { kind: 'sent' },
    );
  });
}

describe('what the governor learns from replies', () => {
  it('records device types, colour features, the curve, groups and presence', () => {
    const g = bare();
    expect(g.addressInfo(40)).toBeUndefined();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), { kind: 'reply', byte: 255 });
    tell(g, c('QUERY_DEVICE_TYPE', A), { kind: 'reply', byte: 6 });
    expect(g.addressInfo(0)?.deviceTypes).toEqual([6]);
    expect(g.addressInfo(0)?.colourKnown).toBe(true);
    tell(g, c('QUERY_DEVICE_TYPE', A), { kind: 'reply', byte: 254 });
    expect(g.addressInfo(0)?.deviceTypes).toEqual([]);
    tell(g, c('QUERY_DEVICE_TYPE', A), { kind: 'reply', byte: 255 });
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', A), { kind: 'reply', byte: 8 });
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', A), { kind: 'reply', byte: 254 });
    expect(g.addressInfo(0)?.deviceTypes).toEqual([8]);
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), { kind: 'no-reply' });
    expect(g.addressInfo(0)?.linearCurve).toBeUndefined();
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), { kind: 'reply', byte: 1 });
    expect(g.addressInfo(0)?.linearCurve).toBe(true);
    tell(g, c('DT8_QUERY_COLOUR_TYPE_FEATURES', A), { kind: 'no-reply' });
    expect(g.colourFacts(0)).toBeUndefined();
    tell(g, c('QUERY_GROUPS_8_15', A), { kind: 'reply', byte: 3 });
    tell(g, c('QUERY_GROUPS_0_7', A), { kind: 'reply', byte: 5 });
    expect(g.addressInfo(0)?.groups).toBe(0x0305);
    tell(g, c('QUERY_GROUPS_0_7', A), { kind: 'no-reply' });
    tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), { kind: 'no-reply' });
    expect(g.addressInfo(0)?.fadeReadBack).toBe(false);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), { kind: 'no-reply' });
    expect(g.knownAddresses()).toEqual([0]);
    tell(g, c('QUERY_MISSING_SHORT_ADDRESS', unaddressed), { kind: 'reply', byte: 255 });
  });
  it('on hardware the shadow models an address only once every value it needs is read back', () => {
    const g = new Governor({ target: 'hardware', shadow: new Simulator([]), connectedAt: -10_000 });
    expect(g.modelAddress(0).ok).toBe(false);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), { kind: 'reply', byte: 255 });
    tell(g, c('QUERY_DEVICE_TYPE', A), { kind: 'reply', byte: 6 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/STATUS/);
    tell(g, c('QUERY_STATUS', A), { kind: 'reply', byte: 0x10 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/fading/);
    tell(g, c('QUERY_STATUS', A), { kind: 'reply', byte: 0 });
    tell(g, c('QUERY_PHYSICAL_MINIMUM', A), { kind: 'reply', byte: 20 });
    tell(g, c('QUERY_MIN_LEVEL', A), { kind: 'reply', byte: 90 });
    tell(g, c('QUERY_MAX_LEVEL', A), { kind: 'reply', byte: 200 });
    tell(g, c('QUERY_GROUPS_0_7', A), { kind: 'reply', byte: 4 });
    tell(g, c('QUERY_GROUPS_8_15', A), { kind: 'reply', byte: 0 });
    tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), { kind: 'reply', byte: 0x47 });
    tell(g, c('QUERY_EXTENDED_FADE_TIME', A), { kind: 'reply', byte: 0 });
    tell(g, c('QUERY_ACTUAL_LEVEL', A), { kind: 'reply', byte: 255 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/not read back/);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), { kind: 'reply', byte: 150 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/curve/);
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), { kind: 'reply', byte: 0 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/scene/);
    for (let k = 0; k < 16; k++)
      tell(g, c('QUERY_SCENE_LEVEL', A, k), { kind: 'reply', byte: k === 2 ? 120 : 255 });
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), { kind: 'reply', byte: 0 });
    expect(reasonOf(g.modelAddress(0))).toMatch(/fast fade/);
    tell(g, c('DT6_QUERY_FAST_FADE_TIME', A), { kind: 'reply', byte: 0 });
    expect(g.modelAddress(0).ok).toBe(true);
    const snap = g.shadow.byShortAddress(0)?.gear.snapshot();
    expect([snap?.minLevel, snap?.maxLevel, snap?.groups, snap?.fadeTime, snap?.fadeRate]).toEqual([
      90, 200, 4, 4, 7,
    ]);
    expect(g.shadow.byShortAddress(0)?.gear.levelAt(200)).toBe(150);
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
    // The shadow clamps as the gear does: its physical minimum is the one read back.
    expect(g.shadow.byShortAddress(0)?.gear.profile.settings.physicalMinimum).toBe(20);
    expect(g.shadow.byShortAddress(0)?.gear.deviceTypes).toEqual([6]);
    expect(g.addressInfo(0)?.colourKnown).toBe(true);
    // DT8 gear needs its colour features first, and gets a matching light type.
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), { kind: 'reply', byte: 255 });
    tell(g, c('QUERY_DEVICE_TYPE', B), { kind: 'reply', byte: 8 });
    for (const [id, v] of [
      ['QUERY_PHYSICAL_MINIMUM', 85],
      ['QUERY_MIN_LEVEL', 85],
      ['QUERY_MAX_LEVEL', 220],
      ['QUERY_GROUPS_0_7', 0],
      ['QUERY_GROUPS_8_15', 0],
      ['QUERY_FADE_TIME_FADE_RATE', 7],
      ['QUERY_EXTENDED_FADE_TIME', 0],
      ['QUERY_ACTUAL_LEVEL', 0],
      ['QUERY_STATUS', 0],
    ] as const) {
      tell(g, c(id, B), { kind: 'reply', byte: v });
    }
    expect(reasonOf(g.modelAddress(1))).toMatch(/colour features/);
    for (const [byte, light] of [
      [0x02, 'C2'],
      [0x40, 'C2'],
      [0x62, 'C5'],
      [0x60, 'C3'],
      [0x80, 'C4'],
      [0xa0, 'C5'],
    ] as const) {
      const h = new Governor({ target: 'hardware', shadow: new Simulator([]), connectedAt: 0 });
      tell(h, c('QUERY_CONTROL_GEAR_PRESENT', B), { kind: 'reply', byte: 255 });
      tell(h, c('QUERY_DEVICE_TYPE', B), { kind: 'reply', byte: 8 });
      for (const [id, v] of [
        ['QUERY_PHYSICAL_MINIMUM', 85],
        ['QUERY_MIN_LEVEL', 85],
        ['QUERY_MAX_LEVEL', 220],
        ['QUERY_GROUPS_0_7', 0],
        ['QUERY_GROUPS_8_15', 0],
        ['QUERY_FADE_TIME_FADE_RATE', 7],
        ['QUERY_EXTENDED_FADE_TIME', 0],
        ['QUERY_ACTUAL_LEVEL', 0],
        ['QUERY_STATUS', 0],
      ] as const) {
        tell(h, c(id, B), { kind: 'reply', byte: v });
      }
      tell(h, c('DT8_QUERY_COLOUR_TYPE_FEATURES', B), { kind: 'reply', byte });
      for (let k = 0; k < 16; k++)
        tell(h, c('QUERY_SCENE_LEVEL', B, k), { kind: 'reply', byte: 255 });
      expect(h.modelAddress(1).ok).toBe(true);
      expect(h.shadow.byShortAddress(1)?.gear.profile.lightType).toBe(light);
    }
    expect(bare().modelAddress(0).ok).toBe(true);
  });
  it('a ceiling check skips gear whose physical minimum is unknown', () => {
    const g = bare();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), { kind: 'reply', byte: 255 });
    expect(g.setCeiling(10, 'ui').ok).toBe(true);
    expect(g.overCeiling(9, 0)).toBe(false);
  });
  it('new short addresses unverify everything', async () => {
    const b = makeBench();
    await b.ready();
    b.governor.observe(
      {
        frame: one(c('PROGRAM_SHORT_ADDRESS', undefined, 7)),
        at: b.clock.now(),
        source: 'console',
      },
      { kind: 'sent' },
    );
    expect(b.governor.addressInfo(0)?.verified).toBe(false);
  });
});

describe('unlocks and settings', () => {
  it('locking one unlock keeps the swing limit while rate stays unlocked', () => {
    const g = bare();
    g.unlock('rate', 'ui', true);
    g.unlock('expert', 'ui', true);
    g.setSwingLimit(2, 'ui');
    g.lock('expert');
    expect(g.swingLimit).toBe(2);
    g.setOperatorCanSee(true, 'ui');
    expect(g.isUnlocked('rate')).toBe(true);
  });
});

describe('rules on the edges', () => {
  it('unaddressed gear on the bus blocks indirect group commands', async () => {
    const b = makeBench();
    await b.ready();
    b.governor.markInventoryFresh(true);
    expect(reason(b.governor.judge(tx([c('RECALL_MAX_LEVEL', broadcast)]), b.clock.now()))).toMatch(
      /without a short address/,
    );
  });
  it('colour commands to a group need every member to support them', async () => {
    const b = makeBench();
    await b.ready();
    expect(reason(b.governor.judge(tx(tcCommands(broadcast, 250, false)), b.clock.now()))).toMatch(
      /not every addressed gear reports Tc/,
    );
    expect(
      reason(
        b.governor.judge(tx(rgbwafCommands(group(3), [1, 1, 1, 1, 1, 1], false)), b.clock.now()),
      ),
    ).toBe('');
    expect(
      reason(
        b.governor.judge(tx(rgbwafCommands(broadcast, [1, 1, 1, 1, 1, 1], false)), b.clock.now()),
      ),
    ).toMatch(/not every addressed gear reports RGBWAF/);
  });
  it('a register loaded while gear may be deaf after RESET is unknown', async () => {
    const b = makeBench();
    await b.ready();
    b.governor.unlock('reset', 'console', true);
    await b.run(tx([c('RESET', A)], 'console'));
    const v = b.governor.judge(tx([c('DTR0', undefined, 4), c('SET_FADE_TIME', B)]), b.clock.now());
    expect(reason(v)).toMatch(/unknown/);
    expect(b.governor.fingerprint()).toMatch(/resetOff/);
  });
  it('a DAPC is lowered as far as it goes when the light is already over, and 0 and 255 are left alone', async () => {
    const b = makeBench();
    await b.ready();
    await b.run(tx(rgbwafCommands(B, [254, 254, 254, 254, 254, 255])));
    await b.clock.advance(3000);
    await b.run(tx([c('DAPC', B, 150)]));
    await b.clock.advance(3000);
    // The governor's ceiling drops below what the mix allows at the gear's lowest level.
    b.governor.setCeiling(100, 'script');
    const v = b.governor.judge(tx([c('DAPC', B, 100)]), b.clock.now());
    expect(v.kind).toBe('clamp');
    if (v.kind === 'clamp') expect(v.note).toMatch(/as far as it goes/);
    expect(b.governor.judge(tx([c('DAPC', B, 255)]), b.clock.now()).kind).toBe('allow');
    expect(b.governor.judge(tx([c('DAPC', B, 0)]), b.clock.now() + 3000).kind).not.toBe('refuse');
  });
  it('on hardware, frames to groups and unaddressed gear count a phantom driver', () => {
    const g = bare('hardware');
    g.observe({ frame: one(c('OFF', unaddressed)), at: 100, source: 'ui' }, { kind: 'sent' });
    expect(reason(g.judge(tx([c('OFF', group(1))]), 400))).toMatch(/hard step/);
    // No level goes to gear the inventory has not found: it may be colour gear (ADR 0019).
    expect(reason(g.judge(tx([c('DAPC', unaddressed, 100)]), 400))).toMatch(
      /Gear the inventory has not found may be colour gear/,
    );
  });
  it('light changes wait 2 s after a hardware connect', () => {
    const g = new Governor({ target: 'hardware', shadow: Simulator.bench(), connectedAt: 1000 });
    expect(g.judge(tx([c('OFF', A)]), 1500).kind).not.toBe('refuse');
    const v = g.judge(tx([c('DAPC', A, 100)]), 1500);
    expect(reason(v)).toMatch(/just after connecting/);
    // The gear has not been scanned, so the level would not go after the hold either (ADR 0019).
    expect(v).not.toHaveProperty('retryAt');
  });
});

describe('the mix rule', () => {
  it('counts gear with no colour as one channel', () => {
    expect(mixSum({ tc: false, channels: 0 }, [254, 254])).toBe(1);
    expect(mixSum({ tc: false, channels: 2 }, [127])).toBeCloseTo(0.5 + 1, 6);
    expect(maxArcForMix(220, 1)).toBe(220);
    expect(maxArcForMix(220, 2)).toBeLessThan(220);
  });
});

describe('the safety profile on other light types', () => {
  it('C1 (DT6 only) and a DT8-only driver both verify', async () => {
    const sim = Simulator.of([
      { id: 'A', profile: da5l('C1'), opts: { shortAddress: 0 } },
      {
        id: 'B',
        profile: da5l('C5', 'rgbwaf', { deviceTypes: 'dt8-only' }),
        opts: { shortAddress: 1 },
      },
      { id: 'C', profile: da5l('C2', 'rgbwaf'), opts: { shortAddress: 2 } },
    ]);
    const b = makeBench({ sim });
    await b.ready();
    expect(b.governor.addressInfo(0)?.verified).toBe(true);
    expect(b.governor.addressInfo(1)?.verified).toBe(true);
    expect(b.governor.addressInfo(2)?.verified).toBe(true);
  });
  it('a profile on an address that does not answer fails, and a scan finds nothing there', async () => {
    const b = makeBench();
    const s = asSubmit(b);
    const r = await b.drive(applySafetyProfile(9, b.governor, s));
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/did not answer/);
    expect(await b.drive(scanAddress(9, b.governor, s))).toBe(false);
    expect(await b.drive(scan(b.governor, s, [9]))).toEqual([]);
  });
  it('a fault on a read fails the profile with the reason', async () => {
    const b = makeBench();
    await b.ready();
    b.sink.fault = (f) => (f.expectReply ? { reached: true } : undefined);
    const r = await b.drive(applySafetyProfile(0, b.governor, asSubmit(b)));
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/did not answer/);
  });
  it('RESET then a refused OFF reports it', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    const wait = () => {
      b.governor.latch();
      return Promise.resolve();
    };
    const r = await b.drive(
      resetAndRestore(0, b.governor, asSubmit(b), wait, 'console', () => b.scheduler.panic()),
    );
    expect(r.ok).toBe(false);
  });
  it('the patient submit gives up after a few refusals', async () => {
    const b = makeBench();
    let calls = 0;
    const s = patient(
      () => {
        calls++;
        return Promise.resolve({ kind: 'refused', reason: 'no', retryAt: b.clock.now() + 10 });
      },
      () => Promise.resolve(),
      () => b.clock.now(),
    );
    const r = await s(tx([c('OFF', A)]));
    expect(r.kind).toBe('refused');
    expect(calls).toBe(6);
  });
});

describe('lowering the ceiling under a colour mix', () => {
  it('switches off a mix that cannot fit, waiting for the rate guard', async () => {
    const sim = Simulator.bench({ a: da5l('C2', 'rgbwaf'), b: da5l('C5', 'tc') });
    const b = makeBench({ sim });
    await b.ready();
    await b.clock.advance(2100);
    await b.run(tx([c('DAPC', B, 112)]));
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        b.clock.at(b.clock.now() + ms, r);
      });
    const r = await b.drive(
      lowerCeiling(b.governor, 111, asSubmit(b), 'script', () => b.clock.now(), wait),
    );
    expect(r.ok).toBe(true);
    expect(sim.unit('B')?.gear.levelAt(b.clock.now())).toBe(0);
  });
  it('fails cleanly below the physical minimum', async () => {
    const b = makeBench();
    await b.ready();
    const wait = () => Promise.resolve();
    const r = await b.drive(
      lowerCeiling(b.governor, 50, asSubmit(b), 'script', () => b.clock.now(), wait),
    );
    expect(r.ok).toBe(false);
  });
});

describe('raw frame helpers', () => {
  it('framesFor and encode agree', () => {
    expect(framesFor(c('OFF', A))[0]).toEqual(one(c('OFF', A)));
  });
});

describe('facts that arrive in odd orders', () => {
  it('group changes before the groups are read, NEXT DEVICE TYPE alone, and a faulted OFF', () => {
    const g = bare('hardware');
    tell(g, c('ADD_TO_GROUP', A, 2), { kind: 'sent' });
    tell(g, c('REMOVE_FROM_GROUP', A, 2), { kind: 'sent' });
    expect(g.addressInfo(0)?.groups).toBeUndefined();
    tell(g, c('QUERY_GROUPS_0_7', A), { kind: 'reply', byte: 0 });
    tell(g, c('QUERY_GROUPS_8_15', A), { kind: 'no-reply' });
    tell(g, c('ADD_TO_GROUP', A, 9), { kind: 'sent' });
    tell(g, c('REMOVE_FROM_GROUP', A, 0), { kind: 'sent' });
    expect(g.addressInfo(0)?.groups).toBe(1 << 9);
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', B), { kind: 'reply', byte: 6 });
    expect(g.addressInfo(1)?.deviceTypes).toEqual([6]);
    tell(g, c('OFF', A), { kind: 'fault', reason: 'gone' });
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('OFF', A), { kind: 'sent' });
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
  });
  it('RGBWAF commands to gear that has not said what it is are refused', () => {
    const g = bare();
    tell(g, c('DTR0', undefined, 0), { kind: 'sent' });
    tell(g, c('DTR1', undefined, 0), { kind: 'sent' });
    tell(g, c('DTR2', undefined, 0), { kind: 'sent' });
    expect(reason(g.judge(tx([c('DT8_SET_TEMPORARY_RGB', short(7))], 'profile'), 1000))).toMatch(
      /does not report RGBWAF/,
    );
  });
  it('gear without a short address has its own scope and the worst colour facts', async () => {
    const sim = Simulator.of([
      { id: 'A', profile: da5l('C2'), opts: { shortAddress: 0 } },
      { id: 'X', profile: da5l('C5', 'rgbwaf') },
    ]);
    const b = makeBench({ sim });
    await b.ready();
    const v = b.governor.judge(tx([c('DAPC', broadcast, 200)]), b.clock.now() + 3000);
    expect(v.kind).not.toBe('allow');
    const { predictEvents } = await import('./rate/trace.ts');
    expect([...predictEvents(sim, 0, 10, false).keys()]).toContain('unit:X');
  });
});
