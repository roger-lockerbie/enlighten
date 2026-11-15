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

/** What the real clock needs from its host. The bus worker passes `performance.now` and `setTimeout`. */
export interface TimerHost {
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * The real clock (ADR 0010). Timers are wake-ups only: when one fires, the clock reads the time and
 * runs every task that is due, in order. Nothing counts ticks, so a late wake-up delays work and never
 * distorts the time. One timer is armed at a time, for the earliest task.
 */
export class TimerClock implements Clock {
  private readonly host: TimerHost;
  private seq = 0;
  private tasks: Task[] = [];
  private handle: unknown;
  private armedFor: number | undefined;
  private running = false;
  /** Called when a task throws, so one failure does not stop the tasks after it. */
  onError: ((e: unknown) => void) | undefined;

  constructor(host: TimerHost) {
    this.host = host;
  }

  now(): number {
    return this.host.now();
  }

  at(time: number, run: () => void): Cancel {
    const task: Task = { time, seq: this.seq++, run, cancelled: false };
    this.tasks.push(task);
    this.tasks.sort((a, b) => a.time - b.time || a.seq - b.seq);
    this.arm();
    return () => {
      if (task.cancelled) return;
      task.cancelled = true;
      this.tasks = this.tasks.filter((t) => t !== task);
      this.arm();
    };
  }

  /** Tasks still waiting. */
  pending(): number {
    return this.tasks.length;
  }

  private arm(): void {
    if (this.running) return;
    const next = this.tasks[0];
    if (next === undefined) {
      this.disarm();
      return;
    }
    if (this.armedFor === next.time) return;
    this.disarm();
    this.armedFor = next.time;
    this.handle = this.host.setTimer(
      () => {
        this.wake();
      },
      Math.max(0, next.time - this.host.now()),
    );
  }

  private disarm(): void {
    if (this.armedFor === undefined) return;
    this.host.clearTimer(this.handle);
    this.armedFor = undefined;
    this.handle = undefined;
  }

  private wake(): void {
    this.armedFor = undefined;
    this.handle = undefined;
    this.running = true;
    try {
      // A task may add tasks that are already due: they run in this wake-up too.
      for (;;) {
        const task = this.tasks[0];
        if (task === undefined || task.time > this.host.now()) break;
        this.tasks.shift();
        if (task.cancelled) continue;
        try {
          task.run();
        } catch (e) {
          this.onError?.(e);
        }
      }
    } finally {
      this.running = false;
    }
    this.arm();
  }
}
