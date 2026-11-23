import { describe, expect, it } from 'vitest';
import { withFloors } from '../bus/timing.ts';
import { broadcast, group, short } from '../dali/address.ts';
import {
  fadePieces,
  fadeSettingText,
  MAX_ROWS,
  planCost,
  planFramesOf,
  planSequence,
  reached,
  rowCommands,
  rowText,
  sameColour,
  type Driver,
  type Plan,
} from './plan.ts';
import type { Sequence, Step } from './sequence.ts';

const A: Driver = {
  address: 0,
  drive: 'tc',
  groups: 0b01,
  minArc: 85,
  auto: true,
  arc: 0,
  colour: { kind: 'tc', mirek: 250 },
};
const B: Driver = {
  address: 1,
  drive: 'rgbwaf',
  groups: 0b10,
  minArc: 85,
  auto: true,
  arc: 0,
  colour: { kind: 'rgbwaf', channels: [0, 0, 0, 0, 0, 255] },
};
const step = (s: Partial<Step>): Step => ({
  target: short(0),
  arc: 200,
  colour: { kind: 'none' },
  durationMs: 0,
  ...s,
});
const seq = (...steps: Step[]): Sequence => ({ name: 'Test', steps });
const plan = (s: Sequence, drivers: Driver[] = [A, B], ceiling = 220): Plan => {
  const r = planSequence(s, drivers, ceiling);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const ids = (cmds: readonly { id: string }[]) => cmds.map((c) => c.id);
const min = 60_000;

describe('the fades that make up a duration', () => {
  const ms = (d: number) => fadePieces(d).map((p) => p.ms);
  it('is no fade for nothing, or for less than half the shortest fade', () => {
    expect(fadePieces(0)).toEqual([{ fade: { kind: 'extended', value: 0 }, ms: 0 }]);
    expect(ms(49)).toEqual([0]);
    expect(ms(50)).toEqual([100]);
  });

  it('uses one fade where one fits', () => {
    expect(ms(700)).toEqual([700]);
    expect(ms(2000)).toEqual([2000]);
    expect(ms(16 * min)).toEqual([16 * min]);
    expect(fadePieces(16 * min)[0]?.fade).toEqual({ kind: 'extended', value: 0x4f });
    expect(ms(160_000)).toEqual([160_000]);
  });

  it('chains across the gap between 160 s and 3 minutes, and past 16 minutes', () => {
    expect(ms(170_000)).toEqual([160_000, 10_000]);
    expect(ms(25 * min)).toEqual([16 * min, 9 * min]);
    expect(ms(40 * min)).toEqual([16 * min, 16 * min, 8 * min]);
    // 2.5 minutes: 2 minutes, then 30 seconds.
    expect(ms(150_000)).toEqual([150_000]);
    expect(ms(165_000)).toEqual([160_000, 5000]);
  });

  it('never differs from the duration by more than the shortest fade', () => {
    for (const d of [51, 333, 1234, 9999, 61_234, 999_999, 3_600_001, 86_400_000]) {
      const sum = ms(d).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - d)).toBeLessThanOrEqual(100);
    }
  });
});

describe('who a target reaches', () => {
  it('is one driver, a group or every driver', () => {
    expect(reached(short(1), [A, B])).toEqual([B]);
    expect(reached(short(9), [A, B])).toEqual([]);
    expect(reached(group(0), [A, B])).toEqual([A]);
    expect(reached(group(5), [A, B])).toEqual([]);
    expect(reached(broadcast, [A, B])).toEqual([A, B]);
    expect(reached({ kind: 'unaddressed' }, [A, B])).toEqual([]);
  });
});

