/**
 * A DALI command as the console line that sends that one command (SPEC section 6): the reverse of
 * the parser's `daliCommand`. `explain` uses it to show each command in a form that can be typed.
 * A property test parses every line this makes and expects the same command back.
 */
import type { Address } from '../dali/address.ts';
import { spec } from '../dali/commands.ts';
import type { Command } from '../dali/codec.ts';
import { nameOf } from './names.ts';

/** An address as the console reads one: 0 to 63, g0 to g15, all, unaddressed. */
export function addressWord(a: Address): string {
  return a.kind === 'short'
    ? String(a.n)
    : a.kind === 'group'
      ? `g${String(a.n)}`
      : a.kind === 'broadcast'
        ? 'all'
        : 'unaddressed';
}

/** The console line for one command. */
export function lineOf(c: Command): string {
  const s = spec(c.id);
  const words = [nameOf(c.id)];
  if (s.kind === 'special') {
    const v = c.value ?? 0;
    if (s.param === 'byte') words.push(String(v));
    else if (s.param === 'shortAddress') words.push(v === 0xff ? 'none' : String(v >> 1));
    else if (s.param === 'initialise')
      words.push(v === 0 ? 'all' : v === 0xff ? 'unaddressed' : String(v >> 1));
    return words.join(' ');
  }
  if (c.address !== undefined) words.push(addressWord(c.address));
  if (s.kind === 'dapc') words.push(c.value === 255 ? 'mask' : String(c.value ?? 0));
  else if (s.param === 'nibble') words.push(String(c.value ?? 0));
  return words.join(' ');
}
