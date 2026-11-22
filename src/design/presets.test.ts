import { describe, expect, it } from 'vitest';
import { planSequence, type Driver } from './plan.ts';
import { PRESETS } from './presets.ts';
import { sequence } from './schema.ts';

const drivers: Driver[] = [
  { address: 0, drive: 'tc', groups: 0, minArc: 85, auto: true, arc: 0, colour: { kind: 'none' } },
  {
    address: 1,
    drive: 'rgbwaf',
    groups: 0,
    minArc: 85,
    auto: true,
    arc: 0,
    colour: { kind: 'none' },
  },
  {
    address: 5,
    drive: 'level',
    groups: 0,
    minArc: 1,
    auto: false,
    arc: 0,
    colour: { kind: 'none' },
  },
];
const min = 60_000;
const preset = (id: string) => {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined) throw new Error(id);
  return p;
};

describe('the built-in sequences', () => {
  it('has the one the spec names, and marks the rest as additions', () => {
    expect(PRESETS.filter((p) => p.fromSpec).map((p) => p.id)).toEqual(['night']);
    expect(PRESETS.map((p) => p.id)).toEqual(['night', 'wind-down', 'night-light', 'sunrise']);
    expect(preset('night').about).toBe('From off to 20% at 2700 K over 25 minutes.');
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s passes the checks and plans', (_id, p) => {
    const seq = p.build(drivers);
    expect(sequence(seq, 'sequence')).toEqual({ ok: true, value: seq });
    const plan = planSequence(seq, drivers, 220);
    expect(plan.ok).toBe(true);
    // Every driver takes part, and nothing is left out.
    if (plan.ok) {
      expect(new Set(plan.value.rows.map((r) => r.address))).toEqual(new Set([0, 1, 5]));
      expect(plan.value.notes).toEqual([]);
    }
  });

  it('builds the night fade for each kind of driver: warm, from off, over 25 minutes', () => {
    const seq = preset('night').build(drivers);
    expect(seq.steps).toHaveLength(6);
    expect(seq.steps[0]).toEqual({
      target: { kind: 'short', n: 0 },
      arc: 0,
      colour: { kind: 'tc', mirek: 370 },
      durationMs: 0,
    });
    expect(seq.steps[1]?.colour).toEqual({ kind: 'rgbwaf', channels: [0, 0, 0, 254, 0, 255] });
    expect(seq.steps[1]?.together).toBe(true);
    expect(seq.steps[2]?.colour).toEqual({ kind: 'none' });
    expect(seq.steps[3]?.together).toBeUndefined();
    expect(seq.steps[3]?.durationMs).toBe(25 * min);
    const plan = planSequence(seq, drivers, 254);
    expect(plan.ok && plan.value.endMs).toBe(25 * min);
    // 20% is arc 195.
    expect(plan.ok && plan.value.rows.at(-1)?.arc).toBe(195);
    // All three start their fades together.
    expect(
      plan.ok && plan.value.rows.filter((r) => r.fadeMs === 16 * min).map((r) => r.atMs),
    ).toEqual([0, 0, 0]);
  });

  it('starts the others from where the light is, or from off for sunrise', () => {
    expect(preset('wind-down').build(drivers).steps).toHaveLength(3);
    expect(preset('night-light').build(drivers).steps[0]?.durationMs).toBe(min);
    const sunrise = preset('sunrise').build(drivers);
    expect(sunrise.steps[0]?.arc).toBe(0);
    expect(sunrise.steps[3]?.colour).toEqual({ kind: 'tc', mirek: 250 });
    expect(sunrise.steps[4]?.colour).toEqual({
      kind: 'rgbwaf',
      channels: [0, 0, 0, 150, 104, 255],
    });
    expect(preset('sunrise').build([]).steps).toEqual([]);
  });
});
