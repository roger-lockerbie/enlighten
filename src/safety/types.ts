/**
 * Types shared by the governor, the scheduler and (from Stage 4) the router. See ADR 0004 and ADR 0011.
 */
import type { TxFrame } from '../dali/sequences.ts';

/** Where a transaction came from. Only `ui` and `console` are a person (SPEC section 5, "Unlocks"). */
export type Source =
  | 'ui'
  | 'console'
  | 'script'
  | 'sequence'
  | 'effect'
  | 'switch'
  | 'import'
  | 'internal'
  | 'profile'
  | 'panic';

export const PERSON_SOURCES: readonly Source[] = ['ui', 'console'];

export const isPerson = (s: Source): boolean => PERSON_SOURCES.includes(s);

/** A short, ordered group of frames that must not be split. */
export interface Transaction {
  readonly frames: readonly TxFrame[];
  readonly source: Source;
  /** What a person asked for, for the bus monitor. */
  readonly label?: string;
}

declare const approvedBrand: unique symbol;

/**
 * Proof that the governor judged a transaction. Only `judge` makes one, and the router checks it with
 * `isApproved` before a transport sees a frame (SPEC S2.1).
 */
export interface Approved {
  readonly [approvedBrand]: true;
  readonly tx: Transaction;
}

export type Verdict =
  | { readonly kind: 'allow'; readonly approval: Approved }
  | {
      readonly kind: 'clamp';
      readonly tx: Transaction;
      readonly note: string;
      readonly approval: Approved;
    }
  | { readonly kind: 'refuse'; readonly reason: string; readonly retryAt?: number };

/** What a transport reports for one frame (docs/ARCHITECTURE.md, Transport). */
export type SendResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'reply'; readonly byte: number }
  | { readonly kind: 'no-reply' }
  | { readonly kind: 'framing-error' }
  | { readonly kind: 'fault'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** A frame that went to a transport, with the time it was delivered (the end of the forward frame). */
export interface SentFrame {
  readonly frame: TxFrame;
  readonly at: number;
  readonly source: Source;
}

export type Unlock = 'rate' | 'reset' | 'expert';

export type Target = 'simulator' | 'hardware';
