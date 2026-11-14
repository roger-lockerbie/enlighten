/**
 * The governor (ADR 0004, ADR 0005, ADR 0011). Every transaction from every source is judged here just
 * before it is sent. `judge` changes nothing. `observe` is the only way the governor's view advances.
 */
import { short, type Address } from '../dali/address.ts';
import { decode, encode, frameText, type Command, type Frame } from '../dali/codec.ts';
import { spec, type CommandSpec } from '../dali/commands.ts';
import { arcToFraction } from '../dali/curve.ts';
import type { TxFrame } from '../dali/sequences.ts';
import {
  DEFAULT_TIMING,
  FORWARD_FRAME_MS,
  settleMs,
  wireMs,
  type BusTiming,
} from '../bus/timing.ts';
import type { Simulator, SimUnit } from '../sim/simulator.ts';
import { RESET_DEAF_MS } from '../sim/gear.ts';
import { maxArcForMix, measure, mixSum, WORST_FACTS, type ColourFacts } from './mix.ts';
import { PHANTOM, predictEvents, ROOM, scopeOf } from './rate/trace.ts';
import { mergeTimes, type TraceEvents } from './rate/legs.ts';
import { swingLimit, violations, withExtra, type Violation } from './rate/guard.ts';
import {
  LIGHT_CHANGING,
  PROFILE_WRITES,
  ruleFor,
  STALES_INVENTORY,
  UNVERIFIED_OK,
  type Rule,
} from './rules.ts';
import {
  isPerson,
  type Approved,
  type SendResult,
  type SentFrame,
  type Source,
  type Target,
  type Transaction,
  type Unlock,
  type Verdict,
} from './types.ts';

/**
 * The DA5-L's fade behaviour has not been confirmed on hardware. Until a reviewed commit changes this
 * after hardware day, every level or colour command on hardware counts as an instant step (SPEC S3.7).
 */
export const FADE_BEHAVIOUR_CONFIRMED = false;

/** Unlocked commands that can raise output past the ceiling, which a person confirmed. */
const CONFIRMED_RAISE: ReadonlySet<string> = new Set([
  'RESET',
  'DT6_SELECT_DIMMING_CURVE',
  'DT8_STORE_TC_LIMIT',
  'DT8_STORE_GEAR_FEATURES',
]);

/** The default ceiling: 40%, arc level 220 (SPEC R6.1). */
export const DEFAULT_CEILING_ARC = 220;
/** An unlocked RESET at most once in this time (SPEC S3.10). */
export const RESET_INTERVAL_MS = 10_000;
/** After an unlocked RESET, OFF goes out this long after it: the gear's 300 ms and a margin. */
export const RESET_OFF_AFTER_MS = 350;
/** The OFF that follows an unlocked RESET is part of the RESET's swing for this long. */
export const RESET_FOLLOW_UP_MS = 2000;
/** How far back the rate guard looks. */
export const HISTORY_MS = 6000;
/**
 * How far ahead the rate guard predicts at most: past the longest fade (16 minutes). A slow fade is
 * one long leg, and whether it reaches the leg ratio can depend on its far end.
 */
export const HORIZON_MS = 17 * 60_000;

export interface AddressInfo {
  present?: boolean | undefined;
  verified: boolean;
  physicalMinimum?: number | undefined;
  minLevel?: number | undefined;
  maxLevel?: number | undefined;
  linearCurve?: boolean | undefined;
  deviceTypes?: number[] | undefined;
  colour?: ColourFacts | undefined;
  groups?: number | undefined;
  /** The fade time and rate have been read back this session (SPEC S3.7). */
  fadeReadBack: boolean;
  /** On hardware: whether the level and colour are known. */
  levelKnown: boolean;
  colourKnown: boolean;
}

export interface GovernorOptions {
  readonly target: Target;
  /** The shadow simulator. In the Simulator target it is the simulated bench itself. */
  readonly shadow: Simulator;
  readonly ceilingArc?: number;
  readonly timing?: BusTiming;
  /**
   * True when the transport feeds frames into the shadow itself (the Simulator target, where the
   * shadow is the bench). `observe` then does not feed it again.
   */
  readonly shadowFedByTransport?: boolean;
  /**
   * When the connection was made. On hardware nothing is known about what the lights did before, so
   * light-changing commands wait `CONNECT_HOLD_MS` from this time (ADR 0011).
   */
  readonly connectedAt?: number;
}

/** After a hardware connect, light-changing commands wait this long: the longest rate guard window but the pattern rule's. */
export const CONNECT_HOLD_MS = 2000;

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** Decode every frame of a transaction, each with the frame before it as context. */
function decodeFrames(frames: readonly TxFrame[]): Command[] {
  const out: Command[] = [];
  let prev: Frame | undefined;
  for (const f of frames) {
    const c = decode(f.frame, prev);
    if (c !== undefined) out.push(c);
    prev = f.frame;
  }
  return out;
}

/** Approvals the governor has issued. Only `judge` adds to it. */
const issued = new WeakSet<object>();

/** True when `a` is an approval `judge` made for exactly this transaction. The router checks this. */
export function isApproved(a: unknown, tx: Transaction): boolean {
  return typeof a === 'object' && a !== null && issued.has(a) && (a as Approved).tx === tx;
}

function approve(tx: Transaction): Approved {
  const a = Object.freeze({ tx }) as unknown as Approved;
  issued.add(a);
  return a;
}

