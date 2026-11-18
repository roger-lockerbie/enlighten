/**
 * The governor (ADR 0004, ADR 0005, ADR 0011). Every transaction from every source is judged here just
 * before it is sent. `judge` changes nothing. `observe` is the only way the governor's view advances.
 */
import { short, type Address } from '../dali/address.ts';
import { decode, encode, frameText, type Command, type Frame } from '../dali/codec.ts';
import { spec, type CommandSpec } from '../dali/commands.ts';
import { arcToFraction } from '../dali/curve.ts';
import {
  DAPC_SEQUENCE_MS,
  extendedFadeMs,
  fadeRateStepsPerSecond,
  fadeTimeMs,
  fastFadeMs,
  UP_DOWN_MS,
} from '../dali/fade.ts';
import type { TxFrame } from '../dali/sequences.ts';
import type { BusReply } from '../dali/reply.ts';
import {
  DEFAULT_TIMING,
  FORWARD_FRAME_MS,
  settleMs,
  wireMs,
  type BusTiming,
} from '../bus/timing.ts';
import type { Simulator, SimUnit } from '../sim/simulator.ts';
import { Da5l, RESET_DEAF_MS } from '../sim/gear.ts';
import { da5l, type Da5lProfile } from '../sim/profile.ts';
import { maxArcForMix, measure, mixSum, WORST_FACTS, type ColourFacts } from './mix.ts';
import { PHANTOM, predictEvents, ROOM, scopeOf } from './rate/trace.ts';
import { uniteTimes, type TraceEvents } from './rate/legs.ts';
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
// When this becomes true, SPEC S3.7 still needs the address's fade time read back this session
// (`AddressInfo.fadeReadBack`) before a command to it counts as faded. That check comes with the change.

/** Recalls of gear memory that a scan does not read: on hardware their result is unknown. */
const RECALLS_MEMORY: ReadonlySet<string> = new Set(['GO_TO_LAST_ACTIVE_LEVEL']);

/** Level commands after which the gear's last active level is what the shadow says. */
const SETS_LAST_ACTIVE: ReadonlySet<string> = new Set([
  'DAPC',
  'UP',
  'DOWN',
  'STEP_UP',
  'STEP_DOWN',
  'RECALL_MAX_LEVEL',
  'RECALL_MIN_LEVEL',
  'ON_AND_STEP_UP',
  'CONTINUOUS_UP',
  'CONTINUOUS_DOWN',
]);

/** The DA5-L light type that matches what gear reported, for a hardware shadow unit. */
function profileFor(
  types: readonly number[],
  colour: ColourFacts | undefined,
  physicalMinimum: number,
): Da5lProfile {
  // The physical minimum the gear reported, so SET MIN LEVEL and RESET clamp as the gear does.
  const s = { physicalMinimum };
  if (!types.includes(8) || colour === undefined) return da5l('C1', 'tc', s);
  if (colour.channels === 0) return da5l('C2', 'tc', s);
  if (colour.channels === 2) return da5l('C2', 'rgbwaf', s);
  if (colour.channels === 3) return colour.tc ? da5l('C5', 'tc', s) : da5l('C3', 'rgbwaf', s);
  if (colour.channels === 4) return da5l('C4', 'rgbwaf', s);
  return da5l('C5', 'rgbwaf', s);
}

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
/** The RESET's own jump to full is a hard step this soon after its delivery: the frame and settling. */
export const RESET_JUMP_WINDOW_MS = 150;
/** How far back the rate guard looks. */
export const HISTORY_MS = 6000;
/**
 * How far ahead the rate guard predicts at most: past the longest fade (16 minutes). A slow fade is
 * one long leg, and whether it reaches the leg ratio can depend on its far end.
 */
export const HORIZON_MS = 17 * 60_000;
/** Gear in an unknown state is taken to move this much longer than its longest fade. */
const MOVING_MARGIN_MS = 100;
/** When it is not known how long such gear may move, a refused change may ask again this soon. */
const UNKNOWN_RETRY_MS = 10_000;
/**
 * The longest fade DALI allows: an extended fade of 16 minutes. Gear whose fade settings are not known
 * may move this long, so a refusal always has a time to ask again (security review S6-S16-1).
 */
const LONGEST_DALI_FADE_MS = 16 * 60_000;
/** Commands that change a fade setting, which a scan has to read again. */
const FADE_SETTINGS: ReadonlySet<string> = new Set([
  'SET_FADE_TIME',
  'SET_FADE_RATE',
  'SET_EXTENDED_FADE_TIME',
  'DT6_STORE_DTR_AS_FAST_FADE_TIME',
  'RESET',
]);

