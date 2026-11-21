/**
 * U-engine: the engine with the simulated bench, and with a "hardware" transport that is a second
 * simulator behind a transport the test controls. Covers SPEC R1.1, R1.1a, R1.3, R1.5, R1.8, D1 to D3,
 * S1.1, S4 and S4.6.
 */
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../bus/clock.ts';
import { withFloors } from '../bus/timing.ts';
import { short } from '../dali/address.ts';
import { Da5l } from '../sim/gear.ts';
import { benchA, benchB } from '../sim/profile.ts';
import { Rig } from '../sim/rig.ts';
import { Simulator } from '../sim/simulator.ts';
import { SimTransport } from '../transport/sim.ts';
import type { TxFrame } from '../dali/sequences.ts';
import type { SendResult } from '../safety/types.ts';
import { Engine, HEARTBEAT_LIMIT_MS, type Snapshot } from './engine.ts';
import type { HardwareInfo, HardwareTransport, TransportState } from './transport.ts';

/** A simulator behind a transport whose connection the test controls. */
class FakeHardware implements HardwareTransport {
  readonly kind = 'server';
  readonly inner: SimTransport;
  st: TransportState = 'down';
  attached = true;
  failConnect: string | undefined;
  engine: Engine | undefined;
  constructor(
    readonly sim: Simulator,
    clock: VirtualClock,
  ) {
    this.inner = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  }
  state(): TransportState {
    return this.st;
  }
  info(): HardwareInfo {
    return { fwMajor: 2, fwMinor: 4, attached: this.attached };
  }
  connect(): Promise<void> {
    if (this.failConnect !== undefined) return Promise.reject(new Error(this.failConnect));
    this.st = 'ready';
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.st = 'down';
    return Promise.resolve();
  }
  send(f: TxFrame): Promise<SendResult> {
    if (this.st !== 'ready') return Promise.resolve({ kind: 'fault', reason: 'down' });
    return this.inner.send(f);
  }
  sendPanic(f: TxFrame): Promise<SendResult> {
    return this.inner.sendPanic(f);
  }
  drop(): void {
    this.st = 'down';
    this.engine?.onTransportState('down', 'The connection to the server closed.');
  }
}

function setup(o: { hardware?: boolean; hwSim?: Simulator } = {}) {
  const clock = new VirtualClock(1000);
  const sim = Simulator.bench();
  const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  const hwSim = o.hwSim ?? Simulator.bench({ at: 0 });
  const hw = o.hardware === false ? undefined : new FakeHardware(hwSim, clock);
  const engine = new Engine({
    clock,
    sim,
    simTransport,
    ...(hw === undefined ? {} : { hardware: hw }),
  });
  if (hw !== undefined) hw.engine = engine;
  const drive = async <T>(p: Promise<T>, limit = 600_000): Promise<T> => {
    const st: { done: boolean; failed: boolean; value?: T; error?: unknown } = {
      done: false,
      failed: false,
    };
    p.then(
      (v) => {
        st.done = true;
        st.value = v;
      },
      (e: unknown) => {
        st.done = true;
        st.failed = true;
        st.error = e;
      },
    );
    const end = clock.now() + limit;
    const isDone = () => st.done;
    while (!isDone()) {
      await flushMicrotasks();
      if (isDone()) break;
      const n = clock.next();
      if (n === undefined || n > end) throw new Error('The engine did not finish.');
      await clock.advanceTo(n);
    }
    if (st.failed) throw st.error;
    return st.value as T;
  };
  /** Run the clock until the engine has no jobs left. */
  const settle = async (limit = 600_000) => {
    const end = clock.now() + limit;
    while (engine.snapshot().jobs.length > 0) {
      const n = clock.next();
      if (n === undefined || n > end) throw new Error('Jobs did not finish.');
      await clock.advanceTo(n);
    }
    await clock.advance(10);
  };
  return { clock, sim, simTransport, hw, hwSim, engine, drive, settle };
}

/** The gear's level once everything has settled, asked on a copy so the bench is not touched. */
const levelOf = (s: Simulator, n: number): number | 'none' | 'collision' =>
  new Rig(s.fork(), 1e9).ask('QUERY_ACTUAL_LEVEL', n);

