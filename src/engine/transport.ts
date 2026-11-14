/**
 * The transport interface (docs/ARCHITECTURE.md, ADR 0012). Types only. The implementations are in
 * `src/transport/`, and only `src/engine/router.ts` and the worker shell import them (SPEC S2.1).
 */
import type { TxFrame } from '../dali/sequences.ts';
import type { SendResult } from '../safety/types.ts';

export type TransportKind = 'sim' | 'server' | 'webhid';

export type TransportState = 'down' | 'connecting' | 'ready' | 'fault';

export interface Transport {
  readonly kind: TransportKind;
  state(): TransportState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** One frame, with its send-twice and reply flags. Resolves when the bus is free again. Never retries. */
  send(frame: TxFrame): Promise<SendResult>;
  /**
   * One of panic's frames (TERMINATE, then broadcast OFF). The server transport sends one PANIC message
   * for the pair, and the server drops its own queue before sending them (SPEC section 9).
   */
  sendPanic(frame: TxFrame): Promise<SendResult>;
}