interface Planned {
  readonly frame: TxFrame;
  readonly cmd: Command;
  readonly spec: CommandSpec;
  readonly deliverAt: number;
}

export class Governor {
  readonly target: Target;
  readonly shadow: Simulator;
  readonly timing: BusTiming;
  private readonly shadowFedByTransport: boolean;

  private ceiling: number;
  private readonly unlocked = new Set<Unlock>();
  private swings = 1;
  private latched = false;
  private dtr: [number | undefined, number | undefined, number | undefined] = [
    undefined,
    undefined,
    undefined,
  ];
  private deafUntil = -Infinity;
  private stale = true;
  private unaddressedPresent = false;
  private operatorCanSee: boolean | undefined;
  private lastResetAt = -Infinity;
  private lastSent: Frame | undefined;
  private readonly info = new Map<number, AddressInfo>();
  /** Legs and hard steps the traces cannot show: commands to gear in an unknown state, and phantom gear. */
  private synthetic: { t: number; scope: string }[] = [];
  /** The OFF that follows an unlocked RESET is part of the RESET's one swing (SPEC S3.10). */
  private resetOff: { targets: Set<number>; until: number } | undefined;
  private readonly holdUntil: number;
  /** Addresses with a temporary colour set since their last ACTIVATE: 'tc', 'rgb', 'waf' parts seen. */
  private readonly tempSeen = new Map<number, Set<string>>();

  constructor(opts: GovernorOptions) {
    this.target = opts.target;
    this.shadow = opts.shadow;
    this.timing = opts.timing ?? DEFAULT_TIMING;
    this.ceiling = opts.ceilingArc ?? DEFAULT_CEILING_ARC;
    this.shadowFedByTransport = opts.shadowFedByTransport ?? opts.target === 'simulator';
    this.holdUntil =
      opts.target === 'hardware' ? (opts.connectedAt ?? -Infinity) + CONNECT_HOLD_MS : -Infinity;
  }

  // -----------------------------------------------------------------------------------------------
  // Settings that only a person can raise or unlock

  get ceilingArc(): number {
    return this.ceiling;
  }

  get isLatched(): boolean {
    return this.latched;
  }

  get swingLimit(): number {
    return this.unlocked.has('rate') ? this.swings : 1;
  }

  isUnlocked(u: Unlock): boolean {
    return this.unlocked.has(u);
  }

  get inventoryStale(): boolean {
    return this.stale;
  }

  addressInfo(n: number): Readonly<AddressInfo> | undefined {
    const i = this.info.get(n);
    return i === undefined ? undefined : structuredClone(i);
  }

  knownAddresses(): number[] {
    return [...this.info.entries()].filter(([, i]) => i.present === true).map(([n]) => n);
  }

  dtrView(): readonly (number | undefined)[] {
    return [...this.dtr];
  }

  /**
   * Change the ceiling. Lowering is open to every source and takes effect for the next transaction.
   * Raising needs a person and a confirmation. A ceiling below a driver's physical minimum is refused.
   * Addresses whose MAX LEVEL is above the new ceiling are no longer verified until it is rewritten.
   */
  setCeiling(arc: number, source: Source, confirmed = false): Outcome {
    if (!Number.isInteger(arc) || arc < 1 || arc > 254)
      return no('The ceiling must be an arc level from 1 to 254.');
    if (arc > this.ceiling && !(isPerson(source) && confirmed)) {
      return no('Raising the ceiling needs a confirmation from a person.');
    }
    const floor = Math.max(
      0,
      ...[...this.info.values()].map((i) => (i.present === true ? (i.physicalMinimum ?? 0) : 0)),
    );
    if (arc < floor) {
      const pct = (arcToFraction(floor) * 100).toFixed(2);
      return no(
        `A driver cannot go below arc level ${String(floor)} (${pct}%). That is the lowest ceiling it can hold.`,
      );
    }
    this.ceiling = arc;
    for (const i of this.info.values()) {
      if (i.maxLevel === undefined || i.maxLevel > arc) i.verified = false;
    }
    return OK;
  }

  unlock(u: Unlock, source: Source, confirmed: boolean): Outcome {
    if (!isPerson(source) || !confirmed)
      return no('An unlock needs a typed confirmation from a person.');
    if (u === 'rate' && this.operatorCanSee === false) {
      return no(
        'The operator said they cannot see the lights, so the rate unlock is off for this session.',
      );
    }
    this.unlocked.add(u);
    return OK;
  }

  lock(u?: Unlock): void {
    if (u === undefined) this.unlocked.clear();
    else this.unlocked.delete(u);
    if (!this.unlocked.has('rate')) this.swings = 1;
  }

  setSwingLimit(n: number, source: Source): Outcome {
    if (!isPerson(source)) return no('Only a person can change the swing limit.');
    if (n > 1 && !this.unlocked.has('rate'))
      return no('Raising the swing limit needs the rate unlock.');
    this.swings = swingLimit(n);
    return OK;
  }

  setOperatorCanSee(can: boolean): void {
    this.operatorCanSee = can;
    if (!can) this.lock('rate');
  }

  /** Panic latches the governor. Nothing is allowed until a person resumes (SPEC S4.4). */
  latch(): void {
    this.latched = true;
  }

