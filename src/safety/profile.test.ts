/**
 * U-safety: the scan and the safety profile against a scripted bus, so every transaction they send,
 * its label and source, and every way they fail can be checked exactly.
 */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { framesFor } from '../dali/sequences.ts';
import { decode, type Command, type Frame } from '../dali/codec.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';
import {
  applySafetyProfile,
  patient,
  resetAndRestore,
  scan,
  scanAddress,
  type Submit,
  type Submitted,
} from './profile.ts';
import type { SendResult } from './types.ts';

type Answer = SendResult | 'refuse';
interface Logged {
  label: string | undefined;
  source: string;
  priority: string | undefined;
  cmds: Command[];
}

/**
 * A bus that answers each command from a table (by command id, or `id:value`), tells the governor
 * what went out when `observe` is set, and logs every transaction.
 */
function fakeBus(
  g: Governor,
  table: Record<string, Answer | Answer[]> = {},
  observe = true,
): { submit: Submit; log: Logged[] } {
  const log: Logged[] = [];
  const counts = new Map<string, number>();
  const submit: Submit = (t, priority) => {
    const cmds: Command[] = [];
    let prev: Frame | undefined;
    for (const f of t.frames) {
      const cmd = decode(f.frame, prev);
      if (cmd !== undefined) cmds.push(cmd);
      prev = f.frame;
    }
    log.push({ label: t.label, source: t.source, priority, cmds });
    const results: SendResult[] = [];
    let at = 1000 + log.length * 100;
    let before: Frame | undefined;
    for (const f of t.frames) {
      const cmd = decode(f.frame, before);
      before = f.frame;
      const key = cmd === undefined ? '' : cmd.id;
      const keyed = cmd?.value === undefined ? undefined : table[`${key}:${String(cmd.value)}`];
      const entry = keyed ?? table[key];
      let a: Answer;
      if (Array.isArray(entry)) {
        const k = counts.get(key) ?? 0;
        counts.set(key, k + 1);
        a = entry[Math.min(k, entry.length - 1)] ?? { kind: 'sent' };
      } else a = entry ?? (f.expectReply ? { kind: 'no-reply' } : { kind: 'sent' });
      if (a === 'refuse') return Promise.resolve<Submitted>({ kind: 'refused', reason: 'no' });
      if (observe) g.observe({ frame: f, at: at++, source: t.source }, a);
      results.push(a);
    }
    return Promise.resolve<Submitted>({ kind: 'done', results });
  };
  return { submit, log };
}

const reply = (byte: number): SendResult => ({ kind: 'reply', byte });
/** Tell the governor about a command outside the bus under test. */
function see(g: Governor, cmd: Command, r: SendResult = { kind: 'sent' }): void {
  const frames = framesFor(cmd);
  frames.forEach((f, i) => {
    g.observe(
      { frame: f, at: 1 + i, source: 'internal' },
      i === frames.length - 1 ? r : { kind: 'sent' },
    );
  });
}
const gov = (target: 'simulator' | 'hardware' = 'simulator') =>
  new Governor({
    target,
    shadow: target === 'hardware' ? new Simulator([]) : Simulator.bench(),
    connectedAt: -10_000,
  });

/** A DT6 driver at arc 85 to 254 that does what it is told. */
const DT6: Record<string, Answer | Answer[]> = {
  QUERY_CONTROL_GEAR_PRESENT: reply(255),
  QUERY_DEVICE_TYPE: reply(6),
  QUERY_PHYSICAL_MINIMUM: reply(85),
  QUERY_MIN_LEVEL: reply(85),
  QUERY_MAX_LEVEL: reply(220),
  QUERY_FADE_TIME_FADE_RATE: reply(7),
  QUERY_EXTENDED_FADE_TIME: reply(0),
  QUERY_GROUPS_0_7: reply(0),
  QUERY_GROUPS_8_15: reply(0),
  DT6_QUERY_DIMMING_CURVE: reply(0),
  DT6_QUERY_FAST_FADE_TIME: reply(0),
  QUERY_SCENE_LEVEL: reply(255),
  QUERY_STATUS: reply(0),
  QUERY_ACTUAL_LEVEL: reply(0),
  QUERY_POWER_ON_LEVEL: reply(0),
  QUERY_SYSTEM_FAILURE_LEVEL: reply(255),
};
const ids = (log: Logged[]) => log.flatMap((l) => l.cmds.map((c) => c.id));
const count = (log: Logged[], id: string) => ids(log).filter((x) => x === id).length;

