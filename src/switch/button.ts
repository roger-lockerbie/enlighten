/**
 * The IEC 62386-301 push button event machine for one button (SPEC section 10, research
 * `switchgear.md` section 1). It takes down and up, and a `Clock`, and emits the part 301 events
 * that the event filter lets through. Nothing here reads the system clock.
 */
import type { Cancel, Clock } from '../bus/clock.ts';

export type ButtonEvent =
  | 'released'
  | 'pressed'
  | 'short'
  | 'double'
  | 'longStart'
  | 'longRepeat'
  | 'longStop'
  | 'free'
  | 'stuck';

/** The event codes of part 301, as python-dali has them. */
export const EVENT_CODE: Readonly<Record<ButtonEvent, number>> = {
  released: 0,
  pressed: 1,
  short: 2,
  double: 5,
  longStart: 9,
  longRepeat: 11,
  longStop: 12,
  free: 14,
  stuck: 15,
};

export const EVENT_LABEL: Readonly<Record<ButtonEvent, string>> = {
  released: 'released',
  pressed: 'pressed',
  short: 'short press',
  double: 'double press',
  longStart: 'long press start',
  longRepeat: 'long press repeat',
  longStop: 'long press stop',
  free: 'free',
  stuck: 'stuck',
};

export const EVENTS: readonly ButtonEvent[] = [
  'released',
  'pressed',
  'short',
  'double',
  'longStart',
  'longRepeat',
  'longStop',
  'stuck',
  'free',
];

/** Filter bits: 0 released, 1 pressed, 2 short, 3 double, 4 long start, 5 repeat, 6 stop, 7 stuck and free. */
const FILTER_BIT: Readonly<Record<ButtonEvent, number>> = {
  released: 0,
  pressed: 1,
  short: 2,
  double: 3,
  longStart: 4,
  longRepeat: 5,
  longStop: 6,
  stuck: 7,
  free: 7,
};

/** Short, long start, repeat, stop, and stuck and free (the Lunatone factory setting). */
export const DEFAULT_FILTER = 0xf4;

export interface Timers {
  /** Short press threshold, 20 ms units, 20 to 5100 ms. */
  readonly shortMs: number;
  /** Double press window, 20 ms units. 0 turns double press off. */
  readonly doubleMs: number;
  /** Repeat interval, 20 ms units, 100 to 2000 ms. */
  readonly repeatMs: number;
  /** Stuck timer, whole seconds, 5 to 255 s. */
  readonly stuckS: number;
  /** A press shorter than this is ignored as a bounce. */
  readonly minPulseMs: number;
}

export const DEFAULT_TIMERS: Timers = {
  shortMs: 500,
  doubleMs: 0,
  repeatMs: 160,
  stuckS: 20,
  minPulseMs: 40,
};

export const LIMITS = {
  shortMs: [20, 5100],
  doubleMs: [0, 2000],
  repeatMs: [100, 2000],
  stuckS: [5, 255],
  minPulseMs: [0, 500],
} as const;

export function isEnabled(filter: number, e: ButtonEvent): boolean {
  return (filter & (1 << FILTER_BIT[e])) !== 0;
}

/** Whether every timer is inside its range and on its unit. */
export function timersProblem(t: Timers): string | undefined {
  const inRange = (v: number, [lo, hi]: readonly [number, number]) =>
    Number.isInteger(v) && v >= lo && v <= hi;
  if (!inRange(t.shortMs, LIMITS.shortMs) || t.shortMs % 20 !== 0)
    return 'The short press timer is 20 to 5100 ms in steps of 20.';
  if (!inRange(t.doubleMs, LIMITS.doubleMs) || t.doubleMs % 20 !== 0)
    return 'The double press timer is 0 (off) or up to 2000 ms in steps of 20.';
  if (!inRange(t.repeatMs, LIMITS.repeatMs) || t.repeatMs % 20 !== 0)
    return 'The repeat timer is 100 to 2000 ms in steps of 20.';
  if (!inRange(t.stuckS, LIMITS.stuckS)) return 'The stuck timer is 5 to 255 seconds.';
  if (!inRange(t.minPulseMs, LIMITS.minPulseMs)) return 'The minimum pulse is 0 to 500 ms.';
  return undefined;
}

