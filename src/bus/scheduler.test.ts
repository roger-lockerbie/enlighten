/** U-bus: the scheduler's timing, transactions kept whole, priorities, utilisation, faults and panic. */
import { describe, expect, it } from 'vitest';
import { broadcast, short } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { framesForAll } from '../dali/sequences.ts';
import { makeBench } from '../../tests/harness/bench.ts';
import type { Source, Transaction } from '../safety/types.ts';
import { Scheduler, type BusRecord } from './scheduler.ts';
import { FLOOR_TIMING } from './timing.ts';

const A = short(0);
const tx = (cmds: readonly Command[], source: Source = 'ui', label?: string): Transaction => ({
  frames: framesForAll(cmds),
  source,
  ...(label === undefined ? {} : { label }),
});

function recordingBench(timing?: Parameters<typeof makeBench>[0]) {
  const b = makeBench(timing);
  const log: BusRecord[] = [];
  const scheduler = new Scheduler({
    clock: b.clock,
    sink: b.sink,
    gate: b.governor,
    timing: b.timing,
    onFrame: (r) => log.push(r),
  });
  return { b, log, scheduler, run: (t: Transaction) => b.drive(scheduler.submit(t)) };
}

describe('scheduler timing', () => {
  it('spaces frames with the default settling times', async () => {
    const { log, run } = recordingBench();
    await run(tx([{ id: 'QUERY_ACTUAL_LEVEL', address: A }]));
    await run(tx([{ id: 'OFF', address: A }]));
    const [q, off] = log;
    expect(q?.end).toBeCloseTo((q?.wireStart ?? 0) + 14.2 + 15.5, 6);
    expect((off?.wireStart ?? 0) - (q?.end ?? 0)).toBeCloseTo(17.0, 6);
  });
  it('never goes under the floors, even with timing set to zero', async () => {
    const { log, run } = recordingBench({
      timing: { settleFirstMs: 0, settleLaterMs: 0, replyMs: 0 },
    });
    await run(
      tx([
        { id: 'DTR0', value: 1 },
        { id: 'DTR1', value: 2 },
        { id: 'QUERY_CONTENT_DTR0', address: A },
      ]),
    );
    await run(tx([{ id: 'OFF', address: A }]));
    for (let i = 1; i < log.length; i++) {
      const gap = (log[i]?.wireStart ?? 0) - (log[i - 1]?.end ?? 0);
      expect(gap).toBeGreaterThanOrEqual(FLOOR_TIMING.settleLaterMs - 1e-9);
    }
    const q = log[2];
    expect((q?.end ?? 0) - (q?.wireStart ?? 0)).toBeGreaterThanOrEqual(
      14.2 + FLOOR_TIMING.replyMs - 1e-9,
    );
    const first = log[3];
    expect((first?.wireStart ?? 0) - (log[2]?.end ?? 0)).toBeGreaterThanOrEqual(
      FLOOR_TIMING.settleFirstMs - 1e-9,
    );
  });
  it('sends a send-twice frame as one frame with both copies', async () => {
    const { b, log, run } = recordingBench();
    await b.ready();
    await run(
      tx([
        { id: 'DTR0', value: 200 },
        { id: 'SET_MAX_LEVEL', address: A },
      ]),
    );
    const pair = log.find((r) => r.frame.sendTwice);
    expect((pair?.end ?? 0) - (pair?.wireStart ?? 0)).toBeCloseTo(14.2 + 14.0 + 14.2, 6);
  });
});

