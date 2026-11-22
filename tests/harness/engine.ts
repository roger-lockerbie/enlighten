/**
 * An engine on a virtual clock with the simulated bench only, for tests that need no hardware.
 */
import { VirtualClock, flushMicrotasks } from '../../src/bus/clock.ts';
import { withFloors } from '../../src/bus/timing.ts';
import { Engine, type EngineOptions } from '../../src/engine/engine.ts';
import { type ExtraUnit } from '../../src/sim/settings.ts';
import { extraUnit, Simulator } from '../../src/sim/simulator.ts';
import { SimTransport } from '../../src/transport/sim.ts';

export interface SimEngine {
  readonly clock: VirtualClock;
  readonly sim: Simulator;
  readonly engine: Engine;
  /** Run the clock until a promise settles. */
  readonly drive: <T>(p: Promise<T>, limit?: number) => Promise<T>;
  /** Run the clock until the engine has no jobs left. */
  readonly settle: (limit?: number) => Promise<void>;
}

export function simEngine(
  o: { extras?: readonly ExtraUnit[]; options?: Partial<EngineOptions>; start?: number } = {},
): SimEngine {
  const clock = new VirtualClock(o.start ?? 1000);
  const sim = Simulator.bench({ at: clock.now() });
  const extras = o.extras ?? [];
  for (const x of extras) sim.add(extraUnit(x, clock.now()));
  const simTransport = new SimTransport(sim, clock, withFloors({}), { keepLog: true });
  const timing = withFloors({});
  const engine = new Engine({
    clock,
    sim,
    simTransport,
    extras,
    dryTransport: (copy, virtual) => new SimTransport(copy, virtual, timing),
    ...o.options,
  });
  const drive = async <T>(p: Promise<T>, limit = 3_600_000): Promise<T> => {
    const st: { done: boolean; failed: boolean; value?: T; error?: unknown } = {
      done: false,
      failed: false,
    };
    p.then(
      (v) => {
        st.done = true;
        st.value = v;
      },
      (e: unknown) => {
        st.done = true;
        st.failed = true;
        st.error = e;
      },
    );
    const end = clock.now() + limit;
    const isDone = () => st.done;
    while (!isDone()) {
      await flushMicrotasks();
      if (isDone()) break;
      const n = clock.next();
      if (n === undefined || n > end) throw new Error('The engine did not finish.');
      await clock.advanceTo(n);
    }
    if (st.failed) throw st.error;
    return st.value as T;
  };
  const settle = async (limit = 3_600_000) => {
    const end = clock.now() + limit;
    while (engine.snapshot().jobs.length > 0) {
      const n = clock.next();
      if (n === undefined || n > end) throw new Error('Jobs did not finish.');
      await clock.advanceTo(n);
    }
    await clock.advance(10);
  };
  return { clock, sim, engine, drive, settle };
}
