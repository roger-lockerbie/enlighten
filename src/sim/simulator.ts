/**
 * The simulated bus: every gear hears every frame, and two answers at once are a framing error
 * (`docs/research/dali.md` section 1).
 */
import type { Address } from '../dali/address.ts';
import type { Frame } from '../dali/codec.ts';
import type { BusReply } from '../dali/reply.ts';
import type { TxFrame } from '../dali/sequences.ts';
import { Da5l, type ChannelDrive, type Da5lOptions } from './gear.ts';
import { benchA, benchB, type Da5lProfile } from './profile.ts';

/** From the start of the first copy of a send-twice pair to the start of the second: one frame and a priority 1 settle. */
export const SEND_TWICE_GAP_MS = 14.2 + 14.0;

export interface SimUnit {
  /** A stable name for the physical unit, since short addresses can change. */
  readonly id: string;
  readonly gear: Da5l;
}

export class Simulator {
  private readonly units: SimUnit[];

  constructor(units: SimUnit[]) {
    this.units = units;
  }

  /** The bench as SPEC R14.1 sets it: driver A at address 0 in C2, driver B at address 1 in C5. */
  static bench(opts: { a?: Da5lProfile; b?: Da5lProfile; at?: number } = {}): Simulator {
    const at = opts.at ?? 0;
    return new Simulator([
      { id: 'A', gear: new Da5l(opts.a ?? benchA(), { shortAddress: 0, at }) },
      { id: 'B', gear: new Da5l(opts.b ?? benchB(), { shortAddress: 1, at, seed: 0x1234567 }) },
    ]);
  }

  static of(profiles: { id: string; profile: Da5lProfile; opts?: Da5lOptions }[]): Simulator {
    return new Simulator(profiles.map((p) => ({ id: p.id, gear: new Da5l(p.profile, p.opts) })));
  }

  get all(): readonly SimUnit[] {
    return this.units;
  }

  /** Add a unit: the hardware shadow grows one per address a scan finds (ADR 0011). */
  add(unit: SimUnit): void {
    this.units.push(unit);
  }

  /** Put a unit in place of any that match, or add it. */
  replace(unit: SimUnit, match: (u: SimUnit) => boolean): void {
    const i = this.units.findIndex(match);
    if (i >= 0) this.units.splice(i, 1, unit);
    else this.units.push(unit);
  }

  unit(id: string): SimUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** The gear that a frame to this address reaches now. */
  reached(a: Address): SimUnit[] {
    return this.units.filter((u) => u.gear.hears(a));
  }

  byShortAddress(n: number): SimUnit | undefined {
    return this.units.find((u) => u.gear.shortAddress === n);
  }

  /** One forward frame, ending at `at`. */
  deliver(frame: Frame, at: number): BusReply {
    const answers: number[] = [];
    for (const u of this.units) {
      const r = u.gear.receive(frame, at);
      if (r !== undefined) answers.push(r);
    }
    if (answers.length > 1) return { kind: 'collision' };
    const only = answers[0];
    return only === undefined ? { kind: 'none' } : { kind: 'value', byte: only };
  }

  /** A frame as the transport sends it: twice, `SEND_TWICE_GAP_MS` apart, when flagged. */
  send(tx: TxFrame, at: number, gap = SEND_TWICE_GAP_MS): BusReply {
    const first = this.deliver(tx.frame, at);
    if (!tx.sendTwice) return first;
    return this.deliver(tx.frame, at + gap);
  }

  outputAt(t: number): Map<string, ChannelDrive> {
    return new Map(this.units.map((u) => [u.id, u.gear.outputAt(t)]));
  }

  /** The latest time any fade or scheduled change ends. */
  settlesAt(): number {
    return Math.max(...this.units.map((u) => u.gear.settlesAt()));
  }

  powerDown(at: number): void {
    for (const u of this.units) u.gear.powerDown(at);
  }

  powerUp(at: number): void {
    for (const u of this.units) u.gear.powerUp(at);
  }

  busDown(at: number): void {
    for (const u of this.units) u.gear.busDown(at);
  }

  busUp(at: number): void {
    for (const u of this.units) u.gear.busUp(at);
  }

  /** An independent copy, for predicting what a transaction would do. */
  fork(): Simulator {
    return new Simulator(this.units.map((u) => ({ id: u.id, gear: u.gear.clone() })));
  }
}
