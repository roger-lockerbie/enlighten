/**
 * U-safety: the hardware target in detail. What `observe` records, the events counted for gear in an
 * unknown state, how a scan builds the shadow, and how the rate guard treats RESET, fades and the
 * time after a connect. Written against the Stage 3 mutation run (`docs/MUTATION.md`).
 */
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesFor, framesForAll, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import { DEFAULT_TIMING, FORWARD_FRAME_MS } from '../bus/timing.ts';
import { makeBench } from '../../tests/harness/bench.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';
import { maxArcForMix } from './mix.ts';
import { PHANTOM, ROOM } from './rate/trace.ts';
import type { SendResult, Source, Transaction, Verdict } from './types.ts';

const A = short(0);
const B = short(1);
const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});
const tx = (cmds: readonly Command[], source: Source = 'ui'): Transaction => ({
  frames: framesForAll(cmds),
  source,
});
const reason = (v: Verdict): string => (v.kind === 'refuse' ? v.reason : '');
const reply = (byte: number): SendResult => ({ kind: 'reply', byte });
const NONE: SendResult = { kind: 'no-reply' };

const hw = (connectedAt = -10_000) =>
  new Governor({ target: 'hardware', shadow: new Simulator([]), connectedAt });
const sim = () =>
  new Governor({ target: 'simulator', shadow: Simulator.bench(), connectedAt: -10_000 });

/** Tell the governor a command went out, as part of transaction `txId` if given. */
function tell(
  g: Governor,
  cmd: Command,
  result: SendResult = { kind: 'sent' },
  at = 100,
  txId?: number,
): void {
  const frames = framesFor(cmd);
  frames.forEach((f, i) => {
    g.observe(
      { frame: f, at: at + i, source: 'internal', ...(txId === undefined ? {} : { tx: txId }) },
      i === frames.length - 1 ? result : { kind: 'sent' },
    );
  });
}

interface Gear {
  types?: number[];
  colour?: number;
  level?: number;
  groups?: number;
  fade?: number;
  scenes?: number[];
  phys?: number;
  curve?: number;
}

/** Every read-back a scan takes, then `modelAddress`. */
function scanInto(g: Governor, n: number, gear: Gear = {}, at = 100) {
  const a = short(n);
  g.beginScan(n);
  const r = (id: string, v: number, value?: number) => {
    tell(g, c(id, a, value), reply(v), at);
  };
  r('QUERY_CONTROL_GEAR_PRESENT', 255);
  const types = gear.types ?? [6];
  if (types.length === 1) r('QUERY_DEVICE_TYPE', types[0] ?? 254);
  else {
    r('QUERY_DEVICE_TYPE', 255);
    for (const t of types) r('QUERY_NEXT_DEVICE_TYPE', t);
    r('QUERY_NEXT_DEVICE_TYPE', 254);
  }
  r('QUERY_PHYSICAL_MINIMUM', gear.phys ?? 85);
  r('QUERY_MIN_LEVEL', 85);
  r('QUERY_MAX_LEVEL', 220);
  r('QUERY_GROUPS_0_7', (gear.groups ?? 0) & 0xff);
  r('QUERY_GROUPS_8_15', (gear.groups ?? 0) >> 8);
  r('QUERY_FADE_TIME_FADE_RATE', gear.fade ?? 0x07);
  r('QUERY_EXTENDED_FADE_TIME', 0);
  r('QUERY_ACTUAL_LEVEL', gear.level ?? 0);
  if (types.includes(6)) {
    r('DT6_QUERY_DIMMING_CURVE', gear.curve ?? 0);
    r('DT6_QUERY_FAST_FADE_TIME', 0);
  }
  if (types.includes(8)) r('DT8_QUERY_COLOUR_TYPE_FEATURES', gear.colour ?? 0x02);
  for (let k = 0; k < 16; k++) r('QUERY_SCENE_LEVEL', gear.scenes?.[k] ?? 255, k);
  r('QUERY_STATUS', 0);
  return g.modelAddress(n);
}

interface Ev {
  t: number;
  scope: string;
  until?: number;
}
interface Inner {
  unknownEvents(cmd: Command, at: number, known: (n: number) => boolean): Ev[];
  extraEvents(planned: readonly unknown[]): Ev[];
  plan(t: Transaction, now: number): { deliverAt: number }[];
}
const inner = (g: Governor) => g as unknown as Inner;
const knownIn = (g: Governor) => (n: number) => g.addressInfo(n)?.levelKnown === true;
const fp = (g: Governor) =>
  JSON.parse(g.fingerprint()) as {
    synthetic: Ev[];
    deafUntil: number;
    unaddressedPresent: boolean;
    resetOff: { targets: number[]; until: number } | null;
    dtr: (number | null)[];
  };

