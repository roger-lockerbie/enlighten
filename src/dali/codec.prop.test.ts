/** P-codec: decode(encode(c)) is c, and encode(decode(f)) is f for every frame that decodes. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Address } from './address.ts';
import { COMMANDS, spec } from './commands.ts';
import { decode, encode, type Command, type Frame } from './codec.ts';

const address: fc.Arbitrary<Address> = fc.oneof(
  fc.integer({ min: 0, max: 63 }).map((n) => ({ kind: 'short' as const, n })),
  fc.integer({ min: 0, max: 15 }).map((n) => ({ kind: 'group' as const, n })),
  fc.constant({ kind: 'broadcast' as const }),
  fc.constant({ kind: 'unaddressed' as const }),
);

const shortData = fc.oneof(
  fc.constant(0xff),
  fc.integer({ min: 0, max: 63 }).map((a) => (a << 1) | 1),
);

export const command: fc.Arbitrary<Command> = fc
  .constantFrom(...COMMANDS)
  .chain((s): fc.Arbitrary<Command> => {
    if (s.kind === 'special') {
      const data =
        s.param === 'byte'
          ? fc.integer({ min: 0, max: 255 })
          : s.param === 'shortAddress'
            ? shortData
            : s.param === 'initialise'
              ? fc.oneof(fc.constant(0), shortData)
              : fc.constant(undefined);
      return data.map((value) => (value === undefined ? { id: s.id } : { id: s.id, value }));
    }
    if (s.kind === 'dapc') {
      return fc
        .tuple(address, fc.integer({ min: 0, max: 255 }))
        .map(([a, value]) => ({ id: s.id, address: a, value }));
    }
    if (s.param === 'nibble') {
      return fc
        .tuple(address, fc.integer({ min: 0, max: 15 }))
        .map(([a, value]) => ({ id: s.id, address: a, value }));
    }
    return address.map((a) => ({ id: s.id, address: a }));
  });

const previousFor = (c: Command): Frame | undefined => {
  const dt = spec(c.id).deviceType;
  return dt === 0 ? undefined : { a: 0xc1, b: dt };
};

describe('P-codec', () => {
  it('decode(encode(c)) is c', () => {
    fc.assert(
      fc.property(command, (c) => {
        expect(decode(encode(c).frame, previousFor(c))).toEqual(c);
      }),
      { numRuns: 5000 },
    );
  });

  it('encode(decode(f)) is f for every frame that decodes, in any device type context', () => {
    const prev = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom(6, 8, 1).map((dt): Frame => ({ a: 0xc1, b: dt })),
      fc.record({ a: fc.integer({ min: 0, max: 255 }), b: fc.integer({ min: 0, max: 255 }) }),
    );
    const frame = fc.record({
      a: fc.integer({ min: 0, max: 255 }),
      b: fc.integer({ min: 0, max: 255 }),
    });
    fc.assert(
      fc.property(frame, prev, (f, p) => {
        const c = decode(f, p);
        if (c !== undefined) expect(encode(c).frame).toEqual(f);
      }),
      { numRuns: 20000 },
    );
  });
});
