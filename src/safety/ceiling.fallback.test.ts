/**
 * The ceiling's retries and its last fallback (S4-D6, S5-L4). `sendFresh` works the commands out
 * again before each attempt and gives up at its deadline. When the governor will not take a driver's
 * MAX LEVEL write with its hold, the hold still goes alone.
 */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { decode, type Command, type Frame } from '../dali/codec.ts';
import { framesForAll } from '../dali/sequences.ts';
import { Simulator } from '../sim/simulator.ts';
import { asSubmit, makeBench } from '../../tests/harness/bench.ts';
import { lowerCeiling, MAX_TRIES, PATIENCE_MS, sendFresh } from './ceiling.ts';
import type { Submit, Submitted } from './profile.ts';

const DAPC: Command = { id: 'DAPC', address: short(0), value: 100 };

/** A submit that answers from a list, then `done`, and records each call's time. */
function scripted(answers: Submitted[], clock: { t: number }) {
  const calls: number[] = [];
  const submit: Submit = (tx) => {
    expect(tx.label).toBe('test');
    expect(tx.source).toBe('profile');
    calls.push(clock.t);
    return Promise.resolve(answers.shift() ?? { kind: 'done', results: [] });
  };
  return { submit, calls };
}

describe('sendFresh', () => {
  const run = (
    answers: Submitted[],
    build: () => Command[] = () => [DAPC],
    deadline = 1000 + PATIENCE_MS,
  ) => {
    const clock = { t: 1000 };
    const { submit, calls } = scripted(answers, clock);
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      clock.t += ms;
      return Promise.resolve();
    };
    return sendFresh(submit, build, 'test', () => clock.t, wait, deadline).then((r) => ({
      r,
      calls,
      waits,
    }));
  };

  it('sends once and reports done', async () => {
    const { r, calls, waits } = await run([]);
    expect(r).toBe('done');
    expect(calls).toEqual([1000]);
    expect(waits).toEqual([]);
  });

  it('sends nothing when nothing is needed', async () => {
    const { r, calls } = await run([], () => []);
    expect(r).toBe('nothing');
    expect(calls).toEqual([]);
  });

  it('waits for the time the rate guard gives, then sends again', async () => {
    const { r, calls, waits } = await run([{ kind: 'refused', reason: 'held', retryAt: 1400 }]);
    expect(r).toBe('done');
    expect(waits).toEqual([400]);
    expect(calls).toEqual([1000, 1400]);
  });

  it('waits at least a millisecond when the time has passed', async () => {
    const { waits } = await run([{ kind: 'refused', reason: 'held', retryAt: 900 }]);
    expect(waits).toEqual([1]);
  });

  it('keeps trying while the retry time is not after its deadline', async () => {
    const held = (t: number): Submitted => ({ kind: 'refused', reason: 'held', retryAt: t });
    const { r, calls } = await run([held(1250), held(1500), held(1000 + PATIENCE_MS)]);
    expect(r).toBe('done');
    expect(calls).toEqual([1000, 1250, 1500, 1000 + PATIENCE_MS]);
  });

  it('gives up when the retry time is after its deadline', async () => {
    const { r, calls, waits } = await run([
      { kind: 'refused', reason: 'held', retryAt: 1000 + PATIENCE_MS + 1 },
    ]);
    expect(r).toBe('refused');
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('with no deadline, waits however long the rate guard asks', async () => {
    const { r, calls } = await run(
      [{ kind: 'refused', reason: 'held', retryAt: 60_000 }],
      () => [DAPC],
      Infinity,
    );
    expect(r).toBe('done');
    expect(calls).toEqual([1000, 60_000]);
  });

  it('always makes the first attempt, even past its deadline', async () => {
    const { r, calls } = await run([], () => [DAPC], 0);
    expect(r).toBe('done');
    expect(calls).toEqual([1000]);
  });

  it(`gives up after ${String(MAX_TRIES)} attempts`, async () => {
    const held: Submitted = { kind: 'refused', reason: 'held', retryAt: 0 };
    const { r, calls } = await run(Array.from({ length: MAX_TRIES + 2 }, () => held));
    expect(r).toBe('refused');
    expect(calls).toHaveLength(MAX_TRIES);
  });

  it('does not send again after a refusal with no time to retry', async () => {
    const { r, calls, waits } = await run([{ kind: 'refused', reason: 'never' }]);
    expect(r).toBe('refused');
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('does not send again after a drop or a fault', async () => {
    for (const kind of ['dropped', 'fault'] as const) {
      const { r, calls } = await run([{ kind, reason: 'gone' }]);
      expect(r).toBe('refused');
      expect(calls).toHaveLength(1);
    }
  });

  it('works the commands out again before each attempt', async () => {
    let n = 0;
    const build = () => (++n < 2 ? [DAPC] : []);
    const { r, calls } = await run([{ kind: 'refused', reason: 'held', retryAt: 1100 }], build);
    expect(r).toBe('nothing');
    expect(calls).toHaveLength(1);
  });
});

describe('lowering the ceiling when the governor will not take a MAX LEVEL write', () => {
  it('still sends the hold alone, and the light lands under the ceiling', async () => {
    const b = makeBench({ target: 'simulator', sim: Simulator.bench({ at: 1000 }) });
    await b.ready();
    await b.clock.advance(3000);
    const lit = await b.run({
      frames: framesForAll([{ id: 'DAPC', address: short(0), value: 200 }]),
      source: 'ui',
    });
    expect(lit.kind).toBe('done');
    await b.clock.advance(3000);

    const inner = asSubmit(b);
    const sent: string[] = [];
    let heldAt: number | undefined;
    const submit: Submit = async (tx, p) => {
      let prev: Frame | undefined;
      const ids = tx.frames.map((f) => {
        const c = decode(f.frame, prev);
        prev = f.frame;
        return c?.id ?? '?';
      });
      // Stand in for a governor that refuses the MAX LEVEL write while the light is above the ceiling.
      if (tx.label === 'hold under the new ceiling' && ids.includes('SET_MAX_LEVEL'))
        return { kind: 'refused', reason: 'not this one' };
      const r = await inner(tx, p);
      sent.push(`${tx.label ?? ''}: ${ids.join(',')}: ${r.kind}`);
      if (heldAt === undefined && ids.join() === 'DAPC') heldAt = b.clock.now();
      return r;
    };
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        b.clock.at(b.clock.now() + ms, r);
      });
    const start = b.clock.now();
    const r = await b.drive(lowerCeiling(b.governor, 150, submit, 'ui', () => b.clock.now(), wait));
    expect(r.ok).toBe(true);
    expect(sent[0]).toBe('hold under the new ceiling: DAPC: done');
    expect(sent.some((l) => l.startsWith('off:'))).toBe(false);
    // Under the ceiling from the hold itself, before the later MAX LEVEL write.
    expect(b.sim.unit('A')?.gear.levelAt((heldAt ?? Infinity) + 50)).toBeLessThanOrEqual(150);
    expect((heldAt ?? Infinity) - start).toBeLessThan(250);
  });
});

describe('lowering the ceiling during an open-ended hold', () => {
  it('waits for the hold through its quarter-second retries and sends both drivers as one', async () => {
    const b = makeBench({ target: 'simulator', sim: Simulator.bench({ at: 1000 }) });
    await b.ready();
    await b.clock.advance(3000);
    for (const n of [0, 1]) {
      const lit = await b.run({
        frames: framesForAll([{ id: 'DAPC', address: short(n), value: 200 }]),
        source: 'ui',
      });
      expect(lit.kind).toBe('done');
      await b.clock.advance(3000);
    }
    // As while the simulated bench is rebuilt: an open hold, which ends 3 s later.
    const start = b.clock.now();
    b.governor.holdLightChanges(start + 60_000, 'rebuilding', 250);
    b.clock.at(start + 3000, () => {
      b.governor.holdLightChanges(start + 3000, 'rebuilding');
    });
    const inner = asSubmit(b);
    const sent: string[] = [];
    const submit: Submit = async (tx, p) => {
      const r = await inner(tx, p);
      sent.push(`${tx.label ?? ''}: ${String(tx.frames.length)}: ${r.kind}`);
      return r;
    };
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        b.clock.at(b.clock.now() + ms, r);
      });
    const r = await b.drive(lowerCeiling(b.governor, 150, submit, 'ui', () => b.clock.now(), wait));
    expect(r.ok).toBe(true);
    const first = sent.findIndex((l) => l.endsWith('done'));
    expect(sent[first]).toBe('hold under the new ceiling: 6: done');
    expect(sent.slice(0, first).every((l) => l === 'hold under the new ceiling: 6: refused')).toBe(
      true,
    );
    expect(sent.some((l) => l.startsWith('off:'))).toBe(false);
    for (const id of ['A', 'B']) expect(b.sim.unit(id)?.gear.levelAt(b.clock.now())).toBe(150);
  });
});