describe('events for gear in an unknown state', () => {
  it('none in the Simulator target', () => {
    expect(inner(sim()).unknownEvents(c('DAPC', broadcast, 1), 5, () => false)).toEqual([]);
  });
  it('none for commands that do not change light, or for gear that is fully known', () => {
    const g = hw();
    expect(scanInto(g, 0).ok).toBe(true);
    g.markInventoryFresh(false);
    const ev = (cmd: Command) => inner(g).unknownEvents(cmd, 5, knownIn(g));
    expect(ev(c('QUERY_ACTUAL_LEVEL', A))).toEqual([]);
    expect(ev(c('DAPC', A, 100))).toEqual([]);
    expect(ev(c('DAPC', broadcast, 100))).toEqual([]);
    expect(ev(c('GO_TO_SCENE', A, 3))).toEqual([]);
  });
  it('a phantom driver for gear without a short address, and for groups while the inventory is in doubt', () => {
    const g = hw();
    scanInto(g, 0);
    const ev = (cmd: Command) => inner(g).unknownEvents(cmd, 5, knownIn(g));
    const phantom = [{ t: 5, scope: PHANTOM }];
    // A new connection starts with a stale inventory.
    expect(ev(c('DAPC', group(2), 100))).toEqual(phantom);
    expect(ev(c('DAPC', A, 100))).toEqual([]);
    g.markInventoryFresh(false);
    expect(ev(c('DAPC', unaddressed, 100))).toEqual(phantom);
    expect(ev(c('DAPC', group(2), 100))).toEqual([]);
    g.markInventoryFresh(true);
    expect(ev(c('DAPC', broadcast, 100))).toEqual(phantom);
    expect(ev(c('DAPC', A, 100))).toEqual([]);
  });
  it('the address and the room when the level is not known, or memory is recalled', () => {
    const g = hw();
    scanInto(g, 0);
    g.markInventoryFresh(false);
    expect(inner(g).unknownEvents(c('DAPC', A, 100), 5, () => false)).toEqual([
      { t: 5, scope: 'a0' },
      { t: 5, scope: ROOM },
    ]);
    expect(inner(g).unknownEvents(c('GO_TO_LAST_ACTIVE_LEVEL', A), 5, knownIn(g))).toEqual([
      { t: 5, scope: 'a0' },
    ]);
    expect(inner(g).unknownEvents(c('DAPC', short(7), 100), 5, knownIn(g))).toEqual([
      { t: 5, scope: 'a7' },
    ]);
  });
  it('a scene recall on DT8 gear, whose scene colours a scan does not read', () => {
    const g = hw();
    scanInto(g, 1, { types: [8], colour: 0x02 });
    for (const cmd of tcCommands(B, 250)) tell(g, cmd);
    expect(g.addressInfo(1)?.colourKnown).toBe(true);
    expect(inner(g).unknownEvents(c('GO_TO_SCENE', B, 3), 5, knownIn(g))).toEqual([
      { t: 5, scope: 'a1' },
    ]);
    expect(inner(g).unknownEvents(c('DAPC', B, 100), 5, knownIn(g))).toEqual([]);
  });
  it('the room for any light change while other gear is not fully known', () => {
    const g = hw();
    scanInto(g, 0);
    // B has answered, has no colour and a level the governor saw set, but no model.
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255));
    tell(g, c('QUERY_DEVICE_TYPE', B), reply(6));
    tell(g, c('DAPC', B, 100));
    expect(g.addressInfo(1)?.levelKnown).toBe(true);
    expect(inner(g).unknownEvents(c('DAPC', A, 100), 5, knownIn(g))).toEqual([
      { t: 5, scope: ROOM },
    ]);
  });
  it('one event per scope per transaction, spanning the commands that were unknown', () => {
    const g = hw();
    scanInto(g, 0);
    g.markInventoryFresh(false);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A));
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    const events = (cmds: Command[]) => {
      const planned = inner(g).plan(tx(cmds), 1000);
      return { at: planned.map((p) => p.deliverAt), ev: inner(g).extraEvents(planned) };
    };
    // DAPC 255 leaves the level as it was, so the DAPC after it is still unknown.
    let r = events([c('DAPC', A, 255), c('DAPC', A, 100), c('DAPC', A, 120)]);
    expect(r.ev).toEqual([
      { t: r.at[0], scope: 'a0', until: r.at[1] },
      { t: r.at[0], scope: ROOM, until: r.at[1] },
    ]);
    r = events([c('OFF', A), c('DAPC', A, 100)]);
    expect(r.ev).toEqual([
      { t: r.at[0], scope: 'a0', until: r.at[0] },
      { t: r.at[0], scope: ROOM, until: r.at[0] },
    ]);
    // A recall inside the transaction makes the level unknown again for what follows.
    r = events([c('DAPC', A, 100), c('GO_TO_LAST_ACTIVE_LEVEL', A), c('DAPC', A, 120)]);
    expect(r.ev).toEqual([
      { t: r.at[0], scope: 'a0', until: r.at[2] },
      { t: r.at[0], scope: ROOM, until: r.at[2] },
    ]);
  });
});