describe('the simulated bench', () => {
  it('scans and verifies the bench at start (SPEC S1.1, R14.1)', async () => {
    const { engine, settle } = setup();
    await settle();
    const s = engine.snapshot();
    expect(s.target).toBe('simulator');
    expect(s.devices.map((d) => [d.address, d.verified, d.ceiling])).toEqual([
      [0, true, 'verified'],
      [1, true, 'verified'],
    ]);
    expect(s.devices[0]?.facts?.drive).toBe('tc');
    expect(s.devices[1]?.facts?.drive).toBe('rgbwaf');
    expect(s.devices[1]?.facts?.assigned).toHaveLength(6);
    expect(s.devices[0]?.facts?.tcLimits?.coolest).toBeGreaterThan(0);
    expect(s.inventoryStale).toBe(false);
    engine.dispose();
  });

  it('sends commands, raw frames and levels through the governor', async () => {
    const { engine, settle, drive, sim, clock } = setup({ hardware: false });
    await settle();
    const r = await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'DAPC', address: short(0), value: 254 }] },
        'ui',
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toContain('ceiling');
    expect(levelOf(sim, 0)).toBeLessThanOrEqual(220);
    const q = await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'QUERY_MAX_LEVEL', address: short(0) }] },
        'ui',
      ),
    );
    expect(q).toEqual({ ok: true, answers: [220] });
    // A raw frame that does not decode is refused by the governor.
    const raw = await drive(engine.request({ kind: 'raw', a: 0x01, b: 0xff }, 'ui'));
    expect(raw.ok).toBe(false);
    const unknown = await drive(
      engine.request({ kind: 'commands', commands: [{ id: 'NOPE' }] }, 'ui'),
    );
    expect(unknown).toEqual({ ok: false, reason: 'Unknown command NOPE.' });
    const bad = await drive(
      engine.request({ kind: 'commands', commands: [{ id: 'DAPC', value: 3 }] }, 'ui'),
    );
    expect(bad.ok).toBe(false);
    // Live levels go through the coalescer and land on the newest value.
    await clock.advance(3000);
    for (const arc of [100, 120, 140, 160])
      await engine.request({ kind: 'level', address: 1, arc }, 'ui');
    await clock.advance(5000);
    expect(levelOf(sim, 1)).toBe(160);
    expect((await engine.request({ kind: 'level', address: 70, arc: 1 }, 'ui')).ok).toBe(false);
    expect((await engine.request({ kind: 'level', address: 1, arc: 255 }, 'ui')).ok).toBe(false);
    engine.dispose();
  });

  it('offers Hardware and Both only with the server (SPEC R1.3)', async () => {
    const { engine } = setup({ hardware: false });
    expect(engine.snapshot().hardwareAvailable).toBe(false);
    const r = await engine.setTarget('hardware', 'ui');
    expect(r.ok).toBe(false);
    expect(engine.snapshot().target).toBe('simulator');
    expect((await engine.setTarget('simulator', 'script')).ok).toBe(false);
    engine.dispose();
  });
});

