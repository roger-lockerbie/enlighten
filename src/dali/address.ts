/**
 * DALI control gear addresses and the address byte of a forward frame (`docs/research/dali.md` section 1).
 */

export type Address =
  | { readonly kind: 'short'; readonly n: number }
  | { readonly kind: 'group'; readonly n: number }
  | { readonly kind: 'broadcast' }
  | { readonly kind: 'unaddressed' };

export const short = (n: number): Address => ({ kind: 'short', n });
export const group = (n: number): Address => ({ kind: 'group', n });
export const broadcast: Address = { kind: 'broadcast' };
export const unaddressed: Address = { kind: 'unaddressed' };

export function isValidAddress(a: Address): boolean {
  switch (a.kind) {
    case 'short':
      return Number.isInteger(a.n) && a.n >= 0 && a.n <= 63;
    case 'group':
      return Number.isInteger(a.n) && a.n >= 0 && a.n <= 15;
    default:
      return true;
  }
}

/** The address byte with the selector bit S (0 for DAPC, 1 for a command). */
export function addressByte(a: Address, selector: 0 | 1): number {
  if (!isValidAddress(a)) throw new RangeError(`invalid address ${addressText(a)}`);
  switch (a.kind) {
    case 'short':
      return (a.n << 1) | selector;
    case 'group':
      return 0x80 | (a.n << 1) | selector;
    case 'broadcast':
      return 0xfe | selector;
    case 'unaddressed':
      return 0xfc | selector;
  }
}

/** Decode the address part of a first byte, or undefined for a special command or a reserved byte. */
export function decodeAddressByte(byte: number): Address | undefined {
  if (byte <= 0x7f) return short(byte >> 1);
  if (byte <= 0x9f) return group((byte >> 1) & 0x0f);
  if (byte === 0xfc || byte === 0xfd) return unaddressed;
  if (byte === 0xfe || byte === 0xff) return broadcast;
  return undefined;
}

export function sameAddress(a: Address, b: Address): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'short' || a.kind === 'group') return a.n === (b as typeof a).n;
  return true;
}

export function addressText(a: Address): string {
  switch (a.kind) {
    case 'short':
      return `A${String(a.n)}`;
    case 'group':
      return `G${String(a.n)}`;
    case 'broadcast':
      return 'BC';
    case 'unaddressed':
      return 'BC-unaddressed';
  }
}