describe('what observe remembers', () => {
  it('extra events, merged within one transaction and kept for the history window', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('DAPC', A, 100), undefined, 1000, 1);
    tell(g, c('DAPC', A, 120), undefined, 1030, 1);
    expect(fp(g).synthetic).toEqual([
      { t: 1000, scope: 'a0', until: 1030, tx: 1 },
      { t: 1000, scope: ROOM, until: 1030, tx: 1 },
    ]);
    tell(g, c('DAPC', A, 130), undefined, 1060, 2);
    tell(g, c('DAPC', A, 140), undefined, 1090);
    tell(g, c('DAPC', A, 150), undefined, 1100);
    expect(fp(g).synthetic.map((e) => [e.t, e.scope])).toEqual([
      [1000, 'a0'],
      [1000, ROOM],
      [1060, 'a0'],
      [1060, ROOM],
      [1090, 'a0'],
      [1090, ROOM],
      [1100, 'a0'],
      [1100, ROOM],
    ]);
    // Events are kept for 7 s: the 6 s the guard looks back and a second more.
    tell(g, c('QUERY_STATUS', A), reply(0), 8000);
    expect(fp(g).synthetic[0]?.t).toBe(1000);
    tell(g, c('QUERY_STATUS', A), reply(0), 8001);
    expect(fp(g).synthetic[0]?.t).toBe(1060);
  });
  it('an event for modelled gear only while its level is unknown', () => {
    const g = hw();
    scanInto(g, 0);
    tell(g, c('DAPC', A, 100), undefined, 1000);
    expect(fp(g).synthetic).toEqual([]);
    const g2 = hw();
    scanInto(g2, 0);
    // A recall the scan did not read leaves the level unknown, so the change after it is unknown too,
    // and so is the room total until then.
    tell(g2, c('GO_TO_LAST_ACTIVE_LEVEL', A), undefined, 1000);
    tell(g2, c('DAPC', A, 120), undefined, 3000);
    tell(g2, c('DAPC', A, 130), undefined, 5000);
    expect(fp(g2).synthetic.map((e) => [e.t, e.scope])).toEqual([
      [1000, 'a0'],
      [3000, 'a0'],
      [3000, ROOM],
    ]);
  });
  it('a RESET or SAVE PERSISTENT VARIABLES makes the gear deaf to registers for 350 ms', () => {
    for (const id of ['RESET', 'SAVE_PERSISTENT_VARIABLES']) {
      const g = hw();
      tell(g, c(id, A), undefined, 1000);
      expect(fp(g).deafUntil).toBe(1000 + 350);
      tell(g, c('DTR0', undefined, 5), undefined, 1349);
      expect(g.dtrView()[0]).toBeUndefined();
      tell(g, c('DTR0', undefined, 6), undefined, 1350);
      expect(g.dtrView()[0]).toBe(6);
      tell(g, c('DTR0', undefined, 7), { kind: 'fault', reason: 'x' }, 1400);
      expect(g.dtrView()[0]).toBeUndefined();
    }
  });
  it('the OFF after a RESET is counted against each gear it reset', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255));
    tell(g, c('RESET', broadcast), undefined, 1000);
    expect(fp(g).resetOff?.targets).toEqual([0, 1]);
    tell(g, c('DAPC', A, 5), undefined, 1100);
    tell(g, c('OFF', broadcast), undefined, 1110);
    expect(fp(g).resetOff?.targets).toEqual([0, 1]);
    tell(g, c('OFF', A), undefined, 1120);
    expect(fp(g).resetOff?.targets).toEqual([1]);
  });
  it('new short addresses unverify everything and, on hardware, unmodel it', () => {
    for (const id of ['PROGRAM_SHORT_ADDRESS', 'SET_SHORT_ADDRESS']) {
      const h = hw();
      scanInto(h, 0);
      const s = sim();
      tell(s, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
      for (const g of [h, s]) {
        if (id === 'SET_SHORT_ADDRESS') tell(g, c('DTR0', undefined, 3));
        tell(g, id === 'SET_SHORT_ADDRESS' ? c(id, A) : c(id, undefined, 3));
        expect(g.inventoryStale).toBe(true);
      }
      expect(h.addressInfo(0)?.modelled).toBe(false);
      expect(s.addressInfo(0)?.modelled).toBe(true);
    }
  });
  it('a fault makes the address unknown on hardware, and only unverified in the Simulator target', () => {
    const s = sim();
    tell(s, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(s, c('DAPC', A, 100), { kind: 'fault', reason: 'x' });
    const si = s.addressInfo(0);
    expect([si?.verified, si?.modelled, si?.levelKnown, si?.colourKnown]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    const h = hw();
    scanInto(h, 0);
    tell(h, c('DAPC', A, 100), { kind: 'fault', reason: 'x' });
    const hi = h.addressInfo(0);
    expect([hi?.modelled, hi?.levelKnown, hi?.colourKnown, hi?.lastActiveKnown]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
  it('the last active level is known after a level command that sets it', () => {
    for (const id of [
      'UP',
      'DOWN',
      'STEP_UP',
      'STEP_DOWN',
      'RECALL_MAX_LEVEL',
      'RECALL_MIN_LEVEL',
      'ON_AND_STEP_UP',
      'CONTINUOUS_UP',
      'CONTINUOUS_DOWN',
    ]) {
      const g = hw();
      scanInto(g, 0);
      expect(g.addressInfo(0)?.lastActiveKnown).toBe(false);
      tell(g, c(id, A));
      expect([id, g.addressInfo(0)?.lastActiveKnown]).toEqual([id, true]);
    }
    const g = hw();
    scanInto(g, 0);
    for (const cmd of [c('DAPC', A, 0), c('DAPC', A, 255), c('OFF', A), c('STEP_DOWN_AND_OFF', A)])
      tell(g, cmd);
    expect(g.addressInfo(0)?.lastActiveKnown).toBe(false);
    tell(g, c('DAPC', A, 100), { kind: 'fault', reason: 'x' });
    expect(g.addressInfo(0)?.lastActiveKnown).toBe(false);
    tell(g, c('DAPC', A, 100));
    expect(g.addressInfo(0)?.lastActiveKnown).toBe(true);
  });
  it('GO TO LAST ACTIVE LEVEL leaves the level unknown on hardware until a level command set it', () => {
    const g = hw();
    scanInto(g, 0);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A));
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('DAPC', A, 100));
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A));
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
    const s = sim();
    tell(s, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(s, c('GO_TO_LAST_ACTIVE_LEVEL', A));
    expect(s.addressInfo(0)?.levelKnown).toBe(true);
  });
  it('a level is known after DAPC or OFF, but not after DAPC 255 or a fault', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('DAPC', A, 255));
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('OFF', A), { kind: 'fault', reason: 'x' });
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('DAPC', A, 100), { kind: 'fault', reason: 'x' });
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('OFF', A));
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
    const h = hw();
    tell(h, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(h, c('DAPC', A, 0));
    expect(h.addressInfo(0)?.levelKnown).toBe(true);
  });
  it('GO TO SCENE leaves the colour unknown on DT8 hardware only', () => {
    const g = hw();
    scanInto(g, 0);
    scanInto(g, 1, { types: [8] });
    for (const cmd of tcCommands(B, 250)) tell(g, cmd);
    tell(g, c('GO_TO_SCENE', A, 3));
    tell(g, c('GO_TO_SCENE', B, 3));
    expect([g.addressInfo(0)?.colourKnown, g.addressInfo(1)?.colourKnown]).toEqual([true, false]);
    const s = sim();
    tell(s, c('QUERY_DEVICE_TYPE', B), reply(8));
    tell(s, c('GO_TO_SCENE', B, 3));
    expect(s.addressInfo(1)?.colourKnown).toBe(true);
  });
  it('a colour is known once a whole temporary colour was set and activated', () => {
    const run = (parts: readonly ('tc' | 'rgb' | 'waf' | 'act' | 'fault')[]) => {
      const g = hw();
      tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255));
      for (const p of parts) {
        if (p === 'tc') tell(g, c('DT8_SET_TEMPORARY_TC', B));
        if (p === 'rgb') tell(g, c('DT8_SET_TEMPORARY_RGB', B));
        if (p === 'waf') tell(g, c('DT8_SET_TEMPORARY_WAF', B));
        if (p === 'act') tell(g, c('DT8_ACTIVATE', B));
        if (p === 'fault') tell(g, c('DT8_ACTIVATE', B), { kind: 'fault', reason: 'x' });
      }
      return g.addressInfo(1)?.colourKnown;
    };
    expect(run(['tc', 'act'])).toBe(true);
    expect(run(['rgb', 'waf', 'act'])).toBe(true);
    expect(run(['rgb', 'act'])).toBe(false);
    expect(run(['waf', 'act'])).toBe(false);
    expect(run(['act'])).toBe(false);
    expect(run(['tc', 'fault'])).toBe(false);
    // ACTIVATE starts the next colour from nothing.
    expect(run(['rgb', 'act', 'waf', 'act'])).toBe(false);
  });
  it('RESET puts the registers back to their reset values', () => {
    const g = hw();
    tell(g, c('QUERY_PHYSICAL_MINIMUM', A), reply(60));
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), reply(1));
    tell(g, c('QUERY_GROUPS_0_7', A), reply(3));
    tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), reply(0x47));
    expect(g.addressInfo(0)?.fadeReadBack).toBe(true);
    tell(g, c('RESET', A), undefined, 1000);
    const i = g.addressInfo(0);
    expect([
      i?.verified,
      i?.maxLevel,
      i?.minLevel,
      i?.linearCurve,
      i?.groups,
      i?.fadeReadBack,
    ]).toEqual([false, 254, 60, false, 0, false]);
  });
  it('a curve change, limit writes and fade writes clear what they change', () => {
    const g = hw();
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('QUERY_MIN_LEVEL', A), reply(90));
    tell(g, c('DT6_QUERY_DIMMING_CURVE', A), reply(0));
    tell(g, c('DTR0', undefined, 0));
    tell(g, c('DT6_SELECT_DIMMING_CURVE', A));
    expect(g.addressInfo(0)?.linearCurve).toBeUndefined();
    tell(g, c('SET_MAX_LEVEL', A));
    expect([g.addressInfo(0)?.maxLevel, g.addressInfo(0)?.minLevel]).toEqual([undefined, 90]);
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('SET_MIN_LEVEL', A));
    expect([g.addressInfo(0)?.maxLevel, g.addressInfo(0)?.minLevel]).toEqual([200, undefined]);
    for (const id of ['SET_FADE_TIME', 'SET_FADE_RATE', 'SET_EXTENDED_FADE_TIME']) {
      tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), reply(0x47));
      tell(g, c('QUERY_EXTENDED_FADE_TIME', A), reply(3));
      tell(g, c(id, A));
      const i = g.addressInfo(0);
      expect([id, i?.fadeReadBack, i?.fadeTime, i?.fadeRate, i?.extendedFade]).toEqual([
        id,
        false,
        undefined,
        undefined,
        undefined,
      ]);
    }
  });
  it('scene and group writes change only the scene or group they name', () => {
    const g = hw();
    tell(g, c('DTR0', undefined, 100));
    tell(g, c('SET_SCENE', A, 3));
    tell(g, c('ADD_TO_GROUP', A, 3));
    expect([g.addressInfo(0)?.scenes, g.addressInfo(0)?.groups]).toEqual([undefined, undefined]);
    for (let k = 0; k < 16; k++) tell(g, c('QUERY_SCENE_LEVEL', A, k), reply(k));
    for (const id of ['SET_SCENE', 'REMOVE_FROM_SCENE']) {
      tell(g, c('QUERY_SCENE_LEVEL', A, 3), reply(3));
      tell(g, c(id, A, 3));
      const s = g.addressInfo(0)?.scenes ?? [];
      expect([id, s[0], s[2], s[3], s[4]]).toEqual([id, 0, 2, undefined, 4]);
    }
    tell(g, c('QUERY_GROUPS_0_7', A), reply(1));
    tell(g, c('QUERY_GROUPS_8_15', A), reply(0));
    tell(g, c('ADD_TO_GROUP', A, 3));
    expect(g.addressInfo(0)?.groups).toBe(0b1001);
    tell(g, c('REMOVE_FROM_GROUP', A, 0));
    expect(g.addressInfo(0)?.groups).toBe(0b1000);
    tell(g, c('REMOVE_FROM_GROUP', A, 3));
    expect(g.addressInfo(0)?.groups).toBe(0);
  });
  it('replies are learned only from a single address and only without a fault', () => {
    const g = hw();
    tell(g, c('QUERY_MAX_LEVEL', A), reply(200));
    tell(g, c('QUERY_MAX_LEVEL', A), { kind: 'fault', reason: 'x' });
    expect(g.addressInfo(0)?.maxLevel).toBe(200);
    tell(g, c('QUERY_MAX_LEVEL', broadcast), reply(100));
    expect(g.addressInfo(0)?.maxLevel).toBe(200);
  });
  it('gear without a short address is noted from a broadcast or unaddressed query only', () => {
    const g = hw();
    const q = (a: Address, r: SendResult) => {
      tell(g, c('QUERY_MISSING_SHORT_ADDRESS', a), r);
      return fp(g).unaddressedPresent;
    };
    expect(q(broadcast, reply(255))).toBe(true);
    expect(q(broadcast, NONE)).toBe(false);
    expect(q(unaddressed, { kind: 'framing-error' })).toBe(true);
    expect(q(unaddressed, { kind: 'fault', reason: 'x' })).toBe(true);
    expect(q(A, NONE)).toBe(true);
    expect(q(group(1), NONE)).toBe(true);
  });
});

