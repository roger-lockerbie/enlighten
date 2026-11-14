/** U-engine: the router sends only approved frames, each once, in order, in time (SPEC S2.1, S3-M1). */
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../bus/clock.ts';
import { PANIC_FRAMES } from '../bus/scheduler.ts';
import { broadcast, short } from '../dali/address.ts';
import { framesForAll, type TxFrame } from '../dali/sequences.ts';
import { Governor } from '../safety/governor.ts';
import type { Approved, SendResult, Transaction } from '../safety/types.ts';
import { Simulator } from '../sim/simulator.ts';
import { APPROVAL_FRAME_MS, Router } from './router.ts';
import type { Transport } from './transport.ts';

class Recorder implements Transport {
  readonly kind = 'sim';
  sent: TxFrame[] = [];
  panics: TxFrame[] = [];
  state() {
    return 'ready' as const;
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  send(f: TxFrame): Promise<SendResult> {
    this.sent.push(f);
    return Promise.resolve({ kind: 'sent' });
  }
  sendPanic(f: TxFrame): Promise<SendResult> {
    this.panics.push(f);
    return Promise.resolve({ kind: 'sent' });
  }
}

function setup() {
  const clock = new VirtualClock(1000);
  const governor = new Governor({ target: 'simulator', shadow: Simulator.bench() });
  const transport = new Recorder();
  const refused: string[] = [];
  const router = new Router({
    transport,
    clock,
    issuer: governor,
    onRefused: (r) => refused.push(r),
  });
  const approve = (tx: Transaction): Approved => {
    const v = governor.judge(tx, clock.now());
    if (v.kind === 'refuse') throw new Error(v.reason);
    return v.approval;
  };
  return { clock, transport, router, refused, approve, governor };
}

const query: Transaction = {
  frames: framesForAll([
    { id: 'DTR0', value: 3 },
    { id: 'QUERY_ACTUAL_LEVEL', address: short(0) },
  ]),
  source: 'ui',
};

describe('router', () => {
  it("refuses another connection's approval, and everything once closed", async () => {
    const { clock, transport, router, refused } = setup();
    const other = new Governor({ target: 'simulator', shadow: Simulator.bench() });
    const v = other.judge(query, clock.now());
    if (v.kind === 'refuse') throw new Error(v.reason);
    const f0 = v.approval.tx.frames[0];
    if (f0 === undefined) throw new Error('one frame');
    expect(await router.send(f0, v.approval)).toEqual({
      kind: 'refused',
      reason: "The approval is from another connection's governor.",
    });
    router.close();
    for (const f of PANIC_FRAMES) expect((await router.sendPanic(f)).kind).toBe('refused');
    expect(transport.sent).toEqual([]);
    expect(transport.panics).toEqual([]);
    expect(refused).toHaveLength(3);
  });

  it('sends the frames of an approval once each, in order', async () => {
    const { transport, router, refused, approve } = setup();
    const a = approve(query);
    const [f0, f1] = a.tx.frames;
    if (f0 === undefined || f1 === undefined) throw new Error('two frames');
    expect((await router.send(f0, a)).kind).toBe('sent');
    expect((await router.send(f1, a)).kind).toBe('sent');
    expect(transport.sent).toEqual([f0, f1]);
    expect(refused).toEqual([]);
    // A third use, or the same frame again, is refused and never reaches the transport.
    expect((await router.send(f1, a)).kind).toBe('refused');
    expect(transport.sent).toHaveLength(2);
  });

  it('refuses frames out of order', async () => {
    const { transport, router, approve } = setup();
    const a = approve(query);
    const f1 = a.tx.frames[1];
    if (f1 === undefined) throw new Error('two frames');
    const r = await router.send(f1, a);
    expect(r).toEqual({
      kind: 'refused',
      reason: 'The frame is not the next one the governor approved.',
    });
    expect(transport.sent).toEqual([]);
  });

  it('refuses a frame equal to the approved one but not the approved copy', async () => {
    const { transport, router, approve } = setup();
    const a = approve(query);
    const f0 = a.tx.frames[0];
    if (f0 === undefined) throw new Error('one frame');
    const copy = { ...f0, frame: { ...f0.frame } };
    expect((await router.send(copy, a)).kind).toBe('refused');
    expect(transport.sent).toEqual([]);
  });

  it('refuses anything that is not an approval the governor made', async () => {
    const { transport, router, refused } = setup();
    const f = query.frames[0];
    if (f === undefined) throw new Error('one frame');
    const forged = Object.freeze({ tx: query, issuedAt: 1000 }) as unknown as Approved;
    expect((await router.send(f, forged)).kind).toBe('refused');
    expect((await router.send(f, null as unknown as Approved)).kind).toBe('refused');
    expect((await router.send(f, 7 as unknown as Approved)).kind).toBe('refused');
    expect(transport.sent).toEqual([]);
    expect(refused).toHaveLength(3);
  });

  it('refuses an approval used after its time', async () => {
    const { clock, transport, router, approve } = setup();
    const a = approve(query);
    const [f0, f1] = a.tx.frames;
    if (f0 === undefined || f1 === undefined) throw new Error('two frames');
    await clock.advance(APPROVAL_FRAME_MS);
    expect((await router.send(f0, a)).kind).toBe('sent');
    await clock.advance(APPROVAL_FRAME_MS + 1);
    expect((await router.send(f1, a)).kind).toBe('refused');
    expect(transport.sent).toEqual([f0]);
  });

  it('refuses a first frame sent more than a second after the judgement', async () => {
    const { clock, router, approve } = setup();
    const a = approve(query);
    const f0 = a.tx.frames[0];
    if (f0 === undefined) throw new Error('one frame');
    await clock.advance(APPROVAL_FRAME_MS + 1);
    expect(await router.send(f0, a)).toEqual({
      kind: 'refused',
      reason: 'The approval has expired.',
    });
  });

  it('passes panic frames, and only panic frames, without an approval', async () => {
    const { transport, router } = setup();
    for (const f of PANIC_FRAMES) expect((await router.sendPanic(f)).kind).toBe('sent');
    const [dapc] = framesForAll([{ id: 'DAPC', address: broadcast, value: 254 }]);
    if (dapc === undefined) throw new Error('one frame');
    expect((await router.sendPanic(dapc)).kind).toBe('refused');
    const [off] = PANIC_FRAMES.slice(1);
    if (off === undefined) throw new Error('two panic frames');
    // The same frame with a reply flag is not panic's frame.
    expect((await router.sendPanic({ ...off, expectReply: true })).kind).toBe('refused');
    expect((await router.sendPanic({ ...off, sendTwice: true })).kind).toBe('refused');
    expect(transport.panics).toEqual([...PANIC_FRAMES]);
    expect(transport.sent).toEqual([]);
  });
});
