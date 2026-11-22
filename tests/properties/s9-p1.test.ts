/**
 * S9-P1, open, for the owner (docs/SECURITY_FINDINGS.md). Five transactions the governor allows
 * whose trace the checker faults: three legs in the room within 0.7 s, at about 1% output, against a
 * limit of two in 1.04 s at a swing limit of 1.
 *
 * Found in Stage 9 by P-plan through a planner bug that is fixed, but the transactions need no
 * planner: they are sent here as a person's own commands. This test is marked as failing on
 * purpose. It passes while the gap is there, and turns red when the rate guard is changed to close
 * it, at which point it becomes an ordinary fixed example.
 */
import { expect, it } from 'vitest';
import { flushMicrotasks } from '../../src/bus/clock.ts';
import type { Command } from '../../src/dali/codec.ts';
import { rateProblems, TraceRecorder } from '../harness/checker.ts';
import { simEngine } from '../harness/engine.ts';
import found from './s9-p1.counterexample.json' with { type: 'json' };

it.fails(
  'S9-P1: the trace of five allowed transactions keeps the swing rule in the room',
  async () => {
    const b = simEngine();
    const live: { rec?: TraceRecorder } = {};
    const drive = async <T>(p: Promise<T>): Promise<T> => {
      const st: { done: boolean; value?: T } = { done: false };
      const done = () => st.done;
      void p.then((v) => {
        st.done = true;
        st.value = v;
      });
      for (let i = 0; i < 1_000_000 && !done(); i++) {
        await flushMicrotasks();
        if (done()) break;
        const n = b.clock.next();
        if (n === undefined) break;
        await b.clock.advanceTo(n);
        live.rec?.record(b.clock.now());
      }
      return st.value as T;
    };
    const pass = async (ms: number) => {
      const end = b.clock.now() + ms;
      while (b.clock.now() < end) {
        await b.clock.advance(Math.min(100, end - b.clock.now()));
        live.rec?.record(b.clock.now());
      }
    };
    await drive(
      (async () => {
        while (b.engine.snapshot().jobs.length > 0) await Promise.resolve();
      })(),
    );
    await pass(3000);
    await drive(
      b.engine.request(
        { kind: 'apply', address: 1, arc: 86, fade: { kind: 'standard', value: 2 } },
        'ui',
      ),
    );
    await pass(3000);
    const rec = new TraceRecorder(b.sim, b.clock.now());
    live.rec = rec;
    const start = b.clock.now();
    for (const t of found.transactions) {
      await pass(Math.max(0, start + t.atMs - b.clock.now()));
      const r = await drive(
        b.engine.request({ kind: 'commands', commands: t.commands as Command[] }, 'ui'),
      );
      // The governor lets each one through: that is the finding.
      expect(r.ok).toBe(true);
    }
    await pass(15_000);
    b.engine.dispose();
    expect(rateProblems(rec, 1)).toEqual([]);
  },
);
