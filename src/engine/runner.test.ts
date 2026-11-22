/**
 * U-engine for Stage 9: the run loop on a hand-driven clock. Rows go when due, a late wake-up delays
 * and never bunches, a refusal stops the run, and a repeating plan starts again each period.
 */
import { describe, expect, it } from 'vitest';
import type { Plan, PlanRow } from '../design/plan.ts';
import type { Submitted } from '../safety/profile.ts';
import { ROW_PATIENCE_MS, runPlan, type RunEnv } from './runner.ts';

const row = (atMs: number, arc = 100): PlanRow => ({
  atMs,
  address: 0,
  step: 0,
  arc,
  colour: { kind: 'none' },
  fade: { kind: 'extended', value: 0 },
  fadeMs: 0,
  setFade: false,
  fromArc: 0,
});
const plan = (rows: PlanRow[], endMs: number, periodMs?: number): Plan => ({
  rows,
  endMs,
  notes: [],
  ...(periodMs === undefined ? {} : { periodMs }),
});
const DONE: Submitted = { kind: 'done', results: [] };

/** A clock that only moves when the loop waits. `late` is added to every wake-up. */
function env(o: {
  late?: (time: number) => number;
  send?: (row: PlanRow, now: number) => Submitted;
  stopAt?: number;
  txMs?: number;
  patienceMs?: number;
}) {
  let now = 0;
  const sent: { at: number; arc: number }[] = [];
  const progress: [number, number, number][] = [];
  const e: RunEnv = {
    now: () => now,
    until: (time) => {
      const wake = Math.max(now, time + (o.late?.(time) ?? 0));
      now = o.stopAt !== undefined && wake >= o.stopAt ? Math.max(now, o.stopAt) : wake;
      return Promise.resolve();
    },
    stopped: () => o.stopAt !== undefined && now >= o.stopAt,
    patienceMs: o.patienceMs ?? ROW_PATIENCE_MS,
    submitRow: (r) => {
      const res = o.send?.(r, now) ?? DONE;
      if (res.kind === 'done') {
        sent.push({ at: now, arc: r.arc });
        now += o.txMs ?? 0;
      }
      return Promise.resolve(res);
    },
    progress: (i, cycle, lateMs) => progress.push([i, cycle, lateMs]),
  };
  return { e, sent, progress, now: () => now };
}

