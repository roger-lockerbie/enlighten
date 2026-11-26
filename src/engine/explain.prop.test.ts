/**
 * P-explain (ADR 0023): whatever line it is given, `explain` sends no frame to the bench, adds no
 * line to the bus monitor and leaves every driver's level and the DTRs as the governor knows them.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { flushMicrotasks, VirtualClock } from '../bus/clock.ts';
import { withFloors } from '../bus/timing.ts';
import { COMMANDS } from '../dali/commands.ts';
import { nameOf } from '../console/names.ts';
import type { ParseContext } from '../console/parse.ts';
import { Simulator } from '../sim/simulator.ts';
import { SimTransport } from '../transport/sim.ts';
import { Engine } from './engine.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);
const ctx: ParseContext = { aliases: new Map() };

const addr = fc.constantFrom('0', '1', '0,1', '0..1', 'g0', 'g3', 'all', 'unaddressed', '7');
const n = (max: number) => fc.integer({ min: 0, max }).map(String);
const friendly = fc.oneof(
  fc.tuple(addr, n(254)).map(([a, v]) => `level ${a} ${v}`),
  fc.tuple(addr, n(100), n(20)).map(([a, v, s]) => `level ${a} ${v}% fade ${s}s`),
  addr.map((a) => `off ${a}`),
  addr.map((a) => `on ${a}`),
  fc.tuple(addr, fc.integer({ min: 1500, max: 9000 })).map(([a, k]) => `tc ${a} ${String(k)}K`),
  fc
    .tuple(addr, fc.integer({ min: 1500, max: 9000 }), n(100))
    .map(([a, k, v]) => `tc ${a} ${String(k)}K ${v}%`),
  fc.tuple(addr, n(254), n(254), n(254)).map(([a, r, g, b]) => `rgb ${a} ${r} ${g} ${b}`),
  fc.tuple(addr, n(30)).map(([a, s]) => `fade ${a} ${s}s`),
  fc.tuple(addr, fc.integer({ min: 1, max: 15 })).map(([a, r]) => `fade ${a} rate ${String(r)}`),
  addr.map((a) => `fade ${a}`),
  fc
    .tuple(addr, fc.constantFrom('recall', 'store', 'remove'), n(15))
    .map(([a, op, s]) => `scene ${a} ${op} ${s}`),
  fc.tuple(addr, n(15), n(254)).map(([a, s, v]) => `scene ${a} store ${s} ${v}`),
  addr.map((a) => `scene ${a} list`),
  fc
    .tuple(addr, fc.constantFrom('add', 'remove'), n(15))
    .map(([a, op, g]) => `group ${a} ${op} ${g}`),
  fc
    .tuple(addr, fc.constantFrom('', 'level', 'max', 'fade', 'groups', 'tc', 'status'))
    .map(([a, w]) => `query ${a} ${w}`),
  fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.boolean())
    .map(([a, b, x]) => `raw ${a.toString(16)} ${b.toString(16)}${x ? ' x2' : ''}`),
  // Every DALI command by name, with an address and a value whether it wants them or not.
  fc
    .tuple(fc.constantFrom(...COMMANDS), addr, n(255), fc.integer({ min: 0, max: 2 }))
    .map(([s, a, v, words]) => [nameOf(s.id), a, v].slice(0, words + 1).join(' ')),
  fc.tuple(fc.constantFrom(...COMMANDS), n(255)).map(([s, v]) => `${nameOf(s.id)} ${v}`),
  // Lines explain does not cover, and nonsense.
  fc.constantFrom('cap 254', 'panic', 'scan', 'unlock reset', 'target hw', 'profile apply', 'frob'),
);

describe('P-explain', () => {
  it('sends nothing, whatever the line', async () => {
    const clock = new VirtualClock(1000);
    const sim = Simulator.bench({ at: 1000 });
    const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
    const engine = new Engine({ clock, sim, simTransport });
    const settle = async () => {
      for (let i = 0; i < 200_000; i++) {
        await flushMicrotasks();
        if (engine.snapshot().jobs.length === 0) return;
        const next = clock.next();
        if (next === undefined) throw new Error('Nothing is waiting on the clock.');
        await clock.advanceTo(next);
      }
      throw new Error('The engine did not settle.');
    };
    await settle();
    // Unlock everything a person can, so no line is stopped by a lock before it could send.
    for (const u of ['rate', 'reset', 'expert'] as const) engine.unlock(u, 'console', true);
    let explained = 0;
    await fc.assert(
      fc.asyncProperty(friendly, async (line) => {
        const frames = simTransport.log.length;
        const before = engine.snapshot();
        const p = engine.console(`explain ${line}`, ctx, true);
        await settle();
        const r = await p;
        const after = engine.snapshot();
        expect(simTransport.log.length, line).toBe(frames);
        expect(after.monitor.length, line).toBe(before.monitor.length);
        expect(
          after.devices.map((d) => d.level),
          line,
        ).toEqual(before.devices.map((d) => d.level));
        expect(after.ceilingArc, line).toBe(before.ceilingArc);
        expect(after.target, line).toBe(before.target);
        expect(after.unlocks, line).toEqual(before.unlocks);
        expect(after.latched, line).toBe(before.latched);
        if (r.ok) explained++;
      }),
      { numRuns: runs * 3 },
    );
    // The property is not empty: most lines were explained, not turned away by the parser.
    expect(explained).toBeGreaterThan(runs);
    engine.dispose();
  }, 120_000);
});
