/**
 * U-engine for Stage 5: what the playground and the bench preview need from the engine. Live light
 * state, colour and Apply intents, the DAPC sequence for a moving control, feedback on live values,
 * the bus monitor's fields, the stored ceiling, and setting up the simulated bench (SPEC R1.6, R13).
 */
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../bus/clock.ts';
import { withFloors } from '../bus/timing.ts';
import { decode, type Frame } from '../dali/codec.ts';
import { unitProfile } from '../sim/settings.ts';
import { Simulator } from '../sim/simulator.ts';
import { SimTransport } from '../transport/sim.ts';
import { Engine, type Snapshot } from './engine.ts';

function setup(o: { ceilingArc?: number; autoActivation?: boolean } = {}) {
  const clock = new VirtualClock(1000);
  const sim = Simulator.bench({
    at: 1000,
    ...(o.autoActivation === false
      ? { a: unitProfile('A', { presentation: 'tc', settings: { autoActivation: false } }) }
      : {}),
  });
  const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  const engine = new Engine({
    clock,
    sim,
    simTransport,
    ...(o.ceilingArc === undefined ? {} : { ceilingArc: o.ceilingArc }),
  });
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    const st: { done: boolean; value?: T; error?: unknown; failed: boolean } = {
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
    const isDone = () => st.done;
    for (let i = 0; i < 100_000 && !isDone(); i++) {
      await flushMicrotasks();
      if (isDone()) break;
      const n = clock.next();
      if (n === undefined) throw new Error('Nothing is waiting on the clock.');
      await clock.advanceTo(n);
    }
    if (st.failed) throw st.error;
    return st.value as T;
  };
  const settle = async () => {
    while (engine.snapshot().jobs.length > 0) {
      const n = clock.next();
      if (n === undefined) throw new Error('Jobs did not finish.');
      await clock.advanceTo(n);
    }
    await clock.advance(10);
  };
  /** Let the coalescer and the bus finish, and the rate guard's windows pass. */
  const idle = async (ms = 3000) => {
    await clock.advance(ms);
    await flushMicrotasks();
  };
  /** Command ids the bench heard since a point in its log. */
  const heard = (from: number) => {
    let prev: Frame | undefined;
    return simTransport.log.slice(from).map((l) => {
      const c = decode(l.frame.frame, prev);
      prev = l.frame.frame;
      return c?.id ?? '?';
    });
  };
  return { clock, sim, simTransport, engine, drive, settle, idle, heard };
}

const lightOf = (s: Snapshot | undefined, n: number) => s?.light.find((l) => l.address === n);

describe('live light state', () => {
  it('shows each bench unit with its terminals, level and colour', async () => {
    const { engine, settle } = setup();
    await settle();
    const s = engine.snapshot();
    expect(s.light.map((l) => [l.address, l.unit])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ]);
    const b = lightOf(s, 1);
    expect(b?.labels).toEqual(['R', 'G', 'B', 'WW', 'CW']);
    expect(b?.channels).toHaveLength(6);
    expect(b?.fading).toBe(false);
    engine.dispose();
  });

  it('follows a fade at the snapshot rate and stops when it settles', async () => {
    const { engine, settle, drive, idle, clock } = setup();
    await settle();
    await idle();
    const r = await drive(
      engine.request({ kind: 'apply', address: 0, fade: { kind: 'standard', value: 4 } }, 'ui'),
    );
    expect(r.ok).toBe(true);
    await idle();
    const seen: Snapshot[] = [];
    const off = engine.subscribe((s) => seen.push(s));
    await drive(engine.request({ kind: 'apply', address: 0, arc: 200 }, 'ui'));
    await clock.advance(600);
    const mid = seen.at(-1);
    expect(lightOf(mid, 0)?.fading).toBe(true);
    expect(lightOf(mid, 0)?.target).toBe(200);
    const during = seen.length;
    expect(during).toBeGreaterThan(4);
    await clock.advance(3000);
    const after = seen.length;
    expect(lightOf(seen.at(-1), 0)?.fading).toBe(false);
    await clock.advance(3000);
    expect(seen.length).toBe(after);
    off();
    engine.dispose();
  });
});

