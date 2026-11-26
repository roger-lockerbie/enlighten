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
  /** The QUERY STATUS reply: 0x10 says the gear is fading. */
  status?: number;
  /** The DT6 fast fade time. */
  fast?: number;
  /** The extended fade time. */
  ext?: number;
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
  r('QUERY_EXTENDED_FADE_TIME', gear.ext ?? 0);
  r('QUERY_ACTUAL_LEVEL', gear.level ?? 0);
  if (types.includes(6)) {
    r('DT6_QUERY_DIMMING_CURVE', gear.curve ?? 0);
    r('DT6_QUERY_FAST_FADE_TIME', gear.fast ?? 0);
  }
  if (types.includes(8)) r('DT8_QUERY_COLOUR_TYPE_FEATURES', gear.colour ?? 0x02);
  for (let k = 0; k < 16; k++) r('QUERY_SCENE_LEVEL', gear.scenes?.[k] ?? 255, k);
  r('QUERY_STATUS', gear.status ?? 0);
  return g.modelAddress(n);
}

interface Ev {
  t: number;
  scope: string;
  until?: number;
}
interface Inner {
  unknownEvents(cmd: Command, at: number): Ev[];
  extraEvents(planned: readonly unknown[]): Ev[];
  plan(t: Transaction, now: number): { deliverAt: number }[];
  fitCeiling(
    t: Transaction,
    now: number,
  ): { ok: true; tx: Transaction } | { ok: false; reason: string };
}
const inner = (g: Governor) => g as unknown as Inner;
/** Whether an ACTIVATE has reached the address for sure, with no temporary colour loaded since. */
const clearIn = (g: Governor, n = 0) =>
  (g as unknown as { tempClear: Map<number, boolean> }).tempClear.get(n) === true;
const fp = (g: Governor) =>
  JSON.parse(g.fingerprint()) as {
    synthetic: Ev[];
    deafUntil: number;
    unaddressedPresent: boolean;
    resetOff: { targets: number[]; until: number } | null;
    dtr: (number | null)[];
  };

describe('events for gear in an unknown state', () => {
  // On hardware every light change is an event for each address it reaches and for the room,
  // whatever a scan read (ADR 0019 amendment 2).
  const A0_ROOM = [
    { t: 5, scope: 'a0' },
    { t: 5, scope: ROOM },
  ];
  it('one for an address the governor has heard nothing from', () => {
    expect(inner(hw()).unknownEvents(c('DAPC', short(5), 100), 5)).toEqual([
      { t: 5, scope: 'a5' },
      { t: 5, scope: ROOM },
    ]);
  });
  it('none in the Simulator target', () => {
    expect(inner(sim()).unknownEvents(c('DAPC', broadcast, 1), 5)).toEqual([]);
  });
  it('none for commands that do not change light, and one for every command that does, scanned or not', () => {
    const g = hw();
    expect(scanInto(g, 0).ok).toBe(true);
    g.markInventoryFresh(false);
    const ev = (cmd: Command) => inner(g).unknownEvents(cmd, 5);
    expect(ev(c('QUERY_ACTUAL_LEVEL', A))).toEqual([]);
    expect(ev(c('DTR0', undefined, 3))).toEqual([]);
    for (const cmd of [
      c('DAPC', A, 100),
      c('DAPC', broadcast, 100),
      c('GO_TO_SCENE', A, 3),
      c('GO_TO_LAST_ACTIVE_LEVEL', A),
      c('OFF', A),
    ])
      expect(ev(cmd), cmd.id).toEqual(A0_ROOM);
    // A group the gear is not in reaches nothing.
    expect(ev(c('DAPC', group(2), 100))).toEqual([]);
  });
  it('a phantom driver for gear without a short address, and for groups while the inventory is in doubt', () => {
    const g = hw();
    scanInto(g, 0);
    const ev = (cmd: Command) => inner(g).unknownEvents(cmd, 5);
    const phantom = { t: 5, scope: PHANTOM };
    const room = { t: 5, scope: ROOM };
    // A new connection starts with a stale inventory.
    expect(ev(c('DAPC', group(2), 100))).toEqual([phantom, room]);
    expect(ev(c('DAPC', A, 100))).toEqual(A0_ROOM);
    g.markInventoryFresh(false);
    expect(ev(c('DAPC', unaddressed, 100))).toEqual([phantom, room]);
    expect(ev(c('DAPC', group(2), 100))).toEqual([]);
    g.markInventoryFresh(true);
    expect(ev(c('DAPC', broadcast, 100))).toEqual([phantom, ...A0_ROOM]);
    expect(ev(c('DAPC', A, 100))).toEqual(A0_ROOM);
  });
  it('a scene recall on DT8 gear, whose scene colours a scan does not read', () => {
    const g = hw();
    scanInto(g, 1, { types: [8], colour: 0x02 });
    for (const cmd of tcCommands(B, 250)) tell(g, cmd);
    // A colour the session set is still not known on hardware (ADR 0019 amendment 1), so the recall
    // and a plain level are each an event, for the gear and for the room.
    expect(g.addressInfo(1)?.colourKnown).toBe(false);
    for (const cmd of [c('GO_TO_SCENE', B, 3), c('DAPC', B, 100)])
      expect(inner(g).unknownEvents(cmd, 5)).toEqual([
        { t: 5, scope: 'a1' },
        { t: 5, scope: ROOM },
      ]);
  });
  it('one event for each command that was unknown, so several in one transaction count apart (S8b-H1)', () => {
    const g = hw();
    scanInto(g, 0);
    g.markInventoryFresh(false);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A));
    expect(g.addressInfo(0)?.levelKnown).toBe(false);
    const events = (cmds: Command[]) => {
      const planned = inner(g).plan(tx(cmds), 1000);
      return { at: planned.map((p) => p.deliverAt), ev: inner(g).extraEvents(planned) };
    };
    // A level that becomes known in the transaction was reached from one the shadow did not have,
    // so what follows it is unknown too (ADR 0019 amendment 1, rule 5).
    let r = events([c('DAPC', A, 255), c('DAPC', A, 100), c('DAPC', A, 120)]);
    expect(r.ev.map((e) => [e.t, e.scope])).toEqual([
      [r.at[0], 'a0'],
      [r.at[0], ROOM],
      [r.at[1], 'a0'],
      [r.at[1], ROOM],
      [r.at[2], 'a0'],
      [r.at[2], ROOM],
    ]);
    r = events([c('OFF', A), c('DAPC', A, 100)]);
    expect(r.ev.map((e) => [e.t, e.scope])).toEqual([
      [r.at[0], 'a0'],
      [r.at[0], ROOM],
      [r.at[1], 'a0'],
      [r.at[1], ROOM],
    ]);
    // A recall inside the transaction makes the level unknown again for what follows.
    r = events([c('DAPC', A, 100), c('GO_TO_LAST_ACTIVE_LEVEL', A), c('DAPC', A, 120)]);
    expect(r.ev.filter((e) => e.scope === 'a0').map((e) => e.t)).toEqual(r.at);
    // A relative command leaves the level unknown.
    r = events([c('UP', A), c('DOWN', A)]);
    expect(r.ev.filter((e) => e.scope === 'a0').map((e) => e.t)).toEqual(r.at);
    // The second copy of a frame sent twice is the same change.
    const twice = inner(g).plan(tx([c('RESET', A)]), 1000);
    expect(
      inner(g)
        .extraEvents(twice)
        .filter((e) => e.scope === 'a0'),
    ).toHaveLength(1);
  });

  it('a transaction that flashes unmodelled gear is refused (S8b-H1)', () => {
    // The gear answered and was never modelled. One transaction of levels up and down counted as
    // one leg and one hard step, and went.
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(5)), reply(255), 10);
    tell(g, c('QUERY_DEVICE_TYPE', short(5)), reply(6), 10);
    const flash = [200, 0, 200, 0, 200].map((v) => c('DAPC', short(5), v));
    expect(reason(g.judge(tx(flash), 5000))).toMatch(/hard step|swing/);
    expect(g.judge(tx([c('DAPC', short(5), 200)]), 5000).kind).not.toBe('refuse');
    // Unaddressed gear the same.
    const all = [254, 0, 254, 0].map((v) => c('DAPC', unaddressed, v));
    expect(g.judge(tx(all), 5000).kind).toBe('refuse');
  });
});

