/** The Stage 5 messages: colour and Apply intents, the bench set-up, and the start values. */
import { describe, expect, it } from 'vitest';
import { parseFromWorker, parseToWorker } from './protocol.ts';

const call = (c: unknown) => parseToWorker({ type: 'call', id: 1, call: c });
const intent = (i: unknown) => call({ op: 'request', intent: i });

describe('Stage 5 messages to the worker', () => {
  it('accepts the playground intents', () => {
    for (const i of [
      { kind: 'level', address: 0, arc: 100, live: true },
      { kind: 'level', address: 0, arc: 100, live: false },
      { kind: 'tc', address: 0, mirek: 333 },
      { kind: 'rgbwaf', address: 1, channels: [229, 89, 25, 152, 0, 255] },
      { kind: 'apply', address: 0 },
      {
        kind: 'apply',
        address: 0,
        fade: { kind: 'standard', value: 4 },
        arc: 170,
        mirek: 333,
      },
      {
        kind: 'apply',
        address: 1,
        fade: { kind: 'extended', value: 0x4f },
        channels: [0, 0, 0, 0, 0, 0],
      },
    ])
      expect(intent(i), JSON.stringify(i)).toEqual({
        type: 'call',
        id: 1,
        call: { op: 'request', intent: i },
      });
  });

  it('refuses malformed playground intents', () => {
    for (const i of [
      { kind: 'level', address: 0, arc: 100, live: 'yes' },
      { kind: 'tc', address: 0, mirek: 0 },
      { kind: 'tc', address: 0, mirek: 65_535 },
      { kind: 'tc', address: 64, mirek: 300 },
      { kind: 'rgbwaf', address: 1, channels: [1, 2, 3, 4, 5] },
      { kind: 'rgbwaf', address: 1, channels: [1, 2, 3, 4, 5, 256] },
      { kind: 'rgbwaf', address: 1, channels: 'red' },
      { kind: 'apply', address: 64 },
      { kind: 'apply', address: 0, fade: { kind: 'standard', value: 16 } },
      { kind: 'apply', address: 0, fade: { kind: 'extended', value: 0x50 } },
      { kind: 'apply', address: 0, fade: { kind: 'slow', value: 1 } },
      { kind: 'apply', address: 0, fade: 4 },
      { kind: 'apply', address: 0, arc: 255 },
      { kind: 'apply', address: 0, mirek: 0 },
      { kind: 'apply', address: 0, channels: [1] },
      { kind: 'nope' },
    ])
      expect(intent(i), JSON.stringify(i)).toBeUndefined();
  });

  it('accepts a bench set-up and refuses a bad one', () => {
    const setup = {
      A: { presentation: 'rgbwaf', settings: { maxLowerPullsDown: false } },
      B: { presentation: 'tc', settings: {} },
    };
    expect(call({ op: 'bench', setup })).toEqual({
      type: 'call',
      id: 1,
      call: { op: 'bench', setup },
    });
    expect(call({ op: 'bench', setup: { C: setup.A } })).toBeUndefined();
    expect(call({ op: 'bench', setup: { A: { presentation: 'xy' } } })).toBeUndefined();
    expect(call({ op: 'bench', setup: 'A' })).toBeUndefined();
    expect(call({ op: 'bench', setup: {} })).toBeUndefined();
    expect(
      call({ op: 'bench', setup: { A: { presentation: 'tc', settings: { tcLimits: {} } } } }),
    ).toBeUndefined();
  });

  it('takes a stored ceiling and bench set-up in init', () => {
    expect(parseToWorker({ type: 'init', ceilingArc: 150 })).toEqual({
      type: 'init',
      ceilingArc: 150,
    });
    const bench = { B: { presentation: 'tc', settings: {} } };
    expect(parseToWorker({ type: 'init', bench })).toEqual({ type: 'init', bench });
    expect(parseToWorker({ type: 'init', ceilingArc: 0 })).toBeUndefined();
    expect(parseToWorker({ type: 'init', ceilingArc: 255 })).toBeUndefined();
    // Above the default needs a person's confirmation in the running app, so init refuses it.
    expect(parseToWorker({ type: 'init', ceilingArc: 220 })).toEqual({
      type: 'init',
      ceilingArc: 220,
    });
    expect(parseToWorker({ type: 'init', ceilingArc: 221 })).toBeUndefined();
    expect(parseToWorker({ type: 'init', bench: { A: 1 } })).toBeUndefined();
    // The default preferences hold no set-up: a start with an empty one is a start with the defaults.
    expect(parseToWorker({ type: 'init', ceilingArc: 220, bench: {} })).toEqual({
      type: 'init',
      ceilingArc: 220,
      bench: {},
    });
  });
});

describe('Stage 5 snapshots from the worker', () => {
  const base = {
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
  it('needs the light, feedback and bench lists', () => {
    expect(
      parseFromWorker({
        type: 'snapshot',
        snapshot: { ...base, light: [], feedback: [], bench: [] },
      }),
    ).toBeDefined();
    expect(parseFromWorker({ type: 'snapshot', snapshot: base })).toBeUndefined();
  });
});
