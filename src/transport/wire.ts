/**
 * The server protocol's messages (SPEC section 9, ADR 0012). Fixed-size binary messages, each starting
 * with a type byte. Integers are big-endian. Anything that is not exactly one of these messages decodes
 * to `undefined`, and the receiver closes the connection.
 */
import type { Frame } from '../dali/codec.ts';

export const PROTOCOL_VERSION = 1;
export const TOKEN_BYTES = 32;

/** RESULT status codes. */
export const Status = {
  sent: 0,
  noReply: 1,
  reply: 2,
  framingError: 3,
  hassebTimeout: 4,
  refused: 5,
  dropped: 6,
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/** CLOSE reason codes. */
export const CloseReason = {
  silence: 1,
  protocolError: 2,
  serverStopping: 3,
  notAuthorised: 4,
  busy: 5,
} as const;
export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason];

export type ClientMessage =
  | { readonly type: 'hello'; readonly version: number; readonly token: Uint8Array }
  | {
      readonly type: 'send';
      readonly seq: number;
      readonly expectReply: boolean;
      readonly sendTwice: boolean;
      readonly frame: Frame;
    }
  | { readonly type: 'ping' }
  | { readonly type: 'panic' };

export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly version: number;
      readonly fwMajor: number;
      readonly fwMinor: number;
      readonly attached: boolean;
      readonly token: Uint8Array;
    }
  | {
      readonly type: 'result';
      readonly seq: number;
      readonly status: Status;
      readonly data: number;
    }
  | { readonly type: 'device'; readonly attached: boolean }
  | { readonly type: 'stopped'; readonly terminate: Status; readonly off: Status }
  | { readonly type: 'close'; readonly reason: number };

const T = {
  hello: 0x01,
  send: 0x02,
  ping: 0x03,
  panic: 0x04,
  welcome: 0x81,
  result: 0x82,
  device: 0x83,
  stopped: 0x84,
  close: 0x8f,
} as const;

const byte = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 255;
const isStatus = (n: number): n is Status => Number.isInteger(n) && n >= 0 && n <= 6;
const isBool = (n: number): boolean => n === 0 || n === 1;

function check(cond: boolean, what: string): void {
  if (!cond) throw new RangeError(`Cannot encode ${what}.`);
}

export function encodeClient(m: ClientMessage): Uint8Array {
  switch (m.type) {
    case 'hello': {
      check(byte(m.version) && m.token.length === TOKEN_BYTES, 'HELLO');
      const out = new Uint8Array(2 + TOKEN_BYTES);
      out[0] = T.hello;
      out[1] = m.version;
      out.set(m.token, 2);
      return out;
    }
    case 'send': {
      check(
        Number.isInteger(m.seq) &&
          m.seq >= 0 &&
          m.seq <= 0xffff &&
          byte(m.frame.a) &&
          byte(m.frame.b),
        'SEND',
      );
      const flags = (m.expectReply ? 1 : 0) | (m.sendTwice ? 2 : 0);
      return Uint8Array.of(T.send, m.seq >> 8, m.seq & 0xff, flags, m.frame.a, m.frame.b);
    }
    case 'ping':
      return Uint8Array.of(T.ping);
    case 'panic':
      return Uint8Array.of(T.panic);
  }
}

export function decodeClient(b: Uint8Array): ClientMessage | undefined {
  const at = (i: number): number => b[i] ?? -1;
  switch (at(0)) {
    case T.hello:
      return b.length === 2 + TOKEN_BYTES
        ? { type: 'hello', version: at(1), token: b.slice(2) }
        : undefined;
    case T.send: {
      const flags = at(3);
      if (b.length !== 6 || (flags & ~3) !== 0) return undefined;
      return {
        type: 'send',
        seq: (at(1) << 8) | at(2),
        expectReply: (flags & 1) !== 0,
        sendTwice: (flags & 2) !== 0,
        frame: { a: at(4), b: at(5) },
      };
    }
    case T.ping:
      return b.length === 1 ? { type: 'ping' } : undefined;
    case T.panic:
      return b.length === 1 ? { type: 'panic' } : undefined;
    default:
      return undefined;
  }
}

export function encodeServer(m: ServerMessage): Uint8Array {
  switch (m.type) {
    case 'welcome': {
      check(
        byte(m.version) && byte(m.fwMajor) && byte(m.fwMinor) && m.token.length === TOKEN_BYTES,
        'WELCOME',
      );
      const out = new Uint8Array(5 + TOKEN_BYTES);
      out.set([T.welcome, m.version, m.fwMajor, m.fwMinor, m.attached ? 1 : 0]);
      out.set(m.token, 5);
      return out;
    }
    case 'result':
      check(
        Number.isInteger(m.seq) &&
          m.seq >= 0 &&
          m.seq <= 0xffff &&
          isStatus(m.status) &&
          byte(m.data),
        'RESULT',
      );
      return Uint8Array.of(T.result, m.seq >> 8, m.seq & 0xff, m.status, m.data);
    case 'device':
      return Uint8Array.of(T.device, m.attached ? 1 : 0);
    case 'stopped':
      check(isStatus(m.terminate) && isStatus(m.off), 'STOPPED');
      return Uint8Array.of(T.stopped, m.terminate, m.off);
    case 'close':
      check(byte(m.reason), 'CLOSE');
      return Uint8Array.of(T.close, m.reason);
  }
}

export function decodeServer(b: Uint8Array): ServerMessage | undefined {
  const at = (i: number): number => b[i] ?? -1;
  switch (at(0)) {
    case T.welcome:
      if (b.length !== 5 + TOKEN_BYTES || !isBool(at(4))) return undefined;
      return {
        type: 'welcome',
        version: at(1),
        fwMajor: at(2),
        fwMinor: at(3),
        attached: at(4) === 1,
        token: b.slice(5),
      };
    case T.result: {
      const status = at(3);
      if (b.length !== 5 || !isStatus(status)) return undefined;
      return { type: 'result', seq: (at(1) << 8) | at(2), status, data: at(4) };
    }
    case T.device:
      return b.length === 2 && isBool(at(1))
        ? { type: 'device', attached: at(1) === 1 }
        : undefined;
    case T.stopped: {
      const t = at(1);
      const o = at(2);
      return b.length === 3 && isStatus(t) && isStatus(o)
        ? { type: 'stopped', terminate: t, off: o }
        : undefined;
    }
    case T.close:
      return b.length === 2 ? { type: 'close', reason: at(1) } : undefined;
    default:
      return undefined;
  }
}

/** The session token from the URL fragment: exactly 64 lowercase hex characters. */
export function parseToken(hex: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
  const out = new Uint8Array(TOKEN_BYTES);
  for (let i = 0; i < TOKEN_BYTES; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
