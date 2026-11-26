/**
 * P-explain (ADR 0023): whatever line it is given, on the simulator, on hardware and on Both,
 * `explain` sends no frame to either transport and leaves everything the engine reports as it was:
 * the bus monitor, the devices and their levels, the DTRs as the governor knows them, the ceiling,
 * the target, the unlocks, the latch, jobs and scan state. Only console lines are added.
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
import type { TxFrame } from '../dali/sequences.ts';
import type { SendResult } from '../safety/types.ts';
import { Engine, type OutputTarget } from './engine.ts';
import type { HardwareInfo, HardwareTransport, TransportState } from './transport.ts';

/** A second simulator behind a transport, standing in for the server and the hasseb. */
class FakeHardware implements HardwareTransport {
  readonly kind = 'server';
  readonly inner: SimTransport;
  private st: TransportState = 'down';
  constructor(sim: Simulator, clock: VirtualClock) {
    this.inner = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  }
  state(): TransportState {
    return this.st;
  }
  info(): HardwareInfo {
    return { fwMajor: 2, fwMinor: 4, attached: true };
  }
  connect(): Promise<void> {
    this.st = 'ready';
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.st = 'down';
    return Promise.resolve();
  }
  send(f: TxFrame): Promise<SendResult> {
    return this.inner.send(f);
  }
  sendPanic(f: TxFrame): Promise<SendResult> {
    return this.inner.sendPanic(f);
  }
}

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
  for (const target of [
    'simulator',
    'hardware',
    'both',
  ] as const satisfies readonly OutputTarget[]) {
    it(`sends nothing and changes nothing, whatever the line, on ${target}`, async () => {
      const clock = new VirtualClock(1000);
      const sim = Simulator.bench({ at: 1000 });
      const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
      const hw = new FakeHardware(Simulator.bench({ at: 0 }), clock);
      const engine = new Engine({ clock, sim, simTransport, hardware: hw });
      const settle = async () => {
        for (let i = 0; i < 400_000; i++) {
          await flushMicrotasks();
          if (engine.snapshot().jobs.length === 0) return;
          const next = clock.next();
          if (next === undefined) throw new Error('Nothing is waiting on the clock.');
          await clock.advanceTo(next);
        }
        throw new Error('The engine did not settle.');
      };
      await settle();
      if (target !== 'simulator') {
        const p = engine.setTarget(target, 'ui');
        await settle();
        expect((await p).ok).toBe(true);
        await settle();
      }
      expect(engine.snapshot().devices.length).toBe(2);
      // Unlock everything a person can, so no line is stopped by a lock before it could send.
      for (const u of ['rate', 'reset', 'expert'] as const) engine.unlock(u, 'console', true);
      /** Everything the engine reports but the console's own lines, and the DTRs under it. */
      const state = () => {
        const rest = { ...engine.snapshot(), console: [] };
        return JSON.stringify({ rest, dtr: engine.dtrView() });
      };
      let explained = 0;
      await fc.assert(
        fc.asyncProperty(friendly, async (line) => {
          const frames = [simTransport.log.length, hw.inner.log.length];
          const before = state();
          const at = clock.now();
          const r = await engine.console(`explain ${line}`, ctx, true);
          // It needs no time on the clock: nothing is queued, nothing waits.
          expect(clock.now(), line).toBe(at);
          expect([simTransport.log.length, hw.inner.log.length], line).toEqual(frames);
          expect(state(), line).toBe(before);
          if (r.ok) explained++;
        }),
        { numRuns: runs * 3 },
      );
      // The property is not empty: most lines were explained, not turned away by the parser.
      expect(explained).toBeGreaterThan(runs);
      engine.dispose();
    }, 300_000);
  }
});