describe('what observe remembers', () => {
  it('extra events, one for each command, kept for the history window', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('DAPC', A, 100), undefined, 1000, 1);
    tell(g, c('DAPC', A, 120), undefined, 1030, 1);
    expect(fp(g).synthetic).toMatchObject([
      { t: 1000, scope: 'a0', until: 1000, tx: 1 },
      { t: 1000, scope: ROOM, until: 1000, tx: 1 },
      { t: 1030, scope: 'a0', until: 1030, tx: 1 },
      { t: 1030, scope: ROOM, until: 1030, tx: 1 },
    ]);
    tell(g, c('DAPC', A, 130), undefined, 1060, 2);
    tell(g, c('DAPC', A, 140), undefined, 1090);
    tell(g, c('DAPC', A, 150), undefined, 1100);
    expect(fp(g).synthetic.map((e) => [e.t, e.scope])).toEqual([
      [1000, 'a0'],
      [1000, ROOM],
      [1030, 'a0'],
      [1030, ROOM],
      [1060, 'a0'],
      [1060, ROOM],
      [1090, 'a0'],
      [1090, ROOM],
      [1100, 'a0'],
      [1100, ROOM],
    ]);
    // The gear's fade time was never read, so its hard step may come for as long as DALI's longest
    // fade and the margin (ADR 0019). Events are kept until 7 s after that: the 6 s the guard looks
    // back and a second more.
    const until = 1000 + 16 * 60_000 + 100;
    expect(fp(g).synthetic[0]).toMatchObject({ t: 1000, hardUntil: until });
    tell(g, c('QUERY_STATUS', A), reply(0), until + 7000);
    expect(fp(g).synthetic[0]?.t).toBe(1000);
    tell(g, c('QUERY_STATUS', A), reply(0), until + 7001);
    expect(fp(g).synthetic[0]?.t).toBe(1030);
  });
  it('an event for every light change, to gear a scan modelled too (ADR 0019 amendment 2)', () => {
    const g = hw();
    scanInto(g, 0);
    tell(g, c('DAPC', A, 100), undefined, 1000);
    tell(g, c('QUERY_ACTUAL_LEVEL', A), reply(100), 1500);
    tell(g, c('DAPC', A, 120), undefined, 3000);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A), undefined, 5000);
    expect(fp(g).synthetic.map((e) => [e.t, e.scope])).toEqual([
      [1000, 'a0'],
      [1000, ROOM],
      [3000, 'a0'],
      [3000, ROOM],
      [5000, 'a0'],
      [5000, ROOM],
    ]);
    // The simulator target has none: there the shadow is the gear.
    const s = sim();
    tell(s, c('DAPC', A, 100), undefined, 1000);
    expect(fp(s).synthetic).toEqual([]);
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
    // The gear is deaf until 1350, so an OFF before then leaves it at full: the follow-up stays due.
    tell(g, c('OFF', A), undefined, 1120);
    expect(fp(g).resetOff?.targets).toEqual([0, 1]);
    tell(g, c('OFF', A), undefined, 1350);
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
  it('nothing waits in the gear once an ACTIVATE arrived, until a colour is loaded again', () => {
    const run = (parts: readonly ('tc' | 'rgb' | 'waf' | 'act' | 'fault' | 'reset')[]) => {
      const g = hw();
      tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255));
      for (const p of parts) {
        if (p === 'tc') tell(g, c('DT8_SET_TEMPORARY_TC', B));
        if (p === 'rgb') tell(g, c('DT8_SET_TEMPORARY_RGB', B));
        if (p === 'waf') tell(g, c('DT8_SET_TEMPORARY_WAF', B));
        if (p === 'act') tell(g, c('DT8_ACTIVATE', B));
        if (p === 'fault') tell(g, c('DT8_ACTIVATE', B), { kind: 'fault', reason: 'x' });
        if (p === 'reset') tell(g, c('RESET', B), undefined, 5000);
      }
      // The colour itself is never known on hardware (ADR 0019 amendment 1).
      expect(g.addressInfo(1)?.colourKnown).not.toBe(true);
      return clearIn(g, 1);
    };
    expect(run([])).toBe(false);
    expect(run(['act'])).toBe(true);
    expect(run(['tc', 'act'])).toBe(true);
    expect(run(['rgb', 'act'])).toBe(true);
    for (const load of ['tc', 'rgb', 'waf'] as const) {
      expect(run([load]), load).toBe(false);
      expect(run(['act', load]), load).toBe(false);
    }
    expect(run(['tc', 'fault'])).toBe(false);
    expect(run(['act', 'fault'])).toBe(false);
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
  it('a reply that does not come leaves nothing read, but the fading bit (Stage 11 review N1)', () => {
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
    // An older answer may be other gear's, so a lost reply does not leave it standing.
    expect([i?.extendedFade, i?.fading, i?.groups]).toEqual([undefined, true, undefined]);
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
    // A new scan starts from nothing read (Stage 11 review N1).
    expect(g.modelAddress(0)).toEqual(no('A value the model needs was not read back.'));
    // One scene level whose reply was lost.
    g = hw();
    scanInto(g, 0);
    tell(g, c('QUERY_SCENE_LEVEL', A, 4), NONE);
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
    expect(g.judge(tx([c('OFF', A)]), 100).kind).not.toBe('refuse');
    // Gear that answered and whose device types were not read may be colour gear, so it takes no
    // level, not even 0 (S8b-M2). Nor does an address nothing was heard from.
    expect(reason(g.judge(tx([c('DAPC', A, 0)]), 100))).toMatch(/scan it before its level/);
    expect(reason(g.judge(tx([c('DAPC', B, 0)]), 100))).toMatch(/scan it before its level/);
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
  it('a hold set by the engine names its reason and says when to ask again', () => {
    const g = sim();
    const dapc = tx([c('DAPC', A, 100)]);
    // The first frame of a transaction judged at 1000 reaches the gear at this time.
    const first = 1000 + DEFAULT_TIMING.settleFirstMs + FORWARD_FRAME_MS;
    expect(g.judge(dapc, 1000).kind).toBe('allow');
    // No retry time: ask again at the hold's end.
    g.holdLightChanges(5000, 'the bench is being rebuilt');
    expect(g.judge(dapc, 1000)).toEqual({
      kind: 'refuse',
      reason: 'Rate guard: the bench is being rebuilt (bus).',
      retryAt: 5000,
    });
    // An open-ended hold asks waiting work to try again soon (S5-D13), even though judging that far
    // ahead finds the hold still there.
    g.holdLightChanges(60_000, 'rebuilding', 250);
    expect(g.judge(dapc, 1000)).toEqual({
      kind: 'refuse',
      reason: 'Rate guard: rebuilding (bus).',
      retryAt: Math.ceil(first + 250),
    });
    // A hold that ends sooner than that gives its end.
    g.holdLightChanges(1100, 'rebuilding', 250);
    expect(g.judge(dapc, 1000)).toMatchObject({ kind: 'refuse', retryAt: 1100 });
    // OFF still goes.
    expect(g.judge(tx([c('OFF', A)]), 1000).kind).toBe('allow');
    // The hold ends when the first frame lands on its end.
    g.holdLightChanges(first, 'rebuilding', 250);
    expect(g.judge(dapc, 1000).kind).toBe('allow');
  });
  it('after a hold with a retry time has ended, a rate guard refusal gives a time that passes', () => {
    const g = hw();
    scanInto(g, 0, { level: 150 });
    g.markInventoryFresh(false);
    g.holdLightChanges(500, 'rebuilding', 250);
    tell(g, c('DAPC', A, 160), undefined, 1000);
    tell(g, c('DAPC', A, 150), undefined, 1300);
    const v = g.judge(tx([c('DAPC', A, 160)]), 1580);
    expect(reason(v)).toMatch(/swing/);
    const retry = v.kind === 'refuse' ? v.retryAt : undefined;
    expect(retry).toBeDefined();
    expect(g.judge(tx([c('DAPC', A, 160)]), retry ?? 0).kind).toBe('allow');
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
    // Each change is a hard step on hardware, so the next waits 2 s after the last may have ended.
    expect(reason(g.judge(tx([c('DAPC', A, 160)]), 3000))).toMatch(/hard step in 2 s/);
    expect(reason(g.judge(tx([c('DAPC', A, 160)]), 3700))).toBe('');
  });
  it('a RESET to gear the shadow does not model can be judged', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    g.unlock('reset', 'ui', true);
    expect(() => g.judge(tx([c('RESET', A)], 'console'), 5000)).not.toThrow();
  });
});

describe('small changes and colour on hardware', () => {
  it('counts each small change as a swing, so small reversals never reach three in a second', () => {
    const g = hw();
    scanInto(g, 0, { level: 100 });
    g.markInventoryFresh(false);
    // Arc 100 and 102 are 6% apart: not a leg and not a hard step, but each change turns back.
    [102, 100, 102, 100].forEach((v, k) => {
      tell(g, c('DAPC', A, v), undefined, 1000 + k * 150);
    });
    expect(reason(g.judge(tx([c('DAPC', A, 102)]), 1600))).toMatch(
      /more than 1 swing\(s\) in a second/,
    );
    // The second of them is refused already.
    const h = hw();
    scanInto(h, 0, { level: 100 });
    h.markInventoryFresh(false);
    tell(h, c('DAPC', A, 102), undefined, 1000);
    expect(h.judge(tx([c('DAPC', A, 100)]), 1150).kind).toBe('refuse');
  });
  it('reads an unknown colour as every channel full, with the facts the gear reported', () => {
    const g = hw();
    // Three RGBWAF channels and no Tc.
    expect(scanInto(g, 0, { types: [6, 8], colour: 0x60, level: 100 }).ok).toBe(true);
    g.markInventoryFresh(false);
    for (const cmd of rgbwafCommands(A, [30, 0, 0, 0, 0, 0])) tell(g, cmd, undefined, 1000);
    // A colour the session set is not known on hardware (ADR 0019 amendment 1). The shadow holds the
    // dim mix, but it does not count.
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    tell(g, c('DAPC', A, 150), { kind: 'fault', reason: 'x' }, 7000);
    // The level is fitted to the ceiling as if every channel were full. The rate guard then refuses
    // it, since a fault may have left a colour waiting.
    const fitted = inner(g).fitCeiling(tx([c('DAPC', A, 220)]), 12_000);
    expect(fitted.ok ? fitted.tx.frames[0]?.frame.b : 0).toBe(maxArcForMix(220, 3));
    expect(reason(g.judge(tx([c('DAPC', A, 220)]), 12_000))).toMatch(
      /set its colour before its level/,
    );
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
    // With a register write in the same transaction too.
    const mixed = tx([c('DTR0', undefined, 1), c('RESET', A)], 'console');
    expect(reason(b.governor.judge(mixed, b.clock.now()))).toBe(
      'Rate guard: one RESET in 10 s (bus).',
    );
  });
});

