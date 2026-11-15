/**
 * The hardware server as a transport (SPEC section 9, ADR 0003, ADR 0012). It speaks the binary
 * protocol over a WebSocket that the worker shell opens, so this file has no network code of its own
 * and tests in Node with a fake socket.
 *
 * One frame at a time: the scheduler waits for each result before the next. A result that does not
 * arrive is a transport fault, because the frame may have reached the bus (SPEC R1.9).
 */
import type { Cancel, Clock } from '../bus/clock.ts';
import { PANIC_FRAMES } from '../bus/scheduler.ts';
import { frameEquals } from '../dali/codec.ts';
import type { TxFrame } from '../dali/sequences.ts';
import type { Transport, TransportState } from '../engine/transport.ts';
import type { SendResult } from '../safety/types.ts';
import {
  CloseReason,
  decodeServer,
  encodeClient,
  PROTOCOL_VERSION,
  Status,
  type ClientMessage,
  type ServerMessage,
} from './wire.ts';

/** The part of a WebSocket the transport uses. The worker passes a real one. */
export interface WebSocketLike {
  binaryType: string;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface ServerInfo {
  readonly fwMajor: number;
  readonly fwMinor: number;
  readonly attached: boolean;
}

export interface ServerTransportOptions {
  readonly clock: Clock;
  /** Opens the socket to `/bus` on the page's own origin. */
  readonly open: () => WebSocketLike;
  /** The token from the URL. It works once: the server's WELCOME brings the one for reconnects. */
  readonly token: Uint8Array;
  readonly onState?: (state: TransportState, reason?: string) => void;
  readonly onDevice?: (attached: boolean) => void;
}

/** How often the transport tells the server it is alive. The server stops after 3 s of silence. */
export const PING_MS = 1000;
/** How long to wait for WELCOME. */
export const CONNECT_TIMEOUT_MS = 3000;
/** How long to wait for a frame's result: the server's 250 ms hasseb timeout with room to spare. */
export const RESULT_TIMEOUT_MS = 2000;
/** How long to wait for STOPPED after PANIC. */
export const STOP_TIMEOUT_MS = 2000;

const CLOSE_TEXT: Record<number, string> = {
  [CloseReason.silence]: 'The server heard nothing for 3 seconds and turned the lights off.',
  [CloseReason.protocolError]: 'The server refused a message it could not read.',
  [CloseReason.serverStopping]: 'The server is stopping.',
  [CloseReason.notAuthorised]:
    'The server refused the session token. Open the address the server prints again.',
  [CloseReason.busy]: 'Another page holds the server.',
};

/** What a RESULT or STOPPED status means for the governor. */
export function resultOf(status: Status, data: number): SendResult {
  switch (status) {
    case Status.sent:
      return { kind: 'sent' };
    case Status.noReply:
      return { kind: 'no-reply' };
    case Status.reply:
      return { kind: 'reply', byte: data };
    case Status.framingError:
      return { kind: 'framing-error' };
    case Status.hassebTimeout:
      return { kind: 'fault', reason: 'The hasseb did not answer in time.' };
    case Status.refused:
      return { kind: 'refused', reason: 'The server refused the frame.' };
    case Status.dropped:
      // Not sent, so the governor must not feed it to the shadow: a refusal says exactly that.
      return { kind: 'refused', reason: 'The server dropped the frame unsent.' };
  }
}

interface Pending {
  readonly resolve: (r: SendResult) => void;
  readonly cancel: Cancel;
}

type PanicResults = readonly [SendResult, SendResult];

export class ServerTransport implements Transport {
  readonly kind = 'server';
  private readonly clock: Clock;
  private readonly open: () => WebSocketLike;
  private readonly onState: ((state: TransportState, reason?: string) => void) | undefined;
  private readonly onDevice: ((attached: boolean) => void) | undefined;
  private token: Uint8Array;
  private ws: WebSocketLike | undefined;
  private st: TransportState = 'down';
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private ping: Cancel | undefined;
  private stopping:
    | { promise: Promise<PanicResults>; resolve: (r: PanicResults) => void; cancel: Cancel }
    | undefined;
  private lastInfo: ServerInfo | undefined;

  constructor(o: ServerTransportOptions) {
    this.clock = o.clock;
    this.open = o.open;
    this.onState = o.onState;
    this.onDevice = o.onDevice;
    this.token = o.token.slice();
  }

  state(): TransportState {
    return this.st;
  }

  /** What the server said in WELCOME, kept current by DEVICE. */
  info(): ServerInfo | undefined {
    return this.lastInfo;
  }

