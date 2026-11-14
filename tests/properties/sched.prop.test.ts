/**
 * P-sched: for any set of transactions, frames of one transaction are never interleaved with
 * another's, and no gap is shorter than the floor.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../../src/bus/clock.ts';
import { Scheduler, type BusRecord, type FrameSink, type Gate } from '../../src/bus/scheduler.ts';
import { FLOOR_TIMING, FORWARD_FRAME_MS, wireMs, withFloors } from '../../src/bus/timing.ts';
import { framesForAll } from '../../src/dali/sequences.ts';
import type { Approved, SendResult, Transaction } from '../../src/safety/types.ts';
import { commands } from '../harness/gen.ts';

const RUNS = Number(process.env['PROP_RUNS'] ?? 50);

describe('P-sched', () => {
  it('keeps transactions whole and respects the floors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(commands(), fc.integer({ min: 0, max: 200 }), fc.boolean()), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.record({
          settleFirstMs: fc.double({ min: -5, max: 30, noNaN: true }),
          settleLaterMs: fc.double({ min: -5, max: 30, noNaN: true }),
          replyMs: fc.double({ min: -5, max: 30, noNaN: true }),
        }),
        fc.integer({ min: 0, max: 30 }),
        async (txs, rawTiming, jitter) => {
          const clock = new VirtualClock(0);
          const timing = withFloors(rawTiming);
          // A sink that takes the bus's own time, plus some transport jitter.
          const sink: FrameSink = {
            send: (f) =>
              new Promise<SendResult>((r) => {
                clock.at(clock.now() + wireMs(f, timing) + jitter, () => {
                  r({ kind: 'sent' });
                });
              }),
            sendPanic: () => Promise.resolve({ kind: 'sent' }),
          };
          const gate: Gate = {
            judge: (tx) => ({ kind: 'allow', approval: { tx } as unknown as Approved }),
            observe: () => undefined,
            latch: () => undefined,
          };
          const log: (BusRecord & { tx: Transaction })[] = [];
          const ids = new Map<string, Transaction>();
          const scheduler = new Scheduler({
            clock,
            sink,
            gate,
            timing,
            onFrame: (r) => {
              const tx = [...ids.values()].find((t) => t.frames.includes(r.frame));
              if (tx !== undefined) log.push({ ...r, tx });
            },
          });
          const all: Promise<unknown>[] = [];
          let t = 0;
          txs.forEach(([cmds, gap, bg], i) => {
            t += gap;
            const tx: Transaction = {
              frames: framesForAll(cmds),
              source: 'script',
              label: String(i),
            };
            ids.set(String(i), tx);
            clock.at(t, () => {
              all.push(scheduler.submit(tx, bg ? 'background' : 'interactive'));
            });
          });
          await clock.runAll();
          await Promise.all(all);
          // Frames of a transaction are contiguous.
          const order = log.map((l) => l.tx);
          for (const tx of new Set(order)) {
            const first = order.indexOf(tx);
            const last = order.lastIndexOf(tx);
            expect(order.slice(first, last + 1).every((x) => x === tx)).toBe(true);
            expect(last - first + 1).toBe(tx.frames.length);
          }
          // No gap under the floor: a new transaction's first frame waits the priority 2 minimum.
          for (let i = 1; i < log.length; i++) {
            const prev = log[i - 1];
            const cur = log[i];
            if (prev === undefined || cur === undefined) continue;
            const floor =
              cur.tx === prev.tx ? FLOOR_TIMING.settleLaterMs : FLOOR_TIMING.settleFirstMs;
            expect(cur.wireStart - prev.end).toBeGreaterThanOrEqual(floor - 1e-9);
            expect(cur.deliverAt - cur.wireStart).toBeCloseTo(FORWARD_FRAME_MS, 9);
          }
        },
      ),
      { numRuns: RUNS },
    );
  }, 120_000);
});