  resume(source: Source): Outcome {
    if (!isPerson(source)) return no('Only a person can resume after panic.');
    this.latched = false;
    return OK;
  }

  /** After a scan has read every address and its groups. */
  markInventoryFresh(unaddressedPresent: boolean): void {
    this.stale = false;
    this.unaddressedPresent = unaddressedPresent;
  }

  /**
   * Mark an address verified, from the safety profile's read-backs (SPEC S1.2). It holds only if the
   * read-backs show the profile in place and the facts the governor has agree.
   */
  markVerified(
    n: number,
    readBack: { max: number; min: number; powerOn: number; systemFailure: number; linear: boolean },
  ): Outcome {
    const i = this.addr(n);
    if (readBack.linear) return no('The dimming curve is not standard.');
    if (readBack.max > this.ceiling)
      return no(`MAX LEVEL reads ${String(readBack.max)}, above the ceiling.`);
    if (readBack.min > readBack.max) return no('MIN LEVEL reads above MAX LEVEL.');
    if (readBack.powerOn !== 0)
      return no(`POWER ON LEVEL reads ${String(readBack.powerOn)}, not 0.`);
    if (readBack.systemFailure !== 255)
      return no(`SYSTEM FAILURE LEVEL reads ${String(readBack.systemFailure)}, not 255.`);
    if (i.maxLevel !== readBack.max || i.minLevel !== readBack.min || i.linearCurve === true) {
      return no('The read-back does not match what the governor saw on the bus.');
    }
    i.verified = true;
    return OK;
  }

  // -----------------------------------------------------------------------------------------------
  // judge

  /**
   * Judge a transaction that would start once the bus is free at `now`. Returns allow, clamp (the same
   * transaction with lower levels) or refuse with a reason and, where waiting helps, a time to retry.
   */
  judge(tx: Transaction, now: number): Verdict {
    if (this.latched) return { kind: 'refuse', reason: 'Panic is latched. Choose Resume first.' };
    if (tx.frames.length === 0) return { kind: 'refuse', reason: 'The transaction is empty.' };
    if (tx.source === 'panic')
      return { kind: 'refuse', reason: 'Panic does not go through judge.' };

    const checked = this.checkRules(tx, now);
    if (!checked.ok) return { kind: 'refuse', reason: checked.reason };
    let candidate: Transaction = checked.tx;
    const notes: string[] = [...checked.notes];

    // A command behind an unlock was confirmed by a person, who was told what it does (P-ceiling).
    const confirmed = decodeFrames(candidate.frames).some((c) => CONFIRMED_RAISE.has(c.id));
    const fitted = confirmed
      ? { ok: true as const, tx: candidate, note: '' }
      : this.fitCeiling(candidate, now);
    if (!fitted.ok) return { kind: 'refuse', reason: fitted.reason };
    if (fitted.tx !== candidate) {
      candidate = fitted.tx;
      notes.push(fitted.note);
    }

    const rate = this.isResetFollowUp(candidate, now) ? [] : this.rateCheck(candidate, now);
    const [first] = rate;
    if (first !== undefined) {
      return {
        kind: 'refuse',
        reason: `Rate guard: ${first.rule} (${first.scope}).`,
        ...this.retryAt(candidate, now, rate),
      };
    }
    const approval = approve(candidate);
    if (candidate === tx) return { kind: 'allow', approval };
    return { kind: 'clamp', tx: candidate, note: notes.join(' '), approval };
  }

  /** True for an OFF to the gear an unlocked RESET just sent to full, within 2 s of it. */
  private isResetFollowUp(tx: Transaction, now: number): boolean {
    const r = this.resetOff;
    if (r === undefined || now > r.until) return false;
    return tx.frames.every((f) => {
      const c = decode(f.frame);
      return c?.id === 'OFF' && c.address?.kind === 'short' && r.targets.has(c.address.n);
    });
  }

  private addr(n: number): AddressInfo {
    let i = this.info.get(n);
    if (i === undefined) {
      i = {
        verified: false,
        fadeReadBack: false,
        levelKnown: this.target === 'simulator',
        colourKnown: this.target === 'simulator',
      };
      this.info.set(n, i);
    }
    return i;
  }

  /** Short addresses a frame to `a` reaches, as far as the governor knows. */
  private members(a: Address): number[] {
    const present = [...this.info.entries()].filter(([, i]) => i.present === true);
    switch (a.kind) {
      case 'short':
        return [a.n];
      case 'group':
        return present
          .filter(([, i]) => i.groups === undefined || (i.groups & (1 << a.n)) !== 0)
          .map(([n]) => n);
      case 'broadcast':
        return present.map(([n]) => n);
      case 'unaddressed':
        return [];
    }
  }

  /** True when every gear the address reaches is verified, and for a group or broadcast the inventory is fresh. */
  private allVerified(a: Address): Outcome {
    if (a.kind === 'unaddressed') return no('Gear without a short address cannot be verified.');
    if (a.kind !== 'short') {
      if (this.stale) return no('The inventory is stale. Scan before using a group or broadcast.');
      if (this.unaddressedPresent) return no('Gear without a short address is on the bus.');
    }
    for (const n of this.members(a)) {
      if (this.info.get(n)?.verified !== true) return no(`Address ${String(n)} is not verified.`);
    }
    return OK;
  }

