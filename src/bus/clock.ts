/**
 * Time for the core (ADR 0010). Nothing in the core reads the system clock or sets a timer: it takes
 * a `Clock`. The real clock lives in the worker shell (Stage 4). Tests use `VirtualClock`.
 */

export type Cancel = () => void;

export interface Clock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Run once `now() >= time`. A time in the past runs at the next chance. */
  at(time: number, run: () => void): Cancel;
}

interface Task {
  readonly time: number;
  readonly seq: number;
  readonly run: () => void;
  cancelled: boolean;
}

/** Let promise callbacks run. Used between virtual timer callbacks so async code keeps step. */
export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** A clock that moves only when a test says so. */
export class VirtualClock implements Clock {
  private t: number;
  private seq = 0;
  private tasks: Task[] = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  at(time: number, run: () => void): Cancel {
    const task: Task = { time: Math.max(time, this.t), seq: this.seq++, run, cancelled: false };
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.time - b.time || a.seq - b.seq);
    return () => {
      task.cancelled = true;
    };
  }

  /** Tasks still waiting. */
  pending(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }

  /** The time of the next waiting task, or undefined. */
  next(): number | undefined {
    return this.tasks.find((t) => !t.cancelled)?.time;
  }

  /**
   * Move to `time`, running each due task in order at its own time, and letting promise callbacks
   * run after each one.
   */
  async advanceTo(time: number): Promise<void> {
    await flushMicrotasks();
    for (;;) {
      const task = this.tasks[0];
      if (task === undefined || task.time > time) break;
      this.tasks.shift();
      if (task.cancelled) continue;
      this.t = task.time;
      task.run();
      await flushMicrotasks();
    }
    this.t = Math.max(this.t, time);
    await flushMicrotasks();
  }

  advance(ms: number): Promise<void> {
    return this.advanceTo(this.t + ms);
  }

  /** Run until nothing is waiting, or until a time limit. */
  async runAll(limit = this.t + 3_600_000): Promise<void> {
    for (;;) {
      await flushMicrotasks();
      const n = this.next();
      if (n === undefined || n > limit) return;
      await this.advanceTo(n);
    }
  }
}
