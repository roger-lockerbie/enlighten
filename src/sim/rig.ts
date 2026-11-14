/**
 * A small driver for tests and examples: sends commands to a simulator with a running time.
 * Pure: time only moves when the caller says.
 */
import { short, type Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import type { BusReply } from '../dali/reply.ts';
import { framesFor, type TxFrame } from '../dali/sequences.ts';
import { Simulator } from './simulator.ts';

export class Rig {
  t: number;
  readonly sim: Simulator;
  /** Time between frames, roughly a command's bus time. */
  step = 40;

  constructor(sim: Simulator, start = 1000) {
    this.sim = sim;
    this.t = start;
  }

  frames(frames: readonly TxFrame[]): BusReply {
    let last: BusReply = { kind: 'none' };
    for (const f of frames) {
      this.t += this.step;
      last = this.sim.send(f, this.t);
      if (f.sendTwice) this.t += this.step;
    }
    return last;
  }

  send(cmd: Command): BusReply {
    return this.frames(framesFor(cmd));
  }

  run(cmds: readonly Command[]): BusReply {
    let last: BusReply = { kind: 'none' };
    for (const c of cmds) last = this.send(c);
    return last;
  }

  /** Send a command to an address. */
  to(id: string, address: Address | number, value?: number): BusReply {
    const a = typeof address === 'number' ? short(address) : address;
    return this.send(value === undefined ? { id, address: a } : { id, address: a, value });
  }

  /** A query's byte, or 'none' or 'collision'. */
  ask(id: string, address: Address | number, value?: number): number | 'none' | 'collision' {
    const r = this.to(id, address, value);
    return r.kind === 'value' ? r.byte : r.kind;
  }

  dtr(n: 0 | 1 | 2, value: number): void {
    this.send({ id: n === 0 ? 'DTR0' : n === 1 ? 'DTR1' : 'DTR2', value });
  }

  /** DTR0 then a configuration command (sent twice). */
  set(id: string, address: Address | number, value: number, param?: number): void {
    this.dtr(0, value);
    this.to(id, address, param);
  }

  wait(ms: number): void {
    this.t += ms;
  }
}