  /** The rule table, frame by frame, with DAPCs clamped to the ceiling. */
  private checkRules(
    tx: Transaction,
    now: number,
  ): { ok: true; tx: Transaction; notes: string[] } | { ok: false; reason: string } {
    const dtr = [...this.dtr];
    const frames: TxFrame[] = [];
    const notes: string[] = [];
    let changed = false;
    let prev: Frame | undefined;
    let free = now;
    for (const f of tx.frames) {
      // When this frame reaches the gear, for the RESET deafness check below.
      const deliverAt = free + settleMs(prev === undefined, this.timing) + FORWARD_FRAME_MS;
      free = deliverAt - FORWARD_FRAME_MS + wireMs(f, this.timing);
      const cmd = decode(f.frame, prev);
      prev = f.frame;
      if (cmd === undefined)
        return { ok: false, reason: `Frame ${frameText(f.frame)} is not a supported command.` };
      const sp = spec(cmd.id);
      if (f.sendTwice !== sp.sendTwice || f.expectReply !== (sp.reply !== 'none')) {
        return {
          ok: false,
          reason: `${sp.label}: the send-twice or reply flag does not match the command.`,
        };
      }
      // A device type command decodes only right after its ENABLE DEVICE TYPE, so a raw frame without
      // one is refused above as not a supported command (SPEC section 5).
      for (const r of sp.reads) {
        if (dtr[r] === undefined)
          return {
            ok: false,
            reason: `${sp.label} reads DTR${String(r)}, which is unknown. Set it first.`,
          };
      }
      const rule = ruleFor(cmd.id, sp.reply !== 'none');
      const res = this.applyRule(rule, cmd, dtr, tx.source);
      if (!res.ok) return { ok: false, reason: `${sp.label}: ${res.reason}` };
      let out = f;
      if (
        rule === 'dapc' &&
        cmd.value !== undefined &&
        cmd.value !== 0 &&
        cmd.value !== 255 &&
        cmd.value > this.ceiling
      ) {
        out = { ...f, frame: { a: f.frame.a, b: this.ceiling } };
        notes.push(`DAPC ${String(cmd.value)} clamped to the ceiling, ${String(this.ceiling)}.`);
        changed = true;
      }
      frames.push(out);
      if (sp.sets !== undefined) {
        dtr[sp.sets] = deliverAt < this.deafUntil ? undefined : cmd.value;
      }
      for (const r of sp.gearWrites) dtr[r] = undefined;
    }
    return { ok: true, tx: changed ? { ...tx, frames } : tx, notes };
  }

  private applyRule(
    rule: Rule,
    cmd: Command,
    dtr: (number | undefined)[],
    source: Source,
  ): Outcome {
    const a = cmd.address;
    // An unverified address accepts DAPC, OFF, queries, DTR writes and the profile's own writes only.
    // Commands behind an unlock are judged by their own rule: they are how unverified gear is recovered.
    const unlocked =
      rule === 'reset' || rule === 'commissioning' || rule === 'expert' || rule === 'expert-curve';
    if (
      a !== undefined &&
      !unlocked &&
      !UNVERIFIED_OK.has(rule) &&
      !(source === 'profile' && PROFILE_WRITES.has(cmd.id))
    ) {
      const v = this.allVerified(a);
      if (!v.ok) return v;
    }
    // Every rule below that uses DTR0 reads it, and the check above has made sure it is known.
    const d0 = dtr[0] ?? 255;
    const personOnly = (u: Unlock): Outcome => {
      if (!this.unlocked.has(u)) return no(`needs the ${u} unlock.`);
      if (!isPerson(source)) return no(`accepted only from a person at the console or the UI.`);
      return OK;
    };
    const facts = (n: number): ColourFacts | undefined => this.info.get(n)?.colour;
    switch (rule) {
      case 'allow':
      case 'dapc':
      case 'off':
      case 'verified-down':
      case 'verified-up':
      case 'enable-dapc-sequence':
      case 'set-fade':
      case 'membership':
      case 'gear-writes':
      case 'activate':
        return OK;
      case 'set-max': {
        const v = d0 === 255 ? 254 : d0;
        return v > this.ceiling ? no('the value is above the ceiling.') : OK;
      }
      case 'set-min':
        return d0 > this.ceiling ? no('the value is above the ceiling.') : OK;
      case 'set-scene':
        return d0 !== 255 && d0 > this.ceiling
          ? no('the value is above the ceiling.')
          : this.storedColourOk(a, d0);
      case 'set-power-on':
        if (d0 === 255) return no('255 would undo the power-on setting.');
        return d0 > this.ceiling
          ? no('the value is above the ceiling.')
          : this.storedColourOk(a, d0);
      case 'temp-tc':
        if (a?.kind === 'short' && facts(a.n)?.tc !== true)
          return no('the gear does not report Tc.');
        if (
          a !== undefined &&
          a.kind !== 'short' &&
          this.members(a).some((n) => facts(n)?.tc !== true)
        ) {
          return no('not every addressed gear reports Tc.');
        }
        return OK;
      case 'temp-rgbwaf':
        if (a?.kind === 'short' && (facts(a.n)?.channels ?? 0) === 0)
          return no('the gear does not report RGBWAF.');
        if (
          a !== undefined &&
          a.kind !== 'short' &&
          this.members(a).some((n) => (facts(n)?.channels ?? 0) === 0)
        ) {
          return no('not every addressed gear reports RGBWAF.');
        }
        return OK;
      case 'rgbwaf-control':
        return (d0 & 0xc0) === 0 ? OK : no('only channel control is allowed.');
      case 'refuse-colour-type':
        return no('the DA5-L is not known to report that colour type.');
      case 'expert':
        return personOnly('expert');
      case 'expert-curve':
        return personOnly('expert');
      case 'reset':
      case 'commissioning':
        return personOnly('reset');
      case 'refuse':
        return no('refused always.');
    }
  }