describe('hardware and Both', () => {
  it('connects with a fresh governor, scans, writes the profile and asks the operator (SPEC R1.1a, S1.1, D1)', async () => {
    const { engine, settle, drive, hwSim } = setup();
    await settle();
    expect((await drive(engine.setTarget('hardware', 'ui'))).ok).toBe(true);
    await settle();
    const s = engine.snapshot();
    expect(s.connection).toBe('ready');
    expect(s.firmware).toBe('2.4');
    expect(s.askCanSee).toBe(true);
    expect(s.devices.map((d) => [d.address, d.verified, d.modelled])).toEqual([
      [0, true, true],
      [1, true, true],
    ]);
    // The profile reached the hardware's gear.
    expect(hwSim.byShortAddress(0)?.gear.snapshot().maxLevel).toBe(220);
    expect(engine.answerCanSee(false, 'script').ok).toBe(false);
    expect(engine.answerCanSee(false, 'ui').ok).toBe(true);
    expect(engine.snapshot().operatorCanSee).toBe(false);
    // The operator cannot see the lights: no rate unlock this session.
    expect(engine.unlock('rate', 'ui', true).ok).toBe(false);
    engine.dispose();
  });

  it('starts again from nothing on a change between Hardware and Both', async () => {
    const { engine, settle, drive } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    engine.unlock('expert', 'ui', true);
    expect(engine.snapshot().unlocks).toEqual(['expert']);
    await drive(engine.setTarget('both', 'ui'));
    // A new connection: nothing verified, nothing unlocked, until its own scan and profile complete.
    const s = engine.snapshot();
    expect(s.unlocks).toEqual([]);
    expect(s.devices).toEqual([]);
    await settle();
    expect(engine.snapshot().devices.every((d) => d.verified)).toBe(true);
    engine.dispose();
  });

  it('shows a dropped connection, stops work and sends nothing to the simulator in its place (SPEC R1.8)', async () => {
    const { engine, settle, drive, hw, sim } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    const before = levelOf(sim, 0);
    hw?.drop();
    const s = engine.snapshot();
    expect(s.connection).toBe('disconnected');
    expect(s.target).toBe('hardware');
    const r = await engine.request(
      { kind: 'commands', commands: [{ id: 'OFF', address: short(0) }] },
      'ui',
    );
    expect(r).toEqual({ ok: false, reason: 'Hardware: disconnected.' });
    expect(levelOf(sim, 0)).toBe(before);
    // Reconnect is a person's choice, and starts afresh.
    expect((await engine.reconnect('script')).ok).toBe(false);
    expect((await drive(engine.reconnect('ui'))).ok).toBe(true);
    await settle();
    expect(engine.snapshot().connection).toBe('ready');
    engine.dispose();
  });

  it('reports a connection that fails, and the hasseb going and coming', async () => {
    const { engine, settle, drive, hw } = setup();
    await settle();
    if (hw === undefined) throw new Error('hardware');
    hw.failConnect = 'The server refused the session token.';
    const r = await drive(engine.setTarget('hardware', 'ui'));
    expect(r).toEqual({ ok: false, reason: 'The server refused the session token.' });
    expect(engine.snapshot().connection).toBe('disconnected');
    hw.failConnect = undefined;
    hw.attached = false;
    expect((await drive(engine.reconnect('ui'))).ok).toBe(false);
    expect(engine.snapshot().connection).toBe('no-hasseb');
    hw.attached = true;
    engine.onDevice(true);
    await settle();
    expect(engine.snapshot().connection).toBe('ready');
    engine.onDevice(false);
    expect(engine.snapshot().connection).toBe('no-hasseb');
    expect(engine.snapshot().devices).toEqual([]);
    engine.dispose();
  });

  it('logs a divergence in Both when the hardware differs from the shadow, and rescans (SPEC R1.5)', async () => {
    const { engine, settle, drive, hwSim, clock } = setup();
    await settle();
    await drive(engine.setTarget('both', 'ui'));
    await settle();
    expect(engine.snapshot().divergences).toEqual([]);
    // Something the app did not send changes the hardware: another master, or a driver doing its own thing.
    const gear = hwSim.byShortAddress(1)?.gear;
    if (gear === undefined) throw new Error('gear');
    hwSim.send({ frame: { a: 0x02, b: 100 }, sendTwice: false, expectReply: false }, clock.now());
    // The background check finds it within a few seconds, and a rescan follows.
    await clock.advance(5000);
    await settle();
    const d = engine.snapshot().divergences;
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]).toMatchObject({
      address: 1,
      command: 'QUERY_ACTUAL_LEVEL',
      shadow: '0',
      hardware: '100',
    });
    // After the rescan the shadow agrees again.
    const count = d.length;
    await clock.advance(5000);
    expect(engine.snapshot().divergences.length).toBe(count);
    engine.clearDivergences();
    expect(engine.snapshot().divergences).toEqual([]);
    engine.dispose();
  });

  it('compares nothing in Hardware, only in Both', async () => {
    const { engine, settle, drive, hwSim, clock } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    hwSim.send({ frame: { a: 0x02, b: 100 }, sendTwice: false, expectReply: false }, clock.now());
    await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'QUERY_ACTUAL_LEVEL', address: short(1) }] },
        'ui',
      ),
    );
    await clock.advance(3000);
    expect(engine.snapshot().divergences).toEqual([]);
    engine.dispose();
  });
});

