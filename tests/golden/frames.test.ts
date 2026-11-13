/** G-frames: the codec against python-dali, byte for byte. */
import { describe, expect, it } from 'vitest';
import { COMMANDS, spec } from '../../src/dali/commands.ts';
import { decode, encode, type Command, type Frame } from '../../src/dali/codec.ts';
import {
  framesForAll,
  rgbwafCommands,
  tcCommands,
  queryColourValueCommands,
} from '../../src/dali/sequences.ts';
import { short } from '../../src/dali/address.ts';
import { decodeSweep, frames, sequences } from './load.ts';

const byPd = new Map(COMMANDS.map((c) => [c.pd, c]));
const fixtures = frames();

function commandFor(f: (typeof fixtures)[number]): Command {
  const s = byPd.get(f.pd);
  if (s === undefined) throw new Error(`no row for ${f.pd}`);
  return {
    id: s.id,
    ...(f.address === null ? {} : { address: f.address }),
    ...(f.param === null ? {} : { value: f.param }),
  };
}

/** Left out of the supported set on purpose (see tools/golden/generate.py). */
const EXCLUDED = new Set(['general.QueryExtendedVersionNumber']);

const EDT = (dt: number): Frame => ({ a: 0xc1, b: dt });

describe('G-frames: every supported command against python-dali', () => {
  it('has a fixture for every row of the command table', () => {
    const covered = new Set(fixtures.map((f) => f.pd));
    const missing = COMMANDS.filter((c) => !covered.has(c.pd)).map((c) => c.pd);
    expect(missing).toEqual([]);
  });

  it('has a row for every python-dali command in the fixtures', () => {
    const unknown = [...new Set(fixtures.map((f) => f.pd))].filter((pd) => !byPd.has(pd));
    expect(unknown).toEqual([]);
  });

  it.each(fixtures.map((f, i) => [i, f] as const))('fixture %i encodes and decodes', (_, f) => {
    const cmd = commandFor(f);
    const e = encode(cmd);
    expect([e.frame.a, e.frame.b]).toEqual(f.frame);
    expect(e.sendTwice).toBe(f.sendTwice);
    expect(e.reply).toBe(f.reply);
    expect(e.deviceType).toBe(f.deviceType);
    const prev = f.deviceType === 0 ? undefined : EDT(f.deviceType);
    const d = decode({ a: f.frame[0], b: f.frame[1] }, prev);
    expect(d).toEqual(cmd);
    expect(f.decodesAs).toBe(f.pd);
  });
});

describe('G-frames: decoding a sweep of frames', () => {
  const { names, rows } = decodeSweep();
  it.each(rows.map((r) => [r.a, r.deviceType, r] as const))(
    'first byte %i, device type %i',
    (a, dt, row) => {
      const zeroRow = rows.find((r) => r.a === a && r.deviceType === 0);
      for (let b = 0; b < 256; b++) {
        // python-dali gives no command for a part 102 opcode after ENABLE DEVICE TYPE. The standard
        // applies ENABLE DEVICE TYPE only to 224 to 255, so below that we expect the plain decoding.
        const addressedCommand = (a & 1) === 1 && (a <= 0x9f || a >= 0xfc);
        const useZero = dt !== 0 && addressedCommand && b < 224;
        const idx = (useZero ? zeroRow?.pd[b] : row.pd[b]) ?? -1;
        const name = idx < 0 ? undefined : names[idx];
        const expected = name === undefined || EXCLUDED.has(name) ? undefined : name;
        const d = decode({ a, b }, dt === 0 ? undefined : EDT(dt));
        const got = d === undefined ? undefined : spec(d.id).pd;
        expect(got, `frame ${String(a)} ${String(b)} dt ${String(dt)}`).toBe(expected);
      }
    },
  );
});

describe('G-frames: sequences as the hasseb driver sends them', () => {
  for (const s of sequences()) {
    const a = short(s.address);
    let cmds: Command[] | undefined;
    if (s.mirek !== undefined) cmds = tcCommands(a, s.mirek);
    else if (s.mix !== undefined) cmds = rgbwafCommands(a, s.mix);
    else if (s.selector !== undefined) cmds = queryColourValueCommands(a, s.selector);
    if (cmds === undefined) continue;
    const built = cmds;
    it(s.name, () => {
      const got = framesForAll(built).map((f) => ({
        frame: [f.frame.a, f.frame.b],
        sendTwice: f.sendTwice,
        expectReply: f.expectReply,
      }));
      expect(got).toEqual(s.frames);
    });
  }
});