  /** A pending temporary colour stored with a level is judged by the mix rule (SPEC section 5). */
  private storedColourOk(a: Address | undefined, level: number): Outcome {
    if (a === undefined) return OK;
    for (const u of this.reachedUnits(a)) {
      const t = u.gear.snapshot().temp;
      if (t.type !== 'rgbwaf') continue;
      const f = this.factsFor(u);
      const lvl = level === 255 ? this.ceiling : Math.min(level, this.ceiling);
      if (
        measure(
          arcToFraction(lvl),
          f,
          t.ch.map((x) => (x === 255 ? 254 : x)),
        ) >
        arcToFraction(this.ceiling) + 1e-9
      ) {
        return no('the pending colour at that level would pass the ceiling.');
      }
    }
    return OK;
  }

  private reachedUnits(a: Address): SimUnit[] {
    return this.shadow.reached(a);
  }

  private factsFor(u: SimUnit): ColourFacts {
    const n = u.gear.shortAddress;
    const f = n === null ? undefined : this.info.get(n)?.colour;
    return f ?? WORST_FACTS;
  }

  private colourOf(u: SimUnit, t: number): readonly number[] {
    const n = u.gear.shortAddress;
    const known = n !== null && this.info.get(n)?.colourKnown === true;
    return known ? u.gear.colourAt(t).ch : [254, 254, 254, 254, 254, 254];
  }

  /** Feed a transaction into a fork of the shadow at the times the scheduler would send it. */
  /** Each frame with its command and when the scheduler would deliver it. Called after the rules pass. */
  private plan(tx: Transaction, now: number): Planned[] {
    const out: Planned[] = [];
    let prev: Frame | undefined;
    let free = now;
    for (const f of tx.frames) {
      const deliverAt = free + settleMs(prev === undefined, this.timing) + FORWARD_FRAME_MS;
      free = deliverAt - FORWARD_FRAME_MS + wireMs(f, this.timing);
      const cmd = decode(f.frame, prev);
      prev = f.frame;
      if (cmd === undefined) throw new Error('plan() needs a transaction that passed the rules');
      out.push({ frame: f, cmd, spec: spec(cmd.id), deliverAt });
    }
    return out;
  }

  /** When the first frame of a transaction starting on a free bus at `now` reaches the gear. */
  private firstDelivery(now: number): number {
    return now + this.timing.settleFirstMs + FORWARD_FRAME_MS;
  }

  private simulate(planned: readonly Planned[]): Simulator {
    const fork = this.shadow.fork();
    const gap = this.timing.settleLaterMs + FORWARD_FRAME_MS;
    for (const p of planned) fork.send(p.frame, p.deliverAt, gap);
    return fork;
  }

  /** The highest ceiling measure for a unit over a time range. */
  private maxMeasure(sim: Simulator, id: string, from: number, to: number): number {
    const u = sim.unit(id);
    if (u === undefined) return 0;
    const facts = this.factsFor(u);
    const bps = [...new Set([from, to, ...u.gear.breakpoints(from, to)])].sort((a, b) => a - b);
    const times = new Set<number>(bps);
    // A level fading up while the mix fades down can peak between breakpoints, so look inside too.
    let a: number | undefined;
    for (const b of bps) {
      if (a !== undefined) {
        const n = Math.min(100, Math.floor((b - a) / 20));
        for (let k = 1; k < n; k++) times.add(a + ((b - a) * k) / n);
      }
      a = b;
    }
    let max = 0;
    for (const t of times) {
      if (t < from || t > to) continue;
      max = Math.max(max, measure(u.gear.arcFractionAt(t), facts, this.colourOf(u, t)));
    }
    return max;
  }

