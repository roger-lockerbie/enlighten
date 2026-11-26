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
  dryHost,
  EXPLAIN_MAX_LINES,
  explainLines,
  frameCount,
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

describe('RESET from the console (DALI review S6-R1)', () => {
  it('sends OFF after RESET and writes the safety profile again', async () => {
    const t = setup({ ceilingArc: 200 });
    await t.settle();
    await t.type('unlock reset', true);
    await t.type('level 0 150');
    await t.clock.advance(3000);
    const from = t.simTransport.log.length;
    const { r, out } = await t.type('reset 0');
    expect(r.ok).toBe(true);
    expect(out[0]).toMatch(/^A0 goes to full output for about 0\.3 s, then OFF/);
    expect(out.at(-1)).toBe('A0 reset, off, and the safety profile verified');
    const log = t.simTransport.log.slice(from);
    const ids = t.heard(from).map((c) => c.id);
    expect(ids.indexOf('RESET')).toBeLessThan(ids.indexOf('OFF'));
    const at = (id: string) => log.find((l) => decode(l.frame.frame)?.id === id)?.at ?? Number.NaN;
    expect(at('OFF') - at('RESET')).toBeLessThan(500);
    // MAX LEVEL is the ceiling again, not RESET's 254.
    const a = t.sim.all.find((u) => u.gear.shortAddress === 0)?.gear;
    expect(a?.snapshot().maxLevel).toBe(200);
    expect(a?.outputAt(t.clock.now()).terminals.every((x) => x === 0)).toBe(true);
  });

  it('routes a raw RESET the same way, and refuses one to a group or broadcast', async () => {
    const t = setup();
    await t.settle();
    await t.type('unlock reset', true);
    const from = t.simTransport.log.length;
    const raw = await t.type('raw 01 20');
    expect(raw.r.ok).toBe(true);
    expect(t.heard(from).map((c) => c.id)).toContain('OFF');
    const g = await t.type('reset g0');
    expect(g.r.ok).toBe(false);
    expect(g.out.join('\n')).toContain('one short address at a time');
    const all = await t.type('raw ff 20');
    expect(all.r.ok).toBe(false);
  });

  it('is refused without the unlock, and a bare RESET is refused on every other path', async () => {
    const t = setup();
    await t.settle();
    const { r } = await t.type('reset 0');
    expect(r.ok).toBe(false);
    t.engine.unlock('reset', 'ui', true);
    const cmds = await t.drive(
      t.engine.request(
        { kind: 'commands', commands: [{ id: 'RESET', address: { kind: 'short', n: 0 } }] },
        'ui',
      ),
    );
    expect(cmds.ok).toBe(false);
    const raw = await t.drive(t.engine.request({ kind: 'raw', a: 0x01, b: 0x20 }, 'ui'));
    expect(raw.ok).toBe(false);
    if (!raw.ok) expect(raw.reason).toMatch(/OFF and the safety profile/);
    expect((await t.drive(t.engine.resetAddress(0, 'script'))).ok).toBe(false);
  });

  const resetAt = (t: ReturnType<typeof setup>, from: number) =>
    t.simTransport.log.slice(from).find((l) => decode(l.frame.frame)?.id === 'RESET')?.at;

  it('refuses a RESET the guard holds at once, so it never goes out later (security review M2)', async () => {
    const t = setup();
    await t.settle();
    await t.type('unlock reset', true);
    expect((await t.type('reset 0')).r.ok).toBe(true);
    const from = t.simTransport.log.length;
    // One RESET in 10 s: the second is refused now, not retried in the background.
    const second = await t.type('reset 1');
    expect(second.r.ok).toBe(false);
    expect(t.engine.snapshot().jobs).toEqual([]);
    await t.clock.advance(15_000);
    expect(t.heard(from).map((c) => c.id)).not.toContain('RESET');
  });

  it('an OFF from another control while the gear is deaf does not hold the follow-up OFF (security review M1)', async () => {
    const t = setup();
    await t.settle();
    await t.type('unlock reset', true);
    const from = t.simTransport.log.length;
    const p = t.engine.console('reset 0', ctx);
    await t.until(() => resetAt(t, from) !== undefined);
    const reset = resetAt(t, from) ?? Number.NaN;
    await t.clock.advance(100);
    const off = await t.drive(
      t.engine.request(
        { kind: 'commands', commands: [{ id: 'OFF', address: { kind: 'short', n: 0 } }] },
        'ui',
      ),
    );
    expect(off.ok).toBe(true);
    expect((await t.drive(p)).ok).toBe(true);
    const offs = t.simTransport.log
      .slice(from)
      .filter((l) => decode(l.frame.frame)?.id === 'OFF')
      .map((l) => l.at - reset);
    // The UI's OFF came while the gear was deaf; the reset's own OFF still followed in time.
    expect(offs[0]).toBeLessThan(350);
    expect(offs.some((d) => d >= 350 && d < 500)).toBe(true);
  });

  it('warns that MAX LEVEL may be 254 when panic stops a reset after its RESET (security review L1)', async () => {
    const t = setup();
    await t.settle();
    await t.type('unlock reset', true);
    const from = t.simTransport.log.length;
    const p = t.engine.resetAddress(0, 'console');
    await t.until(() => resetAt(t, from) !== undefined);
    await t.drive(t.engine.panic());
    const r = await t.drive(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/A0 was reset, so its MAX LEVEL may be 254/);
    expect(t.engine.snapshot().notices.join('\n')).toMatch(/MAX LEVEL may be 254/);
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

  it('a group colour sees a group change made since the scan (S6-D2)', async () => {
    const t = setup();
    await t.settle();
    expect((await t.type('tc g5 3000K')).out.at(-1)).toMatch(/no known gear at G5/);
    expect((await t.type('group 0 add 5')).r.ok).toBe(true);
    // The console sees A0 in g5 at once. The governor asks for a scan first.
    expect((await t.type('tc g5 3000K')).out.at(-1)).toMatch(/Scan before using a group/);
    expect((await t.type('scan')).r.ok).toBe(true);
    const r = await t.type('tc g5 3000K');
    expect(r.r.ok).toBe(true);
    expect(r.out.at(-1)).toBe('G5 3003K (333 mirek)');
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

describe('explain (ADR 0023)', () => {
  /** The typeable line in each row explain printed: two spaces, the line, two spaces or more. */
  const rows = (out: string[]) =>
    out.filter((l) => l.startsWith('  ')).map((l) => l.trim().split(/ {2,}/)[0] ?? '');
  /** The commands those lines send, parsed as the console would parse them. */
  const listed = (out: string[]) =>
    rows(out).map((line) => {
      const p = parseLine(line, ctx);
      if (!p.ok || p.command === undefined) throw new Error(line);
      const c = p.command;
      if (c.cmd === 'off') return { id: 'OFF', address: c.to[0] };
      if (c.cmd !== 'dali') throw new Error(line);
      return {
        id: c.id,
        ...(c.to?.[0] === undefined ? {} : { address: c.to[0] }),
        ...(c.value === undefined ? {} : { value: c.value }),
      };
    });

  it('prints the commands, the frames and the names, and sends nothing', async () => {
    const t = setup();
    await t.settle();
    await t.type('level 0 100');
    const frames = t.simTransport.log.length;
    // The snapshot carries the monitor's last lines only, so its length says nothing: the last
    // line's number does.
    const monitor = t.engine.snapshot().monitor.at(-1)?.seq;
    expect(monitor).toBeGreaterThan(0);
    const { r, out } = await t.type('explain tc 0 3000K 30%');
    expect(r.ok).toBe(true);
    expect(out).toEqual([
      'explain tc 0 3000K 30%: with the target simulator, this would send:',
      '  dtr0 77                             A3 4D         DTR0 77',
      '  dtr1 1                              C3 01         DTR1 1',
      '  set-temporary-colour-temperature 0  C1 08, 01 E7  ENABLE DEVICE TYPE 8, then SET TEMPORARY COLOUR TEMPERATURE Tc A0',
      '  dapc 0 210                          00 D2         DAPC A0 210',
      '4 commands, 5 frames on the bus. Nothing was sent.',
      'The governor judges a line when it is sent, and may clamp, hold or refuse it.',
    ]);
    expect(t.simTransport.log.length).toBe(frames);
    expect(t.engine.snapshot().monitor.at(-1)?.seq).toBe(monitor);
    // The driver is where it was.
    const { out: level } = await t.type('query 0 level');
    expect(level[0]).toMatch(/^actual level 100 /);
  });

  it('lists exactly what the line then sends, for each kind of command', async () => {
    const lines = [
      'level 0 40%',
      'level 0 128 fade 2s',
      'level 1 10% fade 300ms',
      'off 1',
      'on 0',
      'tc 0 2700K',
      'tc 0 4000K 60%',
      'rgb 1 200 10 0',
      'rgb 1 #204060 w 30',
      'fade 0 4s',
      'fade 0 rate 7',
      'fade 1',
      'scene 0 store 3 90',
      'scene 0 recall 3',
      'scene 0 remove 3',
      'scene 1 list',
      'group 0 add 2',
      'group 0 remove 2',
      'query 0',
      'query 1 tc',
      'query 0 groups',
      'dapc 0 77',
      'recall-min-level 1',
      'dtr0 12',
      'query-status 0',
      `${nameOf('DT8_QUERY_COLOUR_TYPE_FEATURES')} 1`,
      'raw 01 a0',
      'level g2 20%',
      'off all',
    ];
    // With the ceiling at the top, so the governor clamps nothing. The clamp has its own test.
    const t = setup({ ceilingArc: 254 });
    await t.settle();
    for (const line of lines) {
      // Let the rate guard's window pass, so the real line is not held or refused.
      await t.clock.advance(5000);
      await t.settle();
      const before = t.simTransport.log.length;
      const explained = await t.type(`explain ${line}`);
      expect(t.simTransport.log.length, line).toBe(before);
      const from = t.simTransport.log.length;
      const real = await t.type(line);
      expect(real.r.ok, `${line}: ${real.out.join(' / ')}`).toBe(true);
      const heard = t.heard(from).filter((c) => c.id !== 'ENABLE_DEVICE_TYPE');
      expect(listed(explained.out), line).toEqual(heard);
    }
  });

  it('shows a send-twice command once, marked, and counts both frames', async () => {
    const t = setup();
    await t.settle();
    const { out } = await t.type('explain fade 0 rate 7');
    expect(out).toEqual([
      'explain fade 0 rate 7: with the target simulator, this would send:',
      '  dtr0 7           A3 07     DTR0 7',
      '  set-fade-rate 0  01 2F x2  SET FADE RATE A0, sent twice',
      '2 commands, 3 frames on the bus. Nothing was sent.',
      'The governor judges a line when it is sent, and may clamp, hold or refuse it.',
    ]);
  });

  it('marks a query, and goes through each address of a list', async () => {
    const t = setup();
    await t.settle();
    const { out } = await t.type('explain query 0,1 level');
    expect(out.slice(1, 3)).toEqual([
      '  query-actual-level 0  01 A0  QUERY ACTUAL LEVEL A0, answers',
      '  query-actual-level 1  03 A0  QUERY ACTUAL LEVEL A1, answers',
    ]);
    expect(out[3]).toBe('2 commands, 2 frames on the bus. Nothing was sent.');
  });

  it('says what it cannot know: the level a scene store would read', async () => {
    const t = setup();
    await t.settle();
    const { r, out } = await t.type('explain scene 0 store 5');
    expect(r.ok).toBe(true);
    expect(rows(out)).toEqual([
      'query-actual-level 0',
      'dtr0 0',
      'set-scene 0 5',
      'query-scene-level 0 5',
    ]);
    expect(out).toContain('DTR0 then carries the level that was read. It is shown as 0 here.');
  });

  it('explains RESET without the reset unlock, and resets nothing', async () => {
    const t = setup();
    await t.settle();
    await t.type('level 0 100');
    const frames = t.simTransport.log.length;
    const { r, out } = await t.type('explain reset 0');
    expect(r.ok).toBe(true);
    expect(rows(out)).toEqual(['reset 0']);
    expect(out.join('\n')).toContain('It needs the reset unlock.');
    expect(t.simTransport.log.length).toBe(frames);
    expect((await t.type('query 0 level')).out[0]).toMatch(/^actual level 100 /);
  });

  it("gives the console's own refusals, and the engine's reasons, without sending", async () => {
    const t = setup();
    await t.settle();
    const frames = t.simTransport.log.length;
    // A0 is tunable white: it has no RGBWAF channels, which the engine says when it builds the line.
    const rgb = await t.type('explain rgb 0 10 20 30');
    expect(rgb.out.some((l) => l.startsWith('refused: '))).toBe(true);
    expect(rgb.out.at(-1)).toBe('Nothing would be sent.');
    const raw = await t.type('explain raw 01 e7');
    expect(raw.out.join(' ')).toContain('is not a supported command on its own');
    const twice = await t.type('explain raw 01 a0 x2');
    expect(twice.out.join(' ')).toContain('not a send-twice command');
    expect(t.simTransport.log.length).toBe(frames);
  });

  it('says when the governor would clamp a level to the ceiling', async () => {
    const t = setup({ ceilingArc: 200 });
    await t.settle();
    const { out } = await t.type('explain level 0 254');
    expect(out).toContain('The ceiling is 200, so the governor would send DAPC 254 as 200.');
    // And that is what it does.
    const from = t.simTransport.log.length;
    await t.type('level 0 254');
    expect(t.heard(from).filter((c) => c.id === 'DAPC')).toEqual([
      { id: 'DAPC', address: { kind: 'short', n: 0 }, value: 200 },
    ]);
    expect((await t.type('explain dapc 0 mask')).out.join(' ')).not.toContain('The ceiling is');
  });

  it('cuts a long list short, keeping the header and saying how many lines are left out', async () => {
    const t = setup();
    await t.settle();
    const { r, out } = await t.type('explain query 0..16');
    expect(r.ok).toBe(true);
    expect(out[0]).toBe('explain query 0..16: with the target simulator, this would send:');
    expect(out[1]).toMatch(/^ {2}query-status 0 /);
    // 17 addresses of 12 queries: 204 rows, of which 150 are printed.
    expect(out.filter((l) => l.startsWith('  ')).length).toBe(EXPLAIN_MAX_LINES);
    expect(out).toContain(
      '54 more lines are not shown. Explain fewer addresses at a time to see them.',
    );
    expect(out).toContain('204 commands, 204 frames on the bus. Nothing was sent.');
    // The whole answer fits in what a snapshot carries.
    expect(out.length).toBeLessThan(200);
  });

  it('turns away a word that is not in its tables, as the real line does (SH-1)', async () => {
    const t = setup();
    await t.settle();
    for (const w of ['constructor', '__proto__', 'toString']) {
      const a = await t.type(`explain query 0 ${w}`);
      expect(a.r.ok, w).toBe(false);
      expect(a.out.join(' '), w).toContain('is not something query can ask');
      expect((await t.type(`target ${w}`)).out.join(' '), w).toContain(
        'target takes sim, hw or both.',
      );
      expect((await t.type(`help ${w}`)).out.join(' '), w).toMatch(/^No help for "/);
    }
    expect(t.engine.snapshot().target).toBe('simulator');
    // A script that asks for help on such a word runs to its end.
    const r = await t.drive(t.engine.runScript('x', 'help constructor\necho done', ctx));
    expect(r.ok).toBe(true);
    expect(t.engine.snapshot().script).toBeUndefined();
  });

  it('says which DTR a command would read', async () => {
    const t = setup();
    await t.settle();
    await t.type('dtr0 200');
    const { out } = await t.type('explain set-max-level 0');
    expect(out[1]).toBe('uses DTR0 = 200');
    expect(rows(out)).toEqual(['set-max-level 0']);
  });

  it('runs nowhere but the console: a script may not use it', async () => {
    const t = setup();
    await t.settle();
    const r = await t.drive(t.engine.runScript('x', 'explain off 0', ctx));
    expect(r.ok).toBe(false);
    expect(t.lines().join('\n')).toContain('explain cannot be used in a script.');
  });
});

describe('the host explain runs on', () => {
  it('reads through, and refuses everything that would send or change the app', async () => {
    const f = fakeHost([]);
    const calls: string[] = [];
    const real: ConsoleHost = {
      ...f.host,
      request: (i) => {
        calls.push('request');
        return f.host.request(i, 'console');
      },
      setCeiling: () => (calls.push('setCeiling'), Promise.resolve({ ok: true })),
      setTarget: () => (calls.push('setTarget'), Promise.resolve({ ok: true })),
      rescan: () => (calls.push('rescan'), Promise.resolve({ ok: true })),
      reapplyProfile: () => (calls.push('reapplyProfile'), Promise.resolve({ ok: true })),
      reset: () => (calls.push('reset'), Promise.resolve({ ok: true })),
      unlock: () => (calls.push('unlock'), { ok: true }),
      lock: () => void calls.push('lock'),
      resume: () => (calls.push('resume'), { ok: true }),
      panic: () => (calls.push('panic'), Promise.resolve()),
      sleep: () => (calls.push('sleep'), Promise.resolve()),
    };
    const dry = dryHost(real);
    const no = { ok: false, reason: 'explain sends nothing.' };
    expect(await dry.request({ kind: 'raw', a: 1, b: 0 }, 'console')).toMatchObject(no);
    expect(await dry.setCeiling(254, 'console', true)).toEqual(no);
    expect(await dry.setTarget('hardware', 'console')).toEqual(no);
    expect(await dry.rescan('console')).toEqual(no);
    expect(await dry.reapplyProfile('console')).toEqual(no);
    expect(await dry.reset(0, 'console')).toEqual(no);
    expect(dry.unlock('reset', 'console', true)).toEqual(no);
    expect(dry.resume('console')).toEqual(no);
    dry.lock();
    await dry.panic();
    await dry.sleep(1000);
    expect(calls).toEqual([]);
    expect(dry.ceilingArc()).toBe(200);
    expect(dry.dtr()).toEqual([220, undefined, undefined]);
    expect(dry.target()).toBe('simulator');
    expect(dry.devices()).toEqual([]);
    expect(dry.connectionText()).toBe('The simulated bench is in use.');
    expect(dry.stopped()).toBe(false);
    expect(dry.now()).toBe(0);
    expect(dry.compile({ kind: 'commands', commands: [{ id: 'TERMINATE' }] })).toEqual({
      commands: [{ id: 'TERMINATE' }],
      notes: [],
    });
  });

  it('formats rows in columns, and counts a send-twice frame twice', () => {
    expect(
      explainLines([{ id: 'TERMINATE' }, { id: 'RESET', address: { kind: 'broadcast' } }]),
    ).toEqual(['  terminate  A1 00     TERMINATE', '  reset all  FF 20 x2  RESET BC, sent twice']);
    expect(frameCount([{ id: 'TERMINATE' }, { id: 'RESET', address: { kind: 'broadcast' } }])).toBe(
      3,
    );
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
    compile: (intent) =>
      intent.kind === 'commands'
        ? { commands: [...intent.commands], notes: [] }
        : 'not built by this fake',
    devices: () => devices,
    ceilingArc: () => 200,
    dtr: () => [220, undefined, undefined],
    target: () => 'simulator',
    connectionText: () => 'The simulated bench is in use.',
    setCeiling: () => Promise.resolve({ ok: true }),
    setTarget: () => Promise.resolve({ ok: true }),
    rescan: () => Promise.resolve({ ok: true }),
    reapplyProfile: () => Promise.resolve({ ok: false, reason: 'no' }),
    reset: () => Promise.resolve({ ok: true }),
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
  it('reads fade settings back after writing them, on hardware only (ADR 0019 amendment 2)', async () => {
    const ids = (f: ReturnType<typeof fakeHost>) =>
      f.sent.flatMap((i) => (i.kind === 'commands' ? i.commands.map((c) => c.id) : []));
    const readBack = ['QUERY_FADE_TIME_FADE_RATE', 'QUERY_EXTENDED_FADE_TIME'];
    for (const target of ['hardware', 'both'] as const) {
      const f = fakeHost([]);
      f.host.target = () => target;
      expect((await f.run('fade 0 rate 7')).ok).toBe(true);
      expect(ids(f), target).toEqual(['DTR0', 'SET_FADE_RATE', ...readBack]);
    }
    // A group cannot be read back, and the simulator target needs none.
    const g = fakeHost([]);
    g.host.target = () => 'hardware';
    expect((await g.run('fade g0 rate 7')).ok).toBe(true);
    expect(ids(g)).toEqual(['DTR0', 'SET_FADE_RATE']);
    const s = fakeHost([]);
    expect((await s.run('fade 0 rate 7')).ok).toBe(true);
    expect(ids(s)).toEqual(['DTR0', 'SET_FADE_RATE']);
  });

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
    // No fade is a candidate: 100 ms is nearer 0 than 707 ms (S6-D6).
    expect(nearestFade(100, false)).toMatchObject({ ms: 0, text: 'no fade' });
    // A fast fade wins over the extended fade while the fade time is 0 (S6-D6).
    expect(nearestFade(150, true, 4)).toMatchObject({
      ms: 100,
      text: 'fade time 0, so the fast fade',
    });
    expect(nearestFade(0, true, 4).ms).toBe(100);
    expect(nearestFade(2000, true, 4).text).toBe('fade time 4');
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
    const dev = (
      address: number,
      drive: 'tc' | 'rgbwaf',
      groups: number | undefined,
      level = 0,
    ): DeviceView =>
      ({
        address,
        verified: true,
        ceiling: 'verified',
        modelled: false,
        facts: { drive },
        level,
        ...(groups === undefined ? {} : { groups }),
      }) as unknown as DeviceView;
    const f = fakeHost([], [dev(0, 'tc', 2), dev(1, 'rgbwaf', 4)]);
    expect((await f.run('tc g1 3000K 50%')).ok).toBe(true);
    expect(f.sent[0]).toMatchObject({ kind: 'commands' });
    expect((await f.run('tc g5 3000K')).out[0]).toMatch(/no known gear at G5/);
    expect((await f.run('rgb all 1 2 3')).out[0]).toMatch(/A0 does not report RGBWAF/);
    // Gear whose groups are not known may be a member (S6-D2).
    const u = fakeHost([], [dev(0, 'tc', 2), dev(1, 'rgbwaf', undefined)]);
    expect((await u.run('tc g1 3000K')).out[0]).toMatch(/A1 does not report colour temperature/);
  });

  it('a group colour with a lower level activates after the level (S5-D3, S6-D1)', async () => {
    const ids = (f: { sent: Intent[] }) =>
      f.sent.flatMap((i) => (i.kind === 'commands' ? i.commands.map((c) => c.id) : []));
    const dev = (level: number): DeviceView =>
      ({
        address: 0,
        verified: true,
        ceiling: 'verified',
        modelled: false,
        facts: { drive: 'tc' },
        groups: 2,
        level,
      }) as unknown as DeviceView;
    const down = fakeHost([{ ok: true, answers: [] }], [dev(200)]);
    await down.run('tc g1 6500K 50');
    expect(ids(down).slice(-2)).toEqual(['DAPC', 'DT8_ACTIVATE']);
    const up = fakeHost([{ ok: true, answers: [] }], [dev(20)]);
    await up.run('tc g1 6500K 50');
    expect(ids(up).slice(-2)).toEqual(['DT8_ACTIVATE', 'DAPC']);
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
      facts: { drive: 'tc', minLevel: 85, maxLevel: 200, extendedFade: 0 },
      groups: 0b101,
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
    // MASK is not a level to store (S6-D11).
    const m = fakeHost([{ ok: true, answers: [255] }]);
    expect((await m.run('scene 0 store 3')).out).toEqual([
      'error The driver reports MASK (starting up, or a lamp error), so nothing was stored.',
    ]);
    expect(m.sent).toHaveLength(1);
    // After a wait for the rate guard, the level is read again and that one is stored (S6-D9).
    const w = fakeHost([
      { ok: true, answers: [100] },
      { ok: false, kind: 'refused', reason: 'Too fast.', retryAt: 500 },
      { ok: true, answers: [40] },
      { ok: true, answers: [40] },
    ]);
    expect((await w.run('scene 0 store 3')).out).toEqual([
      'note waiting 500 ms for the rate guard: Too fast.',
      'out A0 scene 3 holds 40 (0.3%), read back',
    ]);
    const last = w.sent.at(-1);
    expect(last?.kind === 'commands' ? last.commands[0] : undefined).toEqual({
      id: 'DTR0',
      value: 40,
    });
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
    // A command that reads a DTR says which value it uses (S6-D3).
    const d = fakeHost([]);
    expect((await d.run('set-fade-time 0')).out).toEqual([
      'note uses DTR0 = 220',
      'out sent set fade time A0',
    ]);
    expect((await f.run('dapc 0 254')).out).toEqual(['refused refused: no']);
    expect((await f.run('raw 00 fe')).out).toEqual(['out sent raw 00 FE, clamped: held to 200']);
    expect((await f.run('raw 00 fe')).out).toEqual(['refused refused: no']);
    // A device type opcode alone does not decode, so it is refused with that reason (S6-D7).
    expect((await f.run('raw 01 f2 x2')).out).toEqual([
      "refused refused: raw 01 F2 is not a supported command on its own. Use the command's name, which adds ENABLE DEVICE TYPE.",
    ]);
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
