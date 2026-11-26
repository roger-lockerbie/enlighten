/**
 * P-readback (ADR 0022, Stage 11 findings S11-1): on hardware the governor lets a colour or a level
 * go to colour gear only when every fade setting it rests on was read from the gear that is at the
 * address now. A model keeps the gear's real settings through scans with replies lost, address
 * moves that bring other gear to the address, hand-typed queries and fade writes the gear ignores.
 * Whenever the governor allows an ACTIVATE, or a level after it, the real settings must all be 0.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { short, type Address } from '../../src/dali/address.ts';
import type { Command } from '../../src/dali/codec.ts';
import { framesFor, framesForAll } from '../../src/dali/sequences.ts';
import { Governor } from '../../src/safety/governor.ts';
import type { SendResult } from '../../src/safety/types.ts';
import { Simulator } from '../../src/sim/simulator.ts';
import { timeout } from '../harness/gen.ts';

// Each case is a few hundred calls with no bus or clock, and the fault this was written for needed
// about 650 cases to find, so it runs 40 for each of the others' one.
const RUNS = Number(process.env['PROP_RUNS'] ?? 25) * 40;
const A = short(0);
const B = short(1);
const c = (id: string, address?: Address, value?: number): Command => ({
  id,
  ...(address === undefined ? {} : { address }),
  ...(value === undefined ? {} : { value }),
});
const reply = (byte: number): SendResult => ({ kind: 'reply', byte });
const NONE: SendResult = { kind: 'no-reply' };

function tell(g: Governor, cmd: Command, result: SendResult, at: number): void {
  const frames = framesFor(cmd);
  frames.forEach((f, i) => {
    g.observe(
      { frame: f, at: at + i, source: 'internal' },
      i === frames.length - 1 ? result : { kind: 'sent' },
    );
  });
}

/** The fade settings of the gear that is really at A0. */
interface Truth {
  fade: number;
  ext: number;
  fast: number;
}
const FADE_QUERIES = [
  'QUERY_FADE_TIME_FADE_RATE',
  'QUERY_EXTENDED_FADE_TIME',
  'DT6_QUERY_FAST_FADE_TIME',
] as const;
type FadeQuery = (typeof FADE_QUERIES)[number];
const answer = (t: Truth, id: FadeQuery): number =>
  id === 'QUERY_FADE_TIME_FADE_RATE'
    ? (t.fade << 4) | 7
    : id === 'QUERY_EXTENDED_FADE_TIME'
      ? t.ext
      : t.fast;

/** Every read-back of a scan, with the replies to the named queries lost, then the profile. */
function scan(g: Governor, t: Truth, lost: readonly string[], at: number): void {
  const r = (id: string, v: number, value?: number) => {
    tell(g, c(id, A, value), lost.includes(id) ? NONE : reply(v), at);
  };
  g.beginScan(0);
  r('QUERY_CONTROL_GEAR_PRESENT', 255);
  r('QUERY_DEVICE_TYPE', 255);
  for (const type of [6, 8, 254]) r('QUERY_NEXT_DEVICE_TYPE', type);
  r('QUERY_PHYSICAL_MINIMUM', 85);
  r('QUERY_MIN_LEVEL', 85);
  r('QUERY_MAX_LEVEL', 220);
  r('QUERY_GROUPS_0_7', 0);
  r('QUERY_GROUPS_8_15', 0);
  for (const id of FADE_QUERIES.slice(0, 2)) r(id, answer(t, id));
  r('QUERY_ACTUAL_LEVEL', 100);
  r('DT6_QUERY_DIMMING_CURVE', 0);
  r('DT6_QUERY_FAST_FADE_TIME', t.fast);
  r('DT8_QUERY_COLOUR_TYPE_FEATURES', 0x60);
  for (let k = 0; k < 16; k++) r('QUERY_SCENE_LEVEL', 255, k);
  r('QUERY_STATUS', 0);
  g.modelAddress(0);
  g.markInventoryFresh(false);
  g.markVerified(0, { max: 220, min: 85, powerOn: 0, systemFailure: 255, linear: false });
}

const setting = fc.constantFrom(0, 0, 0, 2, 5);
const truth: fc.Arbitrary<Truth> = fc.record({
  fade: setting,
  ext: fc.constantFrom(0, 0, 0, 0x16),
  fast: fc.constantFrom(0, 0, 0, 20),
});
type Step =
  | { kind: 'scan'; lost: string[] }
  | { kind: 'move'; next: Truth }
  | { kind: 'read'; id: FadeQuery; lost: boolean }
  | { kind: 'fade'; value: number; taken: boolean };
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('scan' as const),
    lost: fc.subarray([...FADE_QUERIES, 'QUERY_GROUPS_8_15', 'DT8_QUERY_COLOUR_TYPE_FEATURES'], {
      maxLength: 2,
    }),
  }),
  fc.record({ kind: fc.constant('move' as const), next: truth }),
  fc.record({
    kind: fc.constant('read' as const),
    id: fc.constantFrom(...FADE_QUERIES),
    lost: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('fade' as const), value: setting, taken: fc.boolean() }),
);

describe('P-readback', () => {
  it(
    'a colour or a level goes to colour gear only when the gear now at the address has no fade',
    () => {
      let allowed = 0;
      fc.assert(
        fc.property(truth, fc.array(step, { minLength: 1, maxLength: 8 }), (start, steps) => {
          const g = new Governor({
            target: 'hardware',
            shadow: new Simulator([]),
            connectedAt: -10_000,
          });
          let t = { ...start };
          let at = 1000;
          scan(g, t, [], at);
          for (const s of steps) {
            at += 10_000;
            if (s.kind === 'scan') scan(g, t, s.lost, at);
            else if (s.kind === 'move') {
              // Other gear arrives at A0, as SET SHORT ADDRESS to another address can make it.
              t = { ...s.next };
              tell(g, c('DTR0', undefined, 1), { kind: 'sent' }, at);
              tell(g, c('SET_SHORT_ADDRESS', B), { kind: 'sent' }, at);
            } else if (s.kind === 'read')
              tell(g, c(s.id, A), s.lost ? NONE : reply(answer(t, s.id)), at);
            else {
              tell(g, c('DTR0', undefined, s.value), { kind: 'sent' }, at);
              tell(g, c('SET_FADE_TIME', A), { kind: 'sent' }, at);
              if (s.taken) t.fade = s.value;
            }
          }
          const still = t.fade === 0 && t.ext === 0 && t.fast === 0;
          at += 20 * 60_000;
          const activate = g.judge(
            { frames: framesForAll([c('DT8_ACTIVATE', A)]), source: 'ui' },
            at,
          );
          if (activate.kind === 'refuse') return;
          expect(still, `ACTIVATE allowed with ${JSON.stringify(t)}`).toBe(true);
          tell(g, c('DT8_ACTIVATE', A), { kind: 'sent' }, at);
          at += 20 * 60_000;
          const level = g.judge({ frames: framesForAll([c('DAPC', A, 150)]), source: 'ui' }, at);
          if (level.kind === 'refuse') return;
          expect(still, `DAPC allowed with ${JSON.stringify(t)}`).toBe(true);
          allowed++;
        }),
        { numRuns: RUNS },
      );
      // The property is not empty: some streams end with gear the governor rightly lets move.
      expect(allowed).toBeGreaterThan(0);
    },
    timeout(RUNS),
  );
});