describe('gear in an unknown state moving with other gear (ADR 0016)', () => {
  // Fade time 7 is 5.657 s, so gear seen fading at 100 may move until 5,857 (with the 100 ms margin).
  const fadingUntil = 100 + 5657 + 100;
  /** A0 modelled and settled, A1 seen fading during its scan, so not modelled. Both fade in 5.657 s. */
  function bench(): Governor {
    const g = hw();
    expect(scanInto(g, 0, { fade: 0x77 }).ok).toBe(true);
    expect(scanInto(g, 1, { fade: 0x77, status: 0x10 })).toEqual(
      no('The gear was fading during the scan. Scan it again when it settles.'),
    );
    g.markInventoryFresh(false);
    return g;
  }
  const mixed = /A[01] is in a state the guard does not know, so it changes only on its own/;
  const waits = /A1 may still be fading in a state the guard does not know/;
  const oneAddress =
    /^Rate guard: On hardware a light change goes to one short address at a time, and only OFF goes to a group or to all \(room\)\.$/;

  it('refuses every light change to a group or to all but OFF, whatever the scan found (S8b-R4-D2)', () => {
    // A driver that was not powered during the scan is in no inventory, and a group or broadcast
    // would reach it with nothing counted.
    const g = hw();
    expect(scanInto(g, 0, { groups: 1 }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(
      g.markVerified(0, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false }).ok,
    ).toBe(true);
    for (const cmd of [
      c('DAPC', broadcast, 140),
      c('DAPC', group(0), 140),
      c('DAPC', group(5), 140),
      c('RECALL_MIN_LEVEL', broadcast),
      c('GO_TO_SCENE', group(0), 2),
      c('UP', broadcast),
    ]) {
      const v = g.judge(tx([cmd]), 20_000);
      expect(reason(v), cmd.id).toMatch(oneAddress);
      expect(v, cmd.id).not.toHaveProperty('retryAt');
    }
    expect(g.judge(tx([c('OFF', broadcast)]), 20_000).kind).toBe('allow');
    expect(g.judge(tx([c('OFF', group(5))]), 20_000).kind).toBe('allow');
    expect(g.judge(tx([c('DAPC', A, 140)]), 20_000).kind).toBe('allow');
    // The simulator target has no such rule.
    expect(sim().judge(tx([c('DAPC', broadcast, 140)]), 20_000).kind).toBe('allow');
  });

  it('refuses a broadcast that moves unknown gear with other gear, until a scan', () => {
    const g = bench();
    const v = g.judge(tx([c('DAPC', broadcast, 140)]), 20_000);
    expect(reason(v)).toMatch(oneAddress);
    expect(v).not.toHaveProperty('retryAt');
    // Two commands in one transaction are two hard steps as well, so refused either way.
    expect(reason(g.judge(tx([c('DAPC', A, 140), c('DAPC', B, 140)]), 20_000))).toMatch(mixed);
  });

  it('lets unknown gear change on its own while nothing else moves', () => {
    const g = bench();
    expect(g.judge(tx([c('DAPC', B, 140)]), 20_000).kind).toBe('allow');
    // Not while modelled gear is still fading. A's step on from off is a hard step, so judge 1.5 s on.
    tell(g, c('DAPC', A, 200), { kind: 'sent' }, 20_000);
    expect(reason(g.judge(tx([c('DAPC', B, 140)]), 21_500))).toMatch(/A0 may still be fading/);
    // A0 may move until 25,757, and the room's next hard step waits 1 s more.
    expect(reason(g.judge(tx([c('DAPC', B, 140)]), 26_000))).toMatch(/hard step in 1 s/);
    expect(g.judge(tx([c('DAPC', B, 140)]), 27_000).kind).toBe('allow');
  });

  it('holds other gear while unknown gear may still be fading, and says when to ask again', () => {
    const g = bench();
    const v = g.judge(tx([c('DAPC', A, 140)]), 1000);
    expect(reason(v)).toMatch(waits);
    expect(v).toMatchObject({ retryAt: fadingUntil });
    expect(g.judge(tx([c('DAPC', A, 140)]), fadingUntil).kind).toBe('allow');
  });

  it('counts a light change sent to unknown gear as moving for its longest fade', () => {
    const g = bench();
    tell(g, c('DAPC', B, 140), { kind: 'sent' }, 30_000);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 31_500))).toMatch(waits);
    // Its hard step may come as late as the end of that fade, so the room's next one waits a second
    // more (ADR 0019, S6-P16).
    const stopped = 30_000 + 5657 + 100;
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), stopped + 10))).toMatch(/hard step in 1 s/);
    expect(g.judge(tx([c('DAPC', A, 140)]), stopped + 1040 + 10).kind).toBe('allow');
  });

  it('takes the longest fade DALI allows once a fade setting goes to unknown gear', () => {
    const g = bench();
    tell(g, c('DTR0', undefined, 15), { kind: 'sent' }, 30_000);
    tell(g, c('SET_FADE_TIME', B), { kind: 'sent' }, 30_000);
    tell(g, c('DAPC', B, 140), { kind: 'sent' }, 30_010);
    // 16 minutes, the longest extended fade, so a refusal still has a time to ask again (S6-S16-1).
    const v = g.judge(tx([c('DAPC', A, 140)]), 100_000);
    expect(reason(v)).toMatch(waits);
    // When the gear may have stopped, and the room's second for the hard step it may make by then.
    expect(v).toMatchObject({ retryAt: 30_010 + 16 * 60_000 + 100 + 1040 });
    // A scan clears it sooner.
    expect(scanInto(g, 1, { fade: 0xf7 }, 100_000).ok).toBe(true);
    // The gear's hard step came by the scan at the latest, so the room's next one waits a second
    // from there (ADR 0019).
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 100_100))).toMatch(/hard step in 1 s/);
    expect(g.judge(tx([c('DAPC', A, 140)]), 101_500).kind).toBe('allow');
  });

  it('never marks an address a scan found empty, and a scan that finds it empty clears it', () => {
    const g = bench();
    const empty = (n: number, at: number) => {
      g.beginScan(n);
      tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(n)), NONE, at);
      // The scan says so once its last try went unanswered.
      g.markEmpty(n);
    };
    empty(40, 20_000);
    tell(g, c('DAPC', short(40), 100), { kind: 'sent' }, 20_100);
    expect(g.judge(tx([c('DAPC', A, 140)]), 21_500).kind).toBe('allow');
    // An address never scanned may hold gear, so it is marked, until a scan finds nothing there.
    tell(g, c('DAPC', short(63), 100), { kind: 'sent' }, 30_000);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 31_500))).toMatch(/A63 may still be fading/);
    // One lost reply ends nothing: the scan asks again (S8b-R3-6).
    g.beginScan(63);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(63)), NONE, 31_550);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 31_560))).toMatch(/A63 may still be fading/);
    // Lost replies can make gear look absent, so its hard step may have come as late as the scan,
    // and the room's next one waits a second from there (S8b-L3).
    empty(63, 31_600);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 31_700))).toMatch(/hard step in 1 s/);
    expect(g.judge(tx([c('DAPC', A, 140)]), 32_700).kind).toBe('allow');
  });

  it('lets OFF through while unknown gear moves, and OFF stops the gear it reaches', () => {
    const g = bench();
    // A1 may be fading until 5,857, but an OFF crosses nothing.
    expect(g.judge(tx([c('OFF', A)]), 1000).kind).toBe('allow');
    expect(g.judge(tx([c('OFF', broadcast)]), 1000).kind).toBe('allow');
    // Without an OFF, A0 waits for A1 until 5,857. An OFF to A1 ends its fade, and A0 can go once the
    // room's one hard step a second allows.
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 2100))).toMatch(waits);
    tell(g, c('OFF', B), { kind: 'sent' }, 1000);
    expect(g.judge(tx([c('DAPC', A, 140)]), 2100).kind).toBe('allow');
  });

  it('a broadcast OFF, as panic sends, ends every mark', () => {
    const g = bench();
    tell(g, c('DAPC', short(63), 100), { kind: 'sent' }, 900);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 2100))).toMatch(waits);
    tell(g, c('OFF', broadcast), { kind: 'sent' }, 1000);
    // The OFF reached A0 too, and was a hard step there (ADR 0019 amendment 2).
    const v = g.judge(tx([c('DAPC', A, 140)]), 2100);
    expect(reason(v)).toBe('Rate guard: more than one hard step in 2 s (a0).');
    expect(v).toMatchObject({ retryAt: 3040 });
    expect(g.judge(tx([c('DAPC', A, 140)]), 3100).kind).toBe('allow');
  });

  it('a fault on a light change to modelled gear marks it as moving for its longest fade', () => {
    const g = hw();
    expect(scanInto(g, 0, { fade: 0x77 }).ok).toBe(true);
    expect(scanInto(g, 1, { fade: 0x77 }).ok).toBe(true);
    g.markInventoryFresh(false);
    tell(g, c('DAPC', A, 200), { kind: 'fault', reason: 'x' }, 20_000);
    const v = g.judge(tx([c('DAPC', B, 120)]), 21_500);
    expect(reason(v)).toMatch(/A0 may still be fading/);
    // Until A0 may have stopped, and the room's second after that.
    expect(v).toMatchObject({ retryAt: 20_000 + 5657 + 100 + 1040 });
  });

  it('a scan that models the gear clears it', () => {
    const g = bench();
    expect(scanInto(g, 1, { fade: 0x77 }, 200).ok).toBe(true);
    expect(g.judge(tx([c('DAPC', A, 140)]), 1000).kind).toBe('allow');
    // A broadcast still reaches two addresses, and on hardware one changes at a time.
    expect(reason(g.judge(tx([c('DAPC', broadcast, 140)]), 1000))).toMatch(oneAddress);
  });

  it('counts CONTINUOUS UP and DOWN at the fade rate (S6-D16-2)', () => {
    // A1 has fade time 0 and fade rate 15, which runs the whole range in 90.5 s.
    const at = (cmd: string) => {
      const g = hw();
      expect(scanInto(g, 0, { fade: 0x77 }).ok).toBe(true);
      scanInto(g, 1, { fade: 0x0f, status: 0x10 });
      g.markInventoryFresh(false);
      tell(g, c(cmd, B, cmd === 'DAPC' ? 140 : undefined), { kind: 'sent' }, 200_000);
      return g.judge(tx([c('DAPC', A, 140)]), 201_500);
    };
    expect(at('DAPC').kind).toBe('allow');
    const v = at('CONTINUOUS_DOWN');
    expect(reason(v)).toMatch(waits);
    expect(v.kind === 'refuse' ? (v.retryAt ?? 0) : 0).toBeGreaterThan(200_000 + 90_000);
  });

  it('a fade setting sent during a rescan leaves no stale fade time (S6-D16-4)', () => {
    const g = hw();
    expect(scanInto(g, 0, { fade: 0x77 }).ok).toBe(true);
    expect(scanInto(g, 1).ok).toBe(true);
    g.markInventoryFresh(false);
    // A rescan of A1 that a fast fade setting interrupts leaves it unmodelled.
    g.beginScan(1);
    tell(g, c('DTR0', undefined, 27), { kind: 'sent' }, 150_000);
    tell(g, c('DT6_STORE_DTR_AS_FAST_FADE_TIME', B), { kind: 'sent' }, 150_000);
    expect(g.modelAddress(1).ok).toBe(false);
    tell(g, c('DAPC', B, 140), { kind: 'sent' }, 200_000);
    const v = g.judge(tx([c('DAPC', A, 140)]), 201_500);
    expect(reason(v)).toMatch(waits);
    expect(v.kind === 'refuse' ? (v.retryAt ?? 0) : 0).toBeGreaterThan(200_000 + 15 * 60_000);
  });

  it('treats gear the inventory has not found as gear in an unknown state (S6-D16-3)', () => {
    const g = hw();
    expect(scanInto(g, 0, { fade: 0x77 }).ok).toBe(true);
    expect(scanInto(g, 1, { fade: 0x77 }).ok).toBe(true);
    g.markInventoryFresh(true);
    const unfound = /Gear the inventory has not found/;
    // A broadcast moves the unaddressed gear with A0 and A1.
    expect(reason(g.judge(tx([c('DAPC', broadcast, 140)]), 20_000))).toMatch(unfound);
    expect(g.judge(tx([c('DAPC', A, 140)]), 20_000).kind).toBe('allow');
    // No level goes to unaddressed gear: it may be colour gear (ADR 0019). A change to it that is
    // not a level goes alone, and other gear then waits for it or a fresh inventory.
    expect(reason(g.judge(tx([c('DAPC', unaddressed, 140)]), 20_000))).toMatch(
      /may be colour gear, so it takes no level/,
    );
    expect(g.judge(tx([c('OFF', unaddressed)]), 20_000).kind).toBe('allow');
    tell(g, c('DAPC', unaddressed, 140), { kind: 'sent' }, 20_000);
    expect(reason(g.judge(tx([c('DAPC', A, 140)]), 21_500))).toMatch(
      /Gear the inventory has not found may still be fading/,
    );
    g.markInventoryFresh(false);
    expect(g.judge(tx([c('DAPC', A, 140)]), 21_500).kind).toBe('allow');
  });

  it('applies only to hardware', () => {
    const g = sim();
    expect(g.judge(tx([c('DAPC', broadcast, 140)]), 1000).kind).toBe('allow');
  });
});

