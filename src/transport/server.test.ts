/** U-engine: the server transport against a scripted socket on a virtual clock. */
import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../bus/clock.ts';
import { PANIC_FRAMES } from '../bus/scheduler.ts';
import { short } from '../dali/address.ts';
import { framesFor, type TxFrame } from '../dali/sequences.ts';
import type { TransportState } from '../engine/transport.ts';
import {
  CONNECT_TIMEOUT_MS,
  PING_MS,
  RESULT_TIMEOUT_MS,
  resultOf,
  ServerTransport,
  STOP_TIMEOUT_MS,
  type WebSocketLike,
} from './server.ts';
import {
  decodeClient,
  encodeServer,
  Status,
  type ClientMessage,
  type ServerMessage,
} from './wire.ts';

class FakeSocket implements WebSocketLike {
  binaryType = '';
  sent: ClientMessage[] = [];
  raw: Uint8Array[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: Uint8Array): void {
    this.raw.push(data);
    const m = decodeClient(data);
    if (m === undefined) throw new Error('the transport sent a bad message');
    this.sent.push(m);
  }
  close(): void {
    this.closed = true;
  }
  reply(m: ServerMessage): void {
    this.onmessage?.({ data: encodeServer(m).buffer });
  }
  types(): string[] {
    return this.sent.map((m) => m.type);
  }
}

const TOKEN = new Uint8Array(32).fill(7);
const FRESH = new Uint8Array(32).fill(9);
const welcome = (attached = true): ServerMessage => ({
  type: 'welcome',
  version: 1,
  fwMajor: 2,
  fwMinor: 4,
  attached,
  token: FRESH,
});

function setup() {
  const clock = new VirtualClock(0);
  const sockets: FakeSocket[] = [];
  const states: [TransportState, string | undefined][] = [];
  const devices: boolean[] = [];
  const t = new ServerTransport({
    clock,
    token: TOKEN,
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onState: (s, r) => states.push([s, r]),
    onDevice: (a) => devices.push(a),
  });
  const sock = (): FakeSocket => {
    const s = sockets[sockets.length - 1];
    if (s === undefined) throw new Error('no socket');
    return s;
  };
  const connect = async () => {
    const p = t.connect();
    sock().onopen?.();
    sock().reply(welcome());
    await p;
  };
  return { clock, t, sockets, sock, states, devices, connect };
}

function first<T>(xs: readonly T[], k = 0): T {
  const x = xs[k];
  if (x === undefined) throw new Error('missing');
  return x;
}

const query = first(framesFor({ id: 'QUERY_ACTUAL_LEVEL', address: short(0) }));
const config = first(framesFor({ id: 'SET_MAX_LEVEL', address: short(0) }));

