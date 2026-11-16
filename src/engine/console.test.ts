/**
 * U-engine for Stage 6: the console's executor and the script runner on the simulated bench, on a
 * virtual clock. Every line goes through `Engine.request`, so through the governor (ADR 0014).
 */
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../bus/clock.ts';
import { withFloors } from '../bus/timing.ts';
import { decode, type Frame } from '../dali/codec.ts';
import { nameOf } from '../console/names.ts';
import { parseLine, type ParseContext } from '../console/parse.ts';
import { builtin } from '../script/builtin.ts';
import type { Outcome } from '../safety/governor.ts';
import { Simulator } from '../sim/simulator.ts';
import { SimTransport } from '../transport/sim.ts';
import {
  ConsoleExec,
  nearestFade,
  RATE_WAIT_LIMIT_MS,
  type ConsoleHost,
  type ConsoleLine,
} from './console.ts';
import { Engine, type DeviceView, type Intent, type RequestResult } from './engine.ts';

const ctx: ParseContext = { aliases: new Map([['warm', 0]]) };

function setup(o: { ceilingArc?: number } = {}) {
  const clock = new VirtualClock(1000);
  const sim = Simulator.bench({ at: 1000 });
  const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  const engine = new Engine({
    clock,
    sim,
    simTransport,
    ...(o.ceilingArc === undefined ? {} : { ceilingArc: o.ceilingArc }),
  });
  /** Run the clock until a condition holds. */
  const until = async (cond: () => boolean, limit = 200_000) => {
    for (let i = 0; i < limit; i++) {
      await flushMicrotasks();
      if (cond()) return;
      const n = clock.next();
      if (n === undefined) throw new Error('Nothing is waiting on the clock.');
      await clock.advanceTo(n);
    }
    throw new Error('The condition never held.');
  };
  const drive = async <T>(p: Promise<T>): Promise<T> => {
    const st: { done: boolean; value?: T } = { done: false };
    void p.then((v) => {
      st.done = true;
      st.value = v;
    });
    await until(() => st.done);
    return st.value as T;
  };
  const settle = () => until(() => engine.snapshot().jobs.length === 0);
  /** The console lines from a point on, as text. */
  const lines = (from = 0) =>
    engine
      .snapshot()
      .console.filter((l) => l.seq > from)
      .map((l) => l.text);
  const last = () => engine.snapshot().console.at(-1)?.seq ?? 0;
  const type = async (line: string, confirmed = false) => {
    const from = last();
    const r = await drive(engine.console(line, ctx, confirmed));
    return { r, out: lines(from) };
  };
  const heard = (from: number) => {
    let prev: Frame | undefined;
    return simTransport.log.slice(from).flatMap((l) => {
      const c = decode(l.frame.frame, prev);
      prev = l.frame.frame;
      return c === undefined ? [] : [c];
    });
  };
  return { clock, sim, simTransport, engine, until, drive, settle, lines, last, type, heard };
}

