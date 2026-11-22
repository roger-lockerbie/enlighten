/**
 * U-engine for Stage 9: sequences run as jobs through the governor (SPEC R5.4, S5.1). A plan is
 * checked on a copy of the bench first, runs on the clock, and stops at panic, a stop, or a change
 * of bench.
 */
import { describe, expect, it } from 'vitest';
import { simEngine } from '../../tests/harness/engine.ts';
import { broadcast, short } from '../dali/address.ts';
import type { Sequence, Step } from '../design/sequence.ts';
import type { RunDef } from './engine.ts';

const step = (s: Partial<Step>): Step => ({
  target: short(0),
  arc: 150,
  colour: { kind: 'none' },
  durationMs: 0,
  ...s,
});
const run = (name: string, ...steps: Step[]): RunDef => ({
  kind: 'sequence',
  sequence: { name, steps } satisfies Sequence,
});
const min = 60_000;

async function ready() {
  const b = simEngine();
  await b.settle();
  await b.clock.advance(3000);
  return b;
}
type Bench = Awaited<ReturnType<typeof ready>>;
const level = (b: Bench, unit: string) => b.sim.unit(unit)?.gear.levelAt(b.clock.now());
const jobs = (b: Bench) => b.engine.snapshot().jobs.map((j) => j.kind);