  /**
   * Hold the ceiling's measure (arc fraction times the channel sum) at or under the ceiling. A
   * transaction that would raise it past the ceiling has its DAPCs lowered to fit, or is refused.
   */
  private fitCeiling(
    tx: Transaction,
    now: number,
  ): { ok: true; tx: Transaction; note: string } | { ok: false; reason: string } {
    const limit = arcToFraction(this.ceiling) + 1e-9;
    let current = tx;
    for (let attempt = 0; attempt < 3; attempt++) {
      const planned = this.plan(current, now);
      const from = this.firstDelivery(now);
      const fork = this.simulate(planned);
      // Up to where every fade ends: a fade moves one way, so its end is its highest point.
      const to = Math.max(fork.settlesAt(), this.shadow.settlesAt(), from) + 1;
      const over: SimUnit[] = [];
      let worse = false;
      for (const u of fork.all) {
        const after = this.maxMeasure(fork, u.id, from, to);
        if (after <= limit) continue;
        over.push(u);
        if (after > this.maxMeasure(this.shadow, u.id, from, to) + 1e-9) worse = true;
      }
      if (over.length === 0) {
        return {
          ok: true,
          tx: current,
          note: current === tx ? '' : 'Level lowered so the colour mix stays under the ceiling.',
        };
      }
      // Lower each DAPC that reaches an over-ceiling unit to the level its mix allows.
      const frames = planned.map((p) => {
        const f = p.frame;
        if (p.cmd.id !== 'DAPC' || p.cmd.address === undefined) return f;
        const value = p.cmd.value ?? 0;
        if (value === 0 || value === 255) return f;
        let cap = value;
        for (const u of over) {
          if (!u.gear.hears(p.cmd.address)) continue;
          const sum = mixSum(this.factsFor(u), this.colourOf(u, to));
          cap = Math.min(cap, maxArcForMix(this.ceiling, sum));
        }
        if (cap >= value || cap < 1) return f;
        return { ...f, frame: { a: f.frame.a, b: cap } };
      });
      if (frames.every((f, k) => f === current.frames[k])) {
        // Nothing left to lower. Refuse only what makes things worse, so lowering commands still go out.
        if (worse) return { ok: false, reason: 'This would take the light above the ceiling.' };
        return {
          ok: true,
          tx: current,
          note: current === tx ? '' : 'Level lowered as far as it goes.',
        };
      }
      current = { ...current, frames };
    }
    return { ok: false, reason: 'This would take the light above the ceiling.' };
  }

  /** Extra events for commands to gear in an unknown state and, on hardware, for phantom gear (S3.1b). */
  private extraEvents(planned: readonly Planned[]): { t: number; scope: string }[] {
    if (this.target !== 'hardware') return [];
    const out: { t: number; scope: string }[] = [];
    const levelKnown = new Map<number, boolean>();
    const known = (n: number) => levelKnown.get(n) ?? this.info.get(n)?.levelKnown === true;
    for (const p of planned) {
      if (!LIGHT_CHANGING.has(p.cmd.id) && p.cmd.id !== 'DT8_ACTIVATE') continue;
      const a = p.cmd.address;
      if (a === undefined) continue;
      if (a.kind !== 'short' && (this.stale || this.unaddressedPresent))
        out.push({ t: p.deliverAt, scope: PHANTOM });
      for (const n of this.members(a)) {
        const colourUnknown = this.info.get(n)?.colourKnown !== true;
        if (!known(n) || colourUnknown) out.push({ t: p.deliverAt, scope: `a${String(n)}` });
        if (p.cmd.id === 'DAPC' && p.cmd.value !== 255) levelKnown.set(n, true);
        if (p.cmd.id === 'OFF') levelKnown.set(n, true);
      }
      if (a.kind === 'unaddressed') out.push({ t: p.deliverAt, scope: PHANTOM });
    }
    return out;
  }

  /** The rate guard: compare predicted events with and without the transaction. */
  private rateCheck(tx: Transaction, now: number): Violation[] {
    const planned = this.plan(tx, now);
    const first = this.firstDelivery(now);
    const fork = this.simulate(planned);
    // An unlocked RESET is judged with the OFF that follows it: together they are one swing and one
    // hard step (SPEC S3.10). That OFF is then not judged again.
    const resets: { t: number; scopes: string[] }[] = [];
    for (const p of planned) {
      if (p.cmd.id !== 'RESET' || p.cmd.address === undefined) continue;
      const targets = this.members(p.cmd.address);
      const at = p.deliverAt + RESET_OFF_AFTER_MS;
      for (const n of targets) {
        fork.send(
          {
            frame: encode({ id: 'OFF', address: short(n) }).frame,
            sendTwice: false,
            expectReply: false,
          },
          at,
        );
      }
      resets.push({ t: p.deliverAt, scopes: [...targets.map((n) => `a${String(n)}`), ROOM] });
    }
    const instant = this.target === 'hardware' && !FADE_BEHAVIOUR_CONFIRMED;
    const from = now - HISTORY_MS;
    const to = Math.min(
      Math.max(fork.settlesAt(), this.shadow.settlesAt(), first) + 1,
      first + HORIZON_MS,
    );
    const hist = this.synthetic.filter((e) => e.t >= from);
    const base = withExtra(this.predict(this.shadow, from, to, instant), hist);
    const extra = this.extraEvents(planned);
    if (first < this.holdUntil && planned.some((p) => LIGHT_CHANGING.has(p.cmd.id))) {
      return [
        {
          scope: 'bus',
          rule: 'nothing is known about the lights just after connecting',
          retryAt: this.holdUntil,
        },
      ];
    }
    const cand = withExtra(this.predict(fork, from, to, instant), [...hist, ...extra]);
    for (const r of resets) {
      for (const scope of r.scopes) {
        const hard = cand.get(scope)?.hard ?? [];
        const i = hard.findIndex((t) => t > r.t + 1 && t <= r.t + RESET_FOLLOW_UP_MS);
        if (i >= 0) hard.splice(i, 1);
      }
    }
    const v = violations(cand, base, this.swingLimit);
    if (planned.some((p) => p.cmd.id === 'RESET') && first - this.lastResetAt < RESET_INTERVAL_MS) {
      v.push({
        scope: 'bus',
        rule: 'one RESET in 10 s',
        retryAt: this.lastResetAt + RESET_INTERVAL_MS,
      });
    }
    return v;
  }