describe('DT8 gear whose colour is not known (ADR 0019, S5-P1)', () => {
  const rgb = { types: [6, 8], colour: 0x60, level: 100, groups: 1 };
  const needsColour =
    /A0 may hold a colour that is not activated, so set its colour before its level/;
  /** A0 scanned as lit RGB gear, with no fade time: a colour changes only in one moment. */
  const bench = (fade = 0x07) => {
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, fade }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(verify(g).ok).toBe(true);
    return g;
  };
  const verify = (g: Governor) =>
    g.markVerified(0, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false });
  const red = rgbwafCommands(A, [254, 0, 0, 0, 0, 0]);

  it('refuses every level command, by short address, group or broadcast, with no time to ask again', () => {
    const g = bench();
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    for (const a of [A, group(0), broadcast]) {
      const v = g.judge(tx([c('DAPC', a, 110)]), 5000);
      expect(reason(v)).toMatch(needsColour);
      expect(v).not.toHaveProperty('retryAt');
    }
    for (const id of ['DOWN', 'STEP_DOWN', 'RECALL_MIN_LEVEL', 'STEP_DOWN_AND_OFF'])
      expect(reason(g.judge(tx([c(id, A)]), 5000))).toMatch(needsColour);
    expect(reason(g.judge(tx([c('GO_TO_SCENE', A, 2)]), 5000))).toMatch(needsColour);
    // DAPC 255 changes no level, and still brings a pending colour in.
    expect(reason(g.judge(tx([c('DAPC', A, 255)]), 5000))).toMatch(needsColour);
  });

  it('lets OFF go', () => {
    expect(bench().judge(tx([c('OFF', A)]), 5000).kind).toBe('allow');
  });

  it('takes a whole colour with ACTIVATE while the level is steady, and the level once that colour has faded in', () => {
    const g = bench();
    expect(g.judge(tx(red), 5000).kind).toBe('allow');
    // A colour and a level in one transaction would fade together.
    const both = g.judge(tx([...red, c('DAPC', A, 110)]), 5000);
    expect(reason(both)).toMatch(/A0's colour may still be fading/);
    expect(both).not.toHaveProperty('retryAt');
    red.forEach((cmd, k) => {
      tell(g, cmd, undefined, 5000 + k * 30);
    });
    const activated = 5000 + (red.length - 1) * 30;
    // Nothing waits in the gear now. Its colour is still not known (ADR 0019 amendment 1).
    expect(clearIn(g)).toBe(true);
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    // The level waits until the gear may have stopped after the ACTIVATE: 200 ms and the margin.
    const settled = activated + 200 + 100;
    const early = g.judge(tx([c('DAPC', A, 110)]), activated + 100);
    expect(reason(early)).toMatch(/A0's colour may still be fading \(a0\)/);
    expect(early.kind === 'refuse' ? early.retryAt : 0).toBeGreaterThanOrEqual(settled);
    // The colour change was a hard step that could come until then, so the level waits 2 s more.
    const soon = g.judge(tx([c('DAPC', A, 110)]), settled + 10);
    expect(reason(soon)).toBe('Rate guard: more than one hard step in 2 s (a0).');
    expect(soon.kind === 'refuse' ? soon.retryAt : 0).toBeGreaterThanOrEqual(settled + 2000);
    expect(g.judge(tx([c('DAPC', A, 110)]), settled + 2100).kind).toBe('allow');
  });

  it('any ACTIVATE that arrives leaves nothing waiting, and a colour loaded after it waits again', () => {
    const g = bench();
    for (const cmd of red.slice(0, 4)) tell(g, cmd, undefined, 5000);
    expect(clearIn(g)).toBe(false);
    tell(g, c('DT8_ACTIVATE', A), undefined, 5200);
    expect(clearIn(g)).toBe(true);
    expect(g.judge(tx([c('DAPC', A, 110)]), 9000).kind).toBe('allow');
    for (const cmd of red.slice(0, 4)) tell(g, cmd, undefined, 9000);
    expect(clearIn(g)).toBe(false);
    expect(reason(g.judge(tx([c('DAPC', A, 110)]), 12_000))).toMatch(needsColour);
    // An ACTIVATE that faulted may not have arrived.
    tell(g, c('DT8_ACTIVATE', A), { kind: 'fault', reason: 'x' }, 12_000);
    expect(clearIn(g)).toBe(false);
  });

  it('refuses the colour while the level may be moving, and after a level in the same transaction', () => {
    const g = bench();
    // The colour is loaded, then an OFF goes out. The gear may take the margin to stop after it.
    for (const cmd of red.slice(0, -1)) tell(g, cmd, undefined, 8000);
    tell(g, c('OFF', A), { kind: 'sent' }, 9000);
    const steady = /A0's colour is not known, so it is set only while its level is steady/;
    const act = tx([c('DT8_ACTIVATE', A)]);
    const during = g.judge(act, 9010);
    expect(reason(during)).toMatch(steady);
    expect(during.kind === 'refuse' ? during.retryAt : 0).toBeGreaterThanOrEqual(9100);
    expect(g.judge(act, 9000 + 100 + 2100).kind).toBe('allow');
    // A scene recall moves the level and makes the colour unknown, so a colour straight after it in
    // one transaction is refused, with no time to ask again. The gear has no fade, so the recall goes.
    const h = hw();
    expect(scanInto(h, 0, { ...rgb, fade: 0x07, scenes: [0, 0, 90] }).ok).toBe(true);
    h.markInventoryFresh(false);
    expect(verify(h).ok).toBe(true);
    red.forEach((cmd, k) => {
      tell(h, cmd, undefined, 20_000 + k * 30);
    });
    expect(clearIn(h)).toBe(true);
    const scene = h.judge(tx([c('GO_TO_SCENE', A, 2), ...red]), 30_000);
    expect(reason(scene)).toBe(
      "Rate guard: A0's colour is not known, so it is set only while its level is steady (a0).",
    );
    expect(scene).not.toHaveProperty('retryAt');
  });

  it('after a rescan a colour may be waiting again', () => {
    const g = bench();
    red.forEach((cmd, k) => {
      tell(g, cmd, undefined, 5000 + k * 30);
    });
    expect(clearIn(g)).toBe(true);
    expect(scanInto(g, 0, { ...rgb, fade: 0x17 }, 20_000).ok).toBe(true);
    expect(clearIn(g)).toBe(false);
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    expect(reason(g.judge(tx([c('DAPC', A, 110)]), 30_000))).toMatch(needsColour);
  });

  it('a colour brought in is an event whether the gear is lit or off (ADR 0019 amendment 2)', () => {
    // Whether the gear is off is the shadow's word, and on hardware the shadow allows nothing.
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, level: 0 }).ok).toBe(true);
    g.markInventoryFresh(false);
    const act = c('DT8_ACTIVATE', A);
    for (const gov of [g, bench()])
      expect(
        inner(gov)
          .unknownEvents(act, 5000)
          .map((e) => e.scope),
      ).toEqual(['a0', ROOM]);
  });

  it('a colour changes only with no fade of any kind (S8b-R3-1)', () => {
    const noFade =
      "Rate guard: A0's colour changes only with no fade, so set its fade time to 0 first (a0).";
    const judged = (g: Governor, cmds: Command[]) => reason(g.judge(tx(cmds), 5000));
    expect(judged(bench(0x17), red)).toBe(noFade);
    expect(judged(bench(0x17), [c('DT8_ACTIVATE', A)])).toBe(noFade);
    expect(judged(bench(), red)).toBe('');
    // The extended fade time and DT6's fast fade time are fades too.
    for (const more of [{ ext: 0x16 }, { fast: 20 }]) {
      const g = hw();
      expect(scanInto(g, 0, { ...rgb, fade: 0x07, ...more }).ok).toBe(true);
      g.markInventoryFresh(false);
      expect(verify(g).ok).toBe(true);
      expect(judged(g, red)).toBe(noFade);
    }
    // A fade time set in the same transaction counts, and so does one not read back.
    expect(judged(bench(), [c('DTR0', undefined, 3), c('SET_FADE_TIME', A), ...red])).toBe(noFade);
    // The colour temperature steps are colour changes.
    const tcGear = () => {
      const g = hw();
      expect(scanInto(g, 0, { ...rgb, colour: 0x02, fade: 0x17 }).ok).toBe(true);
      g.markInventoryFresh(false);
      expect(verify(g).ok).toBe(true);
      return g;
    };
    for (const id of ['DT8_TC_STEP_COOLER', 'DT8_TC_STEP_WARMER'])
      expect(judged(tcGear(), [c(id, A)]), id).toBe(noFade);
  });

  it('recalls a scene only when the gear has no fade time, since a scene’s colour is not read (S8b-1)', () => {
    const scenes = /A0's scenes hold colours the guard has not read/;
    const known = (fade: number, sceneLevels?: number[], fast = 0) => {
      const g = hw();
      expect(
        scanInto(g, 0, { ...rgb, fade, fast, ...(sceneLevels ? { scenes: sceneLevels } : {}) }).ok,
      ).toBe(true);
      g.markInventoryFresh(false);
      expect(verify(g).ok).toBe(true);
      red.forEach((cmd, k) => {
        tell(g, cmd, undefined, 5000 + k * 30);
      });
      expect(clearIn(g)).toBe(true);
      return g;
    };
    const recall = tx([c('GO_TO_SCENE', A, 2)]);
    // Fade time 1: the level and the scene's colour would fade together.
    const faded = known(0x17, [0, 0, 90]).judge(recall, 20_000);
    expect(reason(faded)).toMatch(scenes);
    expect(faded).not.toHaveProperty('retryAt');
    // No fade time: both change in one moment.
    expect(reason(known(0x07, [0, 0, 90]).judge(recall, 20_000))).not.toMatch(scenes);
    // With a fade time of 0, DT6 gear fades over its fast fade time (S8b-M1).
    expect(reason(known(0x07, [0, 0, 90], 20).judge(recall, 20_000))).toMatch(scenes);
    // A fade time set in the same transaction counts.
    const set = tx([c('DTR0', undefined, 3), c('SET_FADE_TIME', A), c('GO_TO_SCENE', A, 2)]);
    expect(reason(known(0x07, [0, 0, 90]).judge(set, 20_000))).toMatch(scenes);
    // A scene can change the colour with its level masked, so the level it holds makes no
    // difference (S8b-D3).
    expect(reason(known(0x17).judge(recall, 20_000))).toMatch(scenes);
    const masked = known(0x07);
    expect(reason(masked.judge(recall, 20_000))).not.toMatch(scenes);
    // The recall changed the colour without the temporary colour, so one may be waiting again
    // (S8b-R3-4), and a level after it is refused.
    expect(reason(masked.judge(tx([c('GO_TO_SCENE', A, 2), c('DAPC', A, 90)]), 20_000))).toMatch(
      /set its colour before its level/,
    );
    tell(masked, c('GO_TO_SCENE', A, 2), undefined, 20_000);
    expect(clearIn(masked)).toBe(false);
  });

  it('an OFF to a group ends the wait only for gear whose groups were read (S8b-L2)', () => {
    // A1 answered and its groups were never read, so it counts as a member of every group for a light
    // change. An OFF to group 7 may not reach it, so its range stays.
    const g = hw();
    expect(scanInto(g, 0, { level: 100, groups: 0x80 }).ok).toBe(true);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255), 100);
    tell(g, c('QUERY_DEVICE_TYPE', B), reply(6), 100);
    g.markInventoryFresh(false);
    tell(g, c('DAPC', B, 0), undefined, 10_000);
    const range = () => fp(g).synthetic.find((e) => e.scope === 'a1' && e.t === 10_000);
    const whole = (range() as { hardUntil?: number } | undefined)?.hardUntil;
    tell(g, c('OFF', group(7)), undefined, 13_000);
    expect((range() as { hardUntil?: number } | undefined)?.hardUntil).toBe(whole);
    // An OFF to its own address does end it, 0.8 s after the change.
    tell(g, c('OFF', B), undefined, 16_000);
    expect((range() as { hardUntil?: number } | undefined)?.hardUntil).toBe(10_800);
  });

  it('an OFF that faulted, or went out while the gear was deaf, ends no range (S8b-D5)', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255), 100);
    tell(g, c('DAPC', B, 0), undefined, 10_000);
    const until = () =>
      (fp(g).synthetic.find((e) => e.scope === 'a1' && e.t === 10_000) as { hardUntil?: number })
        .hardUntil;
    const whole = until();
    tell(g, c('OFF', B), { kind: 'fault', reason: 'x' }, 11_000);
    expect(until()).toBe(whole);
    // The OFF that may not have arrived is itself one change, at its own time.
    expect(fp(g).synthetic.find((e) => e.scope === 'a1' && e.t === 11_000)).toMatchObject({
      hardUntil: 11_000,
    });
    // SAVE PERSISTENT VARIABLES leaves the gear deaf for a while.
    tell(g, c('SAVE_PERSISTENT_VARIABLES', B), undefined, 12_000);
    tell(g, c('OFF', B), undefined, 12_100);
    expect(until()).toBe(whole);
    tell(g, c('OFF', B), undefined, 14_000);
    expect(until()).toBe(10_800);
  });

  it('a RESET or a level command forgets a temporary colour loaded before it (S8b-D8)', () => {
    for (const between of [c('RESET', A), c('OFF', A), c('DAPC', A, 255)]) {
      const g = bench();
      for (const cmd of red.slice(0, 4)) tell(g, cmd, undefined, 5000);
      tell(g, between, undefined, 6000);
      for (const cmd of red.slice(4)) tell(g, cmd, undefined, 9000);
      expect(g.addressInfo(0)?.colourKnown, between.id).toBe(false);
    }
  });

  it('a device type list with a reply lost is not read, so the gear is not modelled (S8b-D2)', () => {
    const g = hw();
    g.beginScan(0);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('QUERY_DEVICE_TYPE', A), reply(255));
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', A), reply(6));
    // The reply that would have said 8 is lost, and the list then ends.
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', A), NONE);
    tell(g, c('QUERY_NEXT_DEVICE_TYPE', A), reply(254));
    expect(g.addressInfo(0)?.typesRead).toBe(false);
    expect(g.modelAddress(0)).toMatchObject({ ok: false });
    expect(reason(g.judge(tx([c('DAPC', A, 110)]), 5000))).toMatch(/scan it before its level/);
    // Read whole, it is.
    expect(scanInto(g, 0, { types: [6, 8], colour: 0x60 }, 6000).ok).toBe(true);
    expect(g.addressInfo(0)?.typesRead).toBe(true);
  });

  describe('a level changes only in one moment (ADR 0022, S8b-R4-D1)', () => {
    const LEVEL_NO_FADE =
      'Rate guard: A0 is colour gear, so its level changes only with no fade, so set its fade time to 0 first (a0).';
    /** A0 with its colour activated long ago, so nothing but the fade stands in a level's way. */
    const ready = (gear: Gear = {}) => {
      const g = hw();
      expect(scanInto(g, 0, { ...rgb, fade: 0x07, ...gear }).ok).toBe(true);
      g.markInventoryFresh(false);
      expect(verify(g).ok).toBe(true);
      tell(g, c('DT8_ACTIVATE', A), undefined, 5000);
      expect(clearIn(g)).toBe(true);
      return g;
    };
    const judged = (g: Governor, cmds: Command[], at = 20_000) => g.judge(tx(cmds), at);

    it('the review’s case: a bare ACTIVATE, fade time 2 read back, then DAPC 150', () => {
      const g = ready();
      tell(g, c('DTR0', undefined, 2), undefined, 9000);
      tell(g, c('SET_FADE_TIME', A), undefined, 9000);
      tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), reply(0x27), 9100);
      tell(g, c('QUERY_EXTENDED_FADE_TIME', A), reply(0), 9100);
      const v = judged(g, [c('DAPC', A, 150)]);
      expect(reason(v)).toBe(LEVEL_NO_FADE);
      // Nothing to wait for: the fade time has to change first.
      expect(v).not.toHaveProperty('retryAt');
    });

    it('goes with no fade of any kind, and with none of the three otherwise', () => {
      expect(judged(ready(), [c('DAPC', A, 150)]).kind).toBe('allow');
      for (const more of [{ fade: 0x17 }, { ext: 0x16 }, { fast: 20 }])
        expect(reason(judged(ready(more), [c('DAPC', A, 150)])), JSON.stringify(more)).toBe(
          LEVEL_NO_FADE,
        );
      // A fade time set in the same transaction counts, whatever it is set to.
      for (const t of [0, 3])
        expect(
          reason(
            judged(ready(), [c('DTR0', undefined, t), c('SET_FADE_TIME', A), c('DAPC', A, 150)]),
          ),
        ).toBe(LEVEL_NO_FADE);
    });

    it('holds for every command that moves the level but a scene recall, which has its own words', () => {
      const g = ready({ fade: 0x17 });
      expect(g.setCeiling(254, 'ui', true).ok).toBe(true);
      for (const id of [
        'STEP_UP',
        'STEP_DOWN',
        'RECALL_MIN_LEVEL',
        'STEP_DOWN_AND_OFF',
        'ON_AND_STEP_UP',
        'GO_TO_LAST_ACTIVE_LEVEL',
      ])
        expect(reason(judged(g, [c(id, A)])), id).toBe(LEVEL_NO_FADE);
      // RECALL MAX LEVEL never reaches the rate guard: colour gear counts as every channel full, so
      // the ceiling refuses it.
      expect(reason(judged(g, [c('RECALL_MAX_LEVEL', A)]))).toMatch(/above the ceiling/);
      expect(reason(judged(g, [c('GO_TO_SCENE', A, 2)]))).toMatch(
        /A0's scenes hold colours the guard has not read, so one is recalled only with no fade time set/,
      );
    });

    it('never takes a command that fades at the fade rate, whatever the fade time', () => {
      const g = ready();
      expect(g.setCeiling(254, 'ui', true).ok).toBe(true);
      for (const [id, words] of [
        ['UP', 'UP'],
        ['DOWN', 'DOWN'],
        ['CONTINUOUS_DOWN', 'CONTINUOUS DOWN'],
      ] as const) {
        const v = judged(g, [c(id, A)]);
        expect(reason(v), id).toBe(
          `Rate guard: A0 is colour gear, so its level changes only in one step, and ${words} is a fade (a0).`,
        );
        expect(v).not.toHaveProperty('retryAt');
      }
      // CONTINUOUS UP stops at the ceiling first, for the same reason as RECALL MAX LEVEL.
      expect(reason(judged(g, [c('CONTINUOUS_UP', A)]))).toMatch(/above the ceiling/);
      // The steps are one moment each.
      expect(judged(g, [c('STEP_DOWN', A)]).kind).toBe('allow');
    });

    it('refuses a DAPC sequence to colour gear, by its address or a group or all that holds it', () => {
      const SEQ =
        'Rate guard: A0 may be colour gear, so its level changes only in one step, and a DAPC sequence fades it (a0).';
      const g = ready();
      for (const a of [A, group(0), broadcast]) {
        const v = judged(g, [c('ENABLE_DAPC_SEQUENCE', a)]);
        expect(reason(v)).toBe(SEQ);
        expect(v).not.toHaveProperty('retryAt');
      }
      expect(reason(judged(g, [c('ENABLE_DAPC_SEQUENCE', A), c('DAPC', A, 150)]))).toBe(SEQ);
      // A group A0 is not in.
      expect(judged(g, [c('ENABLE_DAPC_SEQUENCE', group(3))]).kind).toBe('allow');
      // Gear that was never scanned is not verified, and takes nothing of the kind anyway.
      const unscanned = hw();
      unscanned.markInventoryFresh(false);
      expect(reason(judged(unscanned, [c('ENABLE_DAPC_SEQUENCE', A)]))).toBe(
        'ENABLE DAPC SEQUENCE: Address 0 is not verified.',
      );
    });

    it('leaves OFF, gear with no colour and the simulator target as they were', () => {
      expect(judged(ready({ fade: 0x17 }), [c('OFF', A)]).kind).toBe('allow');
      const plain = hw();
      expect(scanInto(plain, 0, { level: 100, fade: 0x27 }).ok).toBe(true);
      plain.markInventoryFresh(false);
      expect(verify(plain).ok).toBe(true);
      for (const cmds of [
        [c('DAPC', A, 150)],
        [c('ENABLE_DAPC_SEQUENCE', A), c('DAPC', A, 150)],
        [c('DOWN', A)],
      ])
        expect(judged(plain, cmds).kind, cmds[0]?.id).toBe('allow');
      const s = sim();
      // The engine's playground tests cover a DAPC sequence on the simulator's verified gear.
      expect(reason(s.judge(tx([c('DAPC', B, 150)]), 20_000))).toBe('');
    });
  });

  it('a rescan with replies lost does not rest on what was read of the gear before (Stage 11 review N1)', () => {
    /** Every read-back of a scan but the ones named, whose replies are lost. */
    const rescan = (g: Governor, lost: string[], fade: number) => {
      const r = (id: string, v: number, value?: number) => {
        tell(g, c(id, A, value), lost.includes(id) ? NONE : reply(v), 30_000);
      };
      g.beginScan(0);
      r('QUERY_CONTROL_GEAR_PRESENT', 255);
      r('QUERY_DEVICE_TYPE', 255);
      for (const t of [6, 8, 254]) r('QUERY_NEXT_DEVICE_TYPE', t);
      r('QUERY_PHYSICAL_MINIMUM', 85);
      r('QUERY_MIN_LEVEL', 85);
      r('QUERY_MAX_LEVEL', 220);
      r('QUERY_GROUPS_0_7', 1);
      r('QUERY_GROUPS_8_15', 0);
      r('QUERY_FADE_TIME_FADE_RATE', fade);
      r('QUERY_EXTENDED_FADE_TIME', 0);
      r('QUERY_ACTUAL_LEVEL', 100);
      r('DT6_QUERY_DIMMING_CURVE', 0);
      r('DT6_QUERY_FAST_FADE_TIME', 0);
      r('DT8_QUERY_COLOUR_TYPE_FEATURES', 0x60);
      for (let k = 0; k < 16; k++) r('QUERY_SCENE_LEVEL', 255, k);
      r('QUERY_STATUS', 0);
      return g.modelAddress(0);
    };
    // A0 scanned with no fade. Other gear, with fade time 5, is moved onto A0 under the reset
    // unlock, and the rescan loses the two fade replies. The old answers must not stand.
    for (const lost of [
      ['QUERY_FADE_TIME_FADE_RATE'],
      ['QUERY_EXTENDED_FADE_TIME'],
      ['QUERY_FADE_TIME_FADE_RATE', 'QUERY_EXTENDED_FADE_TIME'],
    ]) {
      const g = bench();
      expect(g.addressInfo(0)?.fadeTime).toBe(0);
      expect(rescan(g, lost, 0x57).ok, lost.join()).toBe(false);
      const i = g.addressInfo(0);
      if (lost.includes('QUERY_FADE_TIME_FADE_RATE')) expect(i?.fadeTime).toBeUndefined();
      if (lost.includes('QUERY_EXTENDED_FADE_TIME')) expect(i?.extendedFade).toBeUndefined();
      // Whatever else happens, a colour or a level with these settings unread is refused.
      tell(g, c('DT8_ACTIVATE', A), undefined, 40_000);
      const v = g.judge(tx([c('DAPC', A, 150)]), 40_000 + 20 * 60_000);
      expect(v.kind, lost.join()).toBe('refuse');
    }
    // The same scan with every reply heard reads the new fade time, and says so.
    const heard = bench();
    expect(rescan(heard, [], 0x57).ok).toBe(true);
    expect(heard.addressInfo(0)?.fadeTime).toBe(5);
    // Lost group and colour replies leave those unread too.
    const g = bench();
    rescan(g, ['QUERY_GROUPS_8_15', 'DT8_QUERY_COLOUR_TYPE_FEATURES'], 0x07);
    expect(g.addressInfo(0)?.groups).toBeUndefined();
    expect(g.colourFacts(0)).toBeUndefined();
    // Re-addressing forgets the fade read-backs of every address at once, before any rescan.
    const moved = bench();
    expect(verify(moved).ok).toBe(true);
    tell(moved, c('DT8_ACTIVATE', A), undefined, 5000);
    tell(moved, c('DTR0', undefined, 3), undefined, 9000);
    tell(moved, c('SET_SHORT_ADDRESS', B), undefined, 9000);
    expect(moved.addressInfo(0)?.fadeTime).toBeUndefined();
    expect(moved.addressInfo(0)?.groups).toBeUndefined();
  });

  it('applies to colour gear only, and only on hardware', () => {
    const g = hw();
    expect(scanInto(g, 0, { level: 100 }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(g.judge(tx([c('DAPC', A, 110)]), 5000).kind).toBe('allow');
    expect(sim().judge(tx([c('DAPC', A, 110)]), 5000).kind).toBe('allow');
  });
});