describe('replaced connections (security review H1)', () => {
  const nonPanicAfterPanic = (hw: FakeHardware, from: number): string[] => {
    const log = hw.inner.log.slice(from);
    const last = log.map((l) => l.panic).lastIndexOf(true);
    return log.slice(last + 1).map((l) => `${String(l.frame.frame.a)},${String(l.frame.frame.b)}`);
  };

  for (const change of ['both', 'simulator', 'reconnect', 'drop', 'unplug'] as const) {
    it(`nothing the old connection queued reaches the bus after panic (${change})`, async () => {
      const { engine, settle, drive, hw, clock } = setup();
      if (hw === undefined) throw new Error('hardware');
      await settle();
      await drive(engine.setTarget('hardware', 'ui'));
      await settle();
      await clock.advance(3000);
      const from = hw.inner.log.length;
      // Work queued on the hardware connection, not yet on the bus.
      // Queries, which the governor always allows, so only the retirement can stop them.
      const queued = [0, 1, 0, 1].map((n) =>
        engine.request(
          { kind: 'commands', commands: [{ id: 'QUERY_ACTUAL_LEVEL', address: short(n) }] },
          'ui',
        ),
      );
      if (change === 'both') void engine.setTarget('both', 'ui');
      else if (change === 'simulator') await engine.setTarget('simulator', 'ui');
      else if (change === 'reconnect') void engine.reconnect('ui');
      else if (change === 'drop') hw.drop();
      else engine.onDevice(false);
      if (change === 'drop') hw.st = 'ready';
      const p = engine.panic();
      await drive(p);
      await clock.advance(5000);
      for (const q of queued) await q;
      expect(nonPanicAfterPanic(hw, from)).toEqual([]);
      // Panic still reaches the real lights, whatever the target (DALI re-review).
      if (change !== 'drop' && change !== 'unplug') {
        const panics = hw.inner.log
          .slice(from)
          .filter((l) => l.panic)
          .map((l) => l.frame.frame);
        expect(panics.slice(-2)).toEqual([
          { a: 0xa1, b: 0x00 },
          { a: 0xff, b: 0x00 },
        ]);
      }
      const sent = hw.inner.log.slice(from).filter((l) => !l.panic);
      // At most the frame already on the wire went out; the rest were dropped.
      expect(sent.length).toBeLessThanOrEqual(1);
      engine.dispose();
    });
  }
});

describe('panic reaches the idle server connection (re-review R1)', () => {
  it('turns the real lights off after a change to Simulator', async () => {
    const { engine, settle, drive, hw, hwSim, clock } = setup();
    if (hw === undefined) throw new Error('hardware');
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    engine.answerCanSee(true, 'ui');
    await clock.advance(3000);
    // On hardware the colour goes first: Apply sends it, then the level once the governor takes it
    // (ADR 0019).
    const on = await drive(
      engine.request({ kind: 'apply', address: 0, mirek: 300, arc: 120 }, 'ui'),
    );
    expect(on.ok).toBe(true);
    expect(levelOf(hwSim, 0)).toBe(120);
    await drive(engine.setTarget('simulator', 'ui'));
    await drive(engine.panic());
    expect(levelOf(hwSim, 0)).toBe(0);
    engine.dispose();
  });
});

describe('Apply to gear whose colour the governor does not know (ADR 0019)', () => {
  /** A hardware bench with A0 lit before the app connects, and an Apply of a colour and a low level. */
  const waiting = async () => {
    const hwSim = Simulator.bench({ at: 0 });
    new Rig(hwSim, 0).to('DAPC', 0, 200);
    const s = setup({ hwSim });
    await s.settle();
    await s.drive(s.engine.setTarget('hardware', 'ui'));
    await s.settle();
    s.engine.answerCanSee(true, 'ui');
    await s.clock.advance(3000);
    const before = levelOf(hwSim, 0);
    const apply = s.engine.request({ kind: 'apply', address: 0, mirek: 300, arc: 100 }, 'ui');
    // The colour has gone, and the level waits for the governor.
    await s.clock.advance(800);
    expect(levelOf(hwSim, 0)).toBe(before);
    return { ...s, hwSim, apply, before };
  };

  it('sends the colour, then the level once the governor takes it', async () => {
    const { engine, drive, apply, hwSim } = await waiting();
    expect((await drive(apply)).ok).toBe(true);
    expect(levelOf(hwSim, 0)).toBe(100);
    engine.dispose();
  });

  it('does not send the level after a stop (S8b-M3)', async () => {
    const { engine, drive, apply, hwSim, before, clock } = await waiting();
    engine.stopRunners('test');
    expect(await drive(apply)).toMatchObject({ ok: false, kind: 'dropped' });
    await clock.advance(6000);
    expect(levelOf(hwSim, 0)).toBe(before);
    engine.dispose();
  });

  it('does not send the level after panic and resume', async () => {
    const { engine, drive, apply, hwSim, clock } = await waiting();
    await drive(engine.panic());
    expect(engine.resume('ui').ok).toBe(true);
    expect((await drive(apply)).ok).toBe(false);
    await clock.advance(6000);
    expect(levelOf(hwSim, 0)).toBe(0);
    engine.dispose();
  });

  it('gives way to a newer level for the address', async () => {
    const { engine, drive, apply } = await waiting();
    await engine.request({ kind: 'level', address: 0, arc: 90 }, 'ui');
    expect(await drive(apply)).toMatchObject({
      ok: false,
      reason: 'A newer level replaced this one.',
    });
    engine.dispose();
  });

  it('refuses a level with no colour, and says to set the colour first', async () => {
    const { engine, drive, settle, clock } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    engine.answerCanSee(true, 'ui');
    await clock.advance(3000);
    const r = await drive(engine.request({ kind: 'apply', address: 0, arc: 120 }, 'ui'));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.reason).toMatch(/set its colour before its level/);
    engine.dispose();
  });
});