describe('patient submit', () => {
  it('sends again at the time a refusal gives, up to five more times', async () => {
    const waits: number[] = [];
    let calls = 0;
    const p = patient(
      () => {
        calls++;
        return Promise.resolve<Submitted>({ kind: 'refused', reason: 'later', retryAt: 150 });
      },
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      () => 100,
    );
    const r = await p({ frames: [], source: 'internal' });
    expect(r.kind).toBe('refused');
    expect(calls).toBe(6);
    expect(waits).toEqual([50, 50, 50, 50, 50]);
  });
  it('waits at least 1 ms, and gives up at once without a time or on success', async () => {
    const waits: number[] = [];
    const answers: Submitted[] = [
      { kind: 'refused', reason: 'past', retryAt: 90 },
      { kind: 'refused', reason: 'never' },
    ];
    const p = patient(
      () => Promise.resolve(answers.shift() ?? { kind: 'done', results: [] }),
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      () => 100,
    );
    expect(await p({ frames: [], source: 'internal' })).toEqual({
      kind: 'refused',
      reason: 'never',
    });
    expect(waits).toEqual([1]);
    expect((await p({ frames: [], source: 'internal' })).kind).toBe('done');
  });
});

describe('scanning an address', () => {
  it('asks for everything the governor needs, in order, labelled, from the internal source', async () => {
    const g = gov('hardware');
    const bus = fakeBus(g, {
      ...DT6,
      QUERY_DEVICE_TYPE: reply(255),
      QUERY_NEXT_DEVICE_TYPE: [reply(6), reply(8), reply(254)],
      DT8_QUERY_COLOUR_TYPE_FEATURES: reply(0x02),
    });
    expect(await scanAddress(0, g, bus.submit)).toBe(true);
    expect(bus.log.every((l) => l.source === 'internal')).toBe(true);
    expect(bus.log.map((l) => l.label)).toEqual([
      'scan A0',
      'device type',
      'next device type',
      'next device type',
      'next device type',
      'QUERY_PHYSICAL_MINIMUM',
      'QUERY_MIN_LEVEL',
      'QUERY_MAX_LEVEL',
      'QUERY_FADE_TIME_FADE_RATE',
      'QUERY_EXTENDED_FADE_TIME',
      'QUERY_GROUPS_0_7',
      'QUERY_GROUPS_8_15',
      'dimming curve',
      'fast fade time',
      'colour type features',
      ...Array<string>(16).fill('scene level'),
      'status',
      'actual level',
    ]);
    expect(g.addressInfo(0)?.deviceTypes).toEqual([6, 8]);
    expect(g.addressInfo(0)?.modelled).toBe(true);
  });
  it('reads at most eight further device types, and stops at the first that does not answer', async () => {
    let g = gov();
    let bus = fakeBus(g, {
      ...DT6,
      QUERY_DEVICE_TYPE: reply(255),
      QUERY_NEXT_DEVICE_TYPE: reply(6),
    });
    await scanAddress(0, g, bus.submit);
    expect(count(bus.log, 'QUERY_NEXT_DEVICE_TYPE')).toBe(8);
    g = gov();
    bus = fakeBus(g, {
      ...DT6,
      QUERY_DEVICE_TYPE: reply(255),
      QUERY_NEXT_DEVICE_TYPE: { kind: 'no-reply' },
    });
    await scanAddress(0, g, bus.submit);
    expect(count(bus.log, 'QUERY_NEXT_DEVICE_TYPE')).toBe(1);
    expect(count(bus.log, 'DT6_QUERY_DIMMING_CURVE')).toBe(0);
  });
  it('asks DT6 and DT8 questions only of gear that reported them', async () => {
    const asked = async (dt: SendResult) => {
      const g = gov();
      const bus = fakeBus(g, { ...DT6, QUERY_DEVICE_TYPE: dt });
      await scanAddress(0, g, bus.submit, 'console');
      expect(bus.log.every((l) => l.source === 'console')).toBe(true);
      return [
        count(bus.log, 'DT6_QUERY_DIMMING_CURVE'),
        count(bus.log, 'DT8_QUERY_COLOUR_TYPE_FEATURES'),
      ];
    };
    expect(await asked(reply(6))).toEqual([1, 0]);
    expect(await asked(reply(8))).toEqual([0, 1]);
    expect(await asked(reply(254))).toEqual([0, 0]);
    expect(await asked({ kind: 'no-reply' })).toEqual([0, 0]);
  });
  it('starts a scan of the address, so writes before it do not stop it being modelled', async () => {
    const g = gov('hardware');
    see(g, { id: 'DAPC', address: short(0), value: 10 });
    expect(g.addressInfo(0)?.dirty).toBe(true);
    await scanAddress(0, g, fakeBus(g, DT6).submit);
    expect(g.addressInfo(0)?.modelled).toBe(true);
  });
  it('counts a framing error as gear present, and nothing as gear absent', async () => {
    const g = gov();
    expect(
      await scanAddress(
        0,
        g,
        fakeBus(g, { ...DT6, QUERY_CONTROL_GEAR_PRESENT: { kind: 'framing-error' } }).submit,
      ),
    ).toBe(true);
    expect(await scanAddress(0, g, fakeBus(g, {}).submit)).toBe(false);
    // A transaction that ends with no result is no answer.
    const empty: Submit = () => Promise.resolve({ kind: 'done', results: [] });
    expect(await scanAddress(0, g, empty)).toBe(false);
  });
  it('a missing reply to device type means no device types', async () => {
    const g = gov();
    let first = true;
    const bus = fakeBus(g, DT6);
    const submit: Submit = (t, p) => {
      if (t.label === 'device type' && first) {
        first = false;
        return Promise.resolve({ kind: 'done', results: [] });
      }
      return bus.submit(t, p);
    };
    expect(await scanAddress(0, g, submit)).toBe(true);
    expect(count(bus.log, 'DT6_QUERY_DIMMING_CURVE')).toBe(0);
  });
  it('a refusal stops the scan with the label and the reason', async () => {
    const g = gov();
    await expect(
      scanAddress(0, g, fakeBus(g, { QUERY_CONTROL_GEAR_PRESENT: 'refuse' }).submit),
    ).rejects.toThrow('scan A0: no');
    await expect(
      scanAddress(0, g, fakeBus(g, { ...DT6, QUERY_DEVICE_TYPE: 'refuse' }).submit),
    ).rejects.toThrow('device type: no');
  });
  it('a full scan asks all 64 addresses, then about gear without a short address', async () => {
    const g = gov();
    const bus = fakeBus(g, { QUERY_MISSING_SHORT_ADDRESS: reply(255) });
    expect(await scan(g, bus.submit)).toEqual([]);
    expect(bus.log.slice(0, 64).map((l) => l.cmds[0]?.address)).toEqual(
      Array.from({ length: 64 }, (_, i) => short(i)),
    );
    const last = bus.log[64];
    expect([last?.label, last?.source, last?.cmds[0]?.id]).toEqual([
      'unaddressed gear',
      'internal',
      'QUERY_MISSING_SHORT_ADDRESS',
    ]);
    expect(bus.log).toHaveLength(65);
    expect(g.inventoryStale).toBe(false);
  });
});

