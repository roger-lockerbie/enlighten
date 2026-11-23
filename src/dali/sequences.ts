/**
 * Frame builders for multi-frame operations (`docs/research/dali.md` sections 11 and 13).
 * Device type commands get ENABLE DEVICE TYPE in front of them, as the hasseb driver sends them.
 */
import type { Address } from './address.ts';
import { encode, enableDeviceTypeFrame, type Command, type Frame } from './codec.ts';

export interface TxFrame {
  readonly frame: Frame;
  readonly sendTwice: boolean;
  readonly expectReply: boolean;
}

/** One command as frames: ENABLE DEVICE TYPE first when it needs one. */
export function framesFor(cmd: Command): TxFrame[] {
  const e = encode(cmd);
  const main: TxFrame = { frame: e.frame, sendTwice: e.sendTwice, expectReply: e.reply !== 'none' };
  if (e.deviceType === 0) return [main];
  return [
    { frame: enableDeviceTypeFrame(e.deviceType), sendTwice: false, expectReply: false },
    main,
  ];
}

export function framesForAll(cmds: readonly Command[]): TxFrame[] {
  return cmds.flatMap(framesFor);
}

const dtr = (n: 0 | 1 | 2, value: number): Command => ({
  id: n === 0 ? 'DTR0' : n === 1 ? 'DTR1' : 'DTR2',
  value,
});

/** Mirek from kelvin, rounded to nearest (`dali.md` section 11). */
export function kelvinToMirek(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

export function mirekToKelvin(mirek: number): number {
  return mirek > 0 ? 1_000_000 / mirek : 0;
}

/** DTR0, DTR1, SET TEMPORARY COLOUR TEMPERATURE, and ACTIVATE unless the caller relies on automatic activation. */
export function tcCommands(address: Address, mirek: number, activate = true): Command[] {
  const m = Math.max(0, Math.min(0xffff, Math.round(mirek)));
  const out: Command[] = [
    dtr(0, m & 0xff),
    dtr(1, m >> 8),
    { id: 'DT8_SET_TEMPORARY_TC', address },
  ];
  if (activate) out.push({ id: 'DT8_ACTIVATE', address });
  return out;
}

/** RGB then WAF, each 0 to 254 or 255 for no change, then ACTIVATE (as `tools/first_light.py`). */
export function rgbwafCommands(
  address: Address,
  mix: readonly [number, number, number, number, number, number],
  activate = true,
): Command[] {
  const [r, g, b, w, a, f] = mix;
  const out: Command[] = [
    dtr(0, r),
    dtr(1, g),
    dtr(2, b),
    { id: 'DT8_SET_TEMPORARY_RGB', address },
    dtr(0, w),
    dtr(1, a),
    dtr(2, f),
    { id: 'DT8_SET_TEMPORARY_WAF', address },
  ];
  if (activate) out.push({ id: 'DT8_ACTIVATE', address });
  return out;
}

/**
 * Set the fade a driver uses: a standard fade time 0 to 15, or the fade time set to 0 and then an
 * extended fade byte (`dali.md` section 7).
 */
export function fadeCommands(
  address: Address,
  fade: { readonly kind: 'standard' | 'extended'; readonly value: number },
): Command[] {
  if (fade.kind === 'standard') return [dtr(0, fade.value), { id: 'SET_FADE_TIME', address }];
  return [
    dtr(0, 0),
    { id: 'SET_FADE_TIME', address },
    dtr(0, fade.value),
    { id: 'SET_EXTENDED_FADE_TIME', address },
  ];
}

/** Read a 16-bit colour value: QUERY ACTUAL LEVEL, DTR0 = selector, QUERY COLOUR VALUE, QUERY CONTENT DTR0. */
export function queryColourValueCommands(address: Address, selector: number): Command[] {
  return [
    { id: 'QUERY_ACTUAL_LEVEL', address },
    dtr(0, selector),
    { id: 'DT8_QUERY_COLOUR_VALUE', address },
    { id: 'QUERY_CONTENT_DTR0', address },
  ];
}

/** Set the search address and COMPARE. */
export function compareCommands(search: number): Command[] {
  return [
    { id: 'SEARCHADDRH', value: (search >> 16) & 0xff },
    { id: 'SEARCHADDRM', value: (search >> 8) & 0xff },
    { id: 'SEARCHADDRL', value: search & 0xff },
    { id: 'COMPARE' },
  ];
}

/** INITIALISE's data byte: all gear, gear without a short address, or one short address. */
export function initialiseData(target: 'all' | 'unaddressed' | number): number {
  if (target === 'all') return 0;
  if (target === 'unaddressed') return 0xff;
  return (target << 1) | 1;
}

/** The data byte for PROGRAM and VERIFY SHORT ADDRESS: (a << 1) | 1, or 0xFF to clear. */
export function shortAddressData(a: number | 'none'): number {
  return a === 'none' ? 0xff : (a << 1) | 1;
}