type State = 'idle' | 'down' | 'long' | 'waitDouble' | 'secondDown' | 'stuck';

/**
 * One button. `press` and `release` are the inputs; `emit` gets each event that passes the filter.
 * Timers are `Clock.at` wake-ups and are all cancelled when the button goes idle, so an idle button
 * leaves nothing pending.
 */
export class Button {
  private state: State = 'idle';
  private cancels: Cancel[] = [];
  private downAt = 0;

  constructor(
    private readonly clock: Clock,
    private timers: Timers,
    private filter: number,
    private readonly emit: (e: ButtonEvent) => void,
  ) {}

  setTimers(timers: Timers, filter: number): void {
    this.timers = timers;
    this.filter = filter;
  }

  get idle(): boolean {
    return this.state === 'idle';
  }

  get pending(): number {
    return this.cancels.length;
  }

  private out(e: ButtonEvent): void {
    if (isEnabled(this.filter, e)) this.emit(e);
  }

  private clear(): void {
    for (const c of this.cancels) c();
    this.cancels = [];
  }

  private after(ms: number, run: () => void): void {
    const self: { c?: Cancel } = {};
    const wrapped = () => {
      this.cancels = this.cancels.filter((c) => c !== self.c);
      run();
    };
    self.c = this.clock.at(this.clock.now() + ms, wrapped);
    this.cancels.push(self.c);
  }

  /** The button went down. */
  press(): void {
    if (this.state === 'down' || this.state === 'long' || this.state === 'stuck') return;
    if (this.state === 'waitDouble') {
      this.clear();
      this.state = 'secondDown';
      this.downAt = this.clock.now();
      this.out('pressed');
      this.out('double');
      this.armStuck();
      return;
    }
    this.state = 'down';
    this.downAt = this.clock.now();
    this.out('pressed');
    this.after(this.timers.shortMs, () => {
      this.state = 'long';
      this.out('longStart');
      this.repeat();
    });
    this.armStuck();
  }

  private armStuck(): void {
    this.after(this.timers.stuckS * 1000, () => {
      // Held, or bouncing, for the stuck time: stop repeating and wait for a release.
      this.clear();
      this.state = 'stuck';
      this.out('stuck');
    });
  }

  private repeat(): void {
    this.after(this.timers.repeatMs, () => {
      if (this.state !== 'long') return;
      this.out('longRepeat');
      this.repeat();
    });
  }

  /** The button went up. */
  release(): void {
    switch (this.state) {
      case 'idle':
      case 'waitDouble':
        return;
      case 'stuck':
        this.state = 'idle';
        this.out('free');
        return;
      case 'long':
        this.clear();
        this.state = 'idle';
        if (isEnabled(this.filter, 'longStop')) this.out('longStop');
        else this.out('released');
        return;
      case 'secondDown':
        this.clear();
        this.state = 'idle';
        this.out('released');
        return;
      case 'down': {
        this.clear();
        if (this.clock.now() - this.downAt < this.timers.minPulseMs) {
          // A bounce: forget the press and say nothing more.
          this.state = 'idle';
          return;
        }
        this.out('released');
        if (this.timers.doubleMs === 0) {
          this.state = 'idle';
          this.out('short');
          return;
        }
        this.state = 'waitDouble';
        this.after(this.timers.doubleMs, () => {
          this.state = 'idle';
          this.out('short');
        });
      }
    }
  }

  /** Drop everything without any event: used by Panic and a change of target. */
  reset(): void {
    this.clear();
    this.state = 'idle';
  }
}