describe('what the governor learns from replies', () => {
  it('device types, and whether gear without colour has a colour to be unknown', () => {
    const g = hw();
    const types = (r: SendResult) => {
      tell(g, c('QUERY_DEVICE_TYPE', A), r);
      return [g.addressInfo(0)?.deviceTypes, g.addressInfo(0)?.colourKnown];
    };
    expect(types(NONE)).toEqual([[], false]);
    expect(types(reply(255))).toEqual([[], false]);
    expect(types(reply(8))).toEqual([[8], false]);
    expect(types(reply(254))).toEqual([[], true]);
    const h = hw();
    tell(h, c('QUERY_DEVICE_TYPE', A), reply(6));
    expect(h.addressInfo(0)?.colourKnown).toBe(true);
    tell(h, c('QUERY_NEXT_DEVICE_TYPE', A), NONE);
    tell(h, c('QUERY_NEXT_DEVICE_TYPE', A), reply(254));
    expect(h.addressInfo(0)?.deviceTypes).toEqual([6]);
  });
  it('a reply that does not come leaves what was read before', () => {
    const g = hw();
    tell(g, c('QUERY_EXTENDED_FADE_TIME', A), reply(5));
    tell(g, c('QUERY_STATUS', A), reply(0x10));
    tell(g, c('QUERY_GROUPS_0_7', A), reply(1));
    tell(g, c('QUERY_GROUPS_8_15', A), reply(2));
    for (const id of [
      'QUERY_EXTENDED_FADE_TIME',
      'QUERY_STATUS',
      'QUERY_GROUPS_0_7',
      'QUERY_GROUPS_8_15',
    ])
      tell(g, c(id, A), NONE);
    const i = g.addressInfo(0);
    expect([i?.extendedFade, i?.fading, i?.groups]).toEqual([5, true, 0x0201]);
    tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), reply(0x47));
    expect([g.addressInfo(0)?.fadeReadBack, g.addressInfo(0)?.fadeTime]).toEqual([true, 4]);
    tell(g, c('QUERY_SCENE_LEVEL', A, 3), reply(9));
    expect(g.addressInfo(0)?.scenes).toHaveLength(16);
  });
  it('an actual level seeds the model only while its level is unknown', () => {
    const g = hw();
    scanInto(g, 0, { level: 100 });
    const level = () => g.shadow.byShortAddress(0)?.gear.levelAt(5000);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), reply(150), 200);
    expect(level()).toBe(100);
    expect(g.addressInfo(0)?.level).toBe(150);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A), undefined, 300);
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), reply(255), 400);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), NONE, 400);
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), reply(120), 500);
    expect(g.addressInfo(0)?.levelKnown).toBe(true);
    expect(level()).toBe(120);
    // Unmodelled gear keeps the reading for its scan, and nothing is seeded.
    const h = hw();
    tell(h, c('QUERY_ACTUAL_LEVEL', A), reply(90));
    expect([h.addressInfo(0)?.level, h.addressInfo(0)?.levelKnown]).toEqual([90, false]);
  });
});

