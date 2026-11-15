/** The real clock on a fake host: timers are wake-ups, and the time is always read, never counted. */
import { describe, expect, it } from 'vitest';
import { TimerClock, VirtualClock, type TimerHost } from './clock.ts';

class FakeHost implements TimerHost {
  t = 0;
  timers: { id: number; ms: number; run: () => void }[] = [];
  private id = 0;
  now(): number {
    return this.t;
  }
  setTimer(run: () => void, ms: number): unknown {
    const id = ++this.id;
    this.timers.push({ id, ms, run });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }
  /** Fire the one armed timer at time `t`, however late or early that is. */
  fire(t: number): void {
    this.t = t;
    const timer = this.timers.shift();
    timer?.run();
  }
}

describe('TimerClock', () => {
  it('arms one timer for the earliest task and runs due tasks in order', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const ran: string[] = [];
    clock.at(30, () => ran.push('c'));
    clock.at(10, () => ran.push('a'));
    clock.at(10, () => ran.push('b'));
    expect(host.timers).toHaveLength(1);
    expect(host.timers[0]?.ms).toBe(10);
    host.fire(10);
    expect(ran).toEqual(['a', 'b']);
    expect(host.timers).toHaveLength(1);
    expect(host.timers[0]?.ms).toBe(20);
    host.fire(30);
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(host.timers).toHaveLength(0);
    expect(clock.pending()).toBe(0);
  });

  it('runs everything due after a late wake-up, and nothing early', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const ran: number[] = [];
    for (const t of [10, 20, 30, 500]) clock.at(t, () => ran.push(clock.now()));
    host.fire(250);
    // Each task sees the time it actually ran at: nothing pretends the timer was on time.
    expect(ran).toEqual([250, 250, 250]);
    expect(host.timers[0]?.ms).toBe(250);
  });

  it('re-arms after an early wake-up without running the task', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    let ran = false;
    clock.at(100, () => (ran = true));
    host.fire(60);
    expect(ran).toBe(false);
    expect(host.timers[0]?.ms).toBe(40);
    host.fire(100);
    expect(ran).toBe(true);
  });

  it('cancels, and moves the timer to the next task', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const ran: string[] = [];
    const cancel = clock.at(10, () => ran.push('a'));
    clock.at(50, () => ran.push('b'));
    cancel();
    cancel();
    expect(host.timers).toHaveLength(1);
    expect(host.timers[0]?.ms).toBe(50);
    host.fire(50);
    expect(ran).toEqual(['b']);
  });

  it('clears the timer when the last task is cancelled', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const cancel = clock.at(10, () => undefined);
    cancel();
    expect(host.timers).toHaveLength(0);
  });

  it('runs a task added for a time already past in the same wake-up', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const ran: string[] = [];
    clock.at(10, () => {
      ran.push('a');
      clock.at(5, () => ran.push('b'));
    });
    host.fire(10);
    expect(ran).toEqual(['a', 'b']);
    expect(host.timers).toHaveLength(0);
  });

  it('a task in the past runs at the next chance', () => {
    const host = new FakeHost();
    host.t = 100;
    const clock = new TimerClock(host);
    clock.at(40, () => undefined);
    expect(host.timers[0]?.ms).toBe(0);
  });

  it('keeps going after a task throws, and reports it', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    const errors: unknown[] = [];
    clock.onError = (e) => errors.push(e);
    let ran = false;
    clock.at(10, () => {
      throw new Error('boom');
    });
    clock.at(10, () => (ran = true));
    host.fire(10);
    expect(ran).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('a throwing task without a handler does not stop the rest', () => {
    const host = new FakeHost();
    const clock = new TimerClock(host);
    let ran = false;
    clock.at(10, () => {
      throw new Error('boom');
    });
    clock.at(20, () => (ran = true));
    host.fire(20);
    expect(ran).toBe(true);
  });
});

describe('VirtualClock', () => {
  it('reports pending tasks and the next time', async () => {
    const clock = new VirtualClock(0);
    const cancel = clock.at(10, () => undefined);
    clock.at(20, () => undefined);
    cancel();
    expect(clock.pending()).toBe(1);
    expect(clock.next()).toBe(20);
    await clock.runAll();
    expect(clock.now()).toBe(20);
  });
});
