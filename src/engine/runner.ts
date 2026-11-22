/**
 * The run loop for a plan (SPEC R5.4, S5, ADR 0010, ADR 0020). Each row is sent when its time comes
 * by the clock, or as soon after as the clock wakes: times are absolute from the start. After a late
 * wake-up the rows that are overdue go one after another, each through the scheduler and each
 * judged by the guard as it is sent, and a refusal stops the run (ADR 0005). A repeating plan that
 * wakes more than a period late does not replay the passes it missed: it starts its next pass.
 *
 * The same loop runs a plan on the real bench and, on a virtual clock, in the dry run.
 */
import type { Plan, PlanRow } from '../design/plan.ts';
import type { Submitted } from '../safety/profile.ts';

/**
 * A real run waits this long in all for one row the guard holds back, to take up small differences
 * in timing between the check and the bench. The check itself waits for nothing, so a plan it
 * accepts has that much to spare. Anything longer stops the run (ADR 0005).
 */
export const ROW_PATIENCE_MS = 500;

export interface RunEnv {
  now(): number;
  /** Wait until a time. Resolves early when the run is stopped. */
  until(time: number): Promise<void>;
  stopped(): boolean;
  /** Send one row and say how it went. */
  submitRow(row: PlanRow): Promise<Submitted>;
  /** How long one row may wait in all for the guard. */
  readonly patienceMs: number;
  /** Called as each row goes, with how late it was. */
  progress?(row: number, cycle: number, lateMs: number): void;
}

export type RunResult =
  | { readonly kind: 'done'; readonly lateMs: number; readonly endedAt: number }
  | { readonly kind: 'stopped'; readonly lateMs: number }
  | {
      readonly kind: 'refused';
      readonly row: number;
      readonly cycle: number;
      readonly reason: string;
    };

/**
 * Run a plan from `start`. A plan with a period starts again each period until `until` (for a dry
 * run) or until it is stopped. A plan without one ends when its last fade does.
 */
export async function runPlan(
  env: RunEnv,
  plan: Plan,
  start: number,
  until = Infinity,
): Promise<RunResult> {
  let late = 0;
  for (let cycle = 0; ; cycle++) {
    // A repeating plan that is a whole pass or more behind skips the passes it missed.
    if (plan.periodMs !== undefined && plan.periodMs > 0)
      cycle = Math.max(cycle, Math.floor((env.now() - start) / plan.periodMs));
    const base = start + cycle * (plan.periodMs ?? 0);
    for (const [i, row] of plan.rows.entries()) {
      const due = base + row.atMs;
      if (due >= until) return { kind: 'done', lateMs: late, endedAt: env.now() };
      await env.until(due);
      if (env.stopped()) return { kind: 'stopped', lateMs: late };
      let began = env.now();
      const giveUpAt = Math.max(due, began) + env.patienceMs;
      for (;;) {
        began = env.now();
        const r = await env.submitRow(row);
        if (r.kind === 'done') break;
        if (env.stopped() || r.kind === 'dropped') return { kind: 'stopped', lateMs: late };
        const retryAt = r.kind === 'refused' ? r.retryAt : undefined;
        // A retry time that has passed still costs a moment, so the waits always add up.
        const wake = retryAt === undefined ? Infinity : Math.max(retryAt, env.now() + 10);
        if (wake > giveUpAt) return { kind: 'refused', row: i, cycle, reason: r.reason };
        await env.until(wake);
        if (env.stopped()) return { kind: 'stopped', lateMs: late };
      }
      // How long after its time the row started on its way.
      const lateMs = Math.max(0, began - due);
      late = Math.max(late, lateMs);
      env.progress?.(i, cycle, lateMs);
    }
    const end = plan.periodMs === undefined ? base + plan.endMs : base + plan.periodMs;
    await env.until(Math.min(end, until));
    if (env.stopped()) return { kind: 'stopped', lateMs: late };
    if (plan.periodMs === undefined || end >= until)
      return { kind: 'done', lateMs: late, endedAt: env.now() };
  }
}
