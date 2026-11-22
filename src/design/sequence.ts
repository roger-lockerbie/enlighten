/**
 * A sequence (SPEC R5.4): a named list of steps, each a target, a level, a colour and a duration.
 * A step starts when the one before it ends, or with it when `together` is set.
 */
import type { Address } from '../dali/address.ts';
import type { LookColour } from './look.ts';

export const MAX_SEQUENCES = 100;
export const MAX_STEPS = 500;
/** One step lasts at most a day. */
export const MAX_STEP_MS = 24 * 60 * 60_000;

export interface Step {
  /** A short address, a group, or every driver. */
  readonly target: Address;
  /** Arc level 0 to 254. 0 is off. */
  readonly arc: number;
  readonly colour: LookColour;
  /** How long the change takes, in ms. 0 is at once. */
  readonly durationMs: number;
  /** Start with the step before, not after it. */
  readonly together?: boolean;
}

export interface Sequence {
  readonly name: string;
  readonly steps: readonly Step[];
}