  /**
   * Predicted events. On hardware, until fades are confirmed, both the instant-step prediction and the
   * faded one count: instant steps are the worst case for hard steps, but a level and a colour fading
   * together can rise and fall on one channel, which only the faded prediction shows.
   */
  private predict(
    sim: Simulator,
    from: number,
    to: number,
    instant: boolean,
  ): Map<string, TraceEvents> {
    const faded = predictEvents(sim, from, to, false);
    if (!instant) return faded;
    const steps = predictEvents(sim, from, to, true);
    const out = new Map<string, TraceEvents>();
    // Both come from the same simulator, so they have the same scopes.
    for (const [scope, a] of faded) {
      const b = steps.get(scope) ?? a;
      out.set(scope, {
        legs: mergeTimes([a.legs, b.legs]),
        hard: mergeTimes([a.hard, b.hard]),
        reversals: mergeTimes([a.reversals, b.reversals]),
      });
    }
    return out;
  }

  /** The earliest time the same transaction would pass, checked by judging it again then. */
  private retryAt(tx: Transaction, now: number, v: readonly Violation[]): { retryAt?: number } {
    let t = Math.max(now + 1, ...v.map((x) => x.retryAt));
    for (let i = 0; i < 16; i++) {
      const again = this.rateCheck(tx, t);
      if (again.length === 0) return { retryAt: Math.ceil(t) };
      // A hint can lag behind when the change would extend an older run, so widen the step then.
      const hint = Math.max(...again.map((x) => x.retryAt));
      t = hint > t ? hint : t + Math.max(20, (t - now) / 4);
    }
    return {};
  }

  // -----------------------------------------------------------------------------------------------
  // observe

  /**
   * Record a frame that went to a transport, with what came back. A refused frame never reached the
   * bus. A fault may have, so everything it could change becomes unknown (SPEC R1.9).
   */
  observe(sent: SentFrame, result: SendResult): void {
    if (result.kind === 'refused') return;
    const f = sent.frame;
    const prev = this.lastSent;
    this.lastSent = f.frame;
    const fault = result.kind === 'fault';
    if (!this.shadowFedByTransport) {
      this.shadow.send(f, sent.at, this.timing.settleLaterMs + FORWARD_FRAME_MS);
    }
    const cmd = decode(f.frame, prev);
    if (cmd === undefined) return;
    const sp = spec(cmd.id);
    const a = cmd.address;
    const targets = a === undefined ? [] : this.members(a);

    // Registers.
    if (sp.sets !== undefined)
      this.dtr[sp.sets] = fault || sent.at < this.deafUntil ? undefined : cmd.value;
    for (const r of sp.gearWrites) this.dtr[r] = undefined;

    // Extra rate-guard events for unknown and phantom gear.
    if (
      this.target === 'hardware' &&
      (LIGHT_CHANGING.has(cmd.id) || cmd.id === 'DT8_ACTIVATE') &&
      a !== undefined
    ) {
      if (a.kind !== 'short' && (this.stale || this.unaddressedPresent))
        this.synthetic.push({ t: sent.at, scope: PHANTOM });
      if (a.kind === 'unaddressed') this.synthetic.push({ t: sent.at, scope: PHANTOM });
      for (const n of targets) {
        if (this.info.get(n)?.levelKnown !== true)
          this.synthetic.push({ t: sent.at, scope: `a${String(n)}` });
      }
    }
    this.synthetic = this.synthetic.filter((e) => e.t >= sent.at - HISTORY_MS - 1000);

    if (cmd.id === 'RESET' || cmd.id === 'SAVE_PERSISTENT_VARIABLES')
      this.deafUntil = sent.at + RESET_DEAF_MS + 50;
    if (cmd.id === 'RESET') {
      this.lastResetAt = sent.at;
      this.resetOff = { targets: new Set(targets), until: sent.at + RESET_FOLLOW_UP_MS };
    } else if (cmd.id === 'OFF' && this.resetOff !== undefined && a?.kind === 'short') {
      this.resetOff.targets.delete(a.n);
    }
    if (STALES_INVENTORY.has(cmd.id)) this.stale = true;
    if (cmd.id === 'PROGRAM_SHORT_ADDRESS' || cmd.id === 'SET_SHORT_ADDRESS') {
      for (const i of this.info.values()) i.verified = false;
    }

    for (const n of targets) {
      const i = this.addr(n);
      if (fault) {
        i.verified = false;
        i.levelKnown = this.target === 'simulator';
        i.colourKnown = this.target === 'simulator';
      }
      switch (cmd.id) {
        case 'RESET':
          i.verified = false;
          i.maxLevel = 254;
          i.minLevel = i.physicalMinimum;
          i.linearCurve = false;
          i.groups = 0;
          i.fadeReadBack = false;
          break;
        case 'DT6_SELECT_DIMMING_CURVE':
          i.verified = false;
          i.linearCurve = undefined;
          break;
        case 'SET_MAX_LEVEL':
        case 'SET_MIN_LEVEL':
          // The value is known only once read back.
          if (cmd.id === 'SET_MAX_LEVEL') i.maxLevel = undefined;
          else i.minLevel = undefined;
          break;
        case 'SET_FADE_TIME':
        case 'SET_FADE_RATE':
        case 'SET_EXTENDED_FADE_TIME':
          i.fadeReadBack = false;
          break;
        case 'ADD_TO_GROUP':
          if (i.groups !== undefined) i.groups |= 1 << (cmd.value ?? 0);
          break;
        case 'REMOVE_FROM_GROUP':
          if (i.groups !== undefined) i.groups &= ~(1 << (cmd.value ?? 0));
          break;
        case 'DAPC':
          if (!fault && cmd.value !== 255) i.levelKnown = true;
          break;
        case 'OFF':
          if (!fault) i.levelKnown = true;
          break;
        case 'DT8_SET_TEMPORARY_TC':
          this.tempSeen.set(n, new Set(['tc']));
          break;
        case 'DT8_SET_TEMPORARY_RGB':
        case 'DT8_SET_TEMPORARY_WAF': {
          const seen = this.tempSeen.get(n) ?? new Set<string>();
          seen.add(cmd.id === 'DT8_SET_TEMPORARY_RGB' ? 'rgb' : 'waf');
          this.tempSeen.set(n, seen);
          break;
        }
        case 'DT8_ACTIVATE': {
          // The colour is known only when this session set all of it before activating.
          const seen = this.tempSeen.get(n);
          if (
            !fault &&
            seen !== undefined &&
            (seen.has('tc') || (seen.has('rgb') && seen.has('waf')))
          )
            i.colourKnown = true;
          this.tempSeen.delete(n);
          break;
        }
        default:
          break;
      }
    }

    // Facts from replies to a single address.
    if (a?.kind === 'short' && sp.reply !== 'none' && !fault) this.learn(a.n, cmd, result);
    if (
      (a?.kind === 'broadcast' || a?.kind === 'unaddressed') &&
      cmd.id === 'QUERY_MISSING_SHORT_ADDRESS' &&
      !fault
    ) {
      this.unaddressedPresent = result.kind !== 'no-reply';
    }
  }