/** The short address of a scope such as `a12`, or undefined for the room, phantom and unit scopes. */
/**
 * The key for gear the inventory has not found, or that has no short address, in the moving marks
 * (DALI review S6-D16-3). Short addresses are 0 to 63.
 */
const UNFOUND = -1;

function addressOfScope(scope: string): number | undefined {
  if (scope === PHANTOM) return UNFOUND;
  const m = /^a(\d+)$/.exec(scope);
  return m === null ? undefined : Number(m[1]);
}

function gearName(n: number): string {
  return n === UNFOUND ? 'Gear the inventory has not found' : `A${String(n)}`;
}

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
  /**
   * On hardware: whether the shadow has a unit at this address built from read-backs, so its
   * predictions can be trusted (ADR 0011). Always true in the Simulator target.
   */
  modelled: boolean;
  fadeTime?: number | undefined;
  fadeRate?: number | undefined;
  extendedFade?: number | undefined;
  /** The last level read back. */
  level?: number | undefined;
  /** DT6 fast fade time, as read back. */
  fastFade?: number | undefined;
  /** The 16 scene levels read back. */
  scenes?: (number | undefined)[] | undefined;
  /** A command other than a query reached the gear since its scan began, so read-backs may be stale. */
  dirty?: boolean | undefined;
  /** QUERY STATUS said a fade was running when last read. */
  fading?: boolean | undefined;
  /** On hardware: whether the shadow's last active level matches the gear's (a level command this session set it). */
  lastActiveKnown?: boolean | undefined;
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

/** A frozen deep copy, so what was approved is what is sent. */
function freeze(tx: Transaction): Transaction {
  const frames = tx.frames.map((f) =>
    Object.freeze({ ...f, frame: Object.freeze({ ...f.frame }) }),
  );
  return Object.freeze({ ...tx, frames: Object.freeze(frames) });
}

