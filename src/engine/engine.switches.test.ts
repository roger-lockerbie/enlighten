/**
 * U-switch for the engine: plates drive the simulated bench through the governor with the source
 * `switch`, show in the console and the bus monitor, and stop on Panic.
 */
import { describe, expect, it } from 'vitest';
import { simEngine } from '../../tests/harness/engine.ts';
import { short } from '../dali/address.ts';
import { presetPlate } from '../switch/presets.ts';
import type { Plate } from '../switch/plate.ts';

async function ready() {
  const b = simEngine();
  await b.settle();
  await b.clock.advance(3000);
  return b;
}

const plateAt = (n: number, layout: 1 | 2 | 4 = 2): Plate =>
  presetPlate('p1', 'zencontrol', layout, short(n));

const level = (b: Awaited<ReturnType<typeof ready>>, unit: 'A' | 'B' = 'A') =>
  b.sim.unit(unit)?.gear.levelAt(b.clock.now()) ?? -1;

const said = (b: Awaited<ReturnType<typeof ready>>) =>
  b.engine
    .snapshot()
    .console.map((c) => c.text)
    .join('\n');

describe('switch plates on the engine', () => {
  it('a short press on On recalls max, and the frames carry the source switch', async () => {
    const b = await ready();
    b.engine.setSwitches([plateAt(0)], []);
    b.engine.switchInput('p1', 0, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 0, false);
    await b.settle();
    await b.clock.advance(3000);
    expect(level(b)).toBeGreaterThan(0);
    expect(b.engine.snapshot().monitor.some((m) => m.source === 'switch')).toBe(true);
    expect(said(b)).toContain('short press -> on A0');
    expect(b.engine.snapshot().switches[0]?.buttons[0]?.last).toBe('short');
  });

  it('a hold dims while it lasts and stops at release', async () => {
    const b = await ready();
    await b.drive(b.engine.request({ kind: 'level', address: 0, arc: 100 }, 'ui'));
    await b.clock.advance(3000);
    b.engine.setSwitches([plateAt(0)], []);
    b.engine.switchInput('p1', 1, true);
    await b.clock.advance(900);
    b.engine.switchInput('p1', 1, false);
    await b.settle();
    const frames = b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length;
    await b.clock.advance(3000);
    expect(b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length).toBe(frames);
    expect(frames).toBeGreaterThan(0);
  });

  it('does nothing on an address that has no driver, and says why', async () => {
    const b = await ready();
    b.engine.setSwitches([plateAt(30)], []);
    b.engine.switchInput('p1', 0, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 0, false);
    await b.settle();
    expect(b.engine.snapshot().monitor.some((m) => m.source === 'switch')).toBe(false);
    expect(said(b)).toContain('A30 has no driver');
  });

  it('Panic stops a hold and latches, and a press while latched sends nothing', async () => {
    const b = await ready();
    b.engine.setSwitches([plateAt(0)], []);
    b.engine.switchInput('p1', 1, true);
    await b.clock.advance(700);
    await b.drive(b.engine.panic());
    const n = b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length;
    await b.clock.advance(3000);
    expect(b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length).toBe(n);
    expect(b.engine.snapshot().switches[0]?.buttons[1]?.down).toBe(false);
    b.engine.switchInput('p1', 0, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 0, false);
    await b.clock.advance(1000);
    expect(b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length).toBe(n);
    expect(said(b)).toContain('Panic is on');
  });

  it('recalls a scene slot and runs a named sequence', async () => {
    const b = await ready();
    await b.drive(
      b.engine.sceneWrite(0, 1, { name: 'Mid', arc: 120, colour: { kind: 'none' } }, 'ui'),
    );
    const p = plateAt(0, 4);
    const seqName = 'Short';
    const withSeq: Plate = {
      ...p,
      buttons: p.buttons.map((bt, i) =>
        i === 2
          ? {
              ...bt,
              mapping: { short: { kind: 'run', what: 'sequence', name: seqName } },
            }
          : bt,
      ),
    };
    b.engine.setSwitches(
      [withSeq],
      [
        {
          kind: 'sequence',
          sequence: {
            name: seqName,
            steps: [{ target: short(0), arc: 60, colour: { kind: 'none' }, durationMs: 1000 }],
          },
        },
      ],
    );
    // Button 1 is scene 1 in the four button preset.
    b.engine.switchInput('p1', 1, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 1, false);
    await b.settle();
    await b.clock.advance(3000);
    expect(level(b)).toBe(120);
    b.engine.switchInput('p1', 2, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 2, false);
    await b.clock.advance(100);
    expect(said(b)).toContain('run sequence "Short"');
  });

  it('says so when a plate names a sequence the library lacks', async () => {
    const b = await ready();
    const p = plateAt(0, 1);
    b.engine.setSwitches(
      [
        {
          ...p,
          buttons: [{ led: 'off', mapping: { short: { kind: 'run', what: 'effect', name: 'X' } } }],
        },
      ],
      [],
    );
    b.engine.switchInput('p1', 0, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 0, false);
    await b.clock.advance(100);
    expect(said(b)).toContain('The effect "X" is not in the library.');
  });

  it('a page that stops answering lets go of a held button', async () => {
    const b = await ready();
    b.engine.setSwitches([plateAt(0)], []);
    b.engine.heartbeat(true);
    b.engine.switchInput('p1', 1, true);
    await b.clock.advance(700);
    // No more beats: the watchdog stops the hold.
    await b.clock.advance(20_000);
    expect(b.engine.snapshot().switches[0]?.buttons[1]?.down).toBe(false);
    const n = b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length;
    await b.clock.advance(5000);
    expect(b.engine.snapshot().monitor.filter((m) => m.source === 'switch').length).toBe(n);
  });

  it('a group target is left alone while a driver may be a member and is not verified', async () => {
    const b = await ready();
    const p = presetPlate('p1', 'zencontrol', 1, { kind: 'group', n: 3 });
    b.engine.setSwitches([p], []);
    b.engine.switchInput('p1', 0, true);
    await b.clock.advance(100);
    b.engine.switchInput('p1', 0, false);
    await b.clock.advance(500);
    // No driver is in group 3: nothing is sent, and the console says so or sends nothing.
    expect(b.engine.snapshot().monitor.some((m) => m.source === 'switch')).toBe(false);
  });
});