  private learn(n: number, cmd: Command, result: SendResult): void {
    const i = this.addr(n);
    const v = result.kind === 'reply' ? result.byte : undefined;
    switch (cmd.id) {
      case 'QUERY_CONTROL_GEAR_PRESENT':
        i.present = result.kind !== 'no-reply';
        break;
      case 'QUERY_PHYSICAL_MINIMUM':
        i.physicalMinimum = v;
        break;
      case 'QUERY_MIN_LEVEL':
        i.minLevel = v;
        break;
      case 'QUERY_MAX_LEVEL':
        i.maxLevel = v;
        break;
      case 'DT6_QUERY_DIMMING_CURVE':
        i.linearCurve = v === undefined ? undefined : v !== 0;
        break;
      case 'QUERY_DEVICE_TYPE':
        i.deviceTypes = v === undefined || v === 255 ? [] : v === 254 ? [] : [v];
        // Gear with no colour has no colour to be unknown.
        if (v !== undefined && v !== 255 && v !== 8) i.colourKnown = true;
        break;
      case 'QUERY_NEXT_DEVICE_TYPE':
        if (v !== undefined && v !== 254) i.deviceTypes = [...(i.deviceTypes ?? []), v];
        break;
      case 'DT8_QUERY_COLOUR_TYPE_FEATURES':
        if (v !== undefined) i.colour = { tc: (v & 2) !== 0, channels: (v >> 5) & 7 };
        break;
      case 'QUERY_FADE_TIME_FADE_RATE':
        if (v !== undefined) i.fadeReadBack = true;
        break;
      case 'QUERY_GROUPS_0_7':
        if (v !== undefined) i.groups = ((i.groups ?? 0) & 0xff00) | v;
        break;
      case 'QUERY_GROUPS_8_15':
        if (v !== undefined) i.groups = ((i.groups ?? 0) & 0x00ff) | (v << 8);
        break;
      case 'QUERY_ACTUAL_LEVEL':
        if (v !== undefined && v !== 255) i.levelKnown = true;
        break;
      default:
        break;
    }
  }

  /**
   * Record that panic's frames went out, so the rate guard counts the OFF (SPEC S3.9). Panic does not
   * go through `judge`.
   */
  observePanic(sent: SentFrame, result: SendResult): void {
    this.observe(sent, result);
  }

  /** True when an address's light, by the ceiling's measure, is above the ceiling at a time. */
  overCeiling(n: number, at: number): boolean {
    const u = this.shadow.byShortAddress(n);
    if (u === undefined) return false;
    const m = measure(u.gear.arcFractionAt(at), this.factsFor(u), this.colourOf(u, at));
    return m > arcToFraction(this.ceiling) + 1e-9;
  }

  /** Gear facts as a person would see them: for the UI and the tests. */
  colourFacts(n: number): ColourFacts | undefined {
    return this.info.get(n)?.colour;
  }

  /** A short summary of the state that `judge` must not change. */
  fingerprint(): string {
    return JSON.stringify({
      ceiling: this.ceiling,
      unlocked: [...this.unlocked].sort(),
      swings: this.swings,
      latched: this.latched,
      dtr: this.dtr,
      deafUntil: this.deafUntil,
      stale: this.stale,
      unaddressedPresent: this.unaddressedPresent,
      lastResetAt: this.lastResetAt,
      lastSent: this.lastSent,
      info: [...this.info.entries()],
      synthetic: this.synthetic,
      resetOff:
        this.resetOff === undefined
          ? null
          : { targets: [...this.resetOff.targets], until: this.resetOff.until },
      shadow: this.shadow.all.map((u) => u.gear.snapshot()),
    });
  }
}

export { scopeOf };