describe('panic and the latch (SPEC S4)', () => {
  it('stops everything, sends TERMINATE and OFF on every connection, and holds until a person resumes', async () => {
    const { engine, settle, drive, hw, simTransport, clock } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    // Panic in the middle of the connect scan.
    await clock.advance(300);
    const p = engine.panic();
    expect(engine.snapshot().latched).toBe(true);
    await drive(p);
    const simPanics = simTransport.log.filter((l) => l.panic).map((l) => l.frame.frame);
    expect(simPanics).toEqual([
      { a: 0xa1, b: 0x00 },
      { a: 0xff, b: 0x00 },
    ]);
    expect(hw?.inner.log.filter((l) => l.panic)).toHaveLength(2);
    await settle();
    expect(engine.snapshot().jobs).toEqual([]);
    const r = await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'QUERY_ACTUAL_LEVEL', address: short(0) }] },
        'ui',
      ),
    );
    expect(r.ok).toBe(false);
    expect(engine.resume('script').ok).toBe(false);
    expect(engine.resume('ui').ok).toBe(true);
    expect(engine.snapshot().latched).toBe(false);
    engine.dispose();
  });

  it('a new hardware connection made while latched starts latched', async () => {
    const { engine, settle, drive } = setup();
    await settle();
    await drive(engine.panic());
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    expect(engine.snapshot().latched).toBe(true);
    // The scan was refused by the latch, so nothing is verified.
    expect(engine.snapshot().devices.every((d) => !d.verified)).toBe(true);
    engine.dispose();
  });

  it('stops runners when a visible page stops sending heartbeats (SPEC S4.6)', async () => {
    const { engine, clock } = setup({ hardware: false });
    engine.heartbeat(true);
    // The start-up scan is running. No heartbeats arrive.
    await clock.advance(HEARTBEAT_LIMIT_MS + 1100);
    expect(engine.snapshot().notices.some((n) => n.includes('could not offer Panic'))).toBe(true);
    expect(engine.snapshot().jobs).toEqual([]);
    engine.dispose();
  });

  it('a hidden page is exempt from the heartbeat', async () => {
    const { engine, clock, settle } = setup({ hardware: false });
    engine.heartbeat(false);
    await clock.advance(HEARTBEAT_LIMIT_MS + 1100);
    expect(engine.snapshot().notices).toEqual([]);
    await settle();
    expect(engine.snapshot().devices.every((d) => d.verified)).toBe(true);
    engine.dispose();
  });
});

