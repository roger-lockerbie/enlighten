/**
 * U-safety: the two things Stage 4's router and Both mode need from the governor. An approval carries
 * the time it was judged at (S3-M1), and `observe` returns the shadow's own answer before anything is
 * learned from the hardware's (SPEC R1.5).
 */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { framesFor, framesForAll } from '../dali/sequences.ts';
import { Da5l } from '../sim/gear.ts';
import { benchA } from '../sim/profile.ts';
import { Simulator } from '../sim/simulator.ts';
import { Governor } from './governor.ts';

describe('approvals', () => {
  it('carry the time they were judged at', () => {
    const g = new Governor({ target: 'simulator', shadow: Simulator.bench() });
    const v = g.judge(
      { frames: framesForAll([{ id: 'QUERY_ACTUAL_LEVEL', address: short(0) }]), source: 'ui' },
      4321,
    );
    if (v.kind === 'refuse') throw new Error(v.reason);
    expect(v.approval.issuedAt).toBe(4321);
  });
});

describe('observe', () => {
  const query = framesFor({ id: 'QUERY_ACTUAL_LEVEL', address: short(0) });

  it("returns the hardware shadow's answer to a query", () => {
    const shadow = new Simulator([
      { id: 'hw0', gear: new Da5l(benchA(), { shortAddress: 0, at: 0 }) },
    ]);
    const g = new Governor({ target: 'hardware', shadow, connectedAt: 0 });
    const q0 = query[0];
    if (q0 === undefined) throw new Error('one frame');
    const expected = shadow.fork().send(q0, 100);
    const r = g.observe({ frame: q0, at: 100, source: 'internal' }, { kind: 'reply', byte: 7 });
    expect(r).toEqual(expected);
    expect(r?.kind).toBe('value');
  });

  it('returns nothing when the transport feeds the shadow, or the frame was refused', () => {
    const g = new Governor({
      target: 'simulator',
      shadow: Simulator.bench(),
      shadowFedByTransport: true,
    });
    const f = query[0];
    if (f === undefined) throw new Error('one frame');
    expect(
      g.observe({ frame: f, at: 100, source: 'ui' }, { kind: 'reply', byte: 1 }),
    ).toBeUndefined();
    const h = new Governor({ target: 'hardware', shadow: new Simulator([]), connectedAt: 0 });
    expect(
      h.observe({ frame: f, at: 100, source: 'ui' }, { kind: 'refused', reason: 'x' }),
    ).toBeUndefined();
    expect(h.observe({ frame: f, at: 200, source: 'ui' }, { kind: 'no-reply' })).toEqual({
      kind: 'none',
    });
  });

  it('returns the shadow answer for a frame that does not decode', () => {
    const h = new Governor({ target: 'hardware', shadow: new Simulator([]), connectedAt: 0 });
    // 0xFF 0x10 is a reserved command number: no gear answers and nothing decodes.
    const r = h.observe(
      {
        frame: { frame: { a: 0xff, b: 0x10 }, sendTwice: false, expectReply: false },
        at: 100,
        source: 'ui',
      },
      { kind: 'sent' },
    );
    expect(r).toEqual({ kind: 'none' });
  });
});
