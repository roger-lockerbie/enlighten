/**
 * S4-D6: lowering the ceiling brings lit gear under it before the slower profile writes (SPEC R6.2).
 * On hardware, while a DT8 driver's colour is unknown, each pull-down is a hard step, and the room
 * takes one hard step a second (S3.3), so the second driver lands one second after the first. Before
 * the fix it landed after the first driver's whole profile, 3 to 5 seconds later.
 */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { decode, type Frame } from '../dali/codec.ts';
import { framesForAll } from '../dali/sequences.ts';
import { benchA, benchB } from '../sim/profile.ts';
import { Simulator } from '../sim/simulator.ts';
import { asSubmit, makeBench, type Bench } from '../../tests/harness/bench.ts';
import { lowerCeiling } from './ceiling.ts';
import type { Submit } from './profile.ts';

async function litBench(target: 'hardware' | 'simulator', pulls: boolean): Promise<Bench> {
  const sim = Simulator.of([
    { id: 'A', profile: benchA({ maxLowerPullsDown: pulls }), opts: { shortAddress: 0 } },
    { id: 'B', profile: benchB({ maxLowerPullsDown: pulls }), opts: { shortAddress: 1 } },
  ]);
  const b = makeBench({ target, sim });
  await b.ready();
  await b.clock.advance(3000);
  for (const n of [0, 1]) {
    const lit = await b.run({
      frames: framesForAll([{ id: 'DAPC', address: short(n), value: 200 }]),
      source: 'ui',
    });
    expect(lit.kind).toBe('done');
    await b.clock.advance(3000);
  }
  return b;
}

/** Lower to 150 and return when each driver's light was first at or under it, in ms from the start. */
async function lowerAndTime(b: Bench) {
  const start = b.clock.now();
  const under: (number | undefined)[] = [undefined, undefined];
  const watch = () => {
    ['A', 'B'].forEach((id, i) => {
      const g = b.sim.unit(id)?.gear;
      if (under[i] === undefined && g !== undefined && g.levelAt(b.clock.now()) <= 150)
        under[i] = b.clock.now() - start;
    });
    if (under.some((u) => u === undefined) && b.clock.now() - start < 20_000)
      b.clock.at(b.clock.now() + 5, watch);
  };
  watch();
  const labels: string[] = [];
  const inner = asSubmit(b);
  const submit: Submit = async (t, p) => {
    let prev: Frame | undefined;
    const ids = t.frames.map((f) => {
      const c = decode(f.frame, prev);
      prev = f.frame;
      return c?.id ?? '?';
    });
    const r = await inner(t, p);
    labels.push(`${t.label ?? ''}: ${ids.join(',')}: ${r.kind}`);
    return r;
  };
  const wait = (ms: number) =>
    new Promise<void>((r) => {
      b.clock.at(b.clock.now() + ms, r);
    });
  const r = await b.drive(lowerCeiling(b.governor, 150, submit, 'ui', () => b.clock.now(), wait));
  expect(r.ok).toBe(true);
  return { under, labels };
}

describe('lowering the ceiling turns lit gear down before the MAX LEVEL writes (S4-D6)', () => {
  for (const pulls of [true, false]) {
    it(`on hardware with colour unknown, one driver at once and the next a second later (pull-down ${String(pulls)})`, async () => {
      const { under, labels } = await lowerAndTime(await litBench('hardware', pulls));
      expect(under[0]).toBeLessThan(100);
      expect(under[1]).toBeLessThan(1200);
      // Both pull-downs are sent before the first MAX LEVEL write.
      const firstMax = labels.findIndex((l) => l.startsWith('lower MAX LEVEL'));
      const holds = labels
        .map((l, i) => [l, i] as const)
        .filter(([l]) => l.startsWith('hold under the new ceiling') && l.endsWith('done'));
      expect(holds).toHaveLength(2);
      for (const [, i] of holds) expect(i).toBeLessThan(firstMax);
    });
  }

  it('in the Simulator target, both drivers at once in one transaction', async () => {
    const { under, labels } = await lowerAndTime(await litBench('simulator', false));
    expect(under[0]).toBeLessThan(100);
    expect(under[1]).toBeLessThan(100);
    expect(labels[0]).toBe('hold under the new ceiling: DAPC,DAPC: done');
  });
});