describe('settings', () => {
  it('lowers the ceiling at once and rewrites MAX LEVEL; raising needs a confirmation', async () => {
    const { engine, settle, drive, sim } = setup({ hardware: false });
    await settle();
    expect((await drive(engine.setCeiling(200, 'ui'))).ok).toBe(true);
    await settle();
    expect(engine.snapshot().ceilingArc).toBe(200);
    expect(sim.byShortAddress(0)?.gear.snapshot().maxLevel).toBe(200);
    expect((await drive(engine.setCeiling(230, 'script', true))).ok).toBe(false);
    expect((await drive(engine.setCeiling(230, 'ui', false))).ok).toBe(false);
    expect((await drive(engine.setCeiling(230, 'ui', true))).ok).toBe(true);
    await settle();
    expect(engine.snapshot().ceilingArc).toBe(230);
    expect(engine.snapshot().devices.every((d) => d.ceiling === 'verified')).toBe(true);
    engine.dispose();
  });

  it('unlocks, locks and sets the swing limit for a person only', () => {
    const { engine } = setup({ hardware: false });
    expect(engine.unlock('rate', 'script', true).ok).toBe(false);
    expect(engine.unlock('rate', 'ui', true).ok).toBe(true);
    expect(engine.setSwingLimit(3, 'ui').ok).toBe(true);
    expect(engine.snapshot().swingLimit).toBe(3);
    engine.lock('rate');
    expect(engine.snapshot().swingLimit).toBe(1);
    expect(engine.snapshot().unlocks).toEqual([]);
    engine.lock();
    expect(engine.answerCanSee(true, 'ui').ok).toBe(false);
    engine.dispose();
  });

  it('re-applies the profile and rescans on request', async () => {
    const { engine, settle, drive } = setup({ hardware: false });
    await settle();
    expect((await engine.rescan('script')).ok).toBe(false);
    expect((await engine.reapplyProfile('script')).ok).toBe(false);
    expect((await drive(engine.reapplyProfile('ui'))).ok).toBe(true);
    expect((await drive(engine.rescan('ui'))).ok).toBe(true);
    expect(engine.snapshot().devices).toHaveLength(2);
    engine.dispose();
  });

  it('tells subscribers about changes', async () => {
    const { engine, settle } = setup({ hardware: false });
    const seen: Snapshot[] = [];
    const off = engine.subscribe((s) => seen.push(s));
    await settle();
    expect(seen.length).toBeGreaterThan(2);
    off();
    const n = seen.length;
    engine.lock();
    expect(seen.length).toBe(n);
    engine.dispose();
  });
});

describe('commissioning (SPEC D3)', () => {
  it('needs a person, the reset unlock and the typed word, then gives free addresses and verifies them', async () => {
    const hwSim = Simulator.bench({ at: 0 });
    hwSim.add({ id: 'C', gear: new Da5l(benchA(), { shortAddress: null, at: 0, seed: 77 }) });
    hwSim.add({ id: 'D', gear: new Da5l(benchB(), { shortAddress: null, at: 0, seed: 99 }) });
    const { engine, settle, drive } = setup({ hwSim });
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    expect((await engine.commission('script', 'commission')).ok).toBe(false);
    expect((await engine.commission('ui', 'commission')).ok).toBe(false);
    engine.unlock('reset', 'ui', true);
    expect((await engine.commission('ui', 'yes')).ok).toBe(false);
    const r = await drive(engine.commission('ui', 'commission'));
    expect(r).toEqual({ ok: true });
    const s = engine.snapshot();
    expect(s.commission?.assigned.map((a) => a.address).sort()).toEqual([2, 3]);
    expect(s.commission?.problems).toEqual([]);
    expect(hwSim.unit('C')?.gear.shortAddress).not.toBeNull();
    expect(s.devices.map((d) => [d.address, d.verified])).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, true],
    ]);
    engine.dispose();
  }, 60_000);
});

describe('commissioning with a shared random address (DALI review 3)', () => {
  async function run(c: number[], d: number[]) {
    const hwSim = Simulator.bench({ at: 0 });
    hwSim.add({
      id: 'C',
      gear: new Da5l(benchA(), { shortAddress: null, at: 0, randomPreload: c }),
    });
    hwSim.add({
      id: 'D',
      gear: new Da5l(benchB(), { shortAddress: null, at: 0, randomPreload: d }),
    });
    const { engine, settle, drive } = setup({ hwSim });
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    engine.unlock('reset', 'ui', true);
    await drive(engine.commission('ui', 'commission'));
    const result = engine.snapshot().commission;
    engine.dispose();
    return { result, c: hwSim.unit('C')?.gear.shortAddress, d: hwSim.unit('D')?.gear.shortAddress };
  }

  it('randomises again, and gives each driver its own address', async () => {
    const { result, c, d } = await run([0x123456, 0x200000], [0x123456, 0x300000]);
    expect(result?.problems).toEqual([]);
    expect([c, d].sort()).toEqual([2, 3]);
  }, 60_000);

  it('gives up rather than share an address when the clash never clears', async () => {
    const same = Array.from({ length: 10 }, () => 0x0abcde);
    const { result, c, d } = await run(same, same);
    expect(result?.problems.join(' ')).toContain('kept choosing the same random address');
    expect(c).toBeNull();
    expect(d).toBeNull();
  }, 60_000);
});