const UNCONFIRMED = [
  'POWER ON LEVEL 0 means off (a DALI-2 feature)',
  'The power-on colour is stored with POWER ON LEVEL',
];

/** DTR loads before each colour write in a log, as [command, DTR0, DTR1, DTR2]. */
function colourWrites(log: Logged[]): (string | number | undefined)[][] {
  const out: (string | number | undefined)[][] = [];
  for (const l of log) {
    const dtr: (number | undefined)[] = [undefined, undefined, undefined];
    for (const c of l.cmds) {
      if (c.id === 'DTR0') dtr[0] = c.value;
      if (c.id === 'DTR1') dtr[1] = c.value;
      if (c.id === 'DTR2') dtr[2] = c.value;
      if (c.id.startsWith('DT8_SET_TEMPORARY')) out.push([c.id, ...dtr]);
    }
  }
  return out;
}

describe('the safety profile', () => {
  it('writes the profile from the profile source, labelled, and verifies on a matching read-back', async () => {
    const g = gov();
    const bus = fakeBus(g, DT6);
    see(g, { id: 'QUERY_DEVICE_TYPE', address: short(0) }, reply(6));
    const r = await applySafetyProfile(0, g, bus.submit);
    expect(r).toEqual({ address: 0, verified: true, mismatches: [], unconfirmed: UNCONFIRMED });
    const mine = bus.log;
    expect(mine.every((l) => l.source === 'profile')).toBe(true);
    expect(mine.map((l) => l.label)).toEqual([
      'physical minimum',
      'min level',
      'MAX LEVEL',
      'POWER ON LEVEL',
      'SYSTEM FAILURE LEVEL',
      'read back MIN',
      'read back MAX',
      'read back POWER ON',
      'read back SYSTEM FAILURE',
      'read back curve',
    ]);
  });
  it('lowers MIN LEVEL only when it is above the ceiling, and a ceiling at the physical minimum is fine', async () => {
    const g = gov();
    g.setCeiling(85, 'ui');
    const bus = fakeBus(g, { ...DT6, QUERY_MAX_LEVEL: reply(85) });
    expect((await applySafetyProfile(0, g, bus.submit)).verified).toBe(true);
    expect(bus.log.map((l) => l.label)).not.toContain('lower MIN LEVEL');
    const h = gov();
    h.setCeiling(85, 'ui');
    const hb = fakeBus(h, {
      ...DT6,
      QUERY_PHYSICAL_MINIMUM: reply(40),
      QUERY_MIN_LEVEL: [reply(100), reply(40)],
      QUERY_MAX_LEVEL: reply(85),
    });
    expect((await applySafetyProfile(0, h, hb.submit)).verified).toBe(true);
    expect(hb.log.map((l) => l.label)).toContain('lower MIN LEVEL');
    // A MIN LEVEL under or at the ceiling stays as it is, and the read-back expects it.
    for (const ceiling of [220, 100]) {
      const k = gov();
      if (ceiling !== 220) k.setCeiling(ceiling, 'ui');
      const kb = fakeBus(k, {
        ...DT6,
        QUERY_MIN_LEVEL: reply(100),
        QUERY_MAX_LEVEL: reply(ceiling),
      });
      expect((await applySafetyProfile(0, k, kb.submit)).verified).toBe(true);
      expect(kb.log.map((l) => l.label)).not.toContain('lower MIN LEVEL');
    }
  });
  it('lists each read-back that does not match', async () => {
    const g = gov();
    const bus = fakeBus(g, {
      ...DT6,
      QUERY_MIN_LEVEL: [reply(230), reply(90)],
      QUERY_MAX_LEVEL: reply(200),
      QUERY_POWER_ON_LEVEL: reply(5),
      QUERY_SYSTEM_FAILURE_LEVEL: reply(0),
      DT6_QUERY_DIMMING_CURVE: reply(1),
      QUERY_DEVICE_TYPE: reply(6),
    });
    see(g, { id: 'QUERY_DEVICE_TYPE', address: short(0) }, reply(6));
    expect(await applySafetyProfile(0, g, bus.submit)).toEqual({
      address: 0,
      verified: false,
      mismatches: [
        { what: 'MAX LEVEL', expected: 220, actual: 200 },
        { what: 'MIN LEVEL', expected: 85, actual: 90 },
        { what: 'POWER ON LEVEL', expected: 0, actual: 5 },
        { what: 'SYSTEM FAILURE LEVEL', expected: 255, actual: 0 },
        { what: 'dimming curve', expected: 0, actual: 1 },
      ],
      unconfirmed: UNCONFIRMED,
    });
  });
  it('fails with a reason when the gear does not answer or the ceiling is too low', async () => {
    const fail = (reason: string) => ({
      address: 0,
      verified: false,
      reason,
      mismatches: [],
      unconfirmed: UNCONFIRMED,
    });
    let g = gov();
    expect(
      await applySafetyProfile(0, g, fakeBus(g, { QUERY_PHYSICAL_MINIMUM: reply(85) }).submit),
    ).toEqual(fail('The gear did not answer.'));
    g = gov();
    expect(
      await applySafetyProfile(0, g, fakeBus(g, { QUERY_MIN_LEVEL: reply(85) }).submit),
    ).toEqual(fail('The gear did not answer.'));
    g = gov();
    g.setCeiling(84, 'ui');
    expect(await applySafetyProfile(0, g, fakeBus(g, DT6).submit)).toEqual(
      fail("The ceiling is below this driver's physical minimum (arc level 85)."),
    );
    g = gov();
    expect(
      await applySafetyProfile(0, g, fakeBus(g, { ...DT6, SET_MAX_LEVEL: 'refuse' }).submit),
    ).toEqual(fail('MAX LEVEL: no'));
  });
  it('is not verified when the governor saw something else on the bus', async () => {
    const g = gov();
    const r = await applySafetyProfile(0, g, fakeBus(g, DT6, false).submit);
    expect(r).toEqual({
      address: 0,
      verified: false,
      reason: 'The read-back does not match what the governor saw on the bus.',
      mismatches: [],
      unconfirmed: UNCONFIRMED,
    });
  });
  it('stores a warm power-on colour that matches the colour features', async () => {
    const writes = async (types: number, features: number | undefined) => {
      const g = gov();
      const bus = fakeBus(g, DT6);
      see(g, { id: 'QUERY_DEVICE_TYPE', address: short(0) }, reply(types));
      if (features !== undefined)
        see(g, { id: 'DT8_QUERY_COLOUR_TYPE_FEATURES', address: short(0) }, reply(features));
      const r = await applySafetyProfile(0, g, bus.submit);
      expect(r.verified).toBe(true);
      const labels = bus.log.map((l) => l.label);
      return { writes: colourWrites(bus.log), labelled: labels.includes('warm power-on colour') };
    };
    expect(await writes(8, 0x02)).toEqual({
      writes: [['DT8_SET_TEMPORARY_TC', 370 & 0xff, 370 >> 8, undefined]],
      labelled: true,
    });
    // Three channels: red. Four or more: white.
    expect(await writes(8, 0x60)).toEqual({
      writes: [
        ['DT8_SET_TEMPORARY_RGB', 254, 0, 0],
        ['DT8_SET_TEMPORARY_WAF', 0, 0, 0],
      ],
      labelled: true,
    });
    expect((await writes(8, 0x80)).writes).toEqual([
      ['DT8_SET_TEMPORARY_RGB', 0, 0, 0],
      ['DT8_SET_TEMPORARY_WAF', 254, 0, 0],
    ]);
    expect((await writes(8, 0xa0)).writes[1]).toEqual(['DT8_SET_TEMPORARY_WAF', 254, 0, 0]);
    // No colour features, none to store, or no DT8: nothing.
    expect(await writes(8, 0x00)).toEqual({ writes: [], labelled: false });
    expect(await writes(8, undefined)).toEqual({ writes: [], labelled: false });
    expect(await writes(6, 0x02)).toEqual({ writes: [], labelled: false });
  });
});

