/** The Stage 5 and 6 messages: colour and Apply intents, the bench set-up, the start values and the console. */
import { describe, expect, it } from 'vitest';
import { short } from '../dali/address.ts';
import { parseToWorker } from './protocol-in.ts';
import { consoleContext, parseFromWorker } from './protocol.ts';

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
    console: [],
    notices: [],
    unlocks: [],
    latched: false,
    ceilingArc: 220,
  };
  it('needs the light, feedback and bench lists', () => {
    expect(
      parseFromWorker({
        type: 'snapshot',
        snapshot: { ...base, light: [], feedback: [], bench: [], extras: [], switches: [] },
      }),
    ).toBeDefined();
    expect(parseFromWorker({ type: 'snapshot', snapshot: base })).toBeUndefined();
  });
});

describe('Stage 6 console calls', () => {
  it('accepts a console line with its aliases, use default and confirmation', () => {
    expect(
      call({
        op: 'console',
        line: 'level warm 50%',
        aliases: [['warm', 0]],
        use: '0,1',
        confirmed: true,
      }),
    ).toEqual({
      type: 'call',
      id: 1,
      call: {
        op: 'console',
        line: 'level warm 50%',
        aliases: [['warm', 0]],
        use: '0,1',
        confirmed: true,
      },
    });
    expect(call({ op: 'scriptContinue' })).toBeDefined();
    expect(call({ op: 'stopConsole' })).toBeDefined();
    expect(
      call({ op: 'runScript', name: 'first-light', text: 'off 0', aliases: [] }),
    ).toBeDefined();
  });

  it('refuses long lines, bad aliases and bad script names', () => {
    expect(call({ op: 'console', line: 'x'.repeat(501), aliases: [] })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0' })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0', aliases: [['all', 0]] })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0', aliases: [['ok', 64]] })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0', aliases: [['ok', 0, 1]] })).toBeUndefined();
    const many = Array.from({ length: 65 }, (_, i) => [`a${String(i)}`, 0]);
    expect(call({ op: 'console', line: 'off 0', aliases: many })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0', aliases: [], use: 7 })).toBeUndefined();
    expect(call({ op: 'console', line: 'off 0', aliases: [], confirmed: 'yes' })).toBeUndefined();
    expect(call({ op: 'runScript', name: '../x', text: '', aliases: [] })).toBeUndefined();
    expect(
      call({ op: 'runScript', name: 'x', text: 'x'.repeat(64 * 1024 + 1), aliases: [] }),
    ).toBeUndefined();
  });

  it('builds the parse context in the worker, and refuses a use default that does not parse', () => {
    const c = consoleContext([['Warm', 0]], 'warm,1');
    expect(c.ok && [...c.ctx.aliases]).toEqual([['warm', 0]]);
    expect(c.ok && c.ctx.use).toEqual([short(0), short(1)]);
    expect(consoleContext([], 'nowhere').ok).toBe(false);
  });
});