describe('colour intents', () => {
  it('drive each address only the way it reports (SPEC D2)', async () => {
    const { engine, settle, drive, idle, sim } = setup();
    await settle();
    await idle();
    expect(await drive(engine.request({ kind: 'tc', address: 1, mirek: 300 }, 'ui'))).toEqual({
      ok: false,
      reason: 'A1 does not report colour temperature control.',
    });
    expect(
      await drive(
        engine.request({ kind: 'rgbwaf', address: 0, channels: [1, 2, 3, 4, 5, 255] }, 'ui'),
      ),
    ).toEqual({ ok: false, reason: 'A0 does not report RGBWAF channels.' });
    expect(await drive(engine.request({ kind: 'tc', address: 9, mirek: 300 }, 'ui'))).toEqual({
      ok: false,
      reason: 'A9 has not been read yet.',
    });
    expect(await drive(engine.request({ kind: 'tc', address: 64, mirek: 300 }, 'ui'))).toEqual({
      ok: false,
      reason: 'An address is 0 to 63.',
    });
    expect((await drive(engine.request({ kind: 'tc', address: 0, mirek: 0 }, 'ui'))).ok).toBe(
      false,
    );
    expect(
      (
        await drive(
          engine.request({ kind: 'rgbwaf', address: 1, channels: [1, 2, 3, 4, 5, 256] }, 'ui'),
        )
      ).ok,
    ).toBe(false);
    expect(await drive(engine.request({ kind: 'tc', address: 0, mirek: 300 }, 'ui'))).toMatchObject(
      { ok: true, queued: true },
    );
    expect(
      await drive(
        engine.request({ kind: 'rgbwaf', address: 1, channels: [200, 100, 0, 50, 0, 255] }, 'ui'),
      ),
    ).toMatchObject({ ok: true, queued: true });
    await idle();
    const now = sim.unit('A')?.gear.colourAt(1e12);
    expect(now?.tc).toBe(300);
    expect(sim.unit('B')?.gear.colourAt(1e12).ch.slice(0, 5)).toEqual([200, 100, 0, 50, 0]);
    const s = engine.snapshot();
    expect(s.feedback.find((f) => f.key === 'tc:0')).toMatchObject({
      state: 'sent',
      text: 'Sent 300 mirek.',
    });
    expect(s.feedback.find((f) => f.key === 'rgbwaf:1')?.text).toBe(
      'Sent channels 200 100 0 50 0 255.',
    );
    engine.dispose();
  });
});

describe('the DAPC sequence for a moving control (SPEC R13.3)', () => {
  it('starts a sequence before the first live DAPC, and again after a pause', async () => {
    const { engine, settle, drive, idle, clock, simTransport, heard } = setup();
    await settle();
    await idle();
    const from = simTransport.log.length;
    await drive(engine.request({ kind: 'level', address: 0, arc: 150, live: true }, 'ui'));
    await clock.advance(100);
    await drive(engine.request({ kind: 'level', address: 0, arc: 152, live: true }, 'ui'));
    await clock.advance(100);
    expect(heard(from)).toEqual(['ENABLE_DAPC_SEQUENCE', 'DAPC', 'DAPC']);
    await idle(1000);
    const again = simTransport.log.length;
    await drive(engine.request({ kind: 'level', address: 0, arc: 160, live: true }, 'ui'));
    await clock.advance(100);
    expect(heard(again)).toEqual(['ENABLE_DAPC_SEQUENCE', 'DAPC']);
    const fixed = simTransport.log.length;
    await idle(1000);
    await drive(engine.request({ kind: 'level', address: 0, arc: 150 }, 'ui'));
    await clock.advance(100);
    expect(heard(fixed)).toEqual(['DAPC']);
    expect(engine.snapshot().feedback.find((f) => f.key === 'level:0')).toMatchObject({
      state: 'sent',
      text: 'Sent level 150.',
    });
    engine.dispose();
  });

  it('shows a clamp, and a value the rate guard holds back', async () => {
    const { engine, settle, drive, idle, clock } = setup();
    await settle();
    await idle();
    await drive(engine.request({ kind: 'level', address: 0, arc: 254 }, 'ui'));
    await clock.advance(200);
    const clamp = engine.snapshot().feedback.find((f) => f.key === 'level:0');
    expect(clamp?.state).toBe('clamped');
    expect(clamp?.text).toMatch(/^Sent level 220\. .*ceiling/);
    // Off, on, off: the second change back is a swing within the second, held by the rate guard.
    await idle();
    for (const arc of [0, 220, 0]) {
      await drive(engine.request({ kind: 'level', address: 0, arc }, 'ui'));
      await clock.advance(80);
    }
    expect(engine.snapshot().feedback.find((f) => f.key === 'level:0')?.state).toBe('waiting');
    await idle(5000);
    expect(engine.snapshot().feedback.find((f) => f.key === 'level:0')?.state).toBe('sent');
    engine.dispose();
  });
});