describe('RESET and restore', () => {
  const noWait = () => Promise.resolve();
  it('sends RESET, then OFF at the head of the queue, with labels', async () => {
    const g = gov();
    const bus = fakeBus(g, DT6);
    const r = await resetAndRestore(0, g, bus.submit, noWait, 'console', noWait);
    expect(r.ok).toBe(true);
    expect(bus.log.slice(0, 2).map((l) => [l.label, l.priority, l.source])).toEqual([
      ['RESET', undefined, 'console'],
      ['OFF after RESET', 'urgent', 'console'],
    ]);
  });
  it('sends panic when the OFF is refused, and says so', async () => {
    const g = gov();
    let panicked = false;
    const r = await resetAndRestore(
      0,
      g,
      fakeBus(g, { ...DT6, OFF: 'refuse' }).submit,
      noWait,
      'console',
      () => {
        panicked = true;
        return Promise.resolve();
      },
    );
    expect(r).toEqual({ ok: false, reason: 'OFF after RESET: no. Panic sent OFF instead.' });
    expect(panicked).toBe(true);
  });
  it('reports a profile that did not verify', async () => {
    const g = gov();
    const r = await resetAndRestore(
      0,
      g,
      fakeBus(g, { ...DT6, QUERY_POWER_ON_LEVEL: reply(5) }).submit,
      noWait,
      'console',
      noWait,
    );
    expect([r.ok, r.ok ? '' : r.reason]).toEqual([false, 'The safety profile did not verify.']);
    const h = gov();
    const s = await resetAndRestore(
      0,
      h,
      fakeBus(h, { ...DT6, QUERY_PHYSICAL_MINIMUM: { kind: 'no-reply' } }).submit,
      noWait,
      'console',
      noWait,
    );
    expect(s.ok ? '' : s.reason).toBe('The gear did not answer.');
  });
});