  connect(): Promise<void> {
    if (this.st === 'ready' || this.st === 'connecting') return Promise.resolve();
    this.setState('connecting');
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err?: string): void => {
        if (settled) return;
        settled = true;
        timeout();
        if (err === undefined) resolve();
        else reject(new Error(err));
      };
      const timeout = this.clock.at(this.clock.now() + CONNECT_TIMEOUT_MS, () => {
        this.drop('fault', 'The server did not answer.');
        settle('The server did not answer.');
      });
      const ws = this.open();
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.post({ type: 'hello', version: PROTOCOL_VERSION, token: this.token });
      };
      ws.onmessage = (ev) => {
        const m = toBytes(ev.data);
        const msg = m === undefined ? undefined : decodeServer(m);
        if (msg === undefined) {
          this.drop('fault', 'The server sent a message the app cannot read.');
          settle('The server sent a message the app cannot read.');
          return;
        }
        if (msg.type === 'welcome' && this.st === 'connecting') {
          if (msg.version !== PROTOCOL_VERSION) {
            this.drop('fault', 'The server speaks another protocol version.');
            settle('The server speaks another protocol version.');
            return;
          }
          this.token = msg.token.slice();
          this.lastInfo = { fwMajor: msg.fwMajor, fwMinor: msg.fwMinor, attached: msg.attached };
          this.setState('ready');
          this.schedulePing();
          settle();
          return;
        }
        if (msg.type === 'close' && this.st === 'connecting') {
          const why = CLOSE_TEXT[msg.reason] ?? 'The server closed the connection.';
          this.drop('down', why);
          settle(why);
          return;
        }
        this.handle(msg);
      };
      ws.onclose = () => {
        this.drop('down', 'The connection to the server closed.');
        settle('The connection to the server closed.');
      };
      ws.onerror = () => {
        // A close event follows an error, and it does the work.
      };
    });
  }

  disconnect(): Promise<void> {
    this.drop('down', 'Disconnected.');
    return Promise.resolve();
  }

  send(frame: TxFrame): Promise<SendResult> {
    if (this.st !== 'ready')
      return Promise.resolve({ kind: 'fault', reason: 'The server is not connected.' });
    const seq = this.seq;
    this.seq = (this.seq + 1) & 0xffff;
    return new Promise((resolve) => {
      const cancel = this.clock.at(this.clock.now() + RESULT_TIMEOUT_MS, () => {
        this.pending.delete(seq);
        resolve({ kind: 'fault', reason: 'The server did not answer in time.' });
      });
      this.pending.set(seq, { resolve, cancel });
      this.post({
        type: 'send',
        seq,
        expectReply: frame.expectReply,
        sendTwice: frame.sendTwice,
        frame: frame.frame,
      });
    });
  }

  /**
   * Panic's frames. TERMINATE sends one PANIC message; the server drops its queue, lets the frame on
   * the hasseb finish, sends TERMINATE and broadcast OFF, and answers STOPPED with both statuses. The
   * OFF then resolves from the same answer.
   */
  async sendPanic(frame: TxFrame): Promise<SendResult> {
    const [terminate, off] = PANIC_FRAMES;
    const isOff = off !== undefined && frameEquals(frame.frame, off.frame);
    if (!isOff && (terminate === undefined || !frameEquals(frame.frame, terminate.frame)))
      return { kind: 'refused', reason: 'Only TERMINATE and broadcast OFF go out as panic.' };
    if (this.st !== 'ready') return { kind: 'fault', reason: 'The server is not connected.' };
    const stop = this.stopping ?? this.startStop();
    const results = await stop.promise;
    if (isOff && this.stopping === stop) this.stopping = undefined;
    return isOff ? results[1] : results[0];
  }

  private startStop(): NonNullable<ServerTransport['stopping']> {
    let resolve: (r: PanicResults) => void = () => undefined;
    const promise = new Promise<PanicResults>((r) => {
      resolve = r;
    });
    const cancel = this.clock.at(this.clock.now() + STOP_TIMEOUT_MS, () => {
      const fault: SendResult = { kind: 'fault', reason: 'The server did not confirm the stop.' };
      this.finishStop([fault, fault]);
    });
    this.stopping = { promise, resolve, cancel };
    this.post({ type: 'panic' });
    return this.stopping;
  }

  private finishStop(r: PanicResults): void {
    const s = this.stopping;
    if (s === undefined) return;
    s.cancel();
    s.resolve(r);
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'result': {
        const p = this.pending.get(msg.seq);
        if (p === undefined) return; // Late, after a timeout: already a fault.
        this.pending.delete(msg.seq);
        p.cancel();
        p.resolve(resultOf(msg.status, msg.data));
        return;
      }
      case 'stopped':
        this.finishStop([resultOf(msg.terminate, 0), resultOf(msg.off, 0)]);
        return;
      case 'device':
        if (this.lastInfo !== undefined)
          this.lastInfo = { ...this.lastInfo, attached: msg.attached };
        this.onDevice?.(msg.attached);
        return;
      case 'close':
        this.drop('down', CLOSE_TEXT[msg.reason] ?? 'The server closed the connection.');
        return;
      case 'welcome':
        // A second WELCOME is not part of the protocol.
        this.drop('fault', 'The server sent WELCOME twice.');
        return;
    }
  }

  private post(m: ClientMessage): void {
    this.ws?.send(encodeClient(m));
  }

  private schedulePing(): void {
    this.ping = this.clock.at(this.clock.now() + PING_MS, () => {
      if (this.st !== 'ready') return;
      this.post({ type: 'ping' });
      this.schedulePing();
    });
  }

  private setState(s: TransportState, reason?: string): void {
    if (this.st === s) return;
    this.st = s;
    this.onState?.(s, reason);
  }

  /** Close the socket and end everything waiting. A frame without a result may have reached the bus. */
  private drop(state: 'down' | 'fault', reason: string): void {
    this.ping?.();
    this.ping = undefined;
    const ws = this.ws;
    this.ws = undefined;
    if (ws !== undefined) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    }
    for (const p of this.pending.values()) {
      p.cancel();
      p.resolve({ kind: 'fault', reason });
    }
    this.pending.clear();
    const fault: SendResult = { kind: 'fault', reason };
    this.finishStop([fault, fault]);
    this.stopping = undefined;
    if (this.st !== 'down' || state === 'fault') this.setState(state, reason);
  }
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  return undefined;
}