describe('planning a sequence', () => {
  it('plans a step with a fitting fade as one row, and sets the fade first', () => {
    const p = plan(seq(step({ arc: 150, durationMs: 2000 })));
    expect(p.rows).toEqual([
      {
        atMs: 0,
        address: 0,
        step: 0,
        arc: 150,
        colour: { kind: 'none' },
        fade: { kind: 'standard', value: 4 },
        fadeMs: 2000,
        setFade: true,
        fromArc: 0,
      },
    ]);
    expect(p.endMs).toBe(2000);
    expect(p.notes).toEqual([]);
  });

  it('plans the night preset as two chained fades, evenly spaced in arc level', () => {
    const p = plan(
      seq(
        step({ arc: 0, colour: { kind: 'tc', mirek: 370 } }),
        step({ arc: 195, colour: { kind: 'tc', mirek: 370 }, durationMs: 25 * min }),
      ),
    );
    // The colour goes in while the light is off, then the two fades.
    expect(p.rows.map((r) => [r.atMs, r.arc, r.fadeMs])).toEqual([
      [0, 0, 0],
      [0, Math.round(85 + (195 - 85) * (16 / 25)), 16 * min],
      [16 * min, 195, 9 * min],
    ]);
    expect(p.rows[0]?.colour).toEqual({ kind: 'tc', mirek: 370 });
    // The colour is there already, so the fades carry none.
    expect(p.rows[1]?.colour).toEqual({ kind: 'none' });
    expect(p.endMs).toBe(25 * min);
  });

  it('moves the colour along with the level across chained fades', () => {
    const p = plan(
      seq(step({ arc: 200, colour: { kind: 'tc', mirek: 150 }, durationMs: 32 * min })),
      [{ ...A, arc: 100 }],
    );
    expect(p.rows.map((r) => r.arc)).toEqual([150, 200]);
    expect(p.rows.map((r) => r.colour)).toEqual([
      { kind: 'tc', mirek: 200 },
      { kind: 'tc', mirek: 150 },
    ]);
    // The second fade is the same as the first, so it is not set again.
    expect(p.rows.map((r) => r.setFade)).toEqual([true, false]);
  });

  it('mixes RGBWAF channels, and leaves a channel marked "no change" alone', () => {
    const p = plan(
      seq(
        step({
          target: short(1),
          arc: 100,
          colour: { kind: 'rgbwaf', channels: [200, 255, 100, 0, 0, 255] },
          durationMs: 32 * min,
        }),
      ),
      [{ ...B, arc: 100, colour: { kind: 'rgbwaf', channels: [0, 50, 255, 0, 0, 255] } }],
    );
    expect(p.rows.map((r) => r.colour)).toEqual([
      { kind: 'rgbwaf', channels: [100, 50, 100, 0, 0, 255] },
      { kind: 'rgbwaf', channels: [200, 50, 100, 0, 0, 255] },
    ]);
  });

  it('fades to off through the minimum, and ends on off', () => {
    const p = plan(seq(step({ arc: 0, durationMs: 32 * min })), [{ ...A, arc: 185 }]);
    expect(p.rows.map((r) => r.arc)).toEqual([135, 0]);
  });

  it('keeps a driver off through a chained step from off to off, whatever colour it carries', () => {
    // Found by P-plan at 120 runs: the levels between the chained fades were the minimum, so a
    // colour change planned for lights that were off turned them on at 1%.
    const p = plan(
      seq(
        step({
          target: broadcast,
          arc: 0,
          colour: { kind: 'rgbwaf', channels: [0, 157, 175, 7, 55, 255] },
          durationMs: 170_000,
        }),
      ),
    );
    expect(p.rows.every((r) => r.arc === 0)).toBe(true);
    // The driver that takes no such colour has nothing to do at all.
    expect(p.rows.every((r) => r.address === 1)).toBe(true);
    expect(p.rows.map((r) => r.fadeMs)).toEqual([160_000, 10_000]);
  });

  it('refuses a driver with a fast fade time, which would take the place of the plan’s fades', () => {
    const r = planSequence(seq(step({ durationMs: 16 * min })), [{ ...A, fastFade: 20 }], 220);
    expect(r).toEqual({
      ok: false,
      reason:
        'A0 has a fast fade time set, which takes the place of the fades a plan uses. A plan for it would not run as shown.',
    });
  });

  it('uses standard fades only on a driver that reports no extended fade time', () => {
    const old: Driver = { ...A, extended: false };
    const p = plan(seq(step({ arc: 150, durationMs: 10_000 }), step({ arc: 100 })), [old]);
    expect(p.rows.every((r) => r.fade.kind === 'standard')).toBe(true);
    // 10 s is 8 s and 2 s of standard fade times, and no fade is fade time 0.
    expect(p.rows.map((r) => r.fadeMs)).toEqual([8000, 2000, 0]);
    expect(p.rows.at(-1)?.fade).toEqual({ kind: 'standard', value: 0 });
    expect(fadePieces(30, false)).toEqual([{ fade: { kind: 'standard', value: 0 }, ms: 0 }]);
  });

  it('plans a colour temperature outside the driver’s limits at the limit, and says so', () => {
    const p = plan(seq(step({ colour: { kind: 'tc', mirek: 400 } })), [
      { ...A, tc: { coolest: 154, warmest: 370 } },
    ]);
    expect(p.rows[0]?.colour).toEqual({ kind: 'tc', mirek: 370 });
    expect(p.notes).toEqual([
      'A0 takes colour temperatures from 2703 K to 6494 K: a colour outside that is planned at the limit.',
    ]);
  });

  it('runs steps one after another, or together when asked', () => {
    const p = plan(
      seq(
        step({ target: short(0), arc: 150, durationMs: 4000 }),
        step({ target: short(1), arc: 150, durationMs: 2000, together: true }),
        step({ target: short(0), arc: 100, durationMs: 1000 }),
      ),
    );
    expect(p.rows.map((r) => [r.atMs, r.address, r.arc])).toEqual([
      [0, 0, 150],
      [0, 1, 150],
      [4000, 0, 100],
    ]);
    expect(p.endMs).toBe(5000);
    // A first step marked together starts at the start.
    expect(plan(seq(step({ together: true }))).rows[0]?.atMs).toBe(0);
  });

  it('sends nothing for a step that changes nothing, which is how a wait is made', () => {
    const p = plan(
      seq(step({ arc: 150 }), step({ arc: 150, durationMs: 10 * min }), step({ arc: 100 })),
    );
    expect(p.rows.map((r) => [r.atMs, r.arc])).toEqual([
      [0, 150],
      [10 * min, 100],
    ]);
    expect(p.endMs).toBe(10 * min);
  });

  it('plans a group and broadcast for the drivers they reach', () => {
    expect(plan(seq(step({ target: group(1) }))).rows.map((r) => r.address)).toEqual([1]);
    expect(plan(seq(step({ target: broadcast }))).rows.map((r) => r.address)).toEqual([0, 1]);
  });

  it('notes what it leaves out or changes', () => {
    const p = plan(
      seq(
        step({ target: short(7) }),
        step({ target: broadcast, arc: 254, colour: { kind: 'tc', mirek: 370 } }),
      ),
    );
    expect(p.notes).toEqual([
      'Step 1: no driver at A7, so it is skipped.',
      'A level above the ceiling is planned at the ceiling.',
      'A1 does not take a colour temperature: it gets the level only.',
    ]);
    expect(p.rows.map((r) => r.arc)).toEqual([220, 220]);
    expect(p.rows[1]?.colour).toEqual({ kind: 'none' });
    const q = plan(
      seq(step({ target: short(0), colour: { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 255] } })),
    );
    expect(q.notes).toEqual(['A0 does not take RGBWAF channel levels: it gets the level only.']);
  });

  it('refuses a sequence with no steps, too many, a bad level, a bad duration, or too many rows', () => {
    const no = (s: Sequence) => {
      const r = planSequence(s, [A, B], 220);
      return r.ok ? 'planned' : r.reason;
    };
    expect(no(seq())).toBe('A sequence needs at least one step.');
    expect(no(seq(...Array.from({ length: 501 }, () => step({}))))).toBe(
      'A sequence has at most 500 steps.',
    );
    expect(no(seq(step({ arc: 255 })))).toBe('Step 1: a level is an arc level from 0 to 254.');
    expect(no(seq(step({}), step({ arc: 1.5 })))).toBe(
      'Step 2: a level is an arc level from 0 to 254.',
    );
    expect(no(seq(step({ durationMs: -1 })))).toBe('Step 1: a step lasts from 0 to 24 hours.');
    expect(no(seq(step({ durationMs: 86_400_001 })))).toBe(
      'Step 1: a step lasts from 0 to 24 hours.',
    );
    // 500 steps of a day each, up and down, on two drivers.
    const long = seq(
      ...Array.from({ length: 500 }, (_, i) =>
        step({ target: broadcast, arc: i % 2 === 0 ? 220 : 90, durationMs: 86_400_000 }),
      ),
    );
    expect(no(long)).toBe(`This needs more than ${String(MAX_ROWS)} changes. Make it shorter.`);
  });
});

