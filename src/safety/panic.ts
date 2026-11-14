/**
 * Panic (SPEC S4, ADR 0005). The scheduler sends the frames and the governor holds the latch. This
 * module is the one place both are named, for the engine to call.
 */
import type { Governor, Outcome } from './governor.ts';
import type { Source } from './types.ts';

export interface PanicTarget {
  panic(): Promise<void>;
}

/** Stop everything: the scheduler drops its queue and sends TERMINATE and broadcast OFF; the governor latches. */
export async function panic(scheduler: PanicTarget, governor: Governor): Promise<void> {
  governor.latch();
  await scheduler.panic();
}

/** Lift the latch. Only a person can. Lights stay as they are until something is sent. */
export function resume(governor: Governor, source: Source): Outcome {
  return governor.resume(source);
}