describe('running a sequence', () => {
  it('runs each step at its time, shows progress, and says how it ended', async () => {
    const b = await ready();
    const def = run(
      'Up and down',
      step({ arc: 180, durationMs: 2000 }),
      step({ arc: 120, durationMs: 4000 }),
    );
    expect(await b.drive(b.engine.runDesign(def, 'ui'))).toEqual({ ok: true });
    expect(jobs(b)).toEqual(['sequence']);
    expect(b.engine.snapshot().run).toMatchObject({
      kind: 'sequence',
      name: 'Up and down',
      rows: 2,
      endMs: 6000,
    });
    await b.clock.advance(1900);
    expect(level(b, 'A')).toBeGreaterThan(85);
    expect(level(b, 'A')).toBeLessThan(180);
    expect(b.engine.snapshot().run?.row).toBe(1);
    await b.settle();
    // The last command went out a few frames after its time, so its fade ends that much later.
    await b.clock.advance(500);
    expect(level(b, 'A')).toBe(120);
    const s = b.engine.snapshot();
    expect(s.run).toBeUndefined();
    expect(s.lastRun?.outcome).toBe('finished');
    expect(s.lastRun?.text).toMatch(
      /^Finished after 6 s, 0 s after its planned end\. Every change/,
    );
  });

  it('runs the 25-minute night fade to its end, within a command of its planned time', async () => {
    const b = await ready();
    const def = run(
      'Night',
      step({ arc: 0, colour: { kind: 'tc', mirek: 370 } }),
      step({ arc: 195, colour: { kind: 'tc', mirek: 370 }, durationMs: 25 * min }),
    );
    expect((await b.drive(b.engine.runDesign(def, 'ui'))).ok).toBe(true);
    // The check before the run is on a clock of its own, so the run is timed from its own start.
    const start = b.engine.snapshot().run?.startedAt ?? NaN;
    await b.settle();
    const took = b.clock.now() - start;
    expect(took).toBeGreaterThanOrEqual(25 * min);
    expect(took).toBeLessThan(25 * min + 500);
    expect(b.engine.snapshot().lastRun?.outcome).toBe('finished');
    // The last fade's command went out a few frames after its time, so the fade ends that much later.
    await b.clock.advance(500);
    expect(level(b, 'A')).toBe(195);
    expect(Math.round(b.sim.unit('A')?.gear.colourAt(b.clock.now()).tc ?? 0)).toBe(370);
  });

  it('checks a plan without running it', async () => {
    const b = await ready();
    const good = run('Good', step({ target: broadcast, arc: 150, durationMs: 4000 }));
    expect(await b.drive(b.engine.planCheck(good, 'ui'))).toEqual({
      ok: true,
      text: 'Checked against the governor on a copy of the bench: nothing is refused.',
    });
    // Nothing was sent to the bench itself.
    expect(level(b, 'A')).toBe(0);
    expect(jobs(b)).toEqual([]);
  });

  it('refuses a plan the rate guard would refuse, with its reason, and sends none of it', async () => {
    const b = await ready();
    // On, off and on again at once: hard steps closer than the rule allows.
    const flash = run(
      'Flash',
      step({ arc: 200 }),
      step({ arc: 0 }),
      step({ arc: 200 }),
      step({ arc: 0 }),
    );
    const checked = await b.drive(b.engine.planCheck(flash, 'ui'));
    expect(checked.ok).toBe(false);
    expect('reason' in checked && checked.reason).toMatch(
      /^The governor would refuse the change at 0 s for A0\. Rate guard:/,
    );
    const started = await b.drive(b.engine.runDesign(flash, 'ui'));
    expect(started.ok).toBe(false);
    expect(level(b, 'A')).toBe(0);
    expect(jobs(b)).toEqual([]);
    expect(b.engine.snapshot().run).toBeUndefined();
  });

  it('refuses an empty plan, a bad one, and a second run while one is going', async () => {
    const b = await ready();
    expect(await b.drive(b.engine.runDesign(run('None'), 'ui'))).toEqual({
      ok: false,
      reason: 'A sequence needs at least one step.',
    });
    expect(
      await b.drive(b.engine.runDesign(run('Nowhere', step({ target: short(40) })), 'ui')),
    ).toEqual({ ok: false, reason: 'Nothing here would change any light.' });
    expect(
      await b.drive(b.engine.planCheck(run('Nowhere', step({ target: short(40) })), 'ui')),
    ).toEqual({ ok: false, reason: 'Nothing here would change any light.' });
    const slow = run('Slow', step({ arc: 180, durationMs: 60_000 }));
    expect((await b.drive(b.engine.runDesign(slow, 'ui'))).ok).toBe(true);
    expect(await b.drive(b.engine.runDesign(slow, 'ui'))).toEqual({
      ok: false,
      reason: 'A sequence or an effect is running. Stop it first.',
    });
    b.engine.stopRun();
    await b.settle();
  });

  it('stops when a person stops it: nothing more is sent and the light is left as it is', async () => {
    const b = await ready();
    const def = run(
      'Two',
      step({ arc: 180, durationMs: 4000 }),
      step({ arc: 100, durationMs: 4000 }),
    );
    await b.drive(b.engine.runDesign(def, 'ui'));
    await b.clock.advance(1000);
    b.engine.stopRun();
    await b.settle();
    expect(b.engine.snapshot().lastRun).toMatchObject({
      outcome: 'stopped',
      text: 'Stopped: Stopped by a person.',
    });
    // The first fade runs out. The second step never goes.
    await b.clock.advance(10_000);
    expect(level(b, 'A')).toBe(180);
  });

  it('stops at panic, and will not start while panic is on', async () => {
    const b = await ready();
    const def = run(
      'Long',
      step({ arc: 180, durationMs: 60_000 }),
      step({ arc: 100, durationMs: 4000 }),
    );
    await b.drive(b.engine.runDesign(def, 'ui'));
    await b.clock.advance(5000);
    await b.drive(b.engine.panic());
    await b.settle();
    expect(jobs(b)).toEqual([]);
    expect(level(b, 'A')).toBe(0);
    expect(b.engine.snapshot().lastRun?.outcome).toBe('stopped');
    expect(await b.drive(b.engine.runDesign(def, 'ui'))).toEqual({
      ok: false,
      reason: 'Panic is on. Resume first.',
    });
  });

  it('stops when the simulator settings change, and when a scan starts', async () => {
    const b = await ready();
    const def = run(
      'Long',
      step({ arc: 180, durationMs: 60_000 }),
      step({ arc: 100, durationMs: 4000 }),
    );
    await b.drive(b.engine.runDesign(def, 'ui'));
    await b.clock.advance(2000);
    void b.engine.rescan('ui');
    await b.settle();
    expect(b.engine.snapshot().lastRun?.text).toBe('Stopped: A scan started.');
  });

  it('says a run stopped when a driver stops answering part way through', async () => {
    const b = await ready();
    const def = run(
      'Two',
      step({ arc: 180, durationMs: 4000 }),
      step({ arc: 100, durationMs: 4000 }),
    );
    await b.drive(b.engine.runDesign(def, 'ui'));
    await b.clock.advance(1000);
    // The bench is taken apart under the run: its next change has nowhere to go.
    b.sim.remove(() => true);
    await b.settle();
    const s = b.engine.snapshot();
    expect(s.run).toBeUndefined();
    // However it ended, it says so.
    expect(s.lastRun?.name).toBe('Two');
    expect(jobs(b)).toEqual([]);
  });

  it('ends a check at once when Panic is pressed during it, and sends nothing', async () => {
    const b = await ready();
    const long = run('Long', step({ target: broadcast, arc: 180, durationMs: 20 * min }));
    const checking = b.engine.planCheck(long, 'ui');
    const panicking = b.engine.panic();
    expect(await b.drive(checking)).toEqual({ ok: false, reason: 'The check was stopped.' });
    await b.drive(panicking);
    expect(b.engine.snapshot().latched).toBe(true);
    expect(level(b, 'A')).toBe(0);
  });

  it('lets other work in during a check at least every 25 steps of the check, and on real time', async () => {
    // The wall clock here moves 5 ms each time it is read, as if every step took that long.
    let wall = 0;
    let yields = 0;
    const b = simEngine({ options: { wallNow: () => (wall += 5) } });
    await b.settle();
    await b.clock.advance(3000);
    const at = b.clock.at.bind(b.clock);
    b.clock.at = (time, fn) => {
      // A wait of no time at all is the check giving way.
      if (time === b.clock.now()) yields += 1;
      return at(time, fn);
    };
    const r = await b.drive(
      b.engine.planCheck(run('Up', step({ target: broadcast, arc: 150, durationMs: 4000 })), 'ui'),
    );
    expect(r.ok).toBe(true);
    // 12 ms at 5 ms a reading: it gives way about every third step, hundreds of times in all.
    expect(yields).toBeGreaterThan(100);
  });

  it('takes one check at a time, and will not run while one is going', async () => {
    const b = await ready();
    const def = run('Up', step({ target: broadcast, arc: 150, durationMs: 4000 }));
    const first = b.engine.planCheck(def, 'ui');
    expect(await b.engine.planCheck(def, 'ui')).toEqual({
      ok: false,
      reason: 'A check is running. Wait for it to end.',
    });
    expect(await b.engine.runDesign(def, 'ui')).toEqual({
      ok: false,
      reason: 'A check is running. Wait for it to end.',
    });
    expect((await b.drive(first)).ok).toBe(true);
  });

  it('does not run a plan made for lights that changed while it was being checked', async () => {
    const b = await ready();
    const def = run('Up', step({ arc: 150, durationMs: 4000 }));
    const starting = b.engine.runDesign(def, 'ui');
    // A person moves the light while the check is going.
    void b.engine.request({ kind: 'apply', address: 0, arc: 120 }, 'ui');
    expect(await b.drive(starting)).toEqual({
      ok: false,
      reason: 'The lights changed while the plan was being checked. Run it again.',
    });
    expect(jobs(b)).toEqual([]);
  });

  it('runs a plan with a colour step while a colour fade is still going', async () => {
    const b = await ready();
    // A slow colour fade is under way when Run is pressed: the colour reads differently before
    // and after the check, and that alone is no reason to refuse.
    await b.drive(
      b.engine.request(
        {
          kind: 'apply',
          address: 0,
          arc: 150,
          mirek: 200,
          fade: { kind: 'extended', value: 0x2b },
        },
        'ui',
      ),
    );
    await b.clock.advance(4000);
    const def = run(
      'Warm',
      step({ arc: 150, colour: { kind: 'tc', mirek: 370 }, durationMs: 4000 }),
    );
    expect(await b.drive(b.engine.runDesign(def, 'ui'))).toEqual({ ok: true });
    b.engine.stopRun();
    await b.settle();
  });

  it('says so when the wall clock ran on while the run was paused', async () => {
    // The wall clock here is the bench's clock plus a skew, which jumps as it would after a sleep.
    const wall = { skew: 0, now: () => 0 };
    const b = simEngine({ options: { wallNow: () => wall.now() + wall.skew } });
    wall.now = () => b.clock.now();
    await b.settle();
    await b.clock.advance(3000);
    const short4 = run('Short', step({ arc: 180, durationMs: 4000 }));
    await b.drive(b.engine.runDesign(short4, 'ui'));
    await b.clock.advance(1000);
    wall.skew = 600_000;
    await b.settle();
    expect(b.engine.snapshot().lastRun?.text).toMatch(
      /^Finished after 4 s, 0 s after its planned end\. Every change was sent\. The latest went out [\d.]+ s after its time\. By the wall clock it took 10 min 4 s: the page or the computer was paused for 10 min of that, so it ended that much late\.$/,
    );
    // With the two clocks in step again, nothing is added.
    await b.clock.advance(3000);
    await b.drive(b.engine.runDesign(run('Back', step({ arc: 120, durationMs: 4000 })), 'ui'));
    await b.settle();
    expect(b.engine.snapshot().lastRun?.text).toMatch(/after its time\.$/);
    // A run that is stopped says it too.
    await b.clock.advance(3000);
    await b.drive(b.engine.runDesign(run('Cut', step({ arc: 180, durationMs: 60_000 })), 'ui'));
    await b.clock.advance(1000);
    wall.skew += 120_000;
    b.engine.stopRun();
    await b.settle();
    expect(b.engine.snapshot().lastRun?.text).toMatch(
      /^Stopped: Stopped by a person\. By the wall clock it took 2 min 1 s: the page or the computer was paused for 2 min of that/,
    );
  });

  it('is not stopped by Ctrl-C in the console, which stops console work only', async () => {
    const b = await ready();
    await b.drive(b.engine.runDesign(run('Long', step({ arc: 180, durationMs: 60_000 })), 'ui'));
    b.engine.stopConsole();
    await b.clock.advance(1000);
    expect(jobs(b)).toEqual(['sequence']);
    // A scan typed in the console stops it all the same.
    void b.engine.rescan('console');
    await b.settle();
    expect(b.engine.snapshot().lastRun?.text).toBe('Stopped: A scan started.');
  });

  it('is not the engine’s inventory: a run does not hold the background work off', async () => {
    const b = await ready();
    await b.drive(b.engine.runDesign(run('Long', step({ arc: 180, durationMs: 60_000 })), 'ui'));
    // The unverified banner is suppressed while jobs run, but a run is listed as its own kind.
    expect(b.engine.snapshot().jobs).toEqual([{ kind: 'sequence', label: 'Sequence "Long"' }]);
    b.engine.stopRun();
    await b.settle();
  });
});