describe('building the shadow from a scan', () => {
  it('a scan starts clean: sends before it no longer count', () => {
    const g = hw();
    tell(g, c('DAPC', A, 10));
    tell(g, c('QUERY_STATUS', A), reply(0x10));
    expect([g.addressInfo(0)?.dirty, g.addressInfo(0)?.fading]).toEqual([true, true]);
    g.beginScan(0);
    expect([g.addressInfo(0)?.dirty, g.addressInfo(0)?.fading]).toEqual([false, undefined]);
  });
  it('needs presence, device types, every value and every scene', () => {
    const answered = no('The gear has not answered a scan.');
    let g = hw();
    g.beginScan(0);
    tell(g, c('QUERY_STATUS', A), reply(0));
    tell(g, c('QUERY_DEVICE_TYPE', A), reply(6));
    expect(g.modelAddress(0)).toEqual(answered);
    g = hw();
    g.beginScan(0);
    tell(g, c('QUERY_STATUS', A), reply(0));
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    expect(g.modelAddress(0)).toEqual(answered);
    g = hw();
    scanInto(g, 0);
    tell(g, c('SET_EXTENDED_FADE_TIME', A));
    g.beginScan(0);
    tell(g, c('QUERY_STATUS', A), reply(0));
    expect(g.modelAddress(0)).toEqual(no('A value the model needs was not read back.'));
    g = hw();
    scanInto(g, 0);
    tell(g, c('DTR0', undefined, 9));
    tell(g, c('SET_SCENE', A, 4));
    g.beginScan(0);
    tell(g, c('QUERY_STATUS', A), reply(0));
    expect(g.modelAddress(0)).toEqual(no('The scene levels were not read back.'));
    tell(g, c('DAPC', A, 5));
    expect(g.modelAddress(0)).toEqual(
      no('Something was sent to the gear during the scan. Scan it again.'),
    );
  });
  it('one unit per address, rebuilt on each scan, with what was read back', () => {
    const g = hw();
    scanInto(g, 0, { scenes: [10, 20, 30], curve: 1 });
    scanInto(g, 0, { scenes: [10, 20, 30], curve: 1 });
    expect(g.shadow.all.map((u) => u.id)).toEqual(['hw0']);
    scanInto(g, 1, { types: [8] });
    expect(g.shadow.all.map((u) => u.id)).toEqual(['hw0', 'hw1']);
    const s = g.shadow.unit('hw0')?.gear.snapshot();
    expect([s?.scenes.slice(0, 4), s?.linearCurve]).toEqual([[10, 20, 30, 255], true]);
    expect(g.shadow.unit('hw1')?.gear.snapshot().linearCurve).toBe(false);
    expect([g.addressInfo(0)?.lastActiveKnown, g.addressInfo(0)?.colourKnown]).toEqual([
      false,
      true,
    ]);
    expect(g.addressInfo(1)?.colourKnown).toBe(false);
  });
  it('the light type and colour presentation match the colour features read back', () => {
    for (const [byte, light, presentation] of [
      [0x02, 'C2', 'tc'],
      [0x40, 'C2', 'rgbwaf'],
      [0x62, 'C5', 'tc'],
      [0xa0, 'C5', 'rgbwaf'],
    ] as const) {
      const g = hw();
      scanInto(g, 1, { types: [8], colour: byte });
      const p = g.shadow.byShortAddress(1)?.gear.profile;
      expect([byte, p?.lightType, p?.presentation]).toEqual([byte, light, presentation]);
    }
    // DT6 gear is C1 whatever colour features it reported.
    const g = hw();
    tell(g, c('DT8_QUERY_COLOUR_TYPE_FEATURES', A), reply(0x02));
    scanInto(g, 0);
    expect(g.shadow.byShortAddress(0)?.gear.profile.lightType).toBe('C1');
  });
});