describe('the hardware check', () => {
  it('runs every automatic step on the bench and records manual ones', async () => {
    const { engine, settle, drive } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    engine.answerCanSee(true, 'ui');
    const auto = [
      'p2-device-types',
      'p2-colour-features',
      'p2-assigned-colours',
      'p2-limits',
      'p2-power-levels',
      'p2-fades',
      'p2-curve-features',
      'p2-tc-limits',
      'p2-scenes-groups',
      'p2-colour-as-shipped',
      'p2-versions',
      'p3-status-report',
      'p3-empty-address',
      'p3-throughput',
      'p4-profile',
    ];
    for (const id of auto) {
      const r = await drive(engine.runCheck(id, 'ui'));
      expect([id, r]).toEqual([id, { ok: true }]);
    }
    expect(
      (await drive(engine.runCheck('p3-unplug', 'ui', { note: 'The fault showed.' }))).ok,
    ).toBe(true);
    expect((await drive(engine.runCheck('p4-power-cycle', 'ui', { skip: true }))).ok).toBe(true);
    const report = JSON.parse(engine.checkReportText()) as {
      steps: { id: string; status: string; values?: unknown; note?: string }[];
    };
    const by = new Map(report.steps.map((s) => [s.id, s]));
    expect(by.get('p2-limits')?.values).toEqual({
      A0: {
        physicalMinimum: expect.any(Number) as number,
        min: expect.any(Number) as number,
        max: 220,
      },
      A1: {
        physicalMinimum: expect.any(Number) as number,
        min: expect.any(Number) as number,
        max: 220,
      },
    });
    expect(by.get('p3-unplug')).toMatchObject({ status: 'recorded', note: 'The fault showed.' });
    expect(by.get('p4-power-cycle')?.status).toBe('skipped');
    expect(by.get('p4-stop-server')?.status).toBe('not run');
    engine.clearCheck();
    expect(engine.snapshot().check).toEqual([]);
    engine.dispose();
  }, 60_000);

  it('runs the confirm steps only with a confirmation and their unlock', async () => {
    const { engine, settle, drive, hwSim } = setup();
    await settle();
    await drive(engine.setTarget('hardware', 'ui'));
    await settle();
    expect((await engine.runCheck('p2-store-tc-limit', 'ui')).ok).toBe(false);
    expect(await engine.runCheck('p2-store-tc-limit', 'ui', { confirmed: true })).toEqual({
      ok: false,
      reason: 'This step needs the expert unlock.',
    });
    engine.unlock('expert', 'ui', true);
    expect(await drive(engine.runCheck('p2-store-tc-limit', 'ui', { confirmed: true }))).toEqual({
      ok: true,
    });
    expect(
      await drive(engine.runCheck('p3-store-gear-features', 'ui', { confirmed: true })),
    ).toEqual({ ok: true });
    expect(await drive(engine.runCheck('p4-max-below-level', 'ui', { confirmed: true }))).toEqual({
      ok: true,
    });
    expect(hwSim.byShortAddress(0)?.gear.snapshot().maxLevel).toBe(220);
    expect(
      await drive(engine.runCheck('p4-system-failure-fade', 'ui', { confirmed: true })),
    ).toEqual({ ok: true });
    expect(await drive(engine.runCheck('p4-panic-in-flight', 'ui', { confirmed: true }))).toEqual({
      ok: true,
    });
    expect(engine.snapshot().latched).toBe(true);
    const report = JSON.parse(engine.checkReportText()) as {
      steps: { id: string; values?: Record<string, unknown> }[];
    };
    const tc = report.steps.find((s) => s.id === 'p2-store-tc-limit');
    expect(tc?.values?.['changed']).toBe(true);
    expect(tc?.values?.['restored']).toBe(true);
    const gf = report.steps.find((x) => x.id === 'p3-store-gear-features');
    expect([gf?.values?.['changed'], gf?.values?.['restored']]).toEqual([true, true]);
    const inFlight = report.steps.find((x) => x.id === 'p4-panic-in-flight');
    expect(typeof inFlight?.values?.['inFlight']).toBe('boolean');
    expect((await engine.runCheck('nope', 'ui')).ok).toBe(false);
    expect((await engine.runCheck('p2-limits', 'script')).ok).toBe(false);
    engine.dispose();
  }, 60_000);
});