describe('the run loop', () => {
  it('sends each row at its time and ends when the last fade does', async () => {
    const t = env({});
    const r = await runPlan(t.e, plan([row(0, 1), row(1000, 2), row(5000, 3)], 9000), 100);
    expect(t.sent).toEqual([
      { at: 100, arc: 1 },
      { at: 1100, arc: 2 },
      { at: 5100, arc: 3 },
    ]);
    expect(r).toEqual({ kind: 'done', lateMs: 0, endedAt: 9100 });
    expect(t.progress).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('sends a late row as soon as it wakes, and keeps later rows at their own times', async () => {
    // The wake-up for the row at 1000 comes 700 ms late, as in a hidden tab.
    const t = env({ late: (time) => (time === 1000 ? 700 : 0) });
    const r = await runPlan(t.e, plan([row(0, 1), row(1000, 2), row(2000, 3)], 3000), 0);
    expect(t.sent.map((s) => s.at)).toEqual([0, 1700, 2000]);
    expect(r).toEqual({ kind: 'done', lateMs: 700, endedAt: 3000 });
  });

  it('does not bunch rows after a long sleep: each still goes through one send at a time', async () => {
    // Asleep until 10 s. Three rows are overdue, and each takes 300 ms on the bus.
    const t = env({ late: (time) => (time < 10_000 ? 10_000 - time : 0), txMs: 300 });
    const r = await runPlan(t.e, plan([row(0, 1), row(1000, 2), row(2000, 3)], 2500), 0);
    expect(t.sent.map((s) => s.at)).toEqual([10_000, 10_300, 10_600]);
    expect(r.kind === 'done' && r.lateMs).toBe(10_000);
  });

  it('waits out a short refusal and stops at a long one or one with no retry time', async () => {
    let first = true;
    const short = env({
      send: (_r, now) => {
        if (!first) return DONE;
        first = false;
        return { kind: 'refused', reason: 'Rate guard: wait.', retryAt: now + ROW_PATIENCE_MS };
      },
    });
    expect((await runPlan(short.e, plan([row(0)], 0), 0)).kind).toBe('done');
    expect(short.sent).toEqual([{ at: ROW_PATIENCE_MS, arc: 100 }]);

    const long = env({
      send: (_r, now) => ({
        kind: 'refused',
        reason: 'Rate guard: too soon.',
        retryAt: now + ROW_PATIENCE_MS + 1,
      }),
    });
    expect(await runPlan(long.e, plan([row(0), row(10)], 20), 0)).toEqual({
      kind: 'refused',
      row: 0,
      cycle: 0,
      reason: 'Rate guard: too soon.',
    });
    expect(long.sent).toEqual([]);

    const fixed = env({ send: () => ({ kind: 'refused', reason: 'Above the ceiling.' }) });
    expect((await runPlan(fixed.e, plan([row(0)], 0), 0)).kind).toBe('refused');

    // Refusals that each ask for a short wait do not add up past the limit.
    const drip = env({
      send: (_r, now) => ({ kind: 'refused', reason: 'Held.', retryAt: now + 200 }),
    });
    expect((await runPlan(drip.e, plan([row(0)], 0), 0)).kind).toBe('refused');
    expect(drip.now()).toBeLessThanOrEqual(ROW_PATIENCE_MS);

    // A retry time already in the past cannot keep the loop going for ever.
    const stale = env({ send: () => ({ kind: 'refused', reason: 'Held.', retryAt: -5 }) });
    expect((await runPlan(stale.e, plan([row(0)], 0), 0)).kind).toBe('refused');
    expect(stale.now()).toBeLessThanOrEqual(ROW_PATIENCE_MS);

    // The check waits for nothing.
    const none = env({
      patienceMs: 0,
      send: (_r, now) => ({ kind: 'refused', reason: 'Held.', retryAt: now + 1 }),
    });
    expect((await runPlan(none.e, plan([row(0)], 0), 0)).kind).toBe('refused');
  });

  it('stops when told, between rows, during a wait and when a send is dropped', async () => {
    const t = env({ stopAt: 1500 });
    const r = await runPlan(t.e, plan([row(0, 1), row(1000, 2), row(2000, 3)], 3000), 0);
    expect(r).toEqual({ kind: 'stopped', lateMs: 0 });
    expect(t.sent.map((s) => s.arc)).toEqual([1, 2]);

    const end = env({ stopAt: 2500 });
    expect((await runPlan(end.e, plan([row(0)], 3000), 0)).kind).toBe('stopped');

    const dropped = env({ send: () => ({ kind: 'dropped', reason: 'Stopped.' }) });
    expect((await runPlan(dropped.e, plan([row(0)], 0), 0)).kind).toBe('stopped');

    let n = 0;
    const during = env({
      stopAt: 300,
      send: (_r, now) =>
        n++ === 0 ? { kind: 'refused', reason: 'wait', retryAt: now + 400 } : DONE,
    });
    expect((await runPlan(during.e, plan([row(0)], 0), 0)).kind).toBe('stopped');
  });

  it('starts a repeating plan again each period, until the time given', async () => {
    const t = env({});
    const r = await runPlan(t.e, plan([row(0, 1), row(400, 2)], 800, 1000), 0, 2500);
    expect(t.sent).toEqual([
      { at: 0, arc: 1 },
      { at: 400, arc: 2 },
      { at: 1000, arc: 1 },
      { at: 1400, arc: 2 },
      { at: 2000, arc: 1 },
      { at: 2400, arc: 2 },
    ]);
    expect(r.kind).toBe('done');
    expect(t.progress.at(-1)).toEqual([1, 2, 0]);
  });

  it('skips the passes a repeating plan missed while it slept, and starts the next one', async () => {
    // Asleep from just after the first pass until 10.2 s: nine passes are missed.
    const t = env({
      late: (time) => (time > 500 && time < 10_200 ? 10_200 - time : 0),
      stopAt: 12_500,
    });
    const r = await runPlan(t.e, plan([row(0, 1), row(400, 2)], 800, 1000), 0);
    expect(r.kind).toBe('stopped');
    expect(t.sent.map((s) => s.at)).toEqual([
      0, 400, 10_200, 10_400, 11_000, 11_400, 12_000, 12_400,
    ]);
    // The pass it woke in is the tenth, counted from nought.
    expect(t.progress.find((p) => p[2] > 0)?.[1]).toBe(10);
  });

  it('runs a repeating plan until it is stopped when no end is given', async () => {
    const t = env({ stopAt: 3200 });
    const r = await runPlan(t.e, plan([row(0, 1)], 500, 1000), 0);
    expect(r.kind).toBe('stopped');
    expect(t.sent.map((s) => s.at)).toEqual([0, 1000, 2000, 3000]);
  });
});
