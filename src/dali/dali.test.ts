/** U-dali: addresses, the command table, the codec, replies, the curve and fades. */
import { describe, expect, it } from 'vitest';
import {
  addressByte,
  addressText,
  broadcast,
  decodeAddressByte,
  group,
  sameAddress,
  short,
  unaddressed,
} from './address.ts';
import { COMMANDS, hasSpec, spec } from './commands.ts';
import {
  commandText,
  decode,
  decodeSpec,
  encode,
  enabledDeviceType,
  frameEquals,
  frameText,
} from './codec.ts';
import { arcToFraction, fractionToArcFloor, percentToArcFloor, STEP_RATIO } from './curve.ts';
import { extendedFadeMs, fadeRateStepsPerSecond, fadeTimeMs, fastFadeMs } from './fade.ts';
import {
  decodeColourTypeFeatures,
  decodeFadeTimeRate,
  decodeReply,
  decodeStatus,
  encodeColourTypeFeatures,
  encodeStatus,
} from './reply.ts';
import {
  compareCommands,
  framesFor,
  initialiseData,
  kelvinToMirek,
  mirekToKelvin,
  shortAddressData,
  tcCommands,
} from './sequences.ts';

describe('addresses', () => {
  it('encodes each kind with the selector bit', () => {
    expect(addressByte(short(0), 0)).toBe(0x00);
    expect(addressByte(short(63), 1)).toBe(0x7f);
    expect(addressByte(group(15), 1)).toBe(0x9f);
    expect(addressByte(broadcast, 0)).toBe(0xfe);
    expect(addressByte(unaddressed, 1)).toBe(0xfd);
  });
  it('refuses out-of-range addresses', () => {
    expect(() => addressByte(short(64), 0)).toThrow(RangeError);
    expect(() => addressByte(group(16), 0)).toThrow(RangeError);
    expect(() => addressByte(short(1.5), 0)).toThrow(RangeError);
  });
  it('decodes, and leaves special and reserved bytes alone', () => {
    expect(decodeAddressByte(0x4b)).toEqual(short(37));
    expect(decodeAddressByte(0x8b)).toEqual(group(5));
    expect(decodeAddressByte(0xa1)).toBeUndefined();
    expect(decodeAddressByte(0xfb)).toBeUndefined();
    expect(decodeAddressByte(0xfc)).toEqual(unaddressed);
    expect(decodeAddressByte(0xff)).toEqual(broadcast);
  });
  it('compares and prints', () => {
    expect(sameAddress(short(1), short(1))).toBe(true);
    expect(sameAddress(short(1), group(1))).toBe(false);
    expect(sameAddress(broadcast, broadcast)).toBe(true);
    expect(sameAddress(group(2), group(3))).toBe(false);
    expect([short(4), group(2), broadcast, unaddressed].map(addressText)).toEqual([
      'A4',
      'G2',
      'BC',
      'BC-unaddressed',
    ]);
  });
});

describe('command table', () => {
  it('has unique ids and python-dali names', () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    expect(new Set(COMMANDS.map((c) => c.pd)).size).toBe(COMMANDS.length);
  });
  it('looks up by id', () => {
    expect(spec('SET_MAX_LEVEL').reads).toEqual([0]);
    expect(hasSpec('NOPE')).toBe(false);
    expect(() => spec('NOPE')).toThrow(RangeError);
  });
  it('records which registers gear can write (dali.md section 6)', () => {
    const writers = COMMANDS.filter((c) => c.gearWrites.length > 0).map((c) => c.id);
    expect(writers.sort()).toEqual(
      [
        'STORE_ACTUAL_LEVEL_IN_DTR0',
        'QUERY_LIGHT_SOURCE_TYPE',
        'READ_MEMORY_LOCATION',
        'WRITE_MEMORY_LOCATION',
        'WRITE_MEMORY_LOCATION_NO_REPLY',
        'DT8_QUERY_COLOUR_VALUE',
      ].sort(),
    );
    expect(spec('DT8_SET_TEMPORARY_RGB').reads).toEqual([0, 1, 2]);
    expect(spec('DT8_SET_TEMPORARY_TC').reads).toEqual([0, 1]);
    expect(spec('DTR2').sets).toBe(2);
  });
});

