/** U-engine: the live-control coalescer keeps the newest value per key and waits for the bus. */
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../bus/clock.ts';
import { Coalescer, type CoalescedResult } from './coalescer.ts';

function setup(answer: (v: number) => CoalescedResult = () => ({ ok: true })) {
  const clock = new VirtualClock(0);
  const sent: [string, number, number][] = [];
  const c = new Coalescer<number>(clock, (key, v) => {
    sent.push([key, v, clock.now()]);
    // Each send takes 30 ms, as a frame on the bus does.
    return new Promise((resolve) => {
      clock.at(clock.now() + 30, () => {
        resolve(answer(v));
      });
    });
  });
  return { clock, c, sent };
}

describe('Coalescer', () => {
  it('sends the first value at once and only the newest after it', async () => {
    const { clock, c, sent } = setup();
    for (const v of [1, 2, 3, 4]) c.set('a', v);
    expect(c.waiting()).toBe(1);
    await clock.advance(100);
    expect(sent.map((s) => s[1])).toEqual([1, 4]);
    expect(c.waiting()).toBe(0);
  });

  it('keeps keys apart', async () => {
    const { clock, c, sent } = setup();
    c.set('a', 1);
    c.set('b', 2);
    await clock.advance(100);
    expect(sent.map((s) => [s[0], s[1]])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('retries a refused value at its retry time, unless a newer one came', async () => {
    let refuse = true;
    const { clock, c, sent } = setup(() => (refuse ? { ok: false, retryAt: 500 } : { ok: true }));
    c.set('a', 7);
    await clock.advance(100);
    refuse = false;
    await clock.advance(1000);
    expect(sent.map((s) => [s[1], s[2]])).toEqual([
      [7, 0],
      [7, 500],
    ]);
    refuse = true;
    c.set('a', 8);
    await clock.advance(10);
    c.set('a', 9);
    refuse = false;
    await clock.advance(1000);
    expect(sent.slice(2).map((s) => s[1])).toEqual([8, 9]);
  });

  it('drops a value refused with no retry time', async () => {
    const { clock, c, sent } = setup(() => ({ ok: false }));
    c.set('a', 1);
    await clock.advance(1000);
    expect(sent).toHaveLength(1);
    expect(c.waiting()).toBe(0);
  });

  it('cancel drops what is waiting, and a late answer changes nothing', async () => {
    const { clock, c, sent } = setup(() => ({ ok: false, retryAt: 200 }));
    c.set('a', 1);
    c.set('a', 2);
    c.cancel();
    await clock.advance(1000);
    expect(sent.map((s) => s[1])).toEqual([1]);
    c.set('b', 3);
    // Cancel while the send is on the bus: its refusal arrives after, and is ignored.
    await clock.advance(20);
    c.cancel();
    await clock.advance(1000);
    expect(sent.map((s) => s[1])).toEqual([1, 3]);
  });
});
