/**
 * The live-control coalescer (docs/ARCHITECTURE.md, SPEC R13.3). A moving slider sends many values.
 * For each key (an address and a control) only the newest is kept, and it is submitted as soon as the
 * one before it has been sent, or when a refusal's `retryAt` arrives. A value that was refused with no
 * time to retry is dropped.
 */
import type { Cancel, Clock } from '../bus/clock.ts';

export type CoalescedResult =
  { readonly ok: true } | { readonly ok: false; readonly retryAt?: number };

interface Slot<T> {
  newest: T | undefined;
  busy: boolean;
  wake: Cancel | undefined;
}

/** Read through a function: a value may have arrived while the submit was awaited. */
const newer = <T>(slot: Slot<T>): T | undefined => slot.newest;

export class Coalescer<T> {
  private readonly clock: Clock;
  private readonly submit: (key: string, value: T) => Promise<CoalescedResult>;
  private readonly slots = new Map<string, Slot<T>>();
  private generation = 0;

  constructor(clock: Clock, submit: (key: string, value: T) => Promise<CoalescedResult>) {
    this.clock = clock;
    this.submit = submit;
  }

  /** Keep `value` as the newest for `key`, and send it when the key is free. */
  set(key: string, value: T): void {
    const slot = this.slots.get(key) ?? { newest: undefined, busy: false, wake: undefined };
    this.slots.set(key, slot);
    slot.newest = value;
    if (!slot.busy && slot.wake === undefined) void this.flush(key, slot);
  }

  /** Values waiting to be sent. */
  waiting(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.newest !== undefined) n++;
    return n;
  }

  /** Drop everything waiting: runners stop, a target changes, or panic. */
  cancel(): void {
    this.generation++;
    for (const s of this.slots.values()) s.wake?.();
    this.slots.clear();
  }

  private async flush(key: string, slot: Slot<T>): Promise<void> {
    const value = slot.newest;
    if (value === undefined) return;
    slot.newest = undefined;
    slot.busy = true;
    const gen = this.generation;
    const r = await this.submit(key, value);
    slot.busy = false;
    if (gen !== this.generation) return;
    if (!r.ok && r.retryAt !== undefined) {
      // Retry this value at the given time, unless a newer one has come in meanwhile.
      slot.newest = newer(slot) ?? value;
      slot.wake = this.clock.at(r.retryAt, () => {
        slot.wake = undefined;
        void this.flush(key, slot);
      });
      return;
    }
    if (newer(slot) !== undefined) void this.flush(key, slot);
    else this.slots.delete(key);
  }
}