describe('ServerTransport', () => {
  it('says HELLO with the URL token first, and keeps the fresh token for reconnects', async () => {
    const { t, sock, sockets, connect, states } = setup();
    await connect();
    expect(sock().binaryType).toBe('arraybuffer');
    expect(sock().sent[0]).toEqual({ type: 'hello', version: 1, token: TOKEN });
    expect(t.state()).toBe('ready');
    expect(t.info()).toEqual({ fwMajor: 2, fwMinor: 4, attached: true });
    await t.disconnect();
    expect(sock().closed).toBe(true);
    const again = t.connect();
    sock().onopen?.();
    expect(sock().sent[0]).toEqual({ type: 'hello', version: 1, token: FRESH });
    sock().reply(welcome());
    await again;
    expect(sockets).toHaveLength(2);
    expect(states.map((s) => s[0])).toEqual(['connecting', 'ready', 'down', 'connecting', 'ready']);
  });

  it('sends frames with their flags and sequence numbers, and maps each status', async () => {
    const { t, sock, connect } = setup();
    await connect();
    const p1 = t.send(query);
    const p2 = t.send(config);
    expect(sock().sent.slice(1)).toEqual([
      { type: 'send', seq: 0, expectReply: true, sendTwice: false, frame: query.frame },
      { type: 'send', seq: 1, expectReply: false, sendTwice: true, frame: config.frame },
    ]);
    // Results may come back in any order: each matches its own sequence number.
    sock().reply({ type: 'result', seq: 1, status: Status.sent, data: 0 });
    sock().reply({ type: 'result', seq: 0, status: Status.reply, data: 123 });
    expect(await p1).toEqual({ kind: 'reply', byte: 123 });
    expect(await p2).toEqual({ kind: 'sent' });
  });

  it('maps every RESULT status, and treats a dropped frame as not sent', () => {
    expect(resultOf(Status.sent, 0)).toEqual({ kind: 'sent' });
    expect(resultOf(Status.noReply, 0)).toEqual({ kind: 'no-reply' });
    expect(resultOf(Status.reply, 5)).toEqual({ kind: 'reply', byte: 5 });
    expect(resultOf(Status.framingError, 0)).toEqual({ kind: 'framing-error' });
    expect(resultOf(Status.hassebTimeout, 0).kind).toBe('fault');
    expect(resultOf(Status.refused, 0).kind).toBe('refused');
    expect(resultOf(Status.dropped, 0).kind).toBe('refused');
  });

  it('makes a missing result a fault, and ignores it if it comes late', async () => {
    const { t, clock, sock, connect } = setup();
    await connect();
    const p = t.send(query);
    await clock.advance(RESULT_TIMEOUT_MS);
    expect((await p).kind).toBe('fault');
    sock().reply({ type: 'result', seq: 0, status: Status.reply, data: 1 });
    expect(t.state()).toBe('ready');
  });

  it('refuses to send when not connected', async () => {
    const { t } = setup();
    expect((await t.send(query)).kind).toBe('fault');
    expect((await t.sendPanic(first(PANIC_FRAMES))).kind).toBe('fault');
  });

  it('pings every second while connected', async () => {
    const { t, clock, sock, connect } = setup();
    await connect();
    await clock.advance(PING_MS * 3 + 1);
    expect(
      sock()
        .types()
        .filter((x) => x === 'ping'),
    ).toHaveLength(3);
    await t.disconnect();
    await clock.advance(PING_MS * 3);
    expect(
      sock()
        .types()
        .filter((x) => x === 'ping'),
    ).toHaveLength(3);
  });

  it('turns panic into one PANIC message and answers both frames from STOPPED', async () => {
    const { t, sock, connect } = setup();
    await connect();
    const [term, off] = PANIC_FRAMES as [TxFrame, TxFrame];
    const a = t.sendPanic(term);
    expect(sock().types().slice(1)).toEqual(['panic']);
    sock().reply({ type: 'stopped', terminate: Status.sent, off: Status.hassebTimeout });
    expect(await a).toEqual({ kind: 'sent' });
    const b = await t.sendPanic(off);
    expect(b.kind).toBe('fault');
    expect(
      sock()
        .types()
        .filter((x) => x === 'panic'),
    ).toHaveLength(1);
    // A later panic sends a new PANIC.
    const c = t.sendPanic(term);
    expect(
      sock()
        .types()
        .filter((x) => x === 'panic'),
    ).toHaveLength(2);
    sock().reply({ type: 'stopped', terminate: Status.sent, off: Status.sent });
    expect(await c).toEqual({ kind: 'sent' });
    expect(await t.sendPanic(off)).toEqual({ kind: 'sent' });
  });

  it('refuses a panic frame that is not one of panic’s', async () => {
    const { t, connect } = setup();
    await connect();
    expect((await t.sendPanic(query)).kind).toBe('refused');
  });

  it('makes both panic frames faults if STOPPED never comes', async () => {
    const { t, clock, connect } = setup();
    await connect();
    const [term, off] = PANIC_FRAMES as [TxFrame, TxFrame];
    const a = t.sendPanic(term);
    await clock.advance(STOP_TIMEOUT_MS);
    expect((await a).kind).toBe('fault');
    expect((await t.sendPanic(off)).kind).toBe('fault');
  });

  it('starts a stop from the OFF if TERMINATE was not sent first', async () => {
    const { t, sock, connect } = setup();
    await connect();
    const off = first(PANIC_FRAMES, 1);
    const p = t.sendPanic(off);
    sock().reply({ type: 'stopped', terminate: Status.sent, off: Status.sent });
    expect(await p).toEqual({ kind: 'sent' });
  });

  it('ends every waiting frame as a fault when the socket closes', async () => {
    const { t, sock, connect, states } = setup();
    await connect();
    const p = t.send(query);
    const s = sock();
    s.onclose?.();
    expect((await p).kind).toBe('fault');
    expect(t.state()).toBe('down');
    expect(states.at(-1)?.[1]).toBe('The connection to the server closed.');
  });

  it('closes on a message it cannot read', async () => {
    const { t, sock, connect } = setup();
    await connect();
    sock().onmessage?.({ data: Uint8Array.of(0x99) });
    expect(t.state()).toBe('fault');
    expect(sock().closed).toBe(true);
  });

  it('closes on text messages and on a second WELCOME', async () => {
    const one = setup();
    await one.connect();
    one.sock().onmessage?.({ data: 'hello' });
    expect(one.t.state()).toBe('fault');
    const two = setup();
    await two.connect();
    two.sock().reply(welcome());
    expect(two.t.state()).toBe('fault');
  });

  it('reports the hasseb coming and going', async () => {
    const { t, sock, connect, devices } = setup();
    await connect();
    sock().reply({ type: 'device', attached: false });
    expect(devices).toEqual([false]);
    expect(t.info()?.attached).toBe(false);
  });

  it('explains a CLOSE from the server', async () => {
    const { t, sock, connect, states } = setup();
    await connect();
    sock().reply({ type: 'close', reason: 1 });
    expect(t.state()).toBe('down');
    expect(states.at(-1)?.[1]).toContain('3 seconds');
  });

  it('fails to connect when the server refuses the token', async () => {
    const { t, sock } = setup();
    const p = t.connect();
    sock().onopen?.();
    sock().reply({ type: 'close', reason: 4 });
    await expect(p).rejects.toThrow('session token');
    expect(t.state()).toBe('down');
  });

  it('fails to connect when the server never answers, or speaks another version', async () => {
    const a = setup();
    const p = a.t.connect();
    await a.clock.advance(CONNECT_TIMEOUT_MS);
    await expect(p).rejects.toThrow('did not answer');
    const b = setup();
    const q = b.t.connect();
    b.sock().onopen?.();
    b.sock().reply({ ...welcome(), version: 2 } as ServerMessage);
    await expect(q).rejects.toThrow('protocol version');
    const c = setup();
    const r = c.t.connect();
    c.sock().onclose?.();
    await expect(r).rejects.toThrow('closed');
  });

  it('connecting twice is one connection', async () => {
    const { t, sockets, connect } = setup();
    await connect();
    await t.connect();
    expect(sockets).toHaveLength(1);
  });
});