describe('the commands for a row', () => {
  const row = (p: Plan, i = 0) => {
    const r = p.rows[i];
    if (r === undefined) throw new Error('no row');
    return r;
  };
  it('sets a standard fade, or clears the fade time and sets an extended one', () => {
    expect(ids(rowCommands(row(plan(seq(step({ durationMs: 2000 })))), true))).toEqual([
      'DTR0',
      'SET_FADE_TIME',
      'DAPC',
    ]);
    expect(ids(rowCommands(row(plan(seq(step({ durationMs: 16 * min })))), true))).toEqual([
      'DTR0',
      'SET_FADE_TIME',
      'DTR0',
      'SET_EXTENDED_FADE_TIME',
      'DAPC',
    ]);
  });

  it('loads the colour before the level, and leaves activation to gear that does it', () => {
    const p = plan(seq(step({ colour: { kind: 'tc', mirek: 370 } })));
    expect(ids(rowCommands(row(p), true)).slice(-4)).toEqual([
      'DTR0',
      'DTR1',
      'DT8_SET_TEMPORARY_TC',
      'DAPC',
    ]);
  });

  it('activates before a rise and after a fall on gear without automatic activation', () => {
    const up = plan(seq(step({ arc: 200, colour: { kind: 'tc', mirek: 370 } })), [
      { ...A, arc: 100 },
    ]);
    expect(ids(rowCommands(row(up), false)).slice(-2)).toEqual(['DT8_ACTIVATE', 'DAPC']);
    const down = plan(
      seq(
        step({
          target: short(1),
          arc: 90,
          colour: { kind: 'rgbwaf', channels: [9, 9, 9, 9, 9, 255] },
        }),
      ),
      [{ ...B, arc: 200 }],
    );
    expect(ids(rowCommands(row(down), false)).slice(-2)).toEqual(['DAPC', 'DT8_ACTIVATE']);
    // A level alone needs no activation.
    expect(ids(rowCommands(row(plan(seq(step({})))), false)).at(-1)).toBe('DAPC');
  });
});