const no = (r: string) => ({ ok: false, reason: r });

describe('the rate guard on hardware', () => {
  it('only OFF goes out in the 2 s after a connect, and the hold ends when the first frame lands', () => {
    const g = hw(0);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255), 10);
    expect(g.judge(tx([c('DAPC', A, 0)]), 100).kind).not.toBe('refuse');
    expect(reason(g.judge(tx([c('OFF', A), c('DAPC', A, 100)]), 100))).toBe(
      'Rate guard: nothing is known about the lights just after connecting (bus).',
    );
    // Only a level of 0 is OFF: scene 0 is a light change like any other.
    tell(g, c('QUERY_MAX_LEVEL', A), reply(220), 10);
    tell(g, c('QUERY_MIN_LEVEL', A), reply(85), 10);
    expect(
      g.markVerified(0, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false }),
    ).toEqual({ ok: true });
    expect(reason(g.judge(tx([c('GO_TO_SCENE', A, 0)]), 100))).toMatch(/just after connecting/);
    // The first frame reaches the gear 0.5 ms after the hold ends.
    const now = 2000 - DEFAULT_TIMING.settleFirstMs - FORWARD_FRAME_MS + 0.5;
    expect(reason(g.judge(tx([c('DAPC', A, 100)]), now))).not.toMatch(/connecting/);
  });
  it('counts a fade as an instant step until fades are confirmed', () => {
    const g = hw();
    // Fade time 7 (5.7 s): faded, neither change is a hard step.
    scanInto(g, 0, { fade: 0x77 });
    g.markInventoryFresh(false);
    tell(g, c('DAPC', A, 200), undefined, 1000);
    const v = g.judge(tx([c('DAPC', A, 0)]), 2000);
    expect(reason(v)).toMatch(/hard step/);
    // A slow fade up, then a change back down 1.5 s later. Faded, neither is a hard step. As instant
    // steps, they are two hard steps in 2 s.
    const upAndBack = (target: 'hardware' | 'simulator') => {
      const h = new Governor({ target, shadow: new Simulator([]), connectedAt: -10_000 });
      scanInto(h, 0, { fade: 0x77, level: 100 });
      h.markInventoryFresh(false);
      tell(h, c('DAPC', A, 200), undefined, 1000);
      return reason(h.judge(tx([c('DAPC', A, 100)]), 2500));
    };
    expect(upAndBack('simulator')).toBe('');
    expect(upAndBack('hardware')).toMatch(/hard step/);
  });
  it('counts legs from both predictions', () => {
    const g = hw();
    scanInto(g, 0, { level: 150 });
    g.markInventoryFresh(false);
    tell(g, c('DAPC', A, 160), undefined, 1000);
    tell(g, c('DAPC', A, 150), undefined, 1300);
    expect(reason(g.judge(tx([c('DAPC', A, 160)]), 1580))).toMatch(/swing/);
    expect(reason(g.judge(tx([c('DAPC', A, 160)]), 3000))).toBe('');
  });
  it('a RESET to gear the shadow does not model can be judged', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    g.unlock('reset', 'ui', true);
    expect(() => g.judge(tx([c('RESET', A)], 'console'), 5000)).not.toThrow();
  });
});

