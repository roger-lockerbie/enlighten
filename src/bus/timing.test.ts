/** U-bus: timing figures and floors. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMING, FLOOR_TIMING, frameMs, withFloors } from './timing.ts';
import { VirtualClock } from './clock.ts';

const cmd = { sendTwice: false, expectReply: false };
const query = { sendTwice: false, expectReply: true };
const twice = { sendTwice: true, expectReply: false };

describe('bus timing (dali.md section 14)', () => {
  it('defaults to 31.2, 46.7 and 59.4 ms', () => {
    expect(frameMs(cmd, true, DEFAULT_TIMING)).toBeCloseTo(31.2, 6);
    expect(frameMs(query, true, DEFAULT_TIMING)).toBeCloseTo(46.7, 6);
    expect(frameMs(twice, true, DEFAULT_TIMING)).toBeCloseTo(59.4, 6);
  });
  it('never goes under 29.1, 42.1 and 56.7 ms, or 27.7 and 40.7 ms inside a transaction', () => {
    const t = withFloors({ settleFirstMs: 0, settleLaterMs: -5, replyMs: Number.NaN });
    expect(t).toEqual(FLOOR_TIMING);
    expect(frameMs(cmd, true, t)).toBeGreaterThanOrEqual(29.1);
    expect(frameMs(query, true, t)).toBeGreaterThanOrEqual(42.1);
    expect(frameMs(twice, true, t)).toBeGreaterThanOrEqual(56.7);
    expect(frameMs(cmd, false, t)).toBeGreaterThanOrEqual(27.7);
    expect(frameMs(query, false, t)).toBeGreaterThanOrEqual(40.7);
  });
  it('keeps slower settings', () => {
    expect(withFloors({ settleFirstMs: 40 }).settleFirstMs).toBe(40);
  });
});

describe('VirtualClock', () => {
  it('runs tasks in time order and only when advanced', async () => {
    const c = new VirtualClock(100);
    const seen: string[] = [];
    c.at(300, () => seen.push(`b${String(c.now())}`));
    c.at(200, () => {
      seen.push(`a${String(c.now())}`);
      c.at(250, () => seen.push(`c${String(c.now())}`));
    });
    const cancel = c.at(260, () => seen.push('x'));
    cancel();
    c.at(50, () => seen.push(`past${String(c.now())}`));
    expect(c.pending()).toBe(3);
    await c.advance(150);
    expect(seen).toEqual(['past100', 'a200', 'c250']);
    expect(c.now()).toBe(250);
    await c.runAll();
    expect(seen).toEqual(['past100', 'a200', 'c250', 'b300']);
    expect(c.next()).toBeUndefined();
  });
  it('lets promise callbacks run between tasks', async () => {
    const c = new VirtualClock();
    const seen: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        c.at(c.now() + ms, r);
      });
    void (async () => {
      await wait(10);
      seen.push(c.now());
      await wait(10);
      seen.push(c.now());
    })();
    await c.runAll();
    expect(seen).toEqual([10, 20]);
  });
});

describe('send-twice inside a transaction (dali.md section 14)', () => {
  it('is never under 56.7 ms, even after another frame of the same transaction', () => {
    expect(frameMs(twice, false, FLOOR_TIMING)).toBeGreaterThanOrEqual(56.7);
    expect(frameMs(twice, false, DEFAULT_TIMING)).toBeCloseTo(59.4, 6);
  });
});
