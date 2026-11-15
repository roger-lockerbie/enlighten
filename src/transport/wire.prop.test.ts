/** The server protocol's codec: every message round-trips, and nothing else decodes. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseToken } from '../engine/protocol.ts';
import {
  decodeClient,
  decodeServer,
  encodeClient,
  encodeServer,
  PROTOCOL_VERSION,
  TOKEN_BYTES,
  type ClientMessage,
  type ServerMessage,
  type Status,
} from './wire.ts';

const runs = Number(process.env['PROP_RUNS'] ?? 200);
const u8 = fc.integer({ min: 0, max: 255 });
const token = fc.uint8Array({ minLength: TOKEN_BYTES, maxLength: TOKEN_BYTES });
const status = fc.integer({ min: 0, max: 6 }) as fc.Arbitrary<Status>;

const client: fc.Arbitrary<ClientMessage> = fc.oneof(
  fc.record({ type: fc.constant('hello' as const), version: u8, token }),
  fc.record({
    type: fc.constant('send' as const),
    seq: fc.integer({ min: 0, max: 0xffff }),
    expectReply: fc.boolean(),
    sendTwice: fc.boolean(),
    frame: fc.record({ a: u8, b: u8 }),
  }),
  fc.constant({ type: 'ping' as const }),
  fc.constant({ type: 'panic' as const }),
);

const server: fc.Arbitrary<ServerMessage> = fc.oneof(
  fc.record({
    type: fc.constant('welcome' as const),
    version: u8,
    fwMajor: u8,
    fwMinor: u8,
    attached: fc.boolean(),
    token,
  }),
  fc.record({
    type: fc.constant('result' as const),
    seq: fc.integer({ min: 0, max: 0xffff }),
    status,
    data: u8,
  }),
  fc.record({ type: fc.constant('device' as const), attached: fc.boolean() }),
  fc.record({ type: fc.constant('stopped' as const), terminate: status, off: status }),
  fc.record({ type: fc.constant('close' as const), reason: u8 }),
);

const same = (x: Uint8Array, y: Uint8Array): boolean =>
  x.length === y.length && x.every((v, i) => v === y[i]);

describe('wire codec', () => {
  it('round-trips every client message', () => {
    fc.assert(
      fc.property(client, (m) => {
        expect(decodeClient(encodeClient(m))).toEqual(m);
      }),
      { numRuns: runs },
    );
  });

  it('round-trips every server message', () => {
    fc.assert(
      fc.property(server, (m) => {
        expect(decodeServer(encodeServer(m))).toEqual(m);
      }),
      { numRuns: runs },
    );
  });

  it('decodes a byte string only when it is exactly what encoding gives', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 70 }), (b) => {
        const c = decodeClient(b);
        if (c !== undefined) expect(same(encodeClient(c), b)).toBe(true);
        const s = decodeServer(b);
        if (s !== undefined) expect(same(encodeServer(s), b)).toBe(true);
      }),
      { numRuns: runs * 10 },
    );
  });

  it('has the lengths SPEC section 9 gives', () => {
    const t = new Uint8Array(TOKEN_BYTES);
    expect(encodeClient({ type: 'hello', version: PROTOCOL_VERSION, token: t })).toHaveLength(34);
    expect(
      encodeClient({
        type: 'send',
        seq: 0x1234,
        expectReply: true,
        sendTwice: true,
        frame: { a: 1, b: 2 },
      }),
    ).toEqual(Uint8Array.of(0x02, 0x12, 0x34, 3, 1, 2));
    expect(encodeClient({ type: 'ping' })).toEqual(Uint8Array.of(0x03));
    expect(encodeClient({ type: 'panic' })).toEqual(Uint8Array.of(0x04));
    expect(
      encodeServer({
        type: 'welcome',
        version: 1,
        fwMajor: 2,
        fwMinor: 4,
        attached: true,
        token: t,
      }),
    ).toHaveLength(37);
    expect(encodeServer({ type: 'result', seq: 0x0102, status: 2, data: 9 })).toEqual(
      Uint8Array.of(0x82, 1, 2, 2, 9),
    );
    expect(encodeServer({ type: 'stopped', terminate: 0, off: 4 })).toEqual(
      Uint8Array.of(0x84, 0, 4),
    );
  });

  it('refuses flags with other bits set, bad statuses and bad booleans', () => {
    expect(decodeClient(Uint8Array.of(0x02, 0, 0, 4, 0, 0))).toBeUndefined();
    expect(decodeServer(Uint8Array.of(0x82, 0, 0, 7, 0))).toBeUndefined();
    expect(decodeServer(Uint8Array.of(0x83, 2))).toBeUndefined();
    expect(decodeServer(Uint8Array.of(0x84, 0, 9))).toBeUndefined();
    expect(decodeClient(new Uint8Array())).toBeUndefined();
    expect(decodeServer(new Uint8Array())).toBeUndefined();
  });

  it('refuses to encode values out of range', () => {
    expect(() => encodeClient({ type: 'hello', version: 1, token: new Uint8Array(3) })).toThrow();
    expect(() =>
      encodeClient({
        type: 'send',
        seq: 70_000,
        expectReply: false,
        sendTwice: false,
        frame: { a: 0, b: 0 },
      }),
    ).toThrow();
    expect(() => encodeServer({ type: 'result', seq: 1, status: 9 as Status, data: 0 })).toThrow();
    expect(() => encodeServer({ type: 'close', reason: 300 })).toThrow();
    expect(() => encodeServer({ type: 'stopped', terminate: 8 as Status, off: 0 })).toThrow();
    expect(() =>
      encodeServer({
        type: 'welcome',
        version: 1,
        fwMajor: 256,
        fwMinor: 0,
        attached: false,
        token: new Uint8Array(32),
      }),
    ).toThrow();
  });

  it('parses only a 64-character lowercase hex token', () => {
    const hex = 'ab'.repeat(32);
    expect(parseToken(hex)).toEqual(new Uint8Array(32).fill(0xab));
    expect(parseToken('AB'.repeat(32))).toBeUndefined();
    expect(parseToken('ab'.repeat(31))).toBeUndefined();
    expect(parseToken(`${hex}0`)).toBeUndefined();
    expect(parseToken('zz'.repeat(32))).toBeUndefined();
  });
});
