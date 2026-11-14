/**
 * Small helpers for the engine's runners: turn commands into a transaction, submit it, and read the
 * answers. A refusal, a drop or a fault ends the runner with a `StepError`, so nothing goes on as if
 * a read had worked (SPEC S1.2, R1.9).
 */
import type { TxResult } from '../bus/scheduler.ts';
import type { Command } from '../dali/codec.ts';
import { framesForAll } from '../dali/sequences.ts';
import type { Submit, Submitted } from '../safety/profile.ts';
import type { SendResult, Source, Transaction } from '../safety/types.ts';

export class StepError extends Error {}

export function toSubmitted(r: TxResult): Submitted {
  if (r.kind === 'done') return { kind: 'done', results: r.results };
  if (r.kind === 'refused')
    return {
      kind: 'refused',
      reason: r.reason,
      ...(r.retryAt === undefined ? {} : { retryAt: r.retryAt }),
    };
  return { kind: r.kind, reason: r.reason };
}

export function txOf(cmds: readonly Command[], source: Source, label: string): Transaction {
  return { frames: framesForAll(cmds), source, label };
}

/** Send, and return every frame's result. Throws unless the whole transaction went out. */
export async function send(
  submit: Submit,
  cmds: readonly Command[],
  source: Source,
  label: string,
): Promise<readonly SendResult[]> {
  const r = await submit(txOf(cmds, source, label));
  if (r.kind !== 'done') throw new StepError(`${label}: ${r.reason}`);
  return r.results;
}

/** The answer to the last frame: a byte, or undefined when no gear answered. A framing error throws. */
export async function ask(
  submit: Submit,
  cmds: readonly Command[],
  source: Source,
  label: string,
): Promise<number | undefined> {
  const results = await send(submit, cmds, source, label);
  const last = results[results.length - 1];
  if (last?.kind === 'framing-error')
    throw new StepError(`${label}: two answers at once (a framing error).`);
  return last?.kind === 'reply' ? last.byte : undefined;
}

/** The answers to every frame that expects one, in order. */
export async function answers(
  submit: Submit,
  cmds: readonly Command[],
  source: Source,
  label: string,
): Promise<(number | 'none' | 'collision')[]> {
  const frames = framesForAll(cmds);
  const results = await send(submit, cmds, source, label);
  const out: (number | 'none' | 'collision')[] = [];
  results.forEach((r, i) => {
    if (frames[i]?.expectReply !== true) return;
    out.push(r.kind === 'reply' ? r.byte : r.kind === 'framing-error' ? 'collision' : 'none');
  });
  return out;
}
