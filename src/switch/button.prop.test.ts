import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../bus/clock.ts';
import { Button, type ButtonEvent } from './button.ts';

const timers = fc.record({
  shortMs: fc.integer({ min: 1, max: 100 }).map((n) => n * 20),
  doubleMs: fc.oneof(
    fc.constant(0),
    fc.integer({ min: 1, max: 100 }).map((n) => n * 20),
  ),
  repeatMs: fc.integer({ min: 5, max: 100 }).map((n) => n * 20),
  stuckS: fc.integer({ min: 5, max: 30 }),
  minPulseMs: fc.integer({ min: 0, max: 100 }),
});

/** Alternating gaps: the clock advances by each, then the input flips. */
const gaps = fc.array(fc.integer({ min: 0, max: 6000 }), { minLength: 1, maxLength: 30 });

/** Repeats in different holds are not one repeat timer apart, so only one hold is compared. */
function stuckBetween(events: { e: ButtonEvent; at: number }[], from: number, to: number): boolean {
  return events.some((x) => x.at > from && x.at <= to && x.e !== 'longRepeat');
}

describe('P-switch: the button machine', () => {
  it('keeps its invariants for any input and any timers', async () => {
    await fc.assert(
      fc.asyncProperty(timers, gaps, async (t, gs) => {
        const clock = new VirtualClock();
        const events: { e: ButtonEvent; at: number }[] = [];
        const b = new Button(clock, t, 0xff, (e) => events.push({ e, at: clock.now() }));
        let down = false;
        for (const g of gs) {
          await clock.advance(g);
          if (down) b.release();
          else b.press();
          down = !down;
        }
        if (down) b.release();
        await clock.advance(10_000);
        // Idle with nothing pending.
        expect(b.idle).toBe(true);
        expect(b.pending).toBe(0);
        // Repeats are at least one repeat timer apart.
        const repeats = events.filter((x) => x.e === 'longRepeat');
        for (let i = 1; i < repeats.length; i++) {
          const prev = repeats[i - 1];
          const cur = repeats[i];
          if (prev !== undefined && cur !== undefined && !stuckBetween(events, prev.at, cur.at))
            expect(cur.at - prev.at).toBeGreaterThanOrEqual(t.repeatMs);
        }
        // Stuck is always followed by free before the next press.
        let stuck = false;
        for (const { e } of events) {
          if (e === 'stuck') stuck = true;
          if (e === 'free') {
            expect(stuck).toBe(true);
            stuck = false;
          }
          if (e === 'pressed') expect(stuck).toBe(false);
        }
        expect(stuck).toBe(false);
        // A long stop never comes with a released for the same press, and every long start ends.
        let longOpen = false;
        for (const { e } of events) {
          if (e === 'longStart') longOpen = true;
          if (e === 'stuck') longOpen = false;
          if (e === 'longStop') {
            expect(longOpen).toBe(true);
            longOpen = false;
          }
          if (e === 'released') expect(longOpen).toBe(false);
        }
        expect(longOpen).toBe(false);
        // A short or double press only follows a release.
        let released = false;
        for (const { e } of events) {
          if (e === 'released') released = true;
          if (e === 'short') {
            expect(released).toBe(true);
            released = false;
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
