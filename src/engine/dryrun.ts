/**
 * The check when a plan is made (ADR 0005, ADR 0020): the plan is run on a copy of the simulated
 * bench, with a governor of its own at the live ceiling and swing limit, on a virtual clock. It
 * uses the same governor code and the same run loop as the real run, so a plan it accepts should not
 * be refused part way, and a plan it refuses comes back with the governor's own reason.
 *
 * The copy starts with no history: what the bench did in the seconds before is not carried over. The
 * guard still judges every row when the real run sends it.
 */
import { VirtualClock, flushMicrotasks, type Clock } from '../bus/clock.ts';
import { Scheduler } from '../bus/scheduler.ts';
import type { BusTiming } from '../bus/timing.ts';
import { rowCommands, type Plan } from '../design/plan.ts';
import { Governor } from '../safety/governor.ts';
import { applySafetyProfile, patient, scan, type Submit } from '../safety/profile.ts';
import { HARD_WINDOW_MS } from '../safety/rate/guard.ts';
import type { Source } from '../safety/types.ts';
import type { Simulator } from '../sim/simulator.ts';
import { Router } from './router.ts';
import { runPlan, type RunResult } from './runner.ts';
import { toSubmitted, txOf } from './submit.ts';
import type { Transport } from './transport.ts';

export interface DryRunOptions {
  /** The bench to copy. It is not touched. */
  readonly sim: Simulator;
  /** The transport for a simulator on a clock, from the worker (the engine imports none). */
  readonly transport: (sim: Simulator, clock: Clock) => Transport;
  readonly timing: BusTiming;
  readonly ceilingArc: number;
  readonly swingLimit: number;
  readonly now: number;
  readonly source: Source;
  /** Whether each address brings a loaded colour in with a level. */
  readonly auto: (address: number) => boolean;
  /** For a repeating plan: how long to run it. */
  readonly forMs?: number;
  /**
   * Called now and then so the caller can let other work in. Returns false to give up, which a
   * panic does.
   */
  readonly breathe?: () => Promise<boolean>;
}

export type DryRunResult = RunResult | { readonly kind: 'failed'; readonly reason: string };

/** How many clock steps between calls to `breathe`. */
const BREATHE_EVERY = 400;

export async function dryRun(o: DryRunOptions, plan: Plan): Promise<DryRunResult> {
  const clock = new VirtualClock(o.now);
  const sim = o.sim.fork();
  const governor = new Governor({
    target: 'simulator',
    shadow: sim,
    timing: o.timing,
    ceilingArc: o.ceilingArc,
    connectedAt: clock.now(),
  });
  if (o.swingLimit > 1) {
    governor.unlock('rate', 'ui', true);
    governor.setSwingLimit(o.swingLimit, 'ui');
  }
  const router = new Router({
    transport: o.transport(sim, clock),
    clock,
    issuer: governor,
    onRefused: () => undefined,
  });
  const scheduler = new Scheduler({ clock, sink: router, gate: governor, timing: o.timing });
  const raw: Submit = async (tx, priority) => toSubmitted(await scheduler.submit(tx, priority));
  const until = (time: number) =>
    new Promise<void>((resolve) => {
      clock.at(Math.max(time, clock.now()), resolve);
    });
  let gaveUp = false;

  const work = (async (): Promise<DryRunResult> => {
    // The copy's governor learns the bench the way the real one did: a scan, and the profile.
    const calm = patient(
      raw,
      (ms) => until(clock.now() + ms),
      () => clock.now(),
    );
    const addresses = sim.all
      .map((u) => u.gear.shortAddress)
      .filter((n): n is number => n !== null);
    const found = await scan(governor, calm, addresses);
    for (const n of found) await applySafetyProfile(n, governor, calm);
    // Past the hold that follows a connect, as the real bench is by the time anyone runs a plan.
    await until(clock.now() + HARD_WINDOW_MS + 100);
    const start = clock.now();
    return runPlan(
      {
        now: () => clock.now(),
        until,
        stopped: () => gaveUp,
        patienceMs: 0,
        submitRow: (row) => raw(txOf(rowCommands(row, o.auto(row.address)), o.source, 'dry run')),
      },
      plan,
      start,
      plan.periodMs === undefined ? Infinity : start + (o.forMs ?? plan.periodMs),
    );
  })();

  const st: { done: boolean; result?: DryRunResult; error?: unknown } = { done: false };
  work.then(
    (r) => {
      st.done = true;
      st.result = r;
    },
    (e: unknown) => {
      st.done = true;
      st.error = e;
    },
  );
  const settled = () => st.done;
  for (let steps = 1; !settled(); steps++) {
    await flushMicrotasks();
    if (settled()) break;
    const next = clock.next();
    if (next === undefined) return { kind: 'failed', reason: 'The check could not finish.' };
    await clock.advanceTo(next);
    if (steps % BREATHE_EVERY === 0 && o.breathe !== undefined && !(await o.breathe())) {
      gaveUp = true;
      return { kind: 'stopped', lateMs: 0 };
    }
  }
  return (
    st.result ?? {
      kind: 'failed',
      reason: st.error instanceof Error ? st.error.message : 'The check could not finish.',
    }
  );
}