function approve(tx: Transaction, issuedAt: number): Approved {
  const a = Object.freeze({ tx, issuedAt }) as unknown as Approved;
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
  /** When the last frame was delivered: the time the shadow is at. */
  private lastAt = 0;
  private readonly info = new Map<number, AddressInfo>();
  /** Legs and hard steps the traces cannot show: commands to gear in an unknown state, and phantom gear. */
  private synthetic: { t: number; scope: string; until: number; tx?: number | undefined }[] = [];
  /** The OFF that follows an unlocked RESET is part of the RESET's one swing (SPEC S3.10). */
  private resetOff: { targets: Set<number>; until: number } | undefined;
  /**
   * On hardware: until when gear in an unknown state may still be moving, by address. Its fade
   * crosses other lights' at times the shadow cannot know (ADR 0016).
   */
  private readonly unsureMoving = new Map<number, number>();
  private holdUntil: number;
  private holdReason = 'nothing is known about the lights just after connecting';
  /** If set, a refusal in the hold asks to be tried again this soon, not at the hold's end. */
  private holdRetryMs: number | undefined;
  /** Addresses with a temporary colour set since their last ACTIVATE: 'tc', 'rgb', 'waf' parts seen. */
  private readonly tempSeen = new Map<number, Set<string>>();
  /** Approvals this governor issued, so a router can refuse another connection's (ADR 0012). */
  private readonly approvals = new WeakSet<object>();

  constructor(opts: GovernorOptions) {
    this.target = opts.target;
    this.shadow = opts.shadow;
    this.timing = opts.timing ?? DEFAULT_TIMING;
    const ceiling = opts.ceilingArc ?? DEFAULT_CEILING_ARC;
    if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 254) {
      throw new RangeError('The ceiling must be an arc level from 1 to 254.');
    }
    this.ceiling = ceiling;
    this.shadowFedByTransport = opts.shadowFedByTransport ?? opts.target === 'simulator';
    if (opts.target === 'hardware' && opts.connectedAt === undefined) {
      throw new Error('A hardware governor needs the time of the connect.');
    }
    this.holdUntil =
      opts.target === 'hardware' ? (opts.connectedAt ?? 0) + CONNECT_HOLD_MS : -Infinity;
  }

  /**
   * Hold every light change but OFF until a time, with a reason, as after a hardware connect. The
   * engine uses it while the simulated bench is rebuilt: new gear has no history for the rate guard,
   * so nothing may light it until the hard step window has passed (ADR 0013, DALI review S5-D1).
   * It replaces any hold this governor had. Only the simulated bench's governor is given one. A hold
   * whose end is not known yet gives `retryMs`, so waiting work asks again soon rather than at its end.
   */
  holdLightChanges(until: number, reason: string, retryMs?: number): void {
    this.holdUntil = until;
    this.holdReason = reason;
    this.holdRetryMs = retryMs;
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
    if (!Number.isInteger(n) || n < 1 || n > 3)
      return no('The swing limit is a whole number from 1 to 3.');
    if (n > 1 && !this.unlocked.has('rate'))
      return no('Raising the swing limit needs the rate unlock.');
    this.swings = swingLimit(n);
    return OK;
  }

  setOperatorCanSee(can: boolean, source: Source): Outcome {
    if (!isPerson(source))
      return no('Only the operator can answer whether they can see the lights.');
    this.operatorCanSee = can;
    if (!can) this.lock('rate');
    return OK;
  }

  /** True when this governor issued the approval: a router accepts only its own governor's. */
  issued(a: unknown): boolean {
    return typeof a === 'object' && a !== null && this.approvals.has(a);
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
    // Every gear there is has been found, so nothing unfound can still be moving.
    if (!unaddressedPresent) this.unsureMoving.delete(UNFOUND);
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
  judge(input: Transaction, now: number): Verdict {
    // Judge a frozen copy, so what is judged is exactly what is approved and sent (review L2).
    const tx = freeze(input);
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
    // That exemption covers only the confirmed command, so it travels on its own (review L2).
    if (
      confirmed &&
      decodeFrames(candidate.frames).some(
        (c) => LIGHT_CHANGING.has(c.id) && !CONFIRMED_RAISE.has(c.id),
      )
    ) {
      return { kind: 'refuse', reason: 'Send RESET and the other unlocked commands on their own.' };
    }
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
    // The approval holds a frozen copy, and the scheduler sends from it (security review M1).
    const sealed = freeze(candidate);
    const approval = approve(sealed, now);
    this.approvals.add(approval);
    if (candidate === tx) return { kind: 'allow', approval };
    return { kind: 'clamp', tx: sealed, note: notes.join(' '), approval };
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
        modelled: this.target === 'simulator',
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
    // `deliverAt` is when the frame reaches the gear, for the RESET deafness check below.
    for (const { frame: f, cmd, deliverAt } of this.schedule(tx, now)) {
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
      // 255 keeps the level, and the measure counts a masked channel (255) as full.
      const lvl = Math.min(level, this.ceiling);
      if (measure(arcToFraction(lvl), f, t.ch) > arcToFraction(this.ceiling) + 1e-9) {
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
    const i = n === null ? undefined : this.info.get(n);
    if (i?.colour !== undefined) return i.colour;
    // Gear that reported its device types without 8 has no colour: one channel (SPEC R6.6).
    if (i?.deviceTypes !== undefined && i.deviceTypes.length > 0 && !i.deviceTypes.includes(8)) {
      return { tc: false, channels: 0 };
    }
    return WORST_FACTS;
  }

  private colourOf(u: SimUnit, t: number): readonly number[] {
    const n = u.gear.shortAddress;
    const known = n !== null && this.info.get(n)?.colourKnown === true;
    // An unknown colour has no channels to read, and the measure counts a missing channel as full.
    return known ? u.gear.colourAt(t).ch : [];
  }

  /**
   * Each frame with its command (decoded with the frame before it) and when the scheduler would
   * deliver it to the gear, for a transaction that starts on a free bus at `now`.
   */
  private schedule(
    tx: Transaction,
    now: number,
  ): { frame: TxFrame; cmd: Command | undefined; deliverAt: number }[] {
    const out: { frame: TxFrame; cmd: Command | undefined; deliverAt: number }[] = [];
    let prev: Frame | undefined;
    let free = now;
    for (const f of tx.frames) {
      const deliverAt = free + settleMs(f, prev === undefined, this.timing) + FORWARD_FRAME_MS;
      free = deliverAt - FORWARD_FRAME_MS + wireMs(f, this.timing);
      out.push({ frame: f, cmd: decode(f.frame, prev), deliverAt });
      prev = f.frame;
    }
    return out;
  }

  /** The schedule of a transaction that passed the rules, so every frame decodes. */
  private plan(tx: Transaction, now: number): Planned[] {
    return this.schedule(tx, now).map(({ frame, cmd, deliverAt }) => {
      if (cmd === undefined) throw new Error('plan() needs a transaction that passed the rules');
      return { frame, cmd, spec: spec(cmd.id), deliverAt };
    });
  }

  /** When the first frame of a transaction starting on a free bus at `now` reaches the gear. */
  private firstDelivery(now: number): number {
    return now + this.timing.settleFirstMs + FORWARD_FRAME_MS;
  }

  private simulate(
    planned: readonly Planned[],
    extra: readonly { frame: TxFrame; at: number }[] = [],
  ): Simulator {
    const fork = this.shadow.fork();
    const gap = this.timing.settleLaterMs + FORWARD_FRAME_MS;
    // Frames go to the fork in time order: the gear plans each change from the one before.
    const all = [...planned.map((p) => ({ frame: p.frame, at: p.deliverAt })), ...extra].sort(
      (a, b) => a.at - b.at,
    );
    for (const f of all) fork.send(f.frame, f.at, gap);
    return fork;
  }

  /**
   * The OFF an unlocked RESET is still waiting to send. Until it goes, every judgement predicts it,
   * with and without the transaction, so a change made between a RESET and its OFF is judged with
   * the OFF that will follow it (DALI review of ADR 0015).
   */
  private pendingResetOff(now: number): { frame: TxFrame; at: number }[] {
    const r = this.resetOff;
    // The OFF goes at the head of the queue 350 ms after the RESET, or later on a slow transport. It is
    // predicted for as long as it would pass as the follow-up, so nothing judged before it goes is
    // judged without it (second DALI review of ADR 0015).
    if (r === undefined || r.targets.size === 0 || now > r.until) return [];
    const at = Math.max(now, this.lastResetAt + RESET_OFF_AFTER_MS);
    return [...r.targets].map((n) => ({
      frame: {
        frame: encode({ id: 'OFF', address: short(n) }).frame,
        sendTwice: false,
        expectReply: false,
      },
      at,
    }));
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
    // Every time is inside the range: breakpoints come from it, and the rest lie between them.
    let max = 0;
    for (const t of times) {
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
  private extraEvents(planned: readonly Planned[]): { t: number; scope: string; until: number }[] {
    const levelKnown = new Map<number, boolean>();
    const out: { t: number; scope: string; until: number }[] = [];
    for (const p of planned) {
      // One per scope per transaction, as observe records them.
      for (const e of this.unknownEvents(
        p.cmd,
        p.deliverAt,
        (n) => levelKnown.get(n) ?? this.info.get(n)?.levelKnown === true,
      )) {
        const same = out.find((x) => x.scope === e.scope);
        if (same === undefined) out.push({ ...e, until: e.t });
        else same.until = e.t;
      }
      for (const n of p.cmd.address === undefined ? [] : this.members(p.cmd.address)) {
        if ((p.cmd.id === 'DAPC' && p.cmd.value !== 255) || p.cmd.id === 'OFF')
          levelKnown.set(n, true);
        if (RECALLS_MEMORY.has(p.cmd.id)) levelKnown.set(n, false);
      }
    }
    return out;
  }

  /**
   * On hardware, a light change that the shadow cannot predict counts as a leg and a hard step for
   * the address and the room. That is: gear the shadow does not model from read-backs, a level or
   * colour not known, a recall of memory the scan does not read (scenes, the last active level), and
   * phantom gear while the inventory is stale or unaddressed gear is present. `judge` and `observe` use
   * this one function, so what is judged is what is remembered (security review H1).
   */
  private unknownEvents(
    cmd: Command,
    at: number,
    levelKnown: (n: number) => boolean,
  ): { t: number; scope: string }[] {
    if (this.target !== 'hardware') return [];
    if (!LIGHT_CHANGING.has(cmd.id)) return [];
    const a = cmd.address;
    if (a === undefined) return [];
    const out: { t: number; scope: string }[] = [];
    if (
      a.kind === 'unaddressed' ||
      (a.kind !== 'short' && (this.stale || this.unaddressedPresent))
    ) {
      out.push({ t: at, scope: PHANTOM });
    }
    for (const n of this.members(a)) {
      const i = this.info.get(n);
      // Scene levels are read in the scan. Scene colours are not.
      const sceneColour = cmd.id === 'GO_TO_SCENE' && (i?.deviceTypes ?? []).includes(8);
      const unknown =
        i === undefined ||
        !i.modelled ||
        !levelKnown(n) ||
        !i.colourKnown ||
        RECALLS_MEMORY.has(cmd.id) ||
        sceneColour;
      if (unknown) out.push({ t: at, scope: `a${String(n)}` });
    }
    // The room is a sum: while any gear is not fully known, the shadow's room total can be wrong, so
    // every light change also counts as a leg and a hard step for the room.
    const unsure = [...this.info.entries()].some(
      ([n, i]) => i.present === true && (!i.modelled || !levelKnown(n) || !i.colourKnown),
    );
    if (unsure) out.push({ t: at, scope: ROOM });
    return out;
  }

  /**
   * Build or refresh the shadow's unit for an address from what a scan read back (security review
   * C1). On hardware the shadow starts empty. An address is modelled only once every value the
   * prediction depends on has been read.
   */
  /** A scan of this address starts: read-backs from now on describe the gear until something is sent to it. */
  beginScan(n: number): void {
    const i = this.addr(n);
    i.dirty = false;
    i.fading = undefined;
  }

  modelAddress(n: number): Outcome {
    if (this.target !== 'hardware') return OK;
    const i = this.addr(n);
    i.modelled = false;
    // Read-backs taken before a later write, or during a fade, would seed a wrong model (review N1).
    if (i.dirty === true)
      return no('Something was sent to the gear during the scan. Scan it again.');
    if (i.fading === undefined) return no('QUERY STATUS was not read back.');
    if (i.fading) {
      this.markMoving(n, this.lastAt);
      return no('The gear was fading during the scan. Scan it again when it settles.');
    }
    const types = i.deviceTypes;
    if (i.present !== true || types === undefined) return no('The gear has not answered a scan.');
    const needs = [
      i.physicalMinimum,
      i.minLevel,
      i.maxLevel,
      i.groups,
      i.fadeTime,
      i.fadeRate,
      i.extendedFade,
      i.level,
    ];
    if (needs.some((x) => x === undefined)) return no('A value the model needs was not read back.');
    if (types.includes(6) && i.linearCurve === undefined)
      return no('The dimming curve was not read back.');
    if (types.includes(8) && i.colour === undefined)
      return no('The colour features were not read back.');
    const scenes = i.scenes ?? [];
    if (scenes.length < 16 || scenes.some((x) => x === undefined))
      return no('The scene levels were not read back.');
    if (types.includes(6) && i.fastFade === undefined)
      return no('The fast fade time was not read back.');
    // A fresh unit each time, so the light type, physical minimum and device types match the read-backs.
    const profile = profileFor(types, i.colour, i.physicalMinimum ?? 85);
    const gear = new Da5l(profile, {
      shortAddress: n,
      at: this.lastAt,
      deviceTypesOverride: types,
    });
    const unit = { id: `hw${String(n)}`, gear };
    this.shadow.replace(unit, (u) => u.gear.shortAddress === n);
    unit.gear.applyFacts(
      {
        minLevel: i.minLevel,
        maxLevel: i.maxLevel,
        groups: i.groups,
        fastFade: i.fastFade,
        fadeTime: i.fadeTime,
        fadeRate: i.fadeRate,
        extendedFade: i.extendedFade,
        linear: i.linearCurve ?? false,
        level: i.level,
        scenes: scenes.map((x) => x ?? 255),
      },
      this.lastAt,
    );
    i.modelled = true;
    i.levelKnown = true;
    i.lastActiveKnown = false;
    this.unsureMoving.delete(n);
    if (!types.includes(8)) i.colourKnown = true;
    return OK;
  }

  /**
   * The longest an address's output can keep moving after a command: its longest fade, from the
   * shadow when it models the gear, otherwise from the scan's read-backs, with CONTINUOUS UP or DOWN
   * at the fade rate. The longest DALI allows when
   * a fade setting was sent since the scan, or none was read.
   */
  private longestFadeMs(n: number, cmd?: string): number {
    const u = this.shadow.all.find((x) => x.gear.shortAddress === n);
    const i = this.info.get(n);
    const s =
      i?.modelled === true && u !== undefined
        ? u.gear.snapshot()
        : {
            fadeTime: i?.fadeTime,
            fadeRate: i?.fadeRate,
            fastFade: i?.fastFade ?? 0,
            extendedFade: i?.extendedFade,
          };
    // CONTINUOUS UP or DOWN runs at the fade rate, across the whole range at most. When the command
    // is not known, as for gear seen fading during its scan, it may be one of them (S6-D16-2).
    const atRate = cmd === undefined || cmd === 'CONTINUOUS_UP' || cmd === 'CONTINUOUS_DOWN';
    if (s.fadeTime === undefined || s.extendedFade === undefined) return LONGEST_DALI_FADE_MS;
    if (atRate && s.fadeRate === undefined) return LONGEST_DALI_FADE_MS;
    return Math.max(
      fadeTimeMs(s.fadeTime),
      atRate ? (253 * 1000) / fadeRateStepsPerSecond(s.fadeRate ?? 1) : 0,
      s.fastFade >= 27 ? 700 : fastFadeMs(s.fastFade),
      extendedFadeMs(s.extendedFade),
      UP_DOWN_MS,
      DAPC_SEQUENCE_MS,
    );
  }

  private markMoving(n: number, at: number, cmd?: string): void {
    // An address a scan found empty has nothing to move (S6-S16-1).
    if (this.info.get(n)?.present === false) return;
    const until = at + this.longestFadeMs(n, cmd) + MOVING_MARGIN_MS;
    this.unsureMoving.set(n, Math.max(this.unsureMoving.get(n) ?? -Infinity, until));
  }

  /** OFF ends any fade at once, so the gear has stopped moving by the margin after it (S6-S16-4). */
  private markOff(n: number, at: number): void {
    if (this.info.get(n)?.present === false) return;
    this.unsureMoving.set(n, at + MOVING_MARGIN_MS);
  }

  /**
   * On hardware, the room cannot be predicted while gear in an unknown state moves at the same time as
   * other gear: their fades cross at times the shadow does not know. One broadcast made four room legs
   * in 0.7 s while the guard counted one (ADR 0016). So a light change that moves such gear together
   * with any other moving gear, or moves other gear while such gear may still be moving, is refused.
   */
  private unknownMix(
    planned: readonly Planned[],
    fork: Simulator,
    extra: readonly { scope: string }[],
    first: number,
  ): Violation | undefined {
    if (this.target !== 'hardware') return undefined;
    const changed = new Set<number>();
    let onlyOff = true;
    for (const p of planned) {
      if (!LIGHT_CHANGING.has(p.cmd.id) || p.cmd.address === undefined) continue;
      if (p.cmd.id !== 'OFF') onlyOff = false;
      for (const n of this.members(p.cmd.address)) changed.add(n);
    }
    // Gear in an unknown state that this transaction moves, the gear the inventory has not found among
    // it: a frame to unaddressed gear changes no short address.
    const moves = new Set<number>();
    for (const e of extra) {
      const n = addressOfScope(e.scope);
      if (n !== undefined) moves.add(n);
    }
    // OFF ends every fade it reaches at once, so it crosses nothing; the hold lets it through too.
    if ((changed.size === 0 && moves.size === 0) || onlyOff) return undefined;
    const still = [...this.unsureMoving].filter(([n, until]) => until > first && !moves.has(n));
    const wait = Math.max(-Infinity, ...still.map(([, until]) => until));
    const retryAt = Number.isFinite(wait) ? wait : first + UNKNOWN_RETRY_MS;
    if (moves.size === 0) {
      if (still.length === 0) return undefined;
      return {
        scope: ROOM,
        rule: `${gearName(still[0]?.[0] ?? 0)} may still be fading in a state the guard does not know, so other lights wait for it or for a new scan`,
        retryAt,
      };
    }
    const othersMoving = fork.all.some((u) => {
      const sa = u.gear.shortAddress;
      return (sa === null || !moves.has(sa)) && u.gear.settlesAt() > first;
    });
    const others = [...changed].some((n) => !moves.has(n));
    if (moves.size === 1 && !others && !othersMoving && still.length === 0) return undefined;
    return {
      scope: ROOM,
      rule: `${gearName([...moves][0] ?? 0)} is in a state the guard does not know, so it changes only on its own while nothing else moves`,
      retryAt,
    };
  }

  /** The rate guard: compare predicted events with and without the transaction. */
  private rateCheck(tx: Transaction, now: number): Violation[] {
    const planned = this.plan(tx, now);
    const first = this.firstDelivery(now);
    const pending = this.pendingResetOff(now);
    const fork = this.simulate(planned, pending);
    const baseSim = pending.length > 0 ? this.simulate([], pending) : this.shadow;
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
      Math.max(fork.settlesAt(), baseSim.settlesAt(), first) + 1,
      first + HORIZON_MS,
    );
    const hist = this.synthetic.filter((e) => e.t >= from);
    const base = withExtra(this.predict(baseSim, from, to, instant), hist);
    const extra = this.extraEvents(planned);
    // Switching off is always allowed in the hold: it cannot add a flash on top of an unknown past.
    const onlyOff = planned.every(
      (p) =>
        p.cmd.id === 'OFF' ||
        (p.cmd.id === 'DAPC' && p.cmd.value === 0) ||
        !LIGHT_CHANGING.has(p.cmd.id),
    );
    if (first < this.holdUntil && !onlyOff) {
      return [
        {
          scope: 'bus',
          rule: this.holdReason,
          hold: true,
          retryAt:
            this.holdRetryMs === undefined
              ? this.holdUntil
              : Math.min(this.holdUntil, first + this.holdRetryMs),
        },
      ];
    }
    const cand = withExtra(this.predict(fork, from, to, instant), [...hist, ...extra]);
    for (const r of resets) {
      const jumpedIn = (scope: string) =>
        (cand.get(scope)?.hard ?? []).some((t) => t >= r.t - 1 && t <= r.t + RESET_JUMP_WINDOW_MS);
      // In the room, only the RESET's own driver jumping counts as its jump, not another driver's
      // step in the same moment (security review of ADR 0015, L2).
      const own = r.scopes.some((scope) => scope !== ROOM && jumpedIn(scope));
      for (const scope of r.scopes) {
        const hard = cand.get(scope)?.hard ?? [];
        // The RESET's jump to full and its OFF are one hard step, dated at the jump. When the jump
        // was not a hard step (the light was already bright), the OFF is the one hard step (ADR
        // 0015: dropping the first hard step after the RESET dropped the OFF even when the jump had
        // been folded into an earlier rise, which let a flash through). Only a hard step at the
        // RESET's own delivery counts as its jump, and only the step nearest the planned OFF is
        // dropped, so another command's step in the window still counts.
        if (!jumpedIn(scope) || (scope === ROOM && !own)) continue;
        const offAt = r.t + RESET_OFF_AFTER_MS;
        let j = -1;
        hard.forEach((t, k) => {
          if (t <= r.t + RESET_JUMP_WINDOW_MS || t > r.t + RESET_FOLLOW_UP_MS) return;
          if (j < 0 || Math.abs(t - offAt) < Math.abs((hard[j] ?? Infinity) - offAt)) j = k;
        });
        if (j >= 0) hard.splice(j, 1);
      }
    }
    const v = violations(cand, base, this.swingLimit);
    const mix = this.unknownMix(planned, fork, extra, first);
    if (mix !== undefined) v.push(mix);
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
        legs: uniteTimes(a.legs, b.legs),
        hard: uniteTimes(a.hard, b.hard),
        reversals: uniteTimes(a.reversals, b.reversals),
      });
    }
    return out;
  }

  /** The earliest time the same transaction would pass, checked by judging it again then. */
  private retryAt(tx: Transaction, now: number, v: readonly Violation[]): { retryAt?: number } {
    // A hold whose end is not known yet gives its own time to ask again. Judging further ahead would
    // find only the hold, and give up before its end (DALI re-review S5-D13).
    const [only] = v;
    if (this.holdRetryMs !== undefined && v.length === 1 && only?.hold === true)
      return { retryAt: Math.ceil(Math.max(now + 1, only.retryAt)) };
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
  observe(sent: SentFrame, result: SendResult): BusReply | undefined {
    if (result.kind === 'refused') return undefined;
    const f = sent.frame;
    const prev = this.lastSent;
    this.lastSent = f.frame;
    this.lastAt = sent.at;
    const fault = result.kind === 'fault';
    // The shadow's own answer, before anything is learned from the hardware's (SPEC R1.5).
    const shadowReply = this.shadowFedByTransport
      ? undefined
      : this.shadow.send(f, sent.at, this.timing.settleLaterMs + FORWARD_FRAME_MS);
    const cmd = decode(f.frame, prev);
    if (cmd === undefined) return shadowReply;
    const sp = spec(cmd.id);
    const a = cmd.address;
    const targets = a === undefined ? [] : this.members(a);

    // Registers.
    if (sp.sets !== undefined)
      this.dtr[sp.sets] = fault || sent.at < this.deafUntil ? undefined : cmd.value;
    for (const r of sp.gearWrites) this.dtr[r] = undefined;

    // Extra rate-guard events for unknown and phantom gear: the same ones judge counted.
    // One per scope per transaction, as judge counts them.
    for (const e of this.unknownEvents(
      cmd,
      sent.at,
      (n) => this.info.get(n)?.levelKnown === true,
    )) {
      const same =
        sent.tx === undefined
          ? undefined
          : this.synthetic.find((x) => x.tx === sent.tx && x.scope === e.scope);
      if (same === undefined) this.synthetic.push({ ...e, until: e.t, tx: sent.tx });
      else same.until = sent.at;
    }
    // Gear in an unknown state may move for as long as its longest fade (ADR 0016).
    for (const n of targets) {
      const i = this.info.get(n);
      // Modelled or not: a scan under way may unmodel the gear with what it read before (S6-D16-4).
      if (i !== undefined && FADE_SETTINGS.has(cmd.id)) i.fadeTime = undefined;
    }
    const off = cmd.id === 'OFF';
    if (off) {
      // A broadcast OFF, panic's among them, stops everything that may be moving.
      const reached = a?.kind === 'broadcast' ? [...this.unsureMoving.keys()] : targets;
      for (const n of reached) if (this.unsureMoving.has(n)) this.markOff(n, sent.at);
    }
    // A fault leaves modelled gear unknown, and it may have started a fade: mark it with the shadow's
    // longest fade, read before the fault below unmodels it (S6-S16-2).
    if (fault && LIGHT_CHANGING.has(cmd.id) && !off)
      for (const n of targets) this.markMoving(n, sent.at, cmd.id);
    for (const e of this.unknownEvents(
      cmd,
      sent.at,
      (n) => this.info.get(n)?.levelKnown === true,
    )) {
      const n = addressOfScope(e.scope);
      if (n === undefined) continue;
      if (off) this.markOff(n, sent.at);
      else this.markMoving(n, sent.at, cmd.id);
    }
    this.synthetic = this.synthetic.filter((e) => e.t >= sent.at - HISTORY_MS - 1000);

    if (cmd.id === 'RESET' || cmd.id === 'SAVE_PERSISTENT_VARIABLES')
      this.deafUntil = sent.at + RESET_DEAF_MS + 50;
    if (cmd.id === 'RESET') {
      this.lastResetAt = sent.at;
      this.resetOff = { targets: new Set(targets), until: sent.at + RESET_FOLLOW_UP_MS };
    } else if (
      cmd.id === 'OFF' &&
      this.resetOff !== undefined &&
      a?.kind === 'short' &&
      sent.at >= this.deafUntil
    ) {
      // Only an OFF the gear could hear ends the follow-up. One sent while the gear is still deaf
      // after the RESET leaves it at full, and the follow-up OFF must still skip the guard
      // (security review of ADR 0015, M1).
      this.resetOff.targets.delete(a.n);
    }
    if (STALES_INVENTORY.has(cmd.id)) this.stale = true;
    if (cmd.id === 'PROGRAM_SHORT_ADDRESS' || cmd.id === 'SET_SHORT_ADDRESS') {
      for (const i of this.info.values()) {
        i.verified = false;
        i.modelled = this.target === 'simulator';
      }
    }

    for (const n of targets) {
      const i = this.addr(n);
      // Anything but a query can change what a scan read, so a scan in progress cannot model it.
      if (sp.reply === 'none') i.dirty = true;
      if (fault) {
        i.verified = false;
        i.modelled = this.target === 'simulator';
        i.levelKnown = this.target === 'simulator';
        i.colourKnown = this.target === 'simulator';
      }
      const setsLast =
        SETS_LAST_ACTIVE.has(cmd.id) &&
        !(cmd.id === 'DAPC' && (cmd.value === 0 || cmd.value === 255));
      if (setsLast && !fault) i.lastActiveKnown = true;
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
          // The value is known again only when read back.
          i.fadeTime = undefined;
          i.fadeRate = undefined;
          i.extendedFade = undefined;
          break;
        case 'SET_SCENE':
        case 'REMOVE_FROM_SCENE':
          if (i.scenes !== undefined) i.scenes[cmd.value ?? 0] = undefined;
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
        case 'GO_TO_SCENE':
          if (this.target === 'hardware' && (i.deviceTypes ?? []).includes(8))
            i.colourKnown = false;
          break;
        case 'GO_TO_LAST_ACTIVE_LEVEL':
          if (this.target === 'hardware' && i.lastActiveKnown !== true) i.levelKnown = false;
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
    return shadowReply;
  }

  private learn(n: number, cmd: Command, result: SendResult): void {
    const i = this.addr(n);
    const v = result.kind === 'reply' ? result.byte : undefined;
    switch (cmd.id) {
      case 'QUERY_CONTROL_GEAR_PRESENT':
        i.present = result.kind !== 'no-reply';
        if (!i.present) this.unsureMoving.delete(n);
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
        if (v !== undefined) {
          i.fadeReadBack = true;
          i.fadeTime = (v >> 4) & 0x0f;
          i.fadeRate = v & 0x0f;
        }
        break;
      case 'QUERY_EXTENDED_FADE_TIME':
        if (v !== undefined) i.extendedFade = v;
        break;
      case 'DT6_QUERY_FAST_FADE_TIME':
        i.fastFade = v;
        break;
      case 'QUERY_STATUS':
        if (v !== undefined) i.fading = (v & 0x10) !== 0;
        break;
      case 'QUERY_SCENE_LEVEL': {
        const scenes = i.scenes ?? Array<number | undefined>(16).fill(undefined);
        scenes[cmd.value ?? 0] = v;
        i.scenes = scenes;
        break;
      }
      case 'QUERY_GROUPS_0_7':
        if (v !== undefined) i.groups = ((i.groups ?? 0) & 0xff00) | v;
        break;
      case 'QUERY_GROUPS_8_15':
        if (v !== undefined) i.groups = ((i.groups ?? 0) & 0x00ff) | (v << 8);
        break;
      case 'QUERY_ACTUAL_LEVEL':
        // A level read back seeds the model. Once the model runs, the shadow is the prediction and a
        // correction from the hardware is Both mode's job (Stage 4).
        if (v !== undefined && v !== 255) {
          i.level = v;
          if (i.modelled && !i.levelKnown) {
            this.shadow.byShortAddress(n)?.gear.applyFacts({ level: v }, this.lastAt);
            i.levelKnown = true;
          }
        }
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

  /** True when an address's light, by the ceiling's measure, is or will be above the ceiling from a time on. */
  overCeiling(n: number, at: number): boolean {
    const u = this.shadow.byShortAddress(n);
    if (u === undefined) return false;
    // From now to the end of every fade: a level and a mix fading together can peak later.
    const to = Math.max(at, u.gear.settlesAt()) + 1;
    return this.maxMeasure(this.shadow, u.id, at, to) > arcToFraction(this.ceiling) + 1e-9;
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
