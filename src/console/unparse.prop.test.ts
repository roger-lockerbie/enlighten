/** P-unparse: the line `explain` prints for a command parses back to that command. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { broadcast, group, short, unaddressed, type Address } from '../dali/address.ts';
import { COMMANDS, type CommandSpec } from '../dali/commands.ts';
import type { Command } from '../dali/codec.ts';
import { parseLine, type ParseContext } from './parse.ts';
import { addressWord, lineOf } from './unparse.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200) * 5;
const ctx: ParseContext = { aliases: new Map() };

const address: fc.Arbitrary<Address> = fc.oneof(
  fc.integer({ min: 0, max: 63 }).map(short),
  fc.integer({ min: 0, max: 15 }).map(group),
  fc.constant(broadcast),
  fc.constant(unaddressed),
);

/** A valid command for a spec. */
function commandFor(s: CommandSpec): fc.Arbitrary<Command> {
  if (s.kind === 'special') {
    const short6 = fc.integer({ min: 0, max: 63 }).map((n) => (n << 1) | 1);
    const value =
      s.param === 'none'
        ? fc.constant(undefined)
        : s.param === 'byte'
          ? fc.integer({ min: 0, max: 255 })
          : s.param === 'shortAddress'
            ? fc.oneof(short6, fc.constant(0xff))
            : fc.oneof(short6, fc.constant(0), fc.constant(0xff));
    return value.map((v) => (v === undefined ? { id: s.id } : { id: s.id, value: v }));
  }
  if (s.kind === 'dapc')
    return fc
      .tuple(address, fc.integer({ min: 0, max: 255 }))
      .map(([a, v]) => ({ id: s.id, address: a, value: v }));
  if (s.param === 'nibble')
    return fc
      .tuple(address, fc.integer({ min: 0, max: 15 }))
      .map(([a, v]) => ({ id: s.id, address: a, value: v }));
  return address.map((a) => ({ id: s.id, address: a }));
}

const anyCommand = fc.constantFrom(...COMMANDS).chain(commandFor);

/**
 * The one DALI command a line sends. `off` is also one of the console's own commands: it wins the
 * name and sends OFF, so it counts as OFF here.
 */
function sent(line: string): Command {
  const p = parseLine(line, ctx);
  if (!p.ok || p.command === undefined) throw new Error(line);
  const c = p.command;
  if (c.cmd === 'off' && c.to.length === 1 && c.to[0] !== undefined)
    return { id: 'OFF', address: c.to[0] };
  if (c.cmd !== 'dali' || (c.to?.length ?? 1) !== 1) throw new Error(line);
  return {
    id: c.id,
    ...(c.to?.[0] === undefined ? {} : { address: c.to[0] }),
    ...(c.value === undefined ? {} : { value: c.value }),
  };
}

describe('P-unparse', () => {
  it('parses every line it makes back to the same command', () => {
    fc.assert(
      fc.property(anyCommand, (c) => {
        expect(sent(lineOf(c))).toEqual(c);
      }),
      { numRuns: runs },
    );
  });

  it('covers every command in the table at least once', () => {
    for (const s of COMMANDS) {
      const [c] = fc.sample(commandFor(s), 1);
      if (c === undefined) throw new Error(s.id);
      expect(sent(lineOf(c)).id, lineOf(c)).toBe(s.id);
    }
  });

  it('names addresses as the console reads them', () => {
    expect([short(7), group(3), broadcast, unaddressed].map(addressWord)).toEqual([
      '7',
      'g3',
      'all',
      'unaddressed',
    ]);
    expect(lineOf({ id: 'DAPC', address: short(0), value: 255 })).toBe('dapc 0 mask');
    expect(lineOf({ id: 'PROGRAM_SHORT_ADDRESS', value: 0xff })).toBe('program-short-address none');
    expect(lineOf({ id: 'INITIALISE', value: 0xff })).toBe('initialise unaddressed');
    expect(lineOf({ id: 'INITIALISE', value: 0 })).toBe('initialise all');
    expect(lineOf({ id: 'TERMINATE' })).toBe('terminate');
  });
});
