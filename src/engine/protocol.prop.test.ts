/** The page and worker messages: the parsers never throw, and pass only what they describe. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseFromWorker, parseToWorker } from './protocol.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);

describe('parseToWorker', () => {
  it('never throws on any value', () => {
    fc.assert(
      fc.property(fc.anything(), (x) => {
        parseToWorker(x);
        parseFromWorker(x);
      }),
      { numRuns: runs * 5 },
    );
  });

  it('never throws on near-miss messages', () => {
    const near = fc.record({
      type: fc.constantFrom('init', 'heartbeat', 'panic', 'call', 'snapshot', 'reply', 'panicked'),
      id: fc.anything(),
      visible: fc.anything(),
      token: fc.anything(),
      call: fc.record({
        op: fc.constantFrom(
          'setTarget',
          'request',
          'check',
          'unlock',
          'lock',
          'setCeiling',
          'commission',
        ),
        target: fc.anything(),
        intent: fc.anything(),
        unlock: fc.anything(),
        arc: fc.anything(),
        confirmed: fc.anything(),
        step: fc.anything(),
        note: fc.anything(),
        typed: fc.anything(),
      }),
    });
    fc.assert(
      fc.property(near, (x) => {
        parseToWorker(x);
      }),
      { numRuns: runs * 5 },
    );
  });

  it('accepts the messages the page sends', () => {
    expect(parseToWorker({ type: 'init' })).toEqual({ type: 'init' });
    const token = new Uint8Array(32).fill(1);
    expect(parseToWorker({ type: 'init', token })).toEqual({ type: 'init', token });
    expect(parseToWorker({ type: 'heartbeat', visible: true })).toEqual({
      type: 'heartbeat',
      visible: true,
    });
    expect(parseToWorker({ type: 'panic', id: 3 })).toEqual({ type: 'panic', id: 3 });
    const calls = [
      { op: 'setTarget', target: 'both' },
      { op: 'reconnect' },
      { op: 'resume' },
      { op: 'setCeiling', arc: 200, confirmed: false },
      { op: 'unlock', unlock: 'reset', confirmed: true },
      { op: 'lock' },
      { op: 'lock', unlock: 'rate' },
      { op: 'swingLimit', n: 2 },
      { op: 'canSee', can: true },
      { op: 'request', intent: { kind: 'level', address: 1, arc: 100 } },
      { op: 'request', intent: { kind: 'raw', a: 1, b: 2 } },
      {
        op: 'request',
        intent: {
          kind: 'commands',
          label: 'x',
          commands: [
            { id: 'DAPC', address: { kind: 'short', n: 0 }, value: 10 },
            { id: 'OFF', address: { kind: 'broadcast' } },
            { id: 'GO_TO_SCENE', address: { kind: 'group', n: 3 }, value: 2 },
            { id: 'TERMINATE' },
          ],
        },
      },
      { op: 'rescan' },
      { op: 'reapplyProfile' },
      { op: 'commission', typed: 'commission' },
      { op: 'check', step: 'p2-limits', confirmed: true, note: 'n', skip: false },
      { op: 'check', step: 'p2-limits' },
      { op: 'checkReport' },
      { op: 'clearCheck' },
      { op: 'clearDivergences' },
    ];
    for (const call of calls)
      expect(parseToWorker({ type: 'call', id: 1, call })).toEqual({ type: 'call', id: 1, call });
  });

  it('refuses what the page must not send', () => {
    const bad = [
      { type: 'init', token: new Uint8Array(31) },
      { type: 'init', token: 'abc' },
      { type: 'heartbeat' },
      { type: 'panic', id: -1 },
      { type: 'panic', id: 1.5 },
      { type: 'call', id: 1, call: { op: 'setTarget', target: 'lan' } },
      { type: 'call', id: 1, call: { op: 'setCeiling', arc: 255, confirmed: true } },
      { type: 'call', id: 1, call: { op: 'setCeiling', arc: 200 } },
      { type: 'call', id: 1, call: { op: 'unlock', unlock: 'all', confirmed: true } },
      { type: 'call', id: 1, call: { op: 'lock', unlock: 'all' } },
      { type: 'call', id: 1, call: { op: 'swingLimit', n: 4 } },
      { type: 'call', id: 1, call: { op: 'canSee', can: 'yes' } },
      {
        type: 'call',
        id: 1,
        call: { op: 'request', intent: { kind: 'level', address: 64, arc: 1 } },
      },
      { type: 'call', id: 1, call: { op: 'request', intent: { kind: 'raw', a: 256, b: 0 } } },
      { type: 'call', id: 1, call: { op: 'request', intent: { kind: 'commands', commands: [] } } },
      {
        type: 'call',
        id: 1,
        call: { op: 'request', intent: { kind: 'commands', commands: [{ id: 'dapc' }] } },
      },
      {
        type: 'call',
        id: 1,
        call: {
          op: 'request',
          intent: {
            kind: 'commands',
            commands: [{ id: 'OFF', address: { kind: 'short', n: 64 } }],
          },
        },
      },
      {
        type: 'call',
        id: 1,
        call: {
          op: 'request',
          intent: {
            kind: 'commands',
            commands: [{ id: 'OFF', address: { kind: 'group', n: 16 } }],
          },
        },
      },
      {
        type: 'call',
        id: 1,
        call: {
          op: 'request',
          intent: { kind: 'commands', commands: [{ id: 'OFF', address: 'x' }] },
        },
      },
      {
        type: 'call',
        id: 1,
        call: {
          op: 'request',
          intent: { kind: 'commands', commands: [{ id: 'DAPC', value: 300 }] },
        },
      },
      {
        type: 'call',
        id: 1,
        call: { op: 'request', intent: { kind: 'commands', commands: [{ id: 'OFF' }], label: 5 } },
      },
      {
        type: 'call',
        id: 1,
        call: {
          op: 'request',
          intent: { kind: 'commands', commands: Array(17).fill({ id: 'OFF' }) },
        },
      },
      { type: 'call', id: 1, call: { op: 'request', intent: { kind: 'magic' } } },
      { type: 'call', id: 1, call: { op: 'commission', typed: 'x'.repeat(65) } },
      { type: 'call', id: 1, call: { op: 'check', step: 3 } },
      { type: 'call', id: 1, call: { op: 'check', step: 'a', confirmed: 'yes' } },
      { type: 'call', id: 1, call: { op: 'check', step: 'a', note: 'x'.repeat(2001) } },
      { type: 'call', id: 1, call: { op: 'check', step: 'a', skip: 1 } },
      { type: 'call', id: 1, call: { op: 'eval' } },
      { type: 'call', id: 'x', call: { op: 'resume' } },
      { type: 'nope' },
      [],
      null,
    ];
    for (const b of bad) expect([b, parseToWorker(b)]).toEqual([b, undefined]);
  });
});

describe('parseFromWorker', () => {
  const snap = {
    target: 'simulator',
    devices: [],
    divergences: [],
    jobs: [],
    check: [],
    monitor: [],
    notices: [],
    unlocks: [],
    latched: false,
    ceilingArc: 220,
  };
  it('accepts what the worker sends', () => {
    expect(parseFromWorker({ type: 'snapshot', snapshot: snap })?.type).toBe('snapshot');
    expect(parseFromWorker({ type: 'reply', id: 2, result: { ok: true } })?.type).toBe('reply');
    expect(parseFromWorker({ type: 'panicked', id: 2 })).toEqual({ type: 'panicked', id: 2 });
  });
  it('refuses malformed messages', () => {
    expect(
      parseFromWorker({ type: 'snapshot', snapshot: { ...snap, target: 'x' } }),
    ).toBeUndefined();
    expect(
      parseFromWorker({ type: 'snapshot', snapshot: { ...snap, devices: {} } }),
    ).toBeUndefined();
    expect(
      parseFromWorker({ type: 'snapshot', snapshot: { ...snap, ceilingArc: 0 } }),
    ).toBeUndefined();
    expect(parseFromWorker({ type: 'snapshot', snapshot: null })).toBeUndefined();
    expect(parseFromWorker({ type: 'reply', id: 2, result: {} })).toBeUndefined();
    expect(parseFromWorker({ type: 'panicked' })).toBeUndefined();
    expect(parseFromWorker({ type: 'other' })).toBeUndefined();
  });
});