describe('scheduler queue', () => {
  it('keeps transactions whole and puts interactive work ahead of background work', async () => {
    const { b, log, scheduler } = recordingBench();
    const order: string[] = [];
    const ps = [
      scheduler
        .submit(tx([{ id: 'QUERY_STATUS', address: A }], 'internal', 'bg1'), 'background')
        .then(() => order.push('bg1')),
      scheduler
        .submit(
          tx(
            [
              { id: 'DTR0', value: 1 },
              { id: 'DTR1', value: 2 },
            ],
            'ui',
            'i1',
          ),
        )
        .then(() => order.push('i1')),
      scheduler
        .submit(
          tx(
            [
              { id: 'DTR2', value: 3 },
              { id: 'DTR0', value: 4 },
            ],
            'ui',
            'i2',
          ),
        )
        .then(() => order.push('i2')),
    ];
    await b.drive(Promise.all(ps));
    // The first submit starts at once; after it the interactive queue goes first.
    expect(order).toEqual(['bg1', 'i1', 'i2']);
    expect(log.map((r) => r.frame.frame.a)).toEqual([0x01, 0xa3, 0xc3, 0xc5, 0xa3]);
    expect(scheduler.queued).toBe(0);
  });
  it('reports a refusal with its reason and sends nothing', async () => {
    const { log, run } = recordingBench();
    const r = await run(tx([{ id: 'IDENTIFY_DEVICE', address: A }]));
    expect(r.kind).toBe('refused');
    expect(log).toHaveLength(0);
  });
  it('reports a clamp with its note', async () => {
    const { b, run } = recordingBench();
    await b.ready();
    const r = await run(tx([{ id: 'DAPC', address: A, value: 254 }]));
    expect(r.kind === 'done' ? r.note : '').toMatch(/clamped/);
  });
  it('stops a transaction at a fault', async () => {
    const { b, log, run } = recordingBench();
    b.sink.fault = (f) => (f.frame.a === 0xc3 ? { reached: false } : undefined);
    const r = await run(
      tx([
        { id: 'DTR0', value: 1 },
        { id: 'DTR1', value: 2 },
        { id: 'DTR2', value: 3 },
      ]),
    );
    expect(r.kind).toBe('fault');
    expect(log).toHaveLength(2);
  });
  it('reports utilisation over the last second', async () => {
    const { b, scheduler } = recordingBench();
    const ps = Array.from({ length: 10 }, () =>
      scheduler.submit(tx([{ id: 'QUERY_STATUS', address: A }])),
    );
    await b.drive(Promise.all(ps));
    expect(scheduler.utilisation()).toBeCloseTo(0.467, 2);
    await b.clock.advance(2000);
    expect(scheduler.utilisation()).toBe(0);
  });
});

describe('panic', () => {
  it('when idle: TERMINATE then broadcast OFF, the OFF within 100 ms', async () => {
    const { b, log, scheduler } = recordingBench();
    await b.ready();
    await b.clock.advance(1000);
    const t0 = b.clock.now();
    await b.drive(scheduler.panic());
    const ids = log.slice(-2).map((r) => [r.frame.frame.a, r.frame.frame.b]);
    expect(ids).toEqual([
      [0xa1, 0x00],
      [0xff, 0x00],
    ]);
    expect((log[log.length - 1]?.deliverAt ?? Infinity) - t0).toBeLessThan(100);
    expect(log.slice(-2).every((r) => r.source === 'panic')).toBe(true);
  });
  it('drops the queue, lets the frame on the wire finish, and latches until a person resumes', async () => {
    const { b, log, scheduler } = recordingBench();
    await b.ready();
    const before = log.length;
    const running = scheduler.submit(
      tx([
        { id: 'DTR0', value: 1 },
        { id: 'DTR1', value: 2 },
        { id: 'DTR2', value: 3 },
      ]),
    );
    const queued = scheduler.submit(tx([{ id: 'OFF', address: A }]));
    await b.clock.advance(20);
    const p = scheduler.panic();
    const [r1, r2] = await b.drive(Promise.all([running, queued, p]));
    expect(r1.kind).toBe('dropped');
    expect(r2.kind).toBe('dropped');
    const sent = log.slice(before).map((r) => r.frame.frame.a);
    expect(sent).toEqual([0xa3, 0xa1, 0xff]);
    expect(b.governor.isLatched).toBe(true);
    const after = await b.drive(scheduler.submit(tx([{ id: 'QUERY_STATUS', address: A }])));
    expect(after.kind).toBe('refused');
    b.governor.resume('ui');
    const ok = await b.drive(scheduler.submit(tx([{ id: 'QUERY_STATUS', address: A }])));
    expect(ok.kind).toBe('done');
  });
  it('a second panic while one runs returns the same work', async () => {
    const { b, scheduler } = recordingBench();
    const p1 = scheduler.panic();
    const p2 = scheduler.panic();
    expect(p1).toBe(p2);
    await b.drive(p1);
    expect(b.sim.unit('A')?.gear.levelAt(b.clock.now())).toBe(0);
  });
  it('is not delayed by the rate guard', async () => {
    const { b, scheduler, log } = recordingBench();
    await b.ready();
    await b.drive(scheduler.submit(tx([{ id: 'DAPC', address: broadcast, value: 150 }])));
    const t0 = b.clock.now();
    await b.drive(scheduler.panic());
    expect((log[log.length - 1]?.deliverAt ?? Infinity) - t0).toBeLessThan(100);
  });
});