describe('Apply in Commit mode', () => {
  it('sends the fade, the colour and the level as one transaction, in that order', async () => {
    const { engine, settle, drive, idle, simTransport, heard, sim } = setup();
    await settle();
    await idle();
    const from = simTransport.log.length;
    const r = await drive(
      engine.request(
        {
          kind: 'apply',
          address: 0,
          fade: { kind: 'standard', value: 3 },
          mirek: 250,
          arc: 180,
        },
        'ui',
      ),
    );
    expect(r.ok).toBe(true);
    const ids = heard(from);
    expect(ids.indexOf('SET_FADE_TIME')).toBeLessThan(ids.indexOf('DT8_SET_TEMPORARY_TC'));
    expect(ids.at(-1)).toBe('DAPC');
    expect(ids).not.toContain('DT8_ACTIVATE');
    await idle(5000);
    const st = sim.unit('A')?.gear.snapshot();
    expect(st?.fadeTime).toBe(3);
    expect(sim.unit('A')?.gear.colourAt(1e12).tc).toBe(250);
    engine.dispose();
  });

  it('sets an extended fade with the fade time at 0, and activates a colour sent without a level', async () => {
    const { engine, settle, drive, idle, simTransport, heard, sim } = setup();
    await settle();
    await idle();
    const from = simTransport.log.length;
    await drive(
      engine.request(
        {
          kind: 'apply',
          address: 1,
          fade: { kind: 'extended', value: 0x21 },
          channels: [10, 20, 30, 40, 50, 255],
        },
        'ui',
      ),
    );
    const ids = heard(from);
    expect(ids).toContain('SET_EXTENDED_FADE_TIME');
    expect(ids.at(-1)).toBe('DT8_ACTIVATE');
    await idle(5000);
    expect(sim.unit('B')?.gear.snapshot().fadeTime).toBe(0);
    expect(sim.unit('B')?.gear.snapshot().extendedFade).toBe(0x21);
    engine.dispose();
  });

  it('activates the colour before the level when the driver does not report automatic activation', async () => {
    const { engine, settle, drive, idle, simTransport, heard, sim } = setup({
      autoActivation: false,
    });
    await settle();
    await idle();
    expect(
      ((engine.snapshot().devices.find((d) => d.address === 0)?.facts?.gearFeatures ?? 0) & 1) ===
        1,
    ).toBe(false);
    const from = simTransport.log.length;
    const applied = await drive(
      engine.request({ kind: 'apply', address: 0, mirek: 200, arc: 150 }, 'ui'),
    );
    expect(applied.ok ? 'ok' : applied.reason).toBe('ok');
    const ids = heard(from);
    expect(ids.indexOf('DT8_ACTIVATE')).toBeGreaterThan(-1);
    expect(ids.indexOf('DT8_ACTIVATE')).toBeLessThan(ids.indexOf('DAPC'));
    await idle(5000);
    expect(sim.unit('A')?.gear.colourAt(1e12).tc).toBe(200);
    expect(sim.unit('A')?.gear.levelAt(1e12)).toBe(150);
    engine.dispose();
  });

  it('refuses what it cannot apply', async () => {
    const { engine, settle, drive, idle } = setup();
    await settle();
    await idle();
    const ask = (i: Parameters<Engine['request']>[0]) => drive(engine.request(i, 'ui'));
    expect(await ask({ kind: 'apply', address: 0 })).toEqual({
      ok: false,
      reason: 'Nothing to apply.',
    });
    expect(await ask({ kind: 'apply', address: 70, arc: 1 })).toEqual({
      ok: false,
      reason: 'An address is 0 to 63.',
    });
    expect(await ask({ kind: 'apply', address: 0, fade: { kind: 'standard', value: 16 } })).toEqual(
      { ok: false, reason: 'A fade time is 0 to 15.' },
    );
    expect(
      await ask({ kind: 'apply', address: 0, fade: { kind: 'extended', value: 0x50 } }),
    ).toEqual({ ok: false, reason: 'That is not an extended fade time.' });
    expect(
      await ask({ kind: 'apply', address: 0, fade: { kind: 'extended', value: 0x05 } }),
    ).toEqual({ ok: false, reason: 'That is not an extended fade time.' });
    expect(
      (await ask({ kind: 'apply', address: 0, fade: { kind: 'extended', value: 0 } })).ok,
    ).toBe(true);
    expect(
      await ask({ kind: 'apply', address: 1, mirek: 300, channels: [0, 0, 0, 0, 0, 0] }),
    ).toEqual({ ok: false, reason: 'Apply a colour temperature or channels, not both.' });
    expect(await ask({ kind: 'apply', address: 1, mirek: 300 })).toEqual({
      ok: false,
      reason: 'A1 does not report colour temperature control.',
    });
    expect((await ask({ kind: 'apply', address: 0, mirek: 70_000 })).ok).toBe(false);
    expect(await ask({ kind: 'apply', address: 0, channels: [0, 0, 0, 0, 0, 0] })).toEqual({
      ok: false,
      reason: 'A0 does not report RGBWAF channels.',
    });
    expect((await ask({ kind: 'apply', address: 1, channels: [0, 0, 0, 0, 0, -1] })).ok).toBe(
      false,
    );
    expect((await ask({ kind: 'apply', address: 0, arc: 255 })).ok).toBe(false);
    engine.dispose();
  });
});