describe('typed console lines', () => {
  it('sets a level through the governor, held to the ceiling', async () => {
    const t = setup({ ceilingArc: 200 });
    await t.settle();
    const from = t.simTransport.log.length;
    const { r, out } = await t.type('level warm 254');
    expect(r.ok).toBe(true);
    expect(out.join('\n')).toMatch(/^A0 level 254 \(100(\.0)?%\), clamped: /);
    const dapc = t.heard(from).filter((c) => c.id === 'DAPC');
    expect(dapc.length).toBeGreaterThan(0);
    for (const c of dapc) expect(c.value).toBeLessThanOrEqual(200);
  });

  it('prints a decoded reply for a DALI command by name', async () => {
    const t = setup();
    await t.settle();
    await t.type('level 0 128');
    const { out } = await t.type('query-actual-level 0');
    expect(out).toEqual([expect.stringMatching(/^actual level 128 \(.*\) \[0x80\]$/)]);
  });

  it('sends ENABLE DEVICE TYPE before a device type command', async () => {
    const t = setup();
    await t.settle();
    const from = t.simTransport.log.length;
    const { out } = await t.type(`${nameOf('DT8_QUERY_COLOUR_TYPE_FEATURES')} 0`);
    expect(out[0]).toMatch(/colour type features/i);
    expect(t.heard(from).map((c) => c.id)).toEqual([
      'ENABLE_DEVICE_TYPE',
      'DT8_QUERY_COLOUR_TYPE_FEATURES',
    ]);
  });

  it('prefixes each line with its address when the target names more than one', async () => {
    const t = setup();
    await t.settle();
    const { out } = await t.type('query 0,1 level');
    expect(out).toEqual([
      expect.stringMatching(/^A0: actual level/),
      expect.stringMatching(/^A1: actual level/),
    ]);
  });

  it('sends raw frames through the governor, and holds x2 to the command', async () => {
    const t = setup();
    await t.settle();
    let from = t.simTransport.log.length;
    expect((await t.type('raw 01 21')).out).toEqual([
      'sent raw 01 21 (sent twice, as the command needs)',
    ]);
    expect(
      t.simTransport.log.slice(from).map((l) => [decode(l.frame.frame)?.id, l.frame.sendTwice]),
    ).toEqual([['STORE_ACTUAL_LEVEL_IN_DTR0', true]]);
    from = t.simTransport.log.length;
    const x2 = await t.type('raw 01 a0 x2');
    expect(x2.r.ok).toBe(false);
    expect(x2.out).toEqual([
      'refused: raw 01 A0 is not a send-twice command, so x2 does not apply.',
    ]);
    expect(t.simTransport.log.length).toBe(from);
    expect((await t.type('raw 01 a0')).out).toEqual([
      expect.stringMatching(/^actual level .* \[0x/),
    ]);
  });

  it('refuses a colour where the driver does not report it (SPEC D2)', async () => {
    const t = setup();
    await t.settle();
    const { r, out } = await t.type('tc 1 2700K');
    expect(r.ok).toBe(false);
    expect(out[0]).toMatch(/^refused: /);
    const g = await t.type('tc all 2700K');
    expect(g.out[0]).toMatch(/^refused: A1 does not report colour temperature control\.$/);
  });

  it('stores a scene and reads it back, and lists the scenes', async () => {
    const t = setup();
    await t.settle();
    await t.type('level 0 100');
    const s = await t.type('scene 0 store 3');
    expect(s.out).toEqual(['A0 scene 3 holds 100 (1.5%), read back']);
    const l = await t.type('scene 0 list');
    expect(l.out).toHaveLength(16);
    expect(l.out[3]).toBe('scene  3: 100 (1.5%)');
    expect(l.out[4]).toBe('scene  4: not in scene');
  });

  it('needs a typed confirmation to unlock, and lets a person resume after panic', async () => {
    const t = setup();
    await t.settle();
    expect((await t.type('unlock rate')).r.ok).toBe(false);
    expect((await t.type('unlock rate', true)).r.ok).toBe(true);
    expect(t.engine.snapshot().unlocks).toEqual(['rate']);
    await t.type('lock');
    expect(t.engine.snapshot().unlocks).toEqual([]);
    await t.type('panic');
    expect(t.engine.snapshot().latched).toBe(true);
    expect((await t.type('level 0 50')).out[0]).toMatch(/^refused: /);
    expect((await t.type('resume')).out).toEqual(['Resumed. Nothing was sent.']);
    expect(t.engine.snapshot().latched).toBe(false);
  });

  it('lowers the ceiling from the console, and raises it only with a confirmation', async () => {
    const t = setup({ ceilingArc: 200 });
    await t.settle();
    expect((await t.type('cap')).out).toEqual(['ceiling 200 (22.9%)']);
    expect((await t.type('cap 180')).r.ok).toBe(true);
    expect(t.engine.snapshot().ceilingArc).toBe(180);
    expect((await t.type('cap 200')).r.ok).toBe(false);
    expect((await t.type('cap 200', true)).r.ok).toBe(true);
    expect(t.engine.snapshot().ceilingArc).toBe(200);
  });

  it('prints parse errors without sending, and lists devices', async () => {
    const t = setup();
    await t.settle();
    const from = t.simTransport.log.length;
    const bad = await t.type('level 99 50%');
    expect(bad.r.ok).toBe(false);
    expect(t.simTransport.log.length).toBe(from);
    const d = await t.type('devices');
    expect(d.out).toHaveLength(2);
    expect(d.out[0]).toMatch(/^A0 {2}verified {2}colour temperature/);
    expect((await t.type('# only a comment')).r.ok).toBe(true);
  });

  it('a wait ends at once on Ctrl-C', async () => {
    const t = setup();
    await t.settle();
    const start = t.clock.now();
    const p = t.engine.console('wait 10min', ctx);
    await t.clock.advance(1000);
    expect(t.engine.snapshot().jobs.map((j) => j.kind)).toEqual(['console']);
    t.engine.stopConsole();
    const r = await t.drive(p);
    expect(r.ok).toBe(false);
    expect(t.clock.now() - start).toBeLessThan(2000);
    expect(t.lines().at(-1)).toBe('Stopped: Ctrl-C.');
  });

  it('refuses a second line while one runs', async () => {
    const t = setup();
    await t.settle();
    const p = t.engine.console('wait 5s', ctx);
    await flushMicrotasks();
    expect((await t.engine.console('off 0', ctx)).ok).toBe(false);
    await t.drive(p);
  });
});

describe('scripts', () => {
  /** Run a script, pressing Enter at every pause, and check the light at each step. */
  async function runAll(t: ReturnType<typeof setup>, name: string, text: string) {
    const p = t.engine.runScript(name, text, ctx);
    const st = { done: false, r: undefined as Outcome | undefined };
    void p.then((r) => {
      st.done = true;
      st.r = r;
    });
    const seen: number[] = [];
    const done = () => st.done;
    while (!done()) {
      await t.until(() => done() || t.engine.snapshot().script?.paused !== undefined);
      for (const l of t.engine.snapshot().light) seen.push(l.level, l.target);
      if (!done()) t.engine.scriptContinue();
    }
    return { r: st.r, seen };
  }

  it('first-light runs on the simulated bench and never passes the ceiling', async () => {
    const t = setup({ ceilingArc: 120 });
    await t.settle();
    const from = t.simTransport.log.length;
    const fl = builtin('first-light');
    if (fl === undefined) throw new Error('first-light');
    const { r, seen } = await runAll(t, fl.name, fl.text);
    expect(r).toEqual({ ok: true });
    expect(Math.max(...seen)).toBeLessThanOrEqual(120);
    for (const c of t.heard(from)) if (c.id === 'DAPC') expect(c.value).toBeLessThanOrEqual(120);
    expect(t.lines().at(-1)).toBe('first-light finished.');
    expect(t.lines()).toContain('Done. Both tapes off.');
    // Every frame came from the script.
    const sources = new Set(t.engine.snapshot().monitor.map((m) => m.source));
    expect([...sources]).toEqual(['script']);
    for (const l of t.engine.snapshot().light) expect(l.target).toBe(0);
  });

  it('stops at a refused step and names its line', async () => {
    const t = setup();
    await t.settle();
    const { r } = await runAll(t, 'bad', 'level 0 50\ntc 1 2700K\noff 0');
    expect(r?.ok).toBe(false);
    expect(t.lines().slice(-2)).toEqual([
      expect.stringMatching(/^refused: /),
      'bad stopped at line 2.',
    ]);
    expect(t.engine.snapshot().light.find((l) => l.address === 0)?.target).toBeGreaterThan(0);
  });

  it('cannot raise the ceiling, and refuses the commands a script may not use', async () => {
    const t = setup({ ceilingArc: 150 });
    await t.settle();
    const raise = await runAll(t, 'raise', 'cap 200');
    expect(raise.r?.ok).toBe(false);
    expect(t.lines()).toContain('refused: a script cannot raise the ceiling.');
    expect(t.engine.snapshot().ceilingArc).toBe(150);
    const lower = await runAll(t, 'lower', 'cap 140');
    expect(lower.r).toEqual({ ok: true });
    expect(t.engine.snapshot().ceilingArc).toBe(140);
    const from = t.simTransport.log.length;
    const bad = await t.drive(t.engine.runScript('unl', 'off 0\nunlock rate', ctx));
    expect(bad.ok).toBe(false);
    expect(t.lines().at(-1)).toBe('line 2: unlock cannot be used in a script.');
    expect(t.simTransport.log.length).toBe(from);
  });

  it('Ctrl-C at a pause stops the script, and nothing more is sent', async () => {
    const t = setup();
    await t.settle();
    const p = t.engine.runScript('s', 'level 0 50\npause "look"\noff 0', ctx);
    await t.until(() => t.engine.snapshot().script?.paused !== undefined);
    expect(t.engine.snapshot().script).toMatchObject({ name: 's', line: 2, paused: 'look' });
    const from = t.simTransport.log.length;
    t.engine.stopConsole();
    expect((await t.drive(p)).ok).toBe(false);
    expect(t.simTransport.log.length).toBe(from);
    expect(t.lines().at(-1)).toBe('s stopped: Ctrl-C.');
    expect(t.engine.snapshot().script).toBeUndefined();
    expect(t.engine.scriptContinue().ok).toBe(false);
  });

  it('panic stops a script mid-wait, and the heartbeat watchdog stops one too', async () => {
    const t = setup();
    await t.settle();
    const p = t.engine.runScript('s', 'level 0 50\nwait 1min\nlevel 0 254', ctx);
    await t.until(() => t.engine.snapshot().script?.line === 2);
    await t.drive(t.engine.panic());
    expect((await t.drive(p)).ok).toBe(false);
    expect(t.lines().at(-1)).toBe('s stopped: Panic.');
    t.engine.resume('ui');

    t.engine.heartbeat(true);
    const start = t.clock.now();
    const q = t.engine.runScript('w', 'wait 1min\noff 0', ctx);
    expect((await t.drive(q)).ok).toBe(false);
    expect(t.lines().at(-1)).toMatch(/^w stopped: The page stopped answering/);
    expect(t.clock.now() - start).toBeLessThan(10_000);
  });

  it('a scan or profile write from the Devices page stops a script first (S6-L1)', async () => {
    const t = setup();
    await t.settle();
    const p = t.engine.runScript('s', 'level 0 50\nwait 1min\nlevel 0 254', ctx);
    await t.until(() => t.engine.snapshot().script?.line === 2);
    const scan = t.engine.rescan('ui');
    expect((await t.drive(p)).ok).toBe(false);
    expect(t.lines().at(-1)).toBe('s stopped: A scan started.');
    expect((await t.drive(scan)).ok).toBe(true);

    const q = t.engine.runScript('s', 'wait 1min\noff 0', ctx);
    await t.until(() => t.engine.snapshot().script !== undefined);
    const prof = t.engine.reapplyProfile('ui');
    expect((await t.drive(q)).ok).toBe(false);
    expect(t.lines().at(-1)).toBe('s stopped: The safety profile is being written again.');
    expect((await t.drive(prof)).ok).toBe(true);

    // The console's own scan runs inside its line and finishes it.
    expect((await t.type('scan')).r.ok).toBe(true);
  });

  it('runs one script at a time, and refuses typed lines while it runs', async () => {
    const t = setup();
    await t.settle();
    const p = t.engine.runScript('s', 'pause\noff 0', ctx);
    await t.until(() => t.engine.snapshot().script?.paused !== undefined);
    expect(t.engine.snapshot().script?.paused).toBe('Paused.');
    expect((await t.engine.runScript('t', 'off 0', ctx)).ok).toBe(false);
    expect((await t.engine.console('off 0', ctx)).ok).toBe(false);
    expect(t.engine.scriptContinue().ok).toBe(true);
    expect((await t.drive(p)).ok).toBe(true);
  });

  it('prints each step with its line, and repeats', async () => {
    const t = setup();
    await t.settle();
    const from = t.last();
    await t.drive(t.engine.runScript('r', 'repeat 2\n  echo "hi there" # x\nend', ctx));
    expect(t.lines(from)).toEqual([
      'Running r: 2 steps.',
      '2: echo "hi there"',
      'hi there',
      '2: echo "hi there"',
      'hi there',
      'r finished.',
    ]);
    // Echoed text has its own kind, so it cannot pass for the app's own lines (S6-I2).
    const echoed = t.engine.snapshot().console.filter((l) => l.text === 'hi there');
    expect(echoed.map((l) => l.kind)).toEqual(['echo', 'echo']);
  });
});

/** A host whose requests answer from a list, for the paths the bench does not reach. */
function fakeHost(results: RequestResult[], devices: DeviceView[] = []) {
  let now = 0;
  const sent: Intent[] = [];
  const host: ConsoleHost = {
    request: (intent) => {
      sent.push(intent);
      return Promise.resolve(results.shift() ?? { ok: true, answers: [] });
    },
    devices: () => devices,
    ceilingArc: () => 200,
    target: () => 'simulator',
    connectionText: () => 'The simulated bench is in use.',
    setCeiling: () => Promise.resolve({ ok: true }),
    setTarget: () => Promise.resolve({ ok: true }),
    rescan: () => Promise.resolve({ ok: true }),
    reapplyProfile: () => Promise.resolve({ ok: false, reason: 'no' }),
    unlock: () => ({ ok: true }),
    lock: () => undefined,
    resume: () => ({ ok: true }),
    panic: () => Promise.resolve(),
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    stopped: () => false,
  };
  const out: ConsoleLine[] = [];
  const run = async (line: string, source: 'console' | 'script' = 'console') => {
    const p = parseLine(line, ctx);
    if (!p.ok || p.command === undefined) throw new Error(line);
    out.length = 0;
    const ok = await new ConsoleExec(host, { source, out: (l) => out.push(l) }).run(p.command);
    return { ok, out: out.map((l) => `${l.kind} ${l.text}`) };
  };
  return { host, sent, run, now: () => now };
}

describe('ConsoleExec', () => {
  it('prints a fault as a fault, not as no reply', async () => {
    const f = fakeHost([{ ok: false, kind: 'fault', reason: 'The hasseb did not answer.' }]);
    expect(await f.run('query 0 level')).toEqual({
      ok: false,
      out: ['fault fault: The hasseb did not answer.'],
    });
  });

  it('waits for the rate guard, up to the limit', async () => {
    const f = fakeHost([
      { ok: false, kind: 'refused', reason: 'Too fast.', retryAt: 700 },
      { ok: true, answers: [] },
    ]);
    const r = await f.run('off 0');
    expect(r.ok).toBe(true);
    expect(r.out).toEqual(['note waiting 700 ms for the rate guard: Too fast.', 'out off A0']);
    const g = fakeHost([
      { ok: false, kind: 'refused', reason: 'Too fast.', retryAt: RATE_WAIT_LIMIT_MS + 1 },
    ]);
    expect(await g.run('off 0')).toEqual({ ok: false, out: ['refused refused: Too fast.'] });
  });

  it('picks the nearest fade the driver has', () => {
    expect(nearestFade(0, false).text).toBe('no fade');
    expect(nearestFade(2000, false)).toMatchObject({ ms: 2000, text: 'fade time 4' });
    expect(nearestFade(150, true).setting.kind).toBe('extended');
  });

  it('sets a fade on a group with the commands intent, and reads a fade back', async () => {
    const f = fakeHost([
      { ok: true, answers: [] },
      { ok: true, answers: [0x47, 0] },
    ]);
    expect((await f.run('fade g1 2s')).out).toEqual(['out G1 fade fade time 4, 2 s']);
    expect(f.sent[0]).toMatchObject({ kind: 'commands' });
    const r = await f.run('fade 0');
    expect(r.out[0]).toMatch(/^reply fade time\/fade rate fade time 4 \(2 s\)/);
    expect(r.out).toHaveLength(3);
  });

  it('a group colour needs every known member to report it', async () => {
    const dev = (address: number, drive: 'tc' | 'rgbwaf', groups: number): DeviceView =>
      ({
        address,
        verified: true,
        ceiling: 'verified',
        modelled: false,
        facts: { drive, groups },
      }) as unknown as DeviceView;
    const f = fakeHost([], [dev(0, 'tc', 2), dev(1, 'rgbwaf', 4)]);
    expect((await f.run('tc g1 3000K 50%')).ok).toBe(true);
    expect(f.sent[0]).toMatchObject({ kind: 'commands' });
    expect((await f.run('tc g5 3000K')).out[0]).toMatch(/no known gear at G5/);
    expect((await f.run('rgb all 1 2 3')).out[0]).toMatch(/A0 does not report RGBWAF/);
  });

  it('a script cannot raise the ceiling, and pause is for scripts only', async () => {
    const f = fakeHost([]);
    expect((await f.run('cap 250', 'script')).out).toEqual([
      'refused refused: a script cannot raise the ceiling.',
    ]);
    expect((await f.run('cap 200')).out).toEqual(['out The ceiling is already 200 (22.9%).']);
    expect((await f.run('pause')).ok).toBe(false);
    expect((await f.run('history')).ok).toBe(false);
    expect((await f.run('profile apply')).out).toEqual(['refused refused: no']);
    expect((await f.run('target')).out).toEqual([
      'out target simulator. The simulated bench is in use.',
    ]);
  });
});

describe('ConsoleExec, each command', () => {
  const dev = (address: number, extra: Partial<DeviceView> = {}): DeviceView =>
    ({
      address,
      verified: true,
      ceiling: 'verified',
      modelled: false,
      facts: { drive: 'tc', groups: 0b101, minLevel: 85, maxLevel: 200, extendedFade: 0 },
      ...extra,
    }) as unknown as DeviceView;

  it('switches, groups and scenes', async () => {
    const f = fakeHost([]);
    expect((await f.run('on 0')).out).toEqual(['out on A0']);
    expect((await f.run('group 0 add 3')).out).toEqual(['out A0 joined g3']);
    expect((await f.run('group 0,1 remove 3')).out).toEqual(['out A0 left g3', 'out A1 left g3']);
    expect((await f.run('scene g1 recall 2')).out).toEqual(['out G1 scene 2']);
    expect((await f.run('scene 0 remove 2')).out).toEqual(['out A0 scene 2 removed']);
    expect((await f.run('scene g1 store 2')).out).toEqual([
      'error scene store takes short addresses, so each one can be read back.',
    ]);
  });

  it('stores a scene only when the level reads back', async () => {
    const f = fakeHost([{ ok: true, answers: ['none'] }]);
    expect((await f.run('scene 0 store 2')).out).toEqual([
      'error The driver did not say its level, so nothing was stored.',
    ]);
    const g = fakeHost([{ ok: true, answers: [99] }]);
    expect((await g.run('scene 0 store 2 100')).out).toEqual([
      'error scene 2 reads back 99 (1.5%), not 100 (1.5%).',
    ]);
    const h = fakeHost([{ ok: false, kind: 'dropped', reason: 'Stopped.' }]);
    expect((await h.run('scene 0 list')).out).toEqual(['refused stopped: Stopped.']);
    const i = fakeHost([{ ok: false, kind: 'refused', reason: 'no' }]);
    expect((await i.run('scene 0 store 1 50')).out).toEqual(['refused refused: no']);
  });

  it('asks for a summary, the groups and the colour temperature', async () => {
    const f = fakeHost([
      { ok: true, answers: Array.from({ length: 12 }, () => 0) },
      { ok: true, answers: [0b101, 0] },
      { ok: true, answers: [0, 0x01, 0x72] },
      { ok: true, answers: [0, 0xff, 0xff] },
      { ok: true, answers: [0, 'collision', 0] },
    ]);
    expect((await f.run('query 0')).out).toHaveLength(12);
    expect((await f.run('query 0 groups')).out).toHaveLength(2);
    expect((await f.run('query 0 tc')).out).toEqual(['reply colour temperature 370 mirek (2703K)']);
    expect((await f.run('query 0 tc')).out).toEqual(['reply colour temperature: none (MASK)']);
    expect((await f.run('query 0 tc')).out[0]).toMatch(/^reply colour temperature: framing error/);
    const g = fakeHost([{ ok: false, kind: 'fault', reason: 'gone' }]);
    expect((await g.run('query 0 tc')).ok).toBe(false);
  });

  it('sends DALI commands with no address, and prints raw results', async () => {
    const f = fakeHost([
      { ok: true, answers: [] },
      { ok: false, kind: 'refused', reason: 'no' },
      { ok: true, answers: [], note: 'held to 200' },
      { ok: false, kind: 'refused', reason: 'no' },
    ]);
    expect((await f.run('dtr0 7')).out).toEqual(['out sent dtr0 7']);
    expect((await f.run('dapc 0 254')).out).toEqual(['refused refused: no']);
    expect((await f.run('raw 01 fe')).out).toEqual(['out sent raw 01 FE, clamped: held to 200']);
    expect((await f.run('raw 01 fe')).out).toEqual(['refused refused: no']);
  });

  it('sets levels and colours with fades on short addresses and groups', async () => {
    const f = fakeHost([], [dev(0), dev(2)]);
    const r = await f.run('level 0 50 fade 1550ms');
    expect(r.out[0]).toMatch(/^note nearest fade is extended fade/);
    expect(f.sent[0]).toMatchObject({ kind: 'apply', address: 0, arc: 50 });
    expect((await f.run('level g0 50 fade 2s')).out).toEqual(['out G0 level 50 (0.4%) over 2 s']);
    expect(f.sent[1]).toMatchObject({ kind: 'commands' });
    expect((await f.run('rgb 1 1 2 3')).out[0]).toMatch(/^out A1 channels 1 2 3 0 0/);
    expect((await f.run('fade 0 rate 7')).out).toEqual(['out A0 fade rate 7']);
    const g = fakeHost([{ ok: false, kind: 'fault', reason: 'gone' }]);
    expect((await g.run('level 0 50')).out).toEqual(['fault fault: gone']);
    const h = fakeHost([{ ok: false, kind: 'refused', reason: 'no' }]);
    expect((await h.run('tc 0 3000K')).ok).toBe(false);
    const i = fakeHost([{ ok: false, kind: 'refused', reason: 'no' }]);
    expect((await i.run('fade 0')).ok).toBe(false);
  });

  it('lists devices and their safety profile', async () => {
    expect((await fakeHost([]).run('devices')).out).toEqual([
      'out No devices found. Type scan to look again.',
    ]);
    expect((await fakeHost([]).run('profile')).out).toEqual(['out No devices to show.']);
    const profile = {
      address: 1,
      verified: false,
      reason: 'MAX LEVEL did not take',
      mismatches: [{ what: 'MAX LEVEL', expected: 200, actual: undefined }],
      unconfirmed: ['fast fade'],
    };
    const f = fakeHost(
      [],
      [
        dev(0),
        dev(1, { verified: false, profile }),
        { address: 2, verified: false, ceiling: 'pending', modelled: false },
      ],
    );
    expect((await f.run('devices')).out).toEqual([
      'out A0  verified  colour temperature  min 85  max 200  groups g0 g2',
      'out A1  unverified  colour temperature  min 85  max 200  groups g0 g2',
      'out A2  unverified  not read yet',
    ]);
    expect((await f.run('profile 1,2')).out).toEqual([
      'out A1: not verified: MAX LEVEL did not take',
      'note   MAX LEVEL: expected 200, read nothing',
      'note   fast fade: not yet confirmed on hardware',
      'out A2: the safety profile has not been written yet.',
    ]);
  });

  it('scans, changes target, prints help, and stops between addresses', async () => {
    const f = fakeHost([]);
    expect((await f.run('scan')).out).toEqual(['out Scanned, and the safety profile written.']);
    expect((await f.run('target both')).out).toEqual(['out target both']);
    expect((await f.run('help')).out.length).toBeGreaterThan(3);
    let n = 0;
    f.host.stopped = () => n++ > 0;
    expect(await f.run('off 0,1')).toEqual({ ok: false, out: ['out off A0'] });
  });
});
