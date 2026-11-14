/**
 * Backward frames and what they mean for each kind of query (`docs/research/dali.md` section 10).
 */
import { spec } from './commands.ts';
import type { Command } from './codec.ts';

/** What the bus delivered after a forward frame. */
export type BusReply =
  | { readonly kind: 'none' }
  | { readonly kind: 'value'; readonly byte: number }
  | { readonly kind: 'collision' };

export type Reply =
  | { readonly kind: 'no-reply-expected' }
  | { readonly kind: 'yes' }
  | { readonly kind: 'no' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'collision' };

/**
 * Interpret a backward frame for a command. A yes/no query is "yes" for any backward frame and "no"
 * for silence. A value query with silence is `missing`. Two answers at once are a collision.
 */
export function decodeReply(cmd: Command, bus: BusReply): Reply {
  const s = spec(cmd.id);
  if (s.reply === 'none') return { kind: 'no-reply-expected' };
  if (bus.kind === 'collision') return { kind: 'collision' };
  if (s.reply === 'yesno') return bus.kind === 'value' ? { kind: 'yes' } : { kind: 'no' };
  return bus.kind === 'value' ? { kind: 'value', value: bus.byte } : { kind: 'missing' };
}

export interface Status {
  readonly gearFailure: boolean;
  readonly lampFailure: boolean;
  readonly lampOn: boolean;
  readonly limitError: boolean;
  readonly fadeRunning: boolean;
  readonly resetState: boolean;
  readonly missingShortAddress: boolean;
  readonly powerFailure: boolean;
}

export function decodeStatus(byte: number): Status {
  const bit = (n: number) => (byte & (1 << n)) !== 0;
  return {
    gearFailure: bit(0),
    lampFailure: bit(1),
    lampOn: bit(2),
    limitError: bit(3),
    fadeRunning: bit(4),
    resetState: bit(5),
    missingShortAddress: bit(6),
    powerFailure: bit(7),
  };
}

export function encodeStatus(s: Status): number {
  const flags = [
    s.gearFailure,
    s.lampFailure,
    s.lampOn,
    s.limitError,
    s.fadeRunning,
    s.resetState,
    s.missingShortAddress,
    s.powerFailure,
  ];
  return flags.reduce((acc, on, i) => (on ? acc | (1 << i) : acc), 0);
}

/** QUERY FADE TIME/FADE RATE: high four bits the fade time, low four bits the fade rate. */
export function decodeFadeTimeRate(byte: number): { fadeTime: number; fadeRate: number } {
  return { fadeTime: (byte >> 4) & 0x0f, fadeRate: byte & 0x0f };
}

export interface ColourTypeFeatures {
  readonly xy: boolean;
  readonly tc: boolean;
  readonly primaries: number;
  readonly rgbwafChannels: number;
}

/** QUERY COLOUR TYPE FEATURES (`dali.md` section 11). */
export function decodeColourTypeFeatures(byte: number): ColourTypeFeatures {
  return {
    xy: (byte & 1) !== 0,
    tc: (byte & 2) !== 0,
    primaries: (byte >> 2) & 7,
    rgbwafChannels: (byte >> 5) & 7,
  };
}

export function encodeColourTypeFeatures(f: ColourTypeFeatures): number {
  return (f.xy ? 1 : 0) | (f.tc ? 2 : 0) | ((f.primaries & 7) << 2) | ((f.rgbwafChannels & 7) << 5);
}