describe('a plan in words and frames', () => {
  it('says each row as an integrator would read it', () => {
    const p = plan(
      seq(
        step({ arc: 195, colour: { kind: 'tc', mirek: 370 }, durationMs: 16 * min }),
        step({
          target: short(1),
          arc: 100,
          colour: { kind: 'rgbwaf', channels: [1, 2, 3, 255, 255, 255] },
          durationMs: 2000,
        }),
        step({ arc: 0 }),
      ),
    );
    expect(p.rows.map(rowText)).toEqual([
      {
        command: 'level and colour temperature',
        values: 'arc 195 (20.0%), 2700 K',
        fade: '16 min (extended fade 0x4F)',
      },
      {
        command: 'level and RGBWAF channels',
        values: 'arc 100 (1.5%), R 1, G 2, B 3, W 0, A 0',
        fade: '2 s (fade time 4)',
      },
      { command: 'level', values: 'arc 0 (off)', fade: 'no fade' },
    ]);
    expect(fadeSettingText({ kind: 'standard', value: 1 }, 707)).toBe('0.7 s (fade time 1)');
  });

  it('lists every frame with its time, one after another on the bus', () => {
    const timing = withFloors({});
    const p = plan(seq(step({ target: broadcast, colour: { kind: 'tc', mirek: 370 } })), [
      A,
      { ...B, drive: 'tc' },
    ]);
    const frames = planFramesOf(p, () => true, timing);
    expect(frames.map((f) => f.text).slice(0, 9)).toEqual([
      'DTR0 0',
      'SET FADE TIME A0',
      'DTR0 0',
      'SET EXTENDED FADE TIME A0',
      'DTR0 114',
      'DTR1 1',
      'ENABLE DEVICE TYPE 8',
      'SET TEMPORARY COLOUR TEMPERATURE Tc A0',
      'DAPC A0 200',
    ]);
    expect(frames[0]?.atMs).toBeCloseTo(timing.settleFirstMs);
    // The second driver's frames wait for the first driver's.
    const firstB = frames.find((f) => f.address === 1);
    const lastA = frames.filter((f) => f.address === 0).at(-1);
    expect(firstB?.atMs).toBeGreaterThan(lastA?.atMs ?? Infinity);
    for (let i = 1; i < frames.length; i++)
      expect(frames[i]?.atMs).toBeGreaterThan(frames[i - 1]?.atMs ?? Infinity);
  });

  it('counts frames a second for each address, and the share of the bus', () => {
    const timing = withFloors({});
    const p = plan(seq(step({ target: broadcast, durationMs: 10_000 })));
    const cost = planCost(p, () => true, timing);
    // An extended fade (4 frames) and a level, over 10 s.
    expect(cost.perAddress.get(0)).toBeCloseTo(0.5);
    expect(cost.perAddress.get(1)).toBeCloseTo(0.5);
    expect(cost.busShare).toBeGreaterThan(0.01);
    expect(cost.busShare).toBeLessThan(0.05);
    expect(planCost({ ...p, periodMs: 1000 }, () => true, timing).perAddress.get(0)).toBeCloseTo(5);
    expect(planCost({ ...p, periodMs: 1 }, () => true, timing).busShare).toBe(1);
  });

  it('compares colours', () => {
    expect(sameColour({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(sameColour({ kind: 'tc', mirek: 1 }, { kind: 'tc', mirek: 1 })).toBe(true);
    expect(sameColour({ kind: 'tc', mirek: 1 }, { kind: 'tc', mirek: 2 })).toBe(false);
    expect(sameColour({ kind: 'tc', mirek: 1 }, { kind: 'none' })).toBe(false);
    expect(
      sameColour(
        { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 6] },
        { kind: 'rgbwaf', channels: [1, 2, 3, 4, 5, 7] },
      ),
    ).toBe(false);
  });
});