describe('codec', () => {
  it('refuses commands it cannot encode', () => {
    expect(() => encode({ id: 'OFF' })).toThrow(/address/);
    expect(() => encode({ id: 'DAPC', address: short(0) })).toThrow(/level/);
    expect(() => encode({ id: 'DAPC', address: short(0), value: 256 })).toThrow(/level/);
    expect(() => encode({ id: 'GO_TO_SCENE', address: short(0), value: 16 })).toThrow(/0 to 15/);
    expect(() => encode({ id: 'GO_TO_SCENE', address: short(0) })).toThrow(/0 to 15/);
    expect(() => encode({ id: 'GO_TO_SCENE', address: short(0), value: 1.5 })).toThrow(/0 to 15/);
    expect(() => encode({ id: 'GO_TO_SCENE', address: short(0), value: -1 })).toThrow(/0 to 15/);
    expect(() => encode({ id: 'DAPC', address: short(0), value: 2.5 })).toThrow(/level/);
    expect(() => encode({ id: 'OFF', address: short(0), value: 1 })).toThrow(/no value/);
    expect(() => encode({ id: 'TERMINATE', value: 1 })).toThrow(/data byte/);
    expect(() => encode({ id: 'DTR0', value: 256 })).toThrow(/data byte/);
    expect(() => encode({ id: 'DTR0', value: 1, address: short(0) })).toThrow(/no address/);
    expect(() => encode({ id: 'PROGRAM_SHORT_ADDRESS', value: 2 })).toThrow(/data byte/);
    expect(() => encode({ id: 'INITIALISE', value: 0x80 })).toThrow(/data byte/);
  });
  it('decodes device type commands only after ENABLE DEVICE TYPE', () => {
    const f = { a: 0x03, b: 226 };
    expect(decode(f)).toBeUndefined();
    expect(decode(f, { a: 0xc1, b: 8 })?.id).toBe('DT8_ACTIVATE');
    expect(decode(f, { a: 0xc1, b: 6 })?.id).toBe('DT6_DISABLE_CURRENT_PROTECTOR');
    expect(decode(f, { a: 0xc1, b: 7 })).toBeUndefined();
    expect(decode({ a: 0x03, b: 0 }, { a: 0xc1, b: 8 })?.id).toBe('OFF');
    expect(enabledDeviceType({ a: 0xc1, b: 8 })).toBe(8);
    expect(enabledDeviceType({ a: 0xc3, b: 8 })).toBeUndefined();
    expect(enabledDeviceType(undefined)).toBeUndefined();
  });
  it('compares frames by both bytes', () => {
    expect(frameEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(frameEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(frameEquals({ a: 1, b: 2 }, { a: 0, b: 2 })).toBe(false);
  });
  it('decodes a frame to its table row', () => {
    expect(decodeSpec({ a: 0x01, b: 0x00 })?.id).toBe('OFF');
    expect(decodeSpec({ a: 0x03, b: 226 }, { a: 0xc1, b: 8 })?.id).toBe('DT8_ACTIVATE');
    expect(decodeSpec({ a: 0x03, b: 226 })).toBeUndefined();
  });
  it('refuses frames that are not bytes', () => {
    expect(decode({ a: 256, b: 0 })).toBeUndefined();
    expect(decode({ a: 0, b: -1 })).toBeUndefined();
  });
  it('prints frames and commands', () => {
    expect(frameText({ a: 0x0a, b: 0xff })).toBe('0A FF');
    expect(commandText({ id: 'DAPC', address: short(3), value: 220 })).toBe('DAPC A3 220');
    expect(commandText({ id: 'GO_TO_SCENE', address: group(2), value: 4 })).toBe(
      'GO TO SCENE G2 4',
    );
    expect(commandText({ id: 'OFF', address: broadcast })).toBe('OFF BC');
    expect(commandText({ id: 'OFF', address: unaddressed })).toBe('OFF BC-unaddressed');
    expect(commandText({ id: 'TERMINATE' })).toBe('TERMINATE');
  });
});

describe('replies', () => {
  const q = { id: 'QUERY_ACTUAL_LEVEL', address: short(0) };
  const yn = { id: 'QUERY_CONTROL_GEAR_PRESENT', address: short(0) };
  it('maps the bus to typed replies', () => {
    expect(decodeReply({ id: 'OFF', address: short(0) }, { kind: 'none' })).toEqual({
      kind: 'no-reply-expected',
    });
    expect(decodeReply(q, { kind: 'value', byte: 200 })).toEqual({ kind: 'value', value: 200 });
    expect(decodeReply(q, { kind: 'none' })).toEqual({ kind: 'missing' });
    expect(decodeReply(q, { kind: 'collision' })).toEqual({ kind: 'collision' });
    expect(decodeReply(yn, { kind: 'value', byte: 0xff })).toEqual({ kind: 'yes' });
    expect(decodeReply(yn, { kind: 'none' })).toEqual({ kind: 'no' });
  });
  it('decodes status, fade and colour type bytes', () => {
    const s = decodeStatus(0b1001_0100);
    expect(s.lampOn && s.fadeRunning && s.powerFailure).toBe(true);
    expect(s.gearFailure || s.limitError || s.resetState).toBe(false);
    for (let b = 0; b < 256; b++) expect(encodeStatus(decodeStatus(b))).toBe(b);
    expect(decodeFadeTimeRate(0x47)).toEqual({ fadeTime: 4, fadeRate: 7 });
    expect(decodeColourTypeFeatures(0b1010_0010)).toEqual({
      xy: false,
      tc: true,
      primaries: 0,
      rgbwafChannels: 5,
    });
    for (let b = 0; b < 256; b++)
      expect(encodeColourTypeFeatures(decodeColourTypeFeatures(b))).toBe(b);
  });
});

describe('curve (dali.md section 2)', () => {
  it('matches the research table', () => {
    expect(arcToFraction(0)).toBe(0);
    expect(arcToFraction(1)).toBeCloseTo(0.001, 6);
    expect(arcToFraction(254)).toBeCloseTo(1, 9);
    expect(arcToFraction(300)).toBeCloseTo(1, 9);
    expect(arcToFraction(85) * 100).toBeCloseTo(0.99, 2);
    expect(arcToFraction(127) * 100).toBeCloseTo(3.12, 2);
    expect(arcToFraction(220) * 100).toBeCloseTo(39.5, 1);
    expect(arcToFraction(229) * 100).toBeCloseTo(50.5, 1);
    expect(STEP_RATIO).toBeCloseTo(1.0277, 4);
  });
  it('rounds down for the ceiling (SPEC R6.1)', () => {
    expect(percentToArcFloor(40)).toBe(220);
    expect(percentToArcFloor(100)).toBe(254);
    expect(percentToArcFloor(0)).toBe(0);
    expect(percentToArcFloor(1)).toBe(85);
    expect(fractionToArcFloor(2)).toBe(254);
    for (let l = 1; l <= 254; l++) expect(fractionToArcFloor(arcToFraction(l))).toBe(l);
  });
});

describe('fades (dali.md section 7)', () => {
  it('matches the fade time and rate tables', () => {
    expect(fadeTimeMs(0)).toBe(0);
    expect(fadeTimeMs(1)).toBeCloseTo(707.1, 1);
    expect(fadeTimeMs(4)).toBe(2000);
    expect(fadeTimeMs(15)).toBeCloseTo(90_510, 0);
    expect(fadeRateStepsPerSecond(1)).toBeCloseTo(357.8, 1);
    expect(fadeRateStepsPerSecond(7)).toBeCloseTo(44.7, 1);
    expect(fadeRateStepsPerSecond(15)).toBeCloseTo(2.8, 1);
    expect(fadeRateStepsPerSecond(0)).toBeCloseTo(357.8, 1);
  });
  it('decodes extended fade times, with the gaps', () => {
    expect(extendedFadeMs(0x00)).toBe(0);
    expect(extendedFadeMs(0x10)).toBe(100);
    expect(extendedFadeMs(0x1f)).toBe(1600);
    expect(extendedFadeMs(0x2f)).toBe(16_000);
    expect(extendedFadeMs(0x3f)).toBe(160_000);
    expect(extendedFadeMs(0x42)).toBe(180_000);
    expect(extendedFadeMs(0x4f)).toBe(960_000);
    expect(extendedFadeMs(0x50)).toBe(0);
    expect(fastFadeMs(0)).toBe(0);
    expect(fastFadeMs(4)).toBe(100);
    expect(fastFadeMs(40)).toBe(675);
  });
});

describe('sequences', () => {
  it('adds ENABLE DEVICE TYPE in front of device type commands', () => {
    const f = framesFor({ id: 'DT8_ACTIVATE', address: short(1) });
    expect(f.map((x) => [x.frame.a, x.frame.b])).toEqual([
      [0xc1, 8],
      [0x03, 226],
    ]);
  });
  it('converts colour temperature and builds search frames', () => {
    expect(kelvinToMirek(2700)).toBe(370);
    expect(kelvinToMirek(6500)).toBe(154);
    expect(mirekToKelvin(0)).toBe(0);
    expect(mirekToKelvin(250)).toBe(4000);
    expect(tcCommands(short(0), 370, false).map((c) => c.id)).toEqual([
      'DTR0',
      'DTR1',
      'DT8_SET_TEMPORARY_TC',
    ]);
    expect(compareCommands(0x123456).map((c) => c.value)).toEqual([0x12, 0x34, 0x56, undefined]);
    expect([initialiseData('all'), initialiseData('unaddressed'), initialiseData(3)]).toEqual([
      0, 255, 7,
    ]);
    expect([shortAddressData('none'), shortAddressData(5)]).toEqual([255, 11]);
  });
});