describe('the bus monitor fields', () => {
  it('numbers every line and gives its address and time on the wire', async () => {
    const { engine, settle, drive, idle, clock } = setup();
    await settle();
    await idle();
    await drive(engine.request({ kind: 'apply', address: 1, arc: 100 }, 'ui'));
    await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'OFF', address: { kind: 'broadcast' } }] },
        'ui',
      ),
    );
    await drive(
      engine.request(
        { kind: 'commands', commands: [{ id: 'OFF', address: { kind: 'group', n: 3 } }] },
        'ui',
      ),
    );
    await clock.advance(200);
    const m = engine.snapshot().monitor;
    const seqs = m.map((l) => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(m.at(-3)).toMatchObject({ address: 'A1', source: 'ui' });
    expect(m.at(-2)?.address).toBe('all');
    expect(m.at(-1)?.address).toBe('G3');
    expect(m.every((l) => l.ms > 0)).toBe(true);
    expect(m.some((l) => l.address === '')).toBe(true);
    engine.dispose();
  });
});

describe('start and set-up', () => {
  it('starts at a stored ceiling', async () => {
    const { engine, settle } = setup({ ceilingArc: 150 });
    await settle();
    expect(engine.snapshot().ceilingArc).toBe(150);
    expect(engine.snapshot().devices.every((d) => d.ceiling === 'verified')).toBe(true);
    engine.dispose();
  });

  it('rebuilds a bench unit with its new set-up, off, and scans it again (SPEC R1.6)', async () => {
    const { engine, settle, drive, idle, sim } = setup();
    await settle();
    await idle();
    await drive(engine.request({ kind: 'apply', address: 1, arc: 150 }, 'ui'));
    await idle();
    expect(sim.unit('B')?.gear.levelAt(1e12)).toBeGreaterThan(0);
    expect(engine.snapshot().bench.map((b) => b.setup.presentation)).toEqual(['tc', 'rgbwaf']);
    expect(
      await drive(engine.setBench({ B: { presentation: 'tc', settings: {} } }, 'script')),
    ).toEqual({
      ok: false,
      reason: 'Only a person changes the simulator settings.',
    });
    expect(await drive(engine.setBench({}, 'ui'))).toEqual({
      ok: false,
      reason: 'Nothing to change.',
    });
    const tooHigh = await drive(
      engine.setBench({ B: { presentation: 'tc', settings: { physicalMinimum: 230 } } }, 'ui'),
    );
    expect(tooHigh.ok ? '' : tooHigh.reason).toContain('raise the ceiling to at least arc 230');
    const r = await drive(
      engine.setBench({ B: { presentation: 'tc', settings: { maxLowerPullsDown: false } } }, 'ui'),
    );
    expect(r.ok).toBe(true);
    expect(sim.unit('B')?.gear.levelAt(1e12)).toBe(0);
    await settle();
    const s = engine.snapshot();
    expect(s.devices.find((d) => d.address === 1)?.facts?.drive).toBe('tc');
    expect(s.devices.every((d) => d.verified)).toBe(true);
    expect(s.bench.find((b) => b.unit === 'B')?.setup).toEqual({
      presentation: 'tc',
      settings: { maxLowerPullsDown: false },
    });
    expect(s.bench.find((b) => b.unit === 'A')?.setup.presentation).toBe('tc');
    // The new bench still goes through a governor.
    await idle();
    await drive(engine.request({ kind: 'apply', address: 1, arc: 254 }, 'ui'));
    await idle();
    expect(sim.unit('B')?.gear.levelAt(1e12)).toBeLessThanOrEqual(220);
    engine.dispose();
  });

  it('cannot be used to flash the bench: each lit unit is turned off through the governor first, and the bench waits 2 s after a rebuild', async () => {
    const { engine, settle, drive, idle, sim, clock } = setup();
    await settle();
    await idle();
    const t0 = clock.now();
    const changes: number[] = [];
    let last = 0;
    const watch = () => {
      const l = sim.unit('A')?.gear.levelAt(clock.now()) ?? 0;
      if (l > 0 !== last > 0) changes.push(Math.round(clock.now() - t0));
      last = l;
      if (clock.now() - t0 < 8000) clock.at(clock.now() + 5, watch);
    };
    watch();
    // As the DALI review did: on, then a settings change 150 ms later, four times over.
    for (let k = 0; k < 4; k++) {
      await drive(engine.request({ kind: 'apply', address: 0, arc: 220 }, 'ui'));
      await clock.advance(150);
      await drive(
        engine.setBench(
          { A: { presentation: 'tc', settings: { minRaiseLifts: k % 2 === 0 ? false : true } } },
          'ui',
        ),
      );
      await clock.advance(100);
    }
    await clock.advance(8000);
    // Every change of the light, on or off, is at least the hard step window apart (SPEC S3.3).
    expect(changes.length).toBeGreaterThan(1);
    for (let i = 1; i < changes.length; i++)
      expect((changes[i] ?? 0) - (changes[i - 1] ?? 0)).toBeGreaterThanOrEqual(1990);
    engine.dispose();
  });

  it('refuses commands and Apply with a retry time while the rebuilt bench waits', async () => {
    const { engine, settle, drive, idle } = setup();
    await settle();
    await idle();
    expect(
      (await drive(engine.setBench({ A: { presentation: 'rgbwaf', settings: {} } }, 'ui'))).ok,
    ).toBe(true);
    const r = await drive(engine.request({ kind: 'apply', address: 1, arc: 100 }, 'ui'));
    expect(r.ok ? '' : r.reason).toContain('just rebuilt');
    expect(r.ok ? 0 : (r.retryAt ?? 0)).toBeGreaterThan(0);
    // A query still goes out.
    const q = await drive(
      engine.request(
        {
          kind: 'commands',
          commands: [{ id: 'QUERY_ACTUAL_LEVEL', address: { kind: 'short', n: 1 } }],
        },
        'ui',
      ),
    );
    expect(q.ok).toBe(true);
    engine.dispose();
  });
});
