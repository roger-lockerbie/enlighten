import { describe, expect, it } from 'vitest';
import { short, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { VirtualClock } from '../bus/clock.ts';
import { Controller, type Host, type HostResult } from './controller.ts';
import { ledLit } from './led.ts';
import { presetPlate } from './presets.ts';
import type { Family, Layout } from './plate.ts';

function rig(opts: { on?: boolean; blocked?: string; result?: HostResult } = {}) {
  const clock = new VirtualClock();
  const sent: string[] = [];
  const said: string[] = [];
  const state = { on: opts.on, blocked: opts.blocked, stops: 0 };
  const host: Host = {
    isOn: () => state.on,
    blocked: () => state.blocked,
    send: (cmds: readonly Command[]) => {
      sent.push(cmds.map((c) => c.id).join('+'));
      return Promise.resolve(opts.result ?? { ok: true });
    },
    recall: (a) => {
      sent.push(`scene${String(a.slot)}`);
      return Promise.resolve({ ok: true });
    },
    run: (a) => {
      sent.push(`run:${a.name}`);
      return Promise.resolve({ ok: true });
    },
    stopRun: () => {
      state.stops++;
    },
    say: (t) => said.push(t),
  };
  const c = new Controller(clock, host);
  const plate = (f: Family, l: Layout) => presetPlate('p', f, l, short(0));
  return { clock, c, sent, said, state, plate };
}

const tap = async (r: ReturnType<typeof rig>, i: number, ms = 100) => {
  r.c.input('p', i, true);
  await r.clock.advance(ms);
  r.c.input('p', i, false);
  await r.clock.advance(0);
};

describe('switch controller', () => {
  it('short press toggles: off when on, last level when off', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('zencontrol', 1)]);
    await tap(r, 0);
    r.state.on = false;
    await tap(r, 0);
    expect(r.sent).toEqual(['OFF', 'GO_TO_LAST_ACTIVE_LEVEL']);
    expect(r.said.some((s) => s.includes('short press -> toggle A0'))).toBe(true);
  });

  it('a hold dims up first, repeats, then the next hold goes down', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('zencontrol', 1)]);
    r.c.input('p', 0, true);
    await r.clock.advance(500 + 160 * 2);
    r.c.input('p', 0, false);
    await r.clock.advance(0);
    expect(r.sent).toEqual(['UP', 'UP', 'UP']);
    r.c.input('p', 0, true);
    await r.clock.advance(500);
    r.c.input('p', 0, false);
    await r.clock.advance(0);
    expect(r.sent.at(-1)).toBe('DOWN');
  });

  it('a hold on an off light starts with ON AND STEP UP', async () => {
    const r = rig({ on: false });
    r.c.setPlates([r.plate('zencontrol', 2)]);
    r.c.input('p', 0, true);
    await r.clock.advance(500);
    r.c.input('p', 0, false);
    expect(r.sent[0]).toBe('ON_AND_STEP_UP');
  });

  it('four buttons: on, two scenes, off', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('zencontrol', 4)]);
    for (const i of [0, 1, 2, 3]) await tap(r, i);
    expect(r.sent).toEqual(['RECALL_MAX_LEVEL', 'scene1', 'scene2', 'OFF']);
  });

  it('the coupler tunable white button steps colour on a hold', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('coupler', 4)]);
    r.c.input('p', 3, true);
    await r.clock.advance(400);
    r.c.input('p', 3, false);
    expect(r.sent).toEqual(['DT8_TC_STEP_COOLER']);
  });

  it('does nothing on a target that is blocked, and says why', async () => {
    const r = rig({ on: true, blocked: 'A0 is not verified.' });
    r.c.setPlates([r.plate('zencontrol', 1)]);
    await tap(r, 0);
    r.c.input('p', 0, true);
    await r.clock.advance(800);
    r.c.input('p', 0, false);
    expect(r.sent).toEqual([]);
    expect(r.said.some((s) => s.includes('nothing sent. A0 is not verified.'))).toBe(true);
  });

  it('reports a refusal', async () => {
    const r = rig({ on: true, result: { ok: false, reason: 'Held by the rate guard.' } });
    r.c.setPlates([r.plate('zencontrol', 1)]);
    await tap(r, 0);
    expect(r.said.some((s) => s.includes('refused. Held by the rate guard.'))).toBe(true);
  });

  it('reset stops a hold with nothing more sent', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('zencontrol', 1)]);
    r.c.input('p', 0, true);
    await r.clock.advance(500);
    r.c.reset();
    const n = r.sent.length;
    await r.clock.advance(5000);
    expect(r.sent).toHaveLength(n);
    expect(r.c.view()[0]?.buttons[0]?.down).toBe(false);
  });

  it('a KNX plate touched on two surfaces runs its multi action once and ignores both', async () => {
    const r = rig({ on: true });
    r.c.setPlates([r.plate('knx', 2)]);
    r.c.input('p', 0, true);
    r.c.input('p', 1, true);
    await r.clock.advance(1000);
    r.c.input('p', 0, false);
    r.c.input('p', 1, false);
    await r.clock.advance(0);
    expect(r.sent).toEqual(['OFF']);
    expect(r.c.view()[0]?.multi).toBe(false);
  });

  it('ignores an unknown plate or button and repeated levels', () => {
    const r = rig();
    r.c.setPlates([r.plate('zencontrol', 1)]);
    r.c.input('x', 0, true);
    r.c.input('p', 5, true);
    r.c.input('p', 0, false);
    expect(r.c.view()[0]?.buttons[0]?.down).toBe(false);
  });

  it('run and stop actions reach the host', async () => {
    const r = rig();
    const p = r.plate('zencontrol', 1);
    r.c.setPlates([
      {
        ...p,
        buttons: [
          {
            led: 'off',
            mapping: {
              short: { kind: 'run', what: 'sequence', name: 'Dawn' },
              double: { kind: 'stop' },
              released: { kind: 'on', target: { kind: 'broadcast' } as Address },
            },
          },
        ],
        filter: 0xff,
      },
    ]);
    await tap(r, 0);
    expect(r.sent).toContain('run:Dawn');
    expect(r.sent).toContain('RECALL_MAX_LEVEL');
  });

  it('LED modes', () => {
    expect(ledLit('off', true)).toBe(false);
    expect(ledLit('always', undefined)).toBe(true);
    expect(ledLit('onWhenOn', true)).toBe(true);
    expect(ledLit('onWhenOn', undefined)).toBe(false);
    expect(ledLit('onWhenOff', false)).toBe(true);
    expect(ledLit('onWhenOff', undefined)).toBe(false);
  });
});