describe('small changes and colour on hardware', () => {
  it('holds small reversals to three in a second', () => {
    const g = hw();
    scanInto(g, 0, { level: 100 });
    g.markInventoryFresh(false);
    // Arc 100 and 102 are 6% apart: not a leg and not a hard step, but each change turns back.
    [102, 100, 102, 100].forEach((v, k) => {
      tell(g, c('DAPC', A, v), undefined, 1000 + k * 150);
    });
    expect(reason(g.judge(tx([c('DAPC', A, 102)]), 1600))).toMatch(
      /more than three small reversals in a second/,
    );
  });
  it('reads an unknown colour as every channel full, with the facts the gear reported', () => {
    const g = hw();
    // Three RGBWAF channels and no Tc.
    expect(scanInto(g, 0, { types: [6, 8], colour: 0x60, level: 100 }).ok).toBe(true);
    g.markInventoryFresh(false);
    for (const cmd of rgbwafCommands(A, [30, 0, 0, 0, 0, 0])) tell(g, cmd, undefined, 1000);
    expect(g.addressInfo(0)?.colourKnown).toBe(true);
    // A dim known mix keeps DAPC 220 under the ceiling.
    expect(g.judge(tx([c('DAPC', A, 220)]), 6000).kind).toBe('allow');
    // A fault leaves the colour unknown. The shadow still holds the dim mix, but it no longer counts.
    tell(g, c('DAPC', A, 150), { kind: 'fault', reason: 'x' }, 7000);
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    const v = g.judge(tx([c('DAPC', A, 220)]), 12_000);
    expect(v.kind).toBe('clamp');
    expect(v.kind === 'clamp' ? v.tx.frames[0]?.frame.b : 0).toBe(maxArcForMix(220, 3));
  });
});