describe('the colour rule, at the corners mutation testing found unpinned (Stage 8b)', () => {
  const rgb = { types: [6, 8], colour: 0x60, level: 100, groups: 1 };
  const verify = (g: Governor, n = 0) =>
    g.markVerified(n, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false });
  const bench = (gear: Gear = {}) => {
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, fade: 0x07, ...gear }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(verify(g).ok).toBe(true);
    return g;
  };
  const red = rgbwafCommands(A, [254, 0, 0, 0, 0, 0]);
  const RGB = red.slice(0, 4);
  const WAF = red.slice(4, 8);
  const ACT = c('DT8_ACTIVATE', A);
  const LVL = c('DAPC', A, 110);
  /** A level after an ACTIVATE in one transaction is refused either way. The reason says which. */
  const KNOWN = /^Rate guard: A0's colour may still be fading \(a0\)\.$/;
  const UNKNOWN =
    /^Rate guard: A0 may hold a colour that is not activated, so set its colour before its level \(a0\)\.$/;
  const judged = (g: Governor, cmds: Command[], at = 5000) => reason(g.judge(tx(cmds), at));
  /** The same, from what `observe` remembers: whether nothing waits once the commands went out. */
  const told = (cmds: Command[], g = bench()) => {
    cmds.forEach((cmd, k) => {
      tell(g, cmd, undefined, 5000 + k * 30);
    });
    return clearIn(g);
  };

  it('an ACTIVATE leaves nothing waiting, whatever was loaded before it (amendment 1)', () => {
    expect(judged(bench(), [...RGB, ...WAF, ACT, LVL])).toMatch(KNOWN);
    expect(judged(bench(), [...RGB, ACT, LVL])).toMatch(KNOWN);
    expect(judged(bench(), [ACT, LVL])).toMatch(KNOWN);
    expect(told([...WAF, ACT])).toBe(true);
    expect(told([ACT])).toBe(true);
    // Loaded and not activated, or loaded after the ACTIVATE, a colour waits.
    expect(told(RGB)).toBe(false);
    expect(told([ACT, ...WAF])).toBe(false);
    expect(judged(bench(), [ACT, ...RGB, LVL])).toMatch(UNKNOWN);
    for (const id of ['DT8_SET_TEMPORARY_X', 'DT8_SET_TEMPORARY_Y', 'DT8_SET_TEMPORARY_TC']) {
      expect(told([ACT, c(id, A)]), id).toBe(false);
    }
    // The colour is never known on hardware, so every change to the gear is its own event.
    const g = bench();
    expect(told(red, g)).toBe(true);
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    expect(
      inner(g)
        .unknownEvents(LVL, 20_000)
        .map((e) => e.scope),
    ).toEqual(['a0', ROOM]);
  });

  it('COPY REPORT TO TEMPORARY loads a colour like any other (S8b-R2-H1)', () => {
    const COPY = c('DT8_COPY_REPORT_TO_TEMPORARY', A);
    expect(told([...red, COPY])).toBe(false);
    expect(judged(bench(), [...red, COPY, LVL])).toMatch(UNKNOWN);
    expect(told([...RGB, ...WAF, COPY, ACT])).toBe(true);
    // A copy to other gear changes nothing here.
    expect(told([...red, c('DT8_COPY_REPORT_TO_TEMPORARY', B)])).toBe(true);
  });

  it('an ACTIVATE to a group makes the colour known only for gear it is sure to reach (S8b-R2-L1)', () => {
    const G0 = group(0);
    const whole = [
      ...RGB.slice(0, 3),
      c('DT8_SET_TEMPORARY_RGB', G0),
      ...WAF.slice(0, 3),
      c('DT8_SET_TEMPORARY_WAF', G0),
      c('DT8_ACTIVATE', G0),
    ];
    // In group 0, with its groups read.
    const g = bench();
    whole.forEach((cmd, k) => {
      tell(g, cmd, undefined, 5000 + k * 30);
    });
    expect(clearIn(g)).toBe(true);
    expect(judged(bench(), [...whole, LVL])).toMatch(KNOWN);
    // The same gear with the reply about its groups lost counts as in every group, and may be in none.
    const h = hw();
    h.beginScan(0);
    for (const [id, v] of [
      ['QUERY_CONTROL_GEAR_PRESENT', 255],
      ['QUERY_DEVICE_TYPE', 8],
    ] as const)
      tell(h, c(id, A), reply(v));
    h.markInventoryFresh(false);
    expect(h.addressInfo(0)?.groups).toBeUndefined();
    whole.forEach((cmd, k) => {
      tell(h, cmd, undefined, 5000 + k * 30);
    });
    expect(clearIn(h)).toBe(false);
  });

  it('a rescan that fails leaves the colour unknown (S8b-R2-D3)', () => {
    const tc = { colour: 0x02 };
    const g = bench(tc);
    expect(told(tcCommands(A, 300), g)).toBe(true);
    // Something is sent to the gear during the rescan, so the scan cannot model it.
    g.beginScan(0);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255), 9000);
    tell(g, c('DTR0', undefined, 5), undefined, 9000);
    tell(g, c('SET_FADE_RATE', A), undefined, 9000);
    expect(g.modelAddress(0).ok).toBe(false);
    expect(clearIn(g)).toBe(false);
    expect(g.addressInfo(0)?.colourKnown).toBe(false);
    // The failed scan read no colour features, so a Tc command is refused for that first.
    expect(reason(g.judge(tx([...tcCommands(A, 200, false), c('DAPC', A, 200)]), 20_000))).toBe(
      'SET TEMPORARY COLOUR TEMPERATURE Tc: the gear does not report Tc.',
    );
    expect(reason(g.judge(tx([c('DAPC', A, 200)]), 20_000))).toMatch(UNKNOWN);
  });

  it('fade settings count only as read back since they were last written (S8b-R4-1)', () => {
    const noFade =
      "Rate guard: A0's colour changes only with no fade, so set its fade time to 0 first (a0).";
    const set0 = [c('DTR0', undefined, 0), c('SET_FADE_TIME', A)];
    const read = (g: Governor, fade: number, ext = 0, at = 6000) => {
      tell(g, c('QUERY_FADE_TIME_FADE_RATE', A), reply(fade), at);
      tell(g, c('QUERY_EXTENDED_FADE_TIME', A), reply(ext), at);
    };
    // A fade time of 0 sent, and not read back: the gear may not have taken it.
    const g = bench({ fade: 0x17 });
    set0.forEach((cmd) => {
      tell(g, cmd, undefined, 5000);
    });
    expect(judged(g, red, 9000)).toBe(
      "Rate guard: A0's colour changes only with no fade, and its fade settings have not been read back since they were set (a0).",
    );
    // Read back as still 1, then as 0.
    read(g, 0x17);
    expect(judged(g, red, 9000)).toBe(noFade);
    read(g, 0x07);
    expect(judged(g, red, 9000)).toBe('');
    // An extended fade time read back counts too.
    read(g, 0x07, 0x16);
    expect(judged(g, red, 9000)).toBe(noFade);
    // A level to colour gear waits for the read-back too (ADR 0022).
    const unread = bench();
    set0.forEach((cmd) => {
      tell(unread, cmd, undefined, 5000);
    });
    tell(unread, ACT, undefined, 8000);
    // Long after the ACTIVATE, whose own range runs the longest fade DALI allows while unread.
    expect(judged(unread, [LVL], 8000 + 20 * 60_000)).toBe(
      'Rate guard: A0 is colour gear, so its level changes only with no fade, and its fade settings have not been read back since they were set (a0).',
    );
    // Until a fade setting is read back, a level's range runs the longest fade DALI allows. Gear
    // with no colour, which takes a faded level.
    const h = bench({ types: [6] });
    set0.forEach((cmd) => {
      tell(h, cmd, undefined, 5000);
    });
    tell(h, LVL, undefined, 12_000);
    const long = h.judge(tx([c('DAPC', A, 120)]), 20_000);
    expect(long.kind === 'refuse' ? long.retryAt : 0).toBeGreaterThanOrEqual(12_000 + 16 * 60_000);
    // A fade rate not read back makes CONTINUOUS UP as long, and a fast fade time of 27 is 700 ms.
    const k = bench({ fast: 27 });
    expect(judged(k, red, 9000)).toBe(noFade);
  });

  it('gear with no DT6 part has no fast fade time, and gear whose types were not read may fade', () => {
    const only8 = hw();
    expect(scanInto(only8, 0, { types: [8], colour: 0x60, level: 100, fade: 0x07 }).ok).toBe(true);
    only8.markInventoryFresh(false);
    expect(verify(only8).ok).toBe(true);
    expect(judged(only8, red, 9000)).toBe('');
  });

  it('a colour temperature step leaves a colour possibly waiting (S8b-R3-4)', () => {
    const tc = { colour: 0x02 };
    const step = c('DT8_TC_STEP_COOLER', A);
    expect(judged(bench(tc), [ACT, step, LVL])).toMatch(UNKNOWN);
    expect(told([ACT, step], bench(tc))).toBe(false);
    expect(told([step, ACT], bench(tc))).toBe(true);
  });

  it('carries what went out before the transaction', () => {
    const g = bench();
    tell(g, ACT, undefined, 4000);
    expect(judged(g, [LVL], 9000)).toBe('');
    for (const cmd of RGB) tell(g, cmd, undefined, 9000);
    expect(judged(g, [LVL], 12_000)).toMatch(UNKNOWN);
    expect(judged(g, [ACT, LVL], 12_000)).toMatch(KNOWN);
  });

  it('a colour and a level never go in one transaction, in either order', () => {
    const g = bench();
    expect(told(red, g)).toBe(true);
    expect(judged(g, [...red, LVL], 9000)).toMatch(KNOWN);
    expect(judged(g, [LVL, ...red], 9000)).toBe(
      "Rate guard: A0's colour is not known, so it is set only while its level is steady (a0).",
    );
  });

  it('a colour after a level waits out that level, at its own address', () => {
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, fade: 0x07 }).ok).toBe(true);
    expect(scanInto(g, 1, { ...rgb, fade: 0x07 }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(verify(g, 0).ok).toBe(true);
    expect(verify(g, 1).ok).toBe(true);
    tell(g, c('DAPC', B, 150), undefined, 8000);
    const colour = rgbwafCommands(B, [254, 0, 0, 0, 0, 0]);
    // The level may move A1 until 8,300, and its hard step window runs 2 s from there.
    const v = g.judge(tx(colour), 8100);
    expect(reason(v)).toBe('Rate guard: more than one hard step in 2 s (a1).');
    expect(v.kind === 'refuse' ? v.retryAt : 0).toBeGreaterThanOrEqual(10_300);
    expect(g.judge(tx(colour), 10_400).kind).toBe('allow');
    // A0 waits for A1 to stop, and then for the room's second.
    expect(reason(g.judge(tx(red), 8100))).toMatch(/A1 may still be fading/);
    expect(g.judge(tx(red), 9400).kind).toBe('allow');
  });

  it('a level to the unaddressed is refused with a fresh inventory too, and names no address', () => {
    const unfound =
      /^Rate guard: Gear the inventory has not found may be colour gear, so it takes no level until a scan finds it \(phantom\)\.$/;
    const g = bench();
    expect(judged(g, [c('DAPC', unaddressed, 110)])).toMatch(unfound);
    // A group or a broadcast: only while the inventory is stale or unaddressed gear answered.
    expect(judged(g, [c('OFF', group(0))])).toBe('');
    const stale = hw();
    expect(scanInto(stale, 0, { level: 100, groups: 1 }).ok).toBe(true);
    expect(judged(stale, [c('DAPC', group(0), 110)])).toMatch(unfound);
    expect(judged(stale, [c('DAPC', A, 110)])).not.toMatch(unfound);
    const present = hw();
    expect(scanInto(present, 0, { level: 100, groups: 1 }).ok).toBe(true);
    present.markInventoryFresh(true);
    expect(judged(present, [c('DAPC', group(0), 110)])).toMatch(unfound);
    present.markInventoryFresh(false);
    expect(judged(present, [c('DAPC', group(0), 110)])).not.toMatch(unfound);
  });

  it('an address a scan found empty takes no level, and gear whose types hold no colour is skipped', () => {
    const g = hw();
    expect(scanInto(g, 0, { level: 100, fade: 0x17, scenes: [0, 0, 90] }).ok).toBe(true);
    g.beginScan(1);
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), NONE);
    g.markInventoryFresh(false);
    expect(verify(g).ok).toBe(true);
    expect(g.addressInfo(1)?.present).toBe(false);
    // Lost replies make gear look absent, and it may be colour gear (S8b-R2-H2).
    expect(judged(g, [c('DAPC', B, 110)])).toBe(
      'Rate guard: A1 did not answer the scan, so it takes no level until a scan finds it (a1).',
    );
    expect(g.judge(tx([c('OFF', B)]), 5000).kind).toBe('allow');
    expect(g.judge(tx([c('DAPC', A, 110)]), 5000).kind).toBe('allow');
    // DT6 gear with a fade time recalls a scene: it has no colour for the scene to hold.
    expect(judged(g, [c('GO_TO_SCENE', A, 2)])).not.toMatch(/scenes hold colours/);
  });

  it('names the address in each refusal', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(3)), reply(255), 100);
    g.markInventoryFresh(false);
    expect(judged(g, [c('DAPC', short(3), 110)])).toBe(
      'Rate guard: A3 may be colour gear and has not been scanned, so scan it before its level (a3).',
    );
  });

  it('a part set from a register whose write may not have arrived is not known', () => {
    const lost = (cmds: Command[], k: number, g = bench()) => {
      cmds.forEach((cmd, i) => {
        tell(g, cmd, i === k ? { kind: 'fault', reason: 'x' } : undefined, 5000 + i * 30);
      });
      return g.addressInfo(0)?.colourKnown;
    };
    // Each register of the RGB part, and of the WAF part.
    for (const k of [0, 1, 2, 4, 5, 6]) expect(lost(red, k), String(k)).toBe(false);
    const tc = tcCommands(A, 250);
    for (const k of [0, 1]) expect(lost(tc, k, bench({ colour: 0x02 })), String(k)).toBe(false);
    // The low byte lost with the high byte set.
    expect(lost(tcCommands(A, 0x0150), 0, bench({ colour: 0x02 }))).toBe(false);
  });

  it('every command that moves the level waits for a colour to fade in', () => {
    const g = bench();
    // With the ceiling at the top, so the commands that go to the maximum reach the rate guard.
    expect(g.setCeiling(254, 'ui', true).ok).toBe(true);
    expect(told(red, g)).toBe(true);
    for (const id of [
      'UP',
      'STEP_UP',
      'ON_AND_STEP_UP',
      'GO_TO_LAST_ACTIVE_LEVEL',
      'CONTINUOUS_DOWN',
    ])
      expect(judged(g, [c(id, A)], 5400), id).toBe(
        "Rate guard: A0's colour may still be fading (a0).",
      );
  });

  it('gear with no fade recalls a scene while other gear has one', () => {
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, fade: 0x17 }).ok).toBe(true);
    expect(scanInto(g, 1, { ...rgb, fade: 0x07, scenes: [0, 0, 90] }).ok).toBe(true);
    g.markInventoryFresh(false);
    expect(verify(g, 0).ok).toBe(true);
    expect(verify(g, 1).ok).toBe(true);
    rgbwafCommands(B, [254, 0, 0, 0, 0, 0]).forEach((cmd, k) => {
      tell(g, cmd, undefined, 5000 + k * 30);
    });
    expect(clearIn(g, 1)).toBe(true);
    expect(judged(g, [c('GO_TO_SCENE', B, 2)], 20_000)).not.toMatch(/scenes hold colours/);
    // It is A1's own level that has to be steady.
    tell(g, c('UP', B), undefined, 30_000);
    expect(judged(g, [c('GO_TO_SCENE', B, 2)], 30_010)).toMatch(
      /recalled only while the level is steady \(a1\)/,
    );
  });

  it('a scene recall goes on its own, with the level steady, and only with no fade of any kind', () => {
    const known = (gear: Gear) => {
      const g = bench({ fade: 0x07, scenes: [0, 0, 90], ...gear });
      expect(told(red, g)).toBe(true);
      return g;
    };
    const recall = c('GO_TO_SCENE', A, 2);
    expect(judged(known({}), [recall], 20_000)).toBe('');
    expect(judged(known({}), [LVL, recall], 20_000)).toBe(
      "Rate guard: A0's scenes hold colours the guard has not read, so one is recalled on its own (a0).",
    );
    expect(judged(known({ ext: 0x16 }), [recall], 20_000)).toBe(
      "Rate guard: A0's scenes hold colours the guard has not read, so one is recalled only with no fade time set (a0).",
    );
    // UP runs for 200 ms at the fade rate, whatever the fade time.
    const g = known({});
    tell(g, c('UP', A), undefined, 20_000);
    const v = g.judge(tx([recall]), 20_010);
    expect(reason(v)).toBe(
      "Rate guard: A0's scenes hold colours the guard has not read, so one is recalled only while the level is steady (a0).",
    );
    expect(v.kind === 'refuse' ? v.retryAt : 0).toBeGreaterThanOrEqual(20_200);
    // The UP was a change to gear in an unknown state, so the recall also waits out its window.
    expect(judged(g, [recall], 21_000)).toBe('Rate guard: more than one hard step in 2 s (a0).');
    expect(judged(g, [recall], 22_400)).toBe('');
  });

  it('a device type query with no reply reads no types', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', A), reply(255));
    tell(g, c('QUERY_DEVICE_TYPE', A), NONE);
    expect(g.addressInfo(0)?.typesRead).toBe(false);
  });

  it('an ACTIVATE to gear that was never scanned is not held for a steady level', () => {
    const g = hw();
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(3)), reply(255), 100);
    g.markInventoryFresh(false);
    expect(judged(g, [c('DT8_ACTIVATE', short(3))])).not.toMatch(/steady/);
  });

  it('says the device types were not all read', () => {
    const g = hw();
    expect(scanInto(g, 0, rgb).ok).toBe(true);
    tell(g, c('QUERY_DEVICE_TYPE', A), reply(255), 200);
    expect(g.modelAddress(0)).toEqual({
      ok: false,
      reason: 'The device types were not all read back.',
    });
  });
});

