import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../bus/clock.ts';
import {
  Button,
  DEFAULT_FILTER,
  DEFAULT_TIMERS,
  isEnabled,
  timersProblem,
  type ButtonEvent,
  type Timers,
} from './button.ts';

const ALL = 0xff;

function rig(timers: Timers = DEFAULT_TIMERS, filter = ALL) {
  const clock = new VirtualClock();
  const events: ButtonEvent[] = [];
  const b = new Button(clock, timers, filter, (e) => events.push(e));
  return { clock, events, b };
}

describe('part 301 button events', () => {
  it('short press: pressed, released, short on release when double is off', async () => {
    const { clock, events, b } = rig();
    b.press();
    await clock.advance(100);
    b.release();
    expect(events).toEqual(['pressed', 'released', 'short']);
    expect(b.idle).toBe(true);
    expect(b.pending).toBe(0);
  });

  it('long press: start at the short timer, repeats every repeat timer, then stop', async () => {
    const { clock, events, b } = rig();
    b.press();
    await clock.advance(499);
    expect(events).toEqual(['pressed']);
    await clock.advance(1);
    expect(events).toEqual(['pressed', 'longStart']);
    await clock.advance(160 * 3);
    expect(events.filter((e) => e === 'longRepeat')).toHaveLength(3);
    b.release();
    expect(events.at(-1)).toBe('longStop');
    expect(events).not.toContain('released');
    expect(b.pending).toBe(0);
  });

  it('released follows a long press when long press stop is off', async () => {
    const { clock, events, b } = rig(DEFAULT_TIMERS, ALL & ~(1 << 6));
    b.press();
    await clock.advance(600);
    b.release();
    expect(events.at(-1)).toBe('released');
  });

  it('double press: second press inside the window, with no short press', async () => {
    const { clock, events, b } = rig({ ...DEFAULT_TIMERS, doubleMs: 400 });
    b.press();
    await clock.advance(50);
    b.release();
    await clock.advance(100);
    b.press();
    await clock.advance(50);
    b.release();
    await clock.advance(1000);
    expect(events).toEqual(['pressed', 'released', 'pressed', 'double', 'released']);
  });

  it('with double on, a lone press gives its short press after the window', async () => {
    const { clock, events, b } = rig({ ...DEFAULT_TIMERS, doubleMs: 400 });
    b.press();
    await clock.advance(60);
    b.release();
    expect(events).toEqual(['pressed', 'released']);
    await clock.advance(399);
    expect(events).not.toContain('short');
    await clock.advance(1);
    expect(events.at(-1)).toBe('short');
  });

  it('stuck after the stuck timer, then free on release, with no repeats after stuck', async () => {
    const { clock, events, b } = rig({ ...DEFAULT_TIMERS, stuckS: 5 });
    b.press();
    await clock.advance(5000);
    expect(events.at(-1)).toBe('stuck');
    const n = events.length;
    await clock.advance(3000);
    expect(events).toHaveLength(n);
    b.release();
    expect(events.at(-1)).toBe('free');
    expect(b.idle).toBe(true);
    expect(b.pending).toBe(0);
  });

  it('ignores a press shorter than the minimum pulse after saying it was pressed', async () => {
    const { clock, events, b } = rig();
    b.press();
    await clock.advance(10);
    b.release();
    expect(events).toEqual(['pressed']);
    expect(b.idle).toBe(true);
  });

  it('the event filter holds events back', async () => {
    const { clock, events, b } = rig(DEFAULT_TIMERS, DEFAULT_FILTER);
    b.press();
    await clock.advance(100);
    b.release();
    expect(events).toEqual(['short']);
    expect(isEnabled(DEFAULT_FILTER, 'pressed')).toBe(false);
    expect(isEnabled(DEFAULT_FILTER, 'free')).toBe(true);
  });

  it('reset drops everything without events', async () => {
    const { clock, events, b } = rig();
    b.press();
    await clock.advance(700);
    const n = events.length;
    b.reset();
    await clock.advance(5000);
    expect(events).toHaveLength(n);
    expect(b.idle).toBe(true);
    expect(b.pending).toBe(0);
  });

  it('checks timer ranges', () => {
    expect(timersProblem(DEFAULT_TIMERS)).toBeUndefined();
    expect(timersProblem({ ...DEFAULT_TIMERS, shortMs: 510 })).toBeDefined();
    expect(timersProblem({ ...DEFAULT_TIMERS, repeatMs: 60 })).toBeDefined();
    expect(timersProblem({ ...DEFAULT_TIMERS, doubleMs: 2020 })).toBeDefined();
    expect(timersProblem({ ...DEFAULT_TIMERS, stuckS: 2 })).toBeDefined();
    expect(timersProblem({ ...DEFAULT_TIMERS, minPulseMs: 900 })).toBeDefined();
  });

  it('ignores a second press while down and a release while idle', () => {
    const { events, b } = rig();
    b.release();
    b.press();
    b.press();
    expect(events).toEqual(['pressed']);
  });
});
