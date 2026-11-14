/**
 * Both mode (SPEC R1.5). The gate wraps the hardware governor: each frame still goes through `judge`
 * and `observe`, and for the queries the shadow can answer from what it knows (levels, limits, fade
 * settings, groups and scenes), the shadow's answer is compared with the hardware's. A difference goes
 * to the divergence log with the frame, both answers and the time.
 */
import type { Gate } from '../bus/scheduler.ts';
import { decode, frameText, type Frame } from '../dali/codec.ts';
import type { BusReply } from '../dali/reply.ts';
import type { Governor } from '../safety/governor.ts';
import type { SendResult, SentFrame, Transaction, Verdict } from '../safety/types.ts';

/** Queries whose answer the shadow knows from the scan's read-backs and the writes it has seen since. */
export const COMPARED = new Set([
  'QUERY_ACTUAL_LEVEL',
  'QUERY_MIN_LEVEL',
  'QUERY_MAX_LEVEL',
  'QUERY_PHYSICAL_MINIMUM',
  'QUERY_FADE_TIME_FADE_RATE',
  'QUERY_EXTENDED_FADE_TIME',
  'QUERY_GROUPS_0_7',
  'QUERY_GROUPS_8_15',
  'QUERY_SCENE_LEVEL',
]);

export interface Divergence {
  readonly at: number;
  readonly address: number;
  readonly command: string;
  readonly frame: string;
  readonly shadow: string;
  readonly hardware: string;
}

const shadowText = (r: BusReply): string =>
  r.kind === 'value' ? String(r.byte) : r.kind === 'collision' ? 'framing error' : 'no answer';

const hardwareText = (r: SendResult): string | undefined =>
  r.kind === 'reply'
    ? String(r.byte)
    : r.kind === 'framing-error'
      ? 'framing error'
      : r.kind === 'no-reply'
        ? 'no answer'
        : undefined;

export class DivergenceGate implements Gate {
  readonly governor: Governor;
  /** Compare only while this says so: in Both, not in Hardware. */
  private readonly comparing: () => boolean;
  private readonly onDivergence: (d: Divergence) => void;
  private previous: Frame | undefined;

  constructor(governor: Governor, comparing: () => boolean, onDivergence: (d: Divergence) => void) {
    this.governor = governor;
    this.comparing = comparing;
    this.onDivergence = onDivergence;
  }

  judge(tx: Transaction, now: number): Verdict {
    return this.governor.judge(tx, now);
  }

  latch(): void {
    this.governor.latch();
  }

  observe(sent: SentFrame, result: SendResult): void {
    const prev = this.previous;
    if (result.kind !== 'refused') this.previous = sent.frame.frame;
    const cmd = decode(sent.frame.frame, prev);
    // Was the address modelled before this frame? The shadow's answer is worth comparing only then.
    const n = cmd?.address?.kind === 'short' ? cmd.address.n : undefined;
    const modelled = n !== undefined && this.governor.addressInfo(n)?.modelled === true;
    const shadow = this.governor.observe(sent, result);
    if (cmd === undefined || n === undefined || !modelled || shadow === undefined) return;
    if (!this.comparing() || !COMPARED.has(cmd.id)) return;
    const hw = hardwareText(result);
    const sh = shadowText(shadow);
    if (hw === undefined || hw === sh) return;
    this.onDivergence({
      at: sent.at,
      address: n,
      command: cmd.id,
      frame: frameText(sent.frame.frame),
      shadow: sh,
      hardware: hw,
    });
  }
}