describe('events for unknown gear, at the corners mutation testing found unpinned (Stage 8b)', () => {
  const LONGEST = 16 * 60_000 + 100;
  const heard = (g: Governor, n: number) => {
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', short(n)), reply(255), 100);
  };
  const syn = (g: Governor) =>
    fp(g).synthetic as (Ev & { hardUntil: number; gear: number[]; cmd: string })[];

  it('the room waits for every address the command reached, the phantom driver among them', () => {
    const g = hw();
    heard(g, 0);
    heard(g, 1);
    tell(g, c('DAPC', broadcast, 100), undefined, 10_000);
    // Gear the inventory has not found counts as one more address, -1.
    expect(syn(g)).toMatchObject([
      { t: 10_000, scope: PHANTOM, hardUntil: 10_000 + LONGEST, gear: [-1] },
      { t: 10_000, scope: 'a0', hardUntil: 10_000 + LONGEST, gear: [0] },
      { t: 10_000, scope: 'a1', hardUntil: 10_000 + LONGEST, gear: [1] },
      { t: 10_000, scope: ROOM, hardUntil: 10_000 + LONGEST, gear: [-1, 0, 1] },
    ]);
    // An OFF to one address ends its range. The room still waits for the others.
    tell(g, c('OFF', A), undefined, 12_000);
    expect(syn(g).map((e) => [e.scope, e.hardUntil])).toEqual([
      [PHANTOM, 10_000 + LONGEST],
      ['a0', 10_800],
      ['a1', 10_000 + LONGEST],
      [ROOM, 10_000 + LONGEST],
      ['a0', 12_000],
      [ROOM, 12_000],
    ]);
    tell(g, c('OFF', B), undefined, 13_000);
    expect(syn(g).find((e) => e.scope === ROOM)?.hardUntil).toBe(10_000 + LONGEST);
    tell(g, c('OFF', broadcast), undefined, 14_000);
    expect(syn(g).find((e) => e.scope === ROOM)?.hardUntil).toBe(10_800);
  });

  it('a frame sent twice is one event, and the same command later in the transaction is another', () => {
    const g = hw();
    heard(g, 0);
    heard(g, 1);
    tell(g, c('DAPC', A, 100), undefined, 1000, 1);
    tell(g, c('DAPC', A, 100), undefined, 1100, 1);
    tell(g, c('DAPC', B, 100), undefined, 1150, 1);
    expect(syn(g).filter((e) => e.scope === ROOM)).toMatchObject([
      { t: 1000, until: 1150, hardUntil: 1150 + LONGEST, gear: [0, 1], cmd: 'DAPC:100' },
    ]);
    expect(syn(g).filter((e) => e.scope === 'a0')).toMatchObject([{ t: 1000, until: 1100 }]);
    // 101 ms later it is a new change, and so is another level.
    tell(g, c('DAPC', A, 100), undefined, 1201, 1);
    tell(g, c('DAPC', A, 101), undefined, 1210, 1);
    expect(syn(g).filter((e) => e.scope === 'a0')).toMatchObject([
      { t: 1000, until: 1100 },
      { t: 1201, until: 1201 },
      { t: 1210, until: 1210 },
    ]);
    // Another transaction's copy is not joined.
    tell(g, c('DAPC', A, 101), undefined, 1220, 2);
    expect(syn(g).filter((e) => e.scope === 'a0')).toHaveLength(4);
  });

  it('a planned OFF ends the range of a change before it in the transaction', () => {
    const g = hw();
    heard(g, 1);
    const planned = inner(g).plan(tx([c('DAPC', B, 100), c('OFF', B)]), 1000);
    const ev = inner(g).extraEvents(planned) as (Ev & { hardUntil: number })[];
    expect(ev.filter((e) => e.scope === 'a1').map((e) => e.hardUntil)).toEqual([
      planned[1]?.deliverAt,
      planned[1]?.deliverAt,
    ]);
  });

  it('a colour brought in counts for every address it reaches, lit or off, and for the phantom driver', () => {
    const rgb = { types: [6, 8], colour: 0x60, groups: 1 };
    const g = hw();
    expect(scanInto(g, 0, { ...rgb, level: 0 }).ok).toBe(true);
    expect(scanInto(g, 1, { ...rgb, level: 100 }).ok).toBe(true);
    g.markInventoryFresh(false);
    const scopes = (h: Governor, cmd: Command) =>
      inner(h)
        .unknownEvents(cmd, 5000)
        .map((e) => e.scope);
    for (const id of ['DT8_ACTIVATE', 'DT8_TC_STEP_COOLER', 'DT8_TC_STEP_WARMER']) {
      expect(scopes(g, c(id, A)), id).toEqual(['a0', ROOM]);
      expect(scopes(g, c(id, B)), id).toEqual(['a1', ROOM]);
      expect(scopes(g, c(id, broadcast)), id).toEqual(['a0', 'a1', ROOM]);
    }
    g.markInventoryFresh(true);
    expect(scopes(g, c('DT8_ACTIVATE', group(0)))).toEqual([PHANTOM, 'a0', 'a1', ROOM]);
  });

  it('an OFF to a group ends the range of gear whose groups were read', () => {
    const g = hw();
    expect(scanInto(g, 0, { level: 100, groups: 0x80 }).ok).toBe(true);
    g.markInventoryFresh(false);
    tell(g, c('GO_TO_LAST_ACTIVE_LEVEL', A), undefined, 10_000);
    const range = () => syn(g).find((e) => e.scope === 'a0' && e.t === 10_000)?.hardUntil;
    expect(range()).toBe(10_300);
    tell(g, c('OFF', group(6)), undefined, 10_050);
    expect(range()).toBe(10_300);
    tell(g, c('OFF', group(7)), undefined, 10_100);
    expect(range()).toBe(10_100);
  });

  it('a fresh inventory ends the wait for unfound gear only when none answered', () => {
    const g = hw();
    expect(scanInto(g, 0, { level: 100 }).ok).toBe(true);
    g.markInventoryFresh(true);
    tell(g, c('RECALL_MIN_LEVEL', unaddressed), undefined, 20_000);
    const range = () => syn(g).find((e) => e.scope === PHANTOM)?.hardUntil;
    const whole = range();
    expect(whole).toBeGreaterThan(21_000);
    g.markInventoryFresh(true);
    expect(range()).toBe(whole);
    g.markInventoryFresh(false);
    expect(range()).toBeLessThan(21_000);
  });

  /** A0 modelled and lit, A1 heard and never scanned, and a level sent to A1 at 10 s. */
  const withUnknown = () => {
    const g = hw();
    expect(scanInto(g, 0, { level: 100 }).ok).toBe(true);
    expect(
      g.markVerified(0, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false }).ok,
    ).toBe(true);
    heard(g, 1);
    tell(g, c('QUERY_DEVICE_TYPE', B), reply(6), 100);
    g.markInventoryFresh(false);
    tell(g, c('DAPC', B, 0), undefined, 10_000);
    return g;
  };
  const retry = (v: Verdict) => (v.kind === 'refuse' ? (v.retryAt ?? Infinity) : 0);

  it('a planned OFF ends the range of the change before it, 0.8 s after that change', () => {
    const off = tx([c('OFF', B)]);
    // The OFF is a hard step of its own, 2 s after the end of the first one.
    const early = withUnknown().judge(off, 12_000);
    expect(reason(early)).toBe('Rate guard: more than one hard step in 2 s (a1).');
    expect(retry(early)).toBeGreaterThanOrEqual(12_800);
    expect(retry(early)).toBeLessThan(12_900);
    expect(withUnknown().judge(off, 15_000).kind).toBe('allow');
    // An OFF the gear may not hear ends nothing: SAVE PERSISTENT VARIABLES leaves it deaf.
    const g = withUnknown();
    tell(g, c('SAVE_PERSISTENT_VARIABLES', B), undefined, 14_900);
    expect(g.judge(off, 15_000).kind).toBe('refuse');
    expect(g.judge(off, 15_400).kind).toBe('allow');
  });

  it('only an OFF that arrived stops other gear waiting for unknown gear', () => {
    const other = tx([c('DAPC', A, 200)]);
    const waits = /A1 may still be fading in a state the guard does not know/;
    const g = withUnknown();
    expect(retry(g.judge(other, 10_500))).toBeGreaterThan(900_000);
    // Gear that answers a presence query is still moving.
    tell(g, c('QUERY_CONTROL_GEAR_PRESENT', B), reply(255), 10_600);
    expect(retry(g.judge(other, 10_700))).toBeGreaterThan(900_000);
    tell(g, c('OFF', B), { kind: 'fault', reason: 'x' }, 11_000);
    expect(reason(g.judge(other, 11_100))).toMatch(waits);
    expect(retry(g.judge(other, 11_100))).toBeGreaterThan(900_000);
    tell(g, c('SAVE_PERSISTENT_VARIABLES', B), undefined, 12_000);
    tell(g, c('OFF', B), undefined, 12_100);
    expect(retry(g.judge(other, 12_200))).toBeGreaterThan(900_000);
    tell(g, c('OFF', B), undefined, 14_000);
    const after = g.judge(other, 14_010);
    expect(reason(after)).toMatch(waits);
    expect(retry(after)).toBeLessThan(16_000);
    expect(g.judge(other, 16_100).kind).toBe('allow');
  });
});
