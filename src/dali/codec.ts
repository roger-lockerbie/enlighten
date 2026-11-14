/**
 * Encode commands to 16-bit forward frames and decode frames back, byte for byte as python-dali does
 * (`tests/golden/frames.json` and `decode.json`).
 */
import { addressByte, decodeAddressByte, isValidAddress, type Address } from './address.ts';
import {
  DT6_BY_OPCODE,
  DT8_BY_OPCODE,
  SPECIAL_BY_OPCODE,
  STANDARD_BY_OPCODE,
  spec,
  type CommandSpec,
  type ReplyKind,
} from './commands.ts';

/** A 16-bit forward frame: `a` is the address byte (or a special command), `b` the data byte. */
export interface Frame {
  readonly a: number;
  readonly b: number;
}

export interface Command {
  readonly id: string;
  readonly address?: Address;
  /** DAPC level, scene or group number, or a special command's data byte. */
  readonly value?: number;
}

export interface Encoded {
  readonly frame: Frame;
  readonly sendTwice: boolean;
  readonly reply: ReplyKind;
  /** Device type the command needs ENABLE DEVICE TYPE for, or 0. */
  readonly deviceType: 0 | 6 | 8;
}

export const frameEquals = (x: Frame, y: Frame): boolean => x.a === y.a && x.b === y.b;

export function frameText(f: Frame): string {
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `${h(f.a)} ${h(f.b)}`;
}

function isByte(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

/** True when a special command's data byte is valid for its parameter kind. */
function validSpecialData(s: CommandSpec, b: number): boolean {
  switch (s.param) {
    case 'none':
      return b === 0;
    case 'byte':
      return true;
    case 'shortAddress':
      return b === 0xff || (b & 0x81) === 0x01;
    case 'initialise':
      return b === 0 || b === 0xff || (b & 0x81) === 0x01;
    default:
      return false;
  }
}

export function encode(cmd: Command): Encoded {
  const s = spec(cmd.id);
  const out = (a: number, b: number): Encoded => ({
    frame: { a, b },
    sendTwice: s.sendTwice,
    reply: s.reply,
    deviceType: s.deviceType,
  });
  if (s.kind === 'special') {
    const b = cmd.value ?? 0;
    if (!isByte(b) || !validSpecialData(s, b)) {
      throw new RangeError(`${s.label}: invalid data byte ${String(cmd.value)}`);
    }
    if (cmd.address !== undefined) throw new RangeError(`${s.label} takes no address`);
    return out(s.opcode, b);
  }
  if (cmd.address === undefined || !isValidAddress(cmd.address)) {
    throw new RangeError(`${s.label} needs a valid address`);
  }
  if (s.kind === 'dapc') {
    const level = cmd.value;
    if (level === undefined || !isByte(level)) throw new RangeError('DAPC level must be 0 to 255');
    return out(addressByte(cmd.address, 0), level);
  }
  let b = s.opcode;
  if (s.param === 'nibble') {
    const n = cmd.value;
    if (n === undefined || !Number.isInteger(n) || n < 0 || n > 15) {
      throw new RangeError(`${s.label} needs a number from 0 to 15`);
    }
    b += n;
  } else if (cmd.value !== undefined) {
    throw new RangeError(`${s.label} takes no value`);
  }
  return out(addressByte(cmd.address, 1), b);
}

/** ENABLE DEVICE TYPE n, as a frame. */
export function enableDeviceTypeFrame(deviceType: number): Frame {
  return encode({ id: 'ENABLE_DEVICE_TYPE', value: deviceType }).frame;
}

/** The device type a frame enables for the frame after it, if it is ENABLE DEVICE TYPE. */
export function enabledDeviceType(f: Frame | undefined): number | undefined {
  return f?.a === 0xc1 ? f.b : undefined;
}

/**
 * Decode a forward frame. `previous` is the frame before it on the bus, which decides whether a
 * command number of 224 to 255 is a device type command. Returns undefined for a frame that is not a
 * supported command.
 *
 * One deliberate difference from python-dali: after ENABLE DEVICE TYPE, a command number below 224
 * still decodes as the part 102 command. python-dali's decoder gives none there, but the standard
 * applies ENABLE DEVICE TYPE only to the application extended commands.
 */
export function decode(frame: Frame, previous?: Frame): Command | undefined {
  const { a, b } = frame;
  if (!isByte(a) || !isByte(b)) return undefined;
  const special = SPECIAL_BY_OPCODE.get(a);
  if (special !== undefined) {
    if (!validSpecialData(special, b)) return undefined;
    return special.param === 'none' ? { id: special.id } : { id: special.id, value: b };
  }
  const address = decodeAddressByte(a);
  if (address === undefined) return undefined;
  if ((a & 1) === 0) return { id: 'DAPC', address, value: b };
  let s: CommandSpec | undefined;
  if (b >= 224) {
    const dt = enabledDeviceType(previous);
    if (dt === 6) s = DT6_BY_OPCODE.get(b);
    else if (dt === 8) s = DT8_BY_OPCODE.get(b);
  } else {
    s = STANDARD_BY_OPCODE.get(b);
  }
  if (s === undefined) return undefined;
  if (s.param === 'nibble') return { id: s.id, address, value: b - s.opcode };
  return { id: s.id, address };
}

export function decodeSpec(frame: Frame, previous?: Frame): CommandSpec | undefined {
  const c = decode(frame, previous);
  return c === undefined ? undefined : spec(c.id);
}

export function commandText(c: Command): string {
  const s = spec(c.id);
  const parts: string[] = [s.label];
  if (c.address !== undefined) {
    const ad = c.address;
    parts.push(
      ad.kind === 'short'
        ? `A${String(ad.n)}`
        : ad.kind === 'group'
          ? `G${String(ad.n)}`
          : ad.kind === 'broadcast'
            ? 'BC'
            : 'BC-unaddressed',
    );
  }
  if (c.value !== undefined) parts.push(String(c.value));
  return parts.join(' ');
}