describe('RESET and the rate guard', () => {
  it('judges a RESET with the OFF that follows it, as legs', async () => {
    const b = makeBench();
    await b.ready();
    b.governor.unlock('reset', 'console', true);
    await b.run(tx([c('DAPC', A, 150)]));
    await b.clock.advance(3000);
    // With no other change, RESET and its OFF are one hard step and two legs.
    expect(reason(b.governor.judge(tx([c('RESET', A)], 'console'), b.clock.now()))).toBe('');
    // A leg down 0.4 s before: with the RESET's rise and its OFF, three in a second.
    await b.run(tx([c('DAPC', A, 130)]));
    await b.clock.advance(400);
    expect(reason(b.governor.judge(tx([c('RESET', A)], 'console'), b.clock.now()))).toMatch(
      /swing/,
    );
  });
  it('allows one RESET in 10 s, and says when the next may go', async () => {
    const b = makeBench();
    await b.ready();
    await b.clock.advance(3000);
    b.governor.unlock('reset', 'console', true);
    const sent = b.clock.now();
    await b.run(tx([c('RESET', A)], 'console'));
    await b.clock.advance(3000);
    const v = b.governor.judge(tx([c('RESET', A)], 'console'), b.clock.now());
    expect(reason(v)).toBe('Rate guard: one RESET in 10 s (bus).');
    expect(v.kind === 'refuse' ? v.retryAt : 0).toBeGreaterThanOrEqual(sent + 10_000);
  });
});
