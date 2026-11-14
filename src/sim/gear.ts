/**
 * One Skydance DA5-L as DALI control gear, following `docs/research/dali.md`.
 *
 * The model is driven by frames with timestamps and has no clock of its own. Its output is a list of
 * plans: each plan describes the level and colour from a time onward, so `outputAt(t)` is a pure
 * function and the rate guard can read the recent past as well as the predicted future.
 */
import type { Address } from '../dali/address.ts';
import { decode, enabledDeviceType, frameEquals, type Command, type Frame } from '../dali/codec.ts';
import { spec, type CommandSpec } from '../dali/commands.ts';
import { arcToFraction } from '../dali/curve.ts';
import {
  extendedFadeMs,
  fadeRateStepsPerSecond,
  fadeTimeMs,
  fastFadeMs,
  normaliseExtendedFade,
  DAPC_SEQUENCE_MS,
  UP_DOWN_MS,
} from '../dali/fade.ts';
import { encodeColourTypeFeatures, encodeStatus } from '../dali/reply.ts';
import {
  colourModel,
  deviceTypes as profileDeviceTypes,
  type ColourModel,
  type Da5lProfile,
  type Terminal,
} from './profile.ts';

export const MASK = 255;
export const MASK16 = 0xffff;
/** How long a send-twice pair may take (dali.md section 6). */
export const SEND_TWICE_WINDOW_MS = 100;
/** Gear ignores commands for this long after RESET and SAVE PERSISTENT VARIABLES (dali.md section 14). */
export const RESET_DEAF_MS = 300;
/** No command in this time after power-up: the gear goes to POWER ON LEVEL (dali.md section 4). */
export const POWER_UP_MS = 600;
/** Bus voltage missing for longer than this: SYSTEM FAILURE LEVEL (dali.md section 4). */
export const BUS_FAILURE_MS = 500;
/** INITIALISE opens a 15 minute addressing window (dali.md section 13). */
export const INITIALISE_MS = 15 * 60_000;
export const IDENTIFY_MS = 10_000;
/** How much output history each gear keeps for the rate guard. */
export const HISTORY_MS = 20_000;

/** Each terminal's drive, 0 to 1, with what it carries. */
export interface ChannelDrive {
  readonly terminals: readonly number[];
  readonly labels: readonly Terminal[];
}

export interface Colour {
  /** Colour temperature in mirek. */
  readonly tc: number;
  /** RGBWAF channel levels 0 to 254, channels 0 to 5. */
  readonly ch: readonly number[];
}

export type ColourType = 'tc' | 'rgbwaf';

/** A stored colour for a scene, power-on or system failure, or null for MASK. */
export interface StoredColour {
  readonly type: ColourType;
  readonly tc: number;
  readonly ch: readonly number[];
}

interface LevelPlan {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly end: number;
  /** DAPC 0 with a fade: switch off when the fade to MIN ends. */
  readonly offAtEnd: boolean;
}

interface ColourPlan {
  readonly from: Colour;
  readonly to: Colour;
  readonly start: number;
  readonly end: number;
}

export interface OutputPlan {
  readonly since: number;
  readonly level: LevelPlan;
  readonly colour: ColourPlan;
  readonly linear: boolean;
  readonly identifyUntil: number;
  readonly identifyMin: number;
  readonly identifyMax: number;
}

/** Everything about one gear, as plain data so a fork is a structured clone. */
export interface GearState {
  shortAddress: number | null;
  groups: number;
  dtr: [number, number, number];
  minLevel: number;
  maxLevel: number;
  powerOnLevel: number;
  systemFailureLevel: number;
  fadeTime: number;
  fadeRate: number;
  extendedFade: number;
  fastFade: number;
  scenes: number[];
  sceneColours: (StoredColour | null)[];
  powerOnColour: StoredColour | null;
  systemFailureColour: StoredColour | null;
  lastActiveLevel: number;
  linearCurve: boolean;
  limitError: boolean;
  powerFailure: boolean;
  operatingMode: number;
  /** DT8 */
  temp: { type: ColourType | 'none'; tc: number; ch: number[]; control: number };
  activeType: ColourType;
  tcOutOfRange: boolean;
  tcLimits: { coolest: number; warmest: number; physicalCoolest: number; physicalWarmest: number };
  autoActivation: boolean;
  rgbwafControl: number;
  /** Addressing */
  randomAddress: number;
  searchAddress: number;
  initialiseUntil: number;
  withdrawn: boolean;
  rngState: number;
  randomPreload: number[];
  /** Bus context */
  previous: Frame | undefined;
  frameCount: number;
  deviceTypeChainAt: number;
  deviceTypeQueue: number[];
  pendingTwice: { frame: Frame; at: number; deviceType: number } | undefined;
  enableDeviceTypeFormsSeen: { once: number; beforeEach: number };
  dapcSequenceUntil: number;
  deafUntil: number;
  writeEnabled: boolean;
  powered: boolean;
  busUp: boolean;
  /** The level when the mains last went, for POWER ON LEVEL 255. */
  levelBeforePowerDown: number;
  /** Until this time after power-up, QUERY ACTUAL LEVEL answers 255 (dali.md section 10). */
  startingUntil: number;
  /** Output plans, oldest first. The last one with `since <= t` applies at t. */
  plans: OutputPlan[];
}

export interface Da5lOptions {
  readonly shortAddress?: number | null;
  readonly groups?: readonly number[];
  /** For the differential check against python-dali's fake gear only. */
  readonly deviceTypesOverride?: readonly number[];
  readonly randomPreload?: readonly number[];
  readonly seed?: number;
  /** Time the gear's state starts at. */
  readonly at?: number;
}

/** Memory bank 0 (read only). Location 0x16 is the part 102 version, 8 for 2.0. Placeholder contents otherwise. */
const BANK0: readonly number[] = [
  0x1a, 0x00, 0x00, 0x06, 0x97, 0x56, 0x17, 0x41, 0x13, 0x24, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x08, 0x01, 0x00, 0x00,
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function levelAt(p: LevelPlan, t: number): number {
  if (t >= p.end) return p.offAtEnd ? 0 : p.to;
  if (t <= p.start) return p.from;
  return p.from + ((p.to - p.from) * (t - p.start)) / (p.end - p.start);
}

function colourAt(p: ColourPlan, t: number): Colour {
  if (t >= p.end) return p.to;
  if (t <= p.start) return p.from;
  const k = (t - p.start) / (p.end - p.start);
  return {
    tc: p.from.tc + (p.to.tc - p.from.tc) * k,
    ch: p.from.ch.map((v, i) => v + ((p.to.ch[i] ?? v) - v) * k),
  };
}

function nextRandom(s: GearState): number {
  const pre = s.randomPreload.shift();
  if (pre !== undefined) return pre & 0xffffff;
  // xorshift32, so a fork repeats the same sequence.
  let x = s.rngState | 0 || 0x2545f491;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rngState = x >>> 0;
  return s.rngState & 0xffffff;
}

export class Da5l {
  readonly profile: Da5lProfile;
  readonly model: ColourModel;
  readonly deviceTypes: readonly number[];
  private s: GearState;

  constructor(profile: Da5lProfile, opts: Da5lOptions = {}, state?: GearState) {
    this.profile = profile;
    this.model = colourModel(profile);
    this.deviceTypes = opts.deviceTypesOverride ?? profileDeviceTypes(profile);
    this.s = state ?? this.factory(opts);
  }

  /** The state as shipped, with DALI's reset values where the factory's are not published (da5-l.md). */
  private factory(opts: Da5lOptions): GearState {
    const set = this.profile.settings;
    const at = opts.at ?? 0;
    const lim = set.tcLimits;
    const ch = set.factoryChannelLevel;
    const colour: Colour = {
      tc: set.factoryTc === 'warmest' ? lim.physicalWarmest : lim.physicalCoolest,
      ch: [ch, ch, ch, ch, ch, ch],
    };
    let groups = 0;
    for (const g of opts.groups ?? []) groups |= 1 << g;
    return {
      shortAddress: opts.shortAddress ?? null,
      groups,
      dtr: [0, 0, 0],
      minLevel: set.physicalMinimum,
      maxLevel: set.factoryMaxLevel,
      powerOnLevel: set.factoryPowerOnLevel,
      systemFailureLevel: set.factorySystemFailureLevel,
      fadeTime: 0,
      fadeRate: 7,
      extendedFade: 0,
      fastFade: 0,
      scenes: Array<number>(16).fill(MASK),
      sceneColours: Array<StoredColour | null>(16).fill(null),
      powerOnColour: null,
      systemFailureColour: null,
      lastActiveLevel: set.factoryMaxLevel,
      linearCurve: false,
      limitError: false,
      powerFailure: false,
      operatingMode: 0,
      temp: { type: 'none', tc: MASK16, ch: [MASK, MASK, MASK, MASK, MASK, MASK], control: MASK },
      activeType: this.model.tc ? 'tc' : 'rgbwaf',
      tcOutOfRange: false,
      tcLimits: { ...lim },
      autoActivation: set.autoActivation,
      rgbwafControl: set.rgbwafControl,
      randomAddress: 0xffffff,
      searchAddress: 0xffffff,
      initialiseUntil: -Infinity,
      withdrawn: false,
      rngState: opts.seed ?? 0x9e3779b9,
      randomPreload: [...(opts.randomPreload ?? [])],
      previous: undefined,
      frameCount: 0,
      deviceTypeChainAt: -10,
      deviceTypeQueue: [],
      pendingTwice: undefined,
      enableDeviceTypeFormsSeen: { once: 0, beforeEach: 0 },
      dapcSequenceUntil: -Infinity,
      deafUntil: -Infinity,
      writeEnabled: false,
      powered: true,
      busUp: true,
      levelBeforePowerDown: 0,
      startingUntil: -Infinity,
      plans: [
        {
          since: at,
          level: { from: 0, to: 0, start: at, end: at, offAtEnd: false },
          colour: { from: colour, to: colour, start: at, end: at },
          linear: false,
          identifyUntil: -Infinity,
          identifyMin: 0,
          identifyMax: 0,
        },
      ],
    };
  }

  clone(): Da5l {
    return new Da5l(
      this.profile,
      { deviceTypesOverride: this.deviceTypes },
      structuredClone(this.s),
    );
  }

  /** A copy of the state, for the governor's inventory checks, the UI and tests. */
  snapshot(): Readonly<GearState> {
    return structuredClone(this.s);
  }

  get shortAddress(): number | null {
    return this.s.shortAddress;
  }

  hasGroup(g: number): boolean {
    return (this.s.groups & (1 << g)) !== 0;
  }

  /** True when a frame to this address reaches this gear. */
  hears(a: Address): boolean {
    switch (a.kind) {
      case 'short':
        return this.s.shortAddress === a.n;
      case 'group':
        return this.hasGroup(a.n);
      case 'broadcast':
        return true;
      case 'unaddressed':
        return this.s.shortAddress === null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Output

  private planAt(t: number): OutputPlan {
    const plans = this.s.plans;
    for (let i = plans.length - 1; i >= 0; i--) {
      const p = plans[i];
      if (p !== undefined && p.since <= t) return p;
    }
    const first = plans[0];
    if (first === undefined) throw new Error('gear has no output plan');
    return first;
  }

  /** The arc level (fractional, 0 for off) at a time. */
  levelAt(t: number): number {
    const p = this.planAt(t);
    if (t < p.identifyUntil) {
      return Math.floor((t - p.since) / 500) % 2 === 0 ? p.identifyMax : p.identifyMin;
    }
    return levelAt(p.level, t);
  }

  colourAt(t: number): Colour {
    return colourAt(this.planAt(t).colour, t);
  }

  /** The arc level's share of full output at a time, on the curve in use. */
  arcFractionAt(t: number): number {
    const level = this.levelAt(t);
    return this.planAt(t).linear ? clamp(level, 0, 254) / 254 : arcToFraction(level);
  }

  /** Each terminal's drive at a time. Pure: it reads the plans and changes nothing. */
  outputAt(t: number): ChannelDrive {
    const p = this.planAt(t);
    return this.driveFor(p.linear, this.levelAt(t), colourAt(p.colour, t));
  }

  /**
   * The drive the plan in force at `t` settles to, as if every fade ended at once. The rate guard uses
   * this on hardware, where fades count as instant steps until confirmed (SPEC S3.7).
   */
  settledOutputAt(t: number): ChannelDrive {
    const p = this.planAt(t);
    const level = t < p.identifyUntil ? this.levelAt(t) : p.level.offAtEnd ? 0 : p.level.to;
    return this.driveFor(p.linear, level, p.colour.to);
  }

  /** Times in a range at which a new plan starts. */
  planStarts(from: number, to: number): number[] {
    return this.s.plans.map((p) => p.since).filter((t) => t >= from && t <= to);
  }

  private driveFor(linear: boolean, level: number, c: Colour): ChannelDrive {
    const arc = linear ? clamp(level, 0, 254) / 254 : arcToFraction(level);
    const set = this.profile.settings;
    const lim = this.s.tcLimits;
    const span = lim.physicalWarmest - lim.physicalCoolest;
    const warm = span > 0 ? clamp((c.tc - lim.physicalCoolest) / span, 0, 1) : 0.5;
    const steps = set.pwmSteps;
    const terminals = this.model.sources.map((src) => {
      let w: number;
      if (src === null) w = 0;
      else if (src === 'arc') w = 1;
      else if (src === 'warm' || src === 'cool') {
        const f = src === 'warm' ? warm : 1 - warm;
        w = set.tcMix === 'constant-total' ? f : Math.min(1, 2 * f);
      } else {
        const ch = clamp(c.ch[src] ?? 0, 0, 254);
        w = set.channelLaw === 'linear' ? ch / 254 : arcToFraction(ch);
      }
      const d = arc * w;
      return steps > 0 ? Math.round(d * steps) / steps : d;
    });
    return { terminals, labels: this.model.terminals };
  }

  /**
   * Times at which the output can change direction between `from` and `to`: plan starts, fade ends
   * and identify toggles. Between two of these, the level and the colour each move one way.
   */
  breakpoints(from: number, to: number): number[] {
    const out = new Set<number>([from, to]);
    const plans = this.s.plans;
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      if (p === undefined) continue;
      const next = plans[i + 1]?.since ?? Infinity;
      if (next < from || p.since > to) continue;
      for (const t of [p.since, p.level.start, p.level.end, p.colour.start, p.colour.end]) {
        if (t >= from && t <= to && t < next) out.add(t);
      }
      if (p.identifyUntil > p.since) {
        for (let t = p.since; t < Math.min(p.identifyUntil, next, to); t += 500) {
          if (t >= from) out.add(t);
        }
        if (p.identifyUntil >= from && p.identifyUntil <= to) out.add(p.identifyUntil);
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * Set what a scan read back, for a shadow that models real gear (ADR 0011). Values not given are
   * left as they are. The level takes effect at once.
   */
  applyFacts(
    f: {
      minLevel?: number | undefined;
      maxLevel?: number | undefined;
      groups?: number | undefined;
      fadeTime?: number | undefined;
      fadeRate?: number | undefined;
      extendedFade?: number | undefined;
      linear?: boolean | undefined;
      level?: number | undefined;
    },
    at: number,
  ): void {
    const s = this.s;
    if (f.minLevel !== undefined) s.minLevel = f.minLevel;
    if (f.maxLevel !== undefined) s.maxLevel = f.maxLevel;
    if (f.groups !== undefined) s.groups = f.groups;
    if (f.fadeTime !== undefined) s.fadeTime = f.fadeTime;
    if (f.fadeRate !== undefined) s.fadeRate = f.fadeRate;
    if (f.extendedFade !== undefined) s.extendedFade = f.extendedFade;
    if (f.linear !== undefined) {
      s.linearCurve = f.linear;
      this.pushPlan(at, { linear: f.linear });
    }
    if (f.level !== undefined) {
      const l = f.level;
      this.pushPlan(at, {
        level: { from: l, to: l, start: at, end: at, offAtEnd: false },
        identifyUntil: -Infinity,
      });
    }
  }

  /** The level the latest plan ends at: the target of a running fade, 0 for off. */
  finalLevel(): number {
    const p = this.planAt(Infinity);
    return p.level.offAtEnd ? 0 : p.level.to;
  }

  /** The time the last fade (level or colour) ends. */
  settlesAt(): number {
    const p = this.s.plans[this.s.plans.length - 1];
    if (p === undefined) return -Infinity;
    return Math.max(p.since, p.level.end, p.colour.end, p.identifyUntil);
  }

  /** True while either the level or the colour is fading. */
  fadeRunning(t: number): boolean {
    const p = this.planAt(t);
    return t < p.level.end || t < p.colour.end;
  }

  private pushPlan(at: number, change: Partial<Omit<OutputPlan, 'since'>>): void {
    this.s.startingUntil = -Infinity;
    const cur = this.planAt(at);
    const plan: OutputPlan = { ...cur, ...change, since: at };
    // A new plan replaces any that were waiting for a later time (power-on, system failure).
    const kept = this.s.plans.filter((p) => p.since < at);
    const cutoff = at - HISTORY_MS;
    while (kept.length > 1 && (kept[1]?.since ?? Infinity) <= cutoff) kept.shift();
    kept.push(plan);
    this.s.plans = kept;
  }

  private schedulePlan(at: number, change: Partial<Omit<OutputPlan, 'since'>>): void {
    // A plan that applies later: kept after the current one until a command replaces it.
    const cur = this.s.plans[this.s.plans.length - 1];
    if (cur === undefined) return;
    this.s.plans.push({ ...cur, ...change, since: at });
  }

  // ---------------------------------------------------------------------------------------------
  // Level helpers

  /** The level QUERY ACTUAL LEVEL reports. */
  private actualLevel(at: number): number {
    if (at < this.s.startingUntil) return MASK;
    const p = this.planAt(at);
    if (at < p.identifyUntil) return Math.round(this.levelAt(at));
    const target = p.level.offAtEnd ? 0 : p.level.to;
    const v = this.profile.settings.queryDuringFade === 'target' ? target : levelAt(p.level, at);
    return Math.round(v);
  }

  private isOn(at: number): boolean {
    return this.levelAt(at) > 0;
  }

  /** The fade time a DAPC, GO TO SCENE or GO TO LAST ACTIVE LEVEL uses (dali.md section 7). */
  fadeMs(): number {
    const s = this.s;
    if (s.fadeTime > 0) return fadeTimeMs(s.fadeTime);
    if (s.fastFade >= 27) return this.profile.settings.fastFade27Ms;
    if (s.fastFade > 0) return fastFadeMs(s.fastFade);
    return extendedFadeMs(s.extendedFade);
  }

  private clampLevel(n: number): number {
    const s = this.s;
    const v = clamp(n, s.minLevel, s.maxLevel);
    s.limitError = v !== n;
    return v;
  }

  private startFrom(at: number): number {
    const p = this.planAt(at);
    if (this.profile.settings.commandDuringFade === 'from-target' && at < p.level.end) {
      return p.level.offAtEnd ? 0 : p.level.to;
    }
    return this.levelAt(at);
  }

  /** Fade the level to a target over a duration, switching on from off as the profile says. */
  private goTo(
    target: number,
    ms: number,
    at: number,
    offAtEnd = false,
    keepIdentify = false,
  ): void {
    let from = this.startFrom(at);
    if (from <= 0 && target > 0) {
      from = this.profile.settings.fadeFromOff === 'jump-to-min' ? this.s.minLevel : 0;
    }
    if (target > 0 && !offAtEnd) this.s.lastActiveLevel = target;
    const end = ms > 0 ? at + ms : at;
    this.pushPlan(at, {
      level: { from: ms > 0 ? from : target, to: target, start: at, end, offAtEnd },
      ...(keepIdentify ? {} : { identifyUntil: -Infinity }),
    });
  }

  private setNow(level: number, at: number, keepIdentify = false): void {
    this.goTo(level, 0, at, false, keepIdentify);
  }

  // ---------------------------------------------------------------------------------------------
  // Colour helpers

  private colourNow(at: number): Colour {
    return this.colourAt(at);
  }

  private tcClamped(m: number): number {
    const l = this.s.tcLimits;
    return clamp(m, l.coolest, l.warmest);
  }

  /** Apply the temporary colour, fading over a duration (ACTIVATE or automatic activation). */
  private activate(at: number, ms: number): void {
    const s = this.s;
    const t = s.temp;
    const cur = this.colourNow(at);
    if (t.type === 'none') {
      // ACTIVATE still ends a running cross-fade.
      this.pushPlan(at, { colour: { from: cur, to: cur, start: at, end: at } });
      return;
    }
    let to: Colour = cur;
    if (t.type === 'tc' && t.tc !== MASK16) {
      let tc = t.tc;
      const out = tc < s.tcLimits.coolest || tc > s.tcLimits.warmest;
      if (out) {
        if (this.profile.settings.tcOutOfLimits === 'clamp-and-flag') {
          tc = this.tcClamped(tc);
          s.tcOutOfRange = true;
        } else {
          tc = cur.tc;
          s.tcOutOfRange = true;
        }
      } else s.tcOutOfRange = false;
      to = { tc, ch: cur.ch };
      s.activeType = 'tc';
    } else if (t.type === 'rgbwaf') {
      to = { tc: cur.tc, ch: cur.ch.map((v, i) => (t.ch[i] === MASK ? v : (t.ch[i] ?? v))) };
      s.activeType = 'rgbwaf';
    }
    const fade = this.profile.settings.colourFade === 'fade-time' ? ms : 0;
    this.pushPlan(at, { colour: { from: cur, to, start: at, end: at + fade } });
    if (this.profile.settings.temporaryClearedAfterActivate) this.clearTemp();
  }

  private clearTemp(): void {
    this.s.temp = {
      type: 'none',
      tc: MASK16,
      ch: [MASK, MASK, MASK, MASK, MASK, MASK],
      control: this.s.temp.control,
    };
  }

  private applyStoredColour(c: StoredColour | null, at: number, ms: number): void {
    if (c === null || !this.model.dt8) return;
    const cur = this.colourNow(at);
    const to: Colour =
      c.type === 'tc'
        ? { tc: c.tc === MASK16 ? cur.tc : this.tcClamped(c.tc), ch: cur.ch }
        : { tc: cur.tc, ch: cur.ch.map((v, i) => (c.ch[i] === MASK ? v : (c.ch[i] ?? v))) };
    this.s.activeType = c.type;
    const fade = this.profile.settings.colourFade === 'fade-time' ? ms : 0;
    this.pushPlan(at, { colour: { from: cur, to, start: at, end: at + fade } });
  }

  /** What SET SCENE, SET POWER ON LEVEL and SET SYSTEM FAILURE LEVEL store as colour. */
  private colourToStore(at: number): StoredColour | null {
    if (!this.model.dt8) return null;
    const t = this.s.temp;
    if (t.type !== 'none') return { type: t.type, tc: t.tc, ch: [...t.ch] };
    if (this.profile.settings.storedColour === 'temporary-or-actual') {
      const c = this.colourNow(at);
      return { type: this.s.activeType, tc: Math.round(c.tc), ch: c.ch.map((v) => Math.round(v)) };
    }
    return null;
  }

  /** Automatic activation: any level command applies a pending temporary colour (dali.md section 11). */
  private autoActivate(at: number, ms: number): void {
    if (this.model.dt8 && this.s.autoActivation && this.s.temp.type !== 'none')
      this.activate(at, ms);
  }

  // ---------------------------------------------------------------------------------------------
  // Power and the bus

  /** Mains off. The output goes dark and the gear hears nothing. */
  powerDown(at: number): void {
    this.s.levelBeforePowerDown = this.levelAt(at);
    this.s.powered = false;
    this.pushPlan(at, {
      level: { from: 0, to: 0, start: at, end: at, offAtEnd: false },
      identifyUntil: -Infinity,
    });
  }

  /** Mains on: after 0.6 s with no command, POWER ON LEVEL (dali.md section 4). */
  powerUp(at: number): void {
    const s = this.s;
    s.powered = true;
    s.powerFailure = true;
    s.pendingTwice = undefined;
    s.initialiseUntil = -Infinity;
    s.dapcSequenceUntil = -Infinity;
    s.lastActiveLevel = s.maxLevel;
    this.clearTemp();
    const early = this.profile.settings.powerUpOutput === 'max' ? s.maxLevel : 0;
    this.pushPlan(at, {
      level: { from: early, to: early, start: at, end: at, offAtEnd: false },
      identifyUntil: -Infinity,
    });
    const when = at + POWER_UP_MS;
    s.startingUntil = when;
    const lvl = this.powerOnTarget();
    const cur = this.colourAt(at);
    const pc = s.powerOnColour;
    const colour: Colour =
      pc === null
        ? cur
        : pc.type === 'tc'
          ? { tc: pc.tc === MASK16 ? cur.tc : this.tcClamped(pc.tc), ch: cur.ch }
          : { tc: cur.tc, ch: cur.ch.map((v, i) => (pc.ch[i] === MASK ? v : (pc.ch[i] ?? v))) };
    this.schedulePlan(when, {
      level: { from: lvl, to: lvl, start: when, end: when, offAtEnd: false },
      colour: { from: colour, to: colour, start: when, end: when },
    });
  }

  private powerOnTarget(): number {
    const s = this.s;
    if (s.powerOnLevel === 0) return 0;
    if (s.powerOnLevel === MASK) return s.levelBeforePowerDown;
    return clamp(s.powerOnLevel, s.minLevel, s.maxLevel);
  }

  /** The bus voltage goes. After 0.5 s the gear goes to SYSTEM FAILURE LEVEL. */
  busDown(at: number): void {
    const s = this.s;
    s.busUp = false;
    s.pendingTwice = undefined;
    if (s.systemFailureLevel === MASK) return;
    const when = at + BUS_FAILURE_MS;
    const target =
      s.systemFailureLevel === 0 ? 0 : clamp(s.systemFailureLevel, s.minLevel, s.maxLevel);
    const from = levelAt(this.planAt(when).level, when);
    const ms = this.profile.settings.systemFailure === 'fade' ? this.fadeMs() : 0;
    // The stored failure colour applies with the level, in the same way (dali.md sections 4 and 9).
    const cur = this.colourAt(when);
    const fc = s.systemFailureColour;
    const to: Colour =
      fc === null || !this.model.dt8
        ? cur
        : fc.type === 'tc'
          ? { tc: fc.tc === MASK16 ? cur.tc : this.tcClamped(fc.tc), ch: cur.ch }
          : { tc: cur.tc, ch: cur.ch.map((v, i) => (fc.ch[i] === MASK ? v : (fc.ch[i] ?? v))) };
    this.schedulePlan(when, {
      level: {
        from: ms > 0 ? from : target,
        to: target,
        start: when,
        end: when + ms,
        offAtEnd: false,
      },
      colour: { from: cur, to, start: when, end: when + ms },
      identifyUntil: -Infinity,
    });
  }

  busUp(at: number): void {
    const s = this.s;
    s.busUp = true;
    // Back within 0.5 s: the system failure level never applies.
    s.plans = s.plans.filter((p) => p.since <= at);
    if (this.profile.settings.busReturn === 'power-on-level') this.setNow(this.powerOnTarget(), at);
  }

  // ---------------------------------------------------------------------------------------------
  // Frames

  /**
   * One forward frame on the bus, which every gear hears. Returns the backward frame byte, or
   * undefined for no answer.
   */
  receive(frame: Frame, at: number): number | undefined {
    const s = this.s;
    if (!s.powered || !s.busUp) return undefined;
    if (at < s.deafUntil) return undefined;
    s.frameCount++;
    const previous = s.previous;
    s.previous = frame;
    const set = this.profile.settings;

    // The second copy of a send-twice pair.
    const pending = s.pendingTwice;
    if (
      pending !== undefined &&
      frameEquals(pending.frame, frame) &&
      at - pending.at <= SEND_TWICE_WINDOW_MS
    ) {
      const dtNow = enabledDeviceType(previous) ?? 0;
      let accepted = true;
      if (pending.deviceType !== 0) {
        if (dtNow === pending.deviceType) {
          s.enableDeviceTypeFormsSeen.beforeEach++;
          accepted = set.enableDeviceTypeForm !== 'once';
        } else {
          s.enableDeviceTypeFormsSeen.once++;
          accepted = set.enableDeviceTypeForm !== 'before-each';
        }
      }
      s.pendingTwice = undefined;
      if (!accepted) return undefined;
      const cmd = decode(
        frame,
        pending.deviceType === 0 ? undefined : { a: 0xc1, b: pending.deviceType },
      );
      if (cmd === undefined) return undefined;
      return this.execute(cmd, spec(cmd.id), at);
    }

    const cmd = decode(frame, previous);
    const sp = cmd === undefined ? undefined : spec(cmd.id);

    if (pending !== undefined) {
      const isEdt = frame.a === 0xc1;
      const keepForEdt = isEdt && pending.deviceType !== 0 && set.enableDeviceTypeForm !== 'once';
      if (!keepForEdt && set.sendTwiceCancelledByOtherFrame) s.pendingTwice = undefined;
      if (at - pending.at > SEND_TWICE_WINDOW_MS) s.pendingTwice = undefined;
    }

    if (cmd === undefined || sp === undefined) return undefined;
    if (sp.deviceType !== 0 && !this.deviceTypes.includes(sp.deviceType)) return undefined;
    if (cmd.address !== undefined && !this.hears(cmd.address)) return undefined;

    if (sp.sendTwice) {
      s.pendingTwice = { frame, at, deviceType: sp.deviceType };
      return undefined;
    }
    return this.execute(cmd, sp, at);
  }

  /** Carry out a command addressed to this gear (or a special command). */
  private execute(cmd: Command, sp: CommandSpec, at: number): number | undefined {
    const s = this.s;
    const set = this.profile.settings;
    const v = cmd.value ?? 0;
    const yes = 0xff;

    // A memory write must follow ENABLE WRITE MEMORY with nothing else between.
    if (
      s.writeEnabled &&
      !['WRITE_MEMORY_LOCATION', 'WRITE_MEMORY_LOCATION_NO_REPLY', 'DTR0', 'DTR1', 'DTR2'].includes(
        sp.id,
      ) &&
      !sp.id.startsWith('QUERY_CONTENT_DTR')
    ) {
      s.writeEnabled = false;
    }
    // IDENTIFY DEVICE is stopped by any command but these (dali.md section 13).
    const p = this.planAt(at);
    if (
      at < p.identifyUntil &&
      !['INITIALISE', 'RECALL_MIN_LEVEL', 'RECALL_MAX_LEVEL', 'IDENTIFY_DEVICE'].includes(sp.id)
    ) {
      this.pushPlan(at, {
        identifyUntil: -Infinity,
        level: { ...p.level, from: this.levelAt(at), start: at },
      });
    }

    const levelCommand = (fn: () => void, ms: number) => {
      if (sp.id !== 'DAPC') s.dapcSequenceUntil = -Infinity;
      s.powerFailure = false;
      fn();
      this.autoActivate(at, ms);
    };

    switch (sp.id) {
      case 'DAPC': {
        if (v === MASK) {
          const now = this.levelAt(at);
          this.pushPlan(at, { level: { from: now, to: now, start: at, end: at, offAtEnd: false } });
          s.powerFailure = false;
          this.autoActivate(at, 0);
          return undefined;
        }
        const inSequence = at <= s.dapcSequenceUntil;
        if (inSequence) s.dapcSequenceUntil = at + DAPC_SEQUENCE_MS;
        const ms = inSequence ? DAPC_SEQUENCE_MS : this.fadeMs();
        levelCommand(() => {
          if (v === 0) {
            if (set.dapcZeroWithFade === 'fade-to-min-then-off' && ms > 0 && this.isOn(at)) {
              this.goTo(s.minLevel, ms, at, true);
            } else this.setNow(0, at);
            s.limitError = false;
          } else this.goTo(this.clampLevel(v), ms, at);
        }, ms);
        return undefined;
      }
      case 'OFF':
        levelCommand(() => {
          this.setNow(0, at);
        }, 0);
        return undefined;
      case 'UP':
      case 'DOWN': {
        levelCommand(() => {
          if (!this.isOn(at)) return;
          let delta = (fadeRateStepsPerSecond(s.fadeRate) * UP_DOWN_MS) / 1000;
          if (set.upDownRounding === 'round-each') delta = Math.max(1, Math.round(delta));
          const cur = this.levelAt(at);
          const target =
            sp.id === 'UP' ? Math.min(s.maxLevel, cur + delta) : Math.max(s.minLevel, cur - delta);
          this.pushPlan(at, {
            level: { from: cur, to: target, start: at, end: at + UP_DOWN_MS, offAtEnd: false },
            identifyUntil: -Infinity,
          });
          s.lastActiveLevel = target;
        }, UP_DOWN_MS);
        return undefined;
      }
      case 'CONTINUOUS_UP':
      case 'CONTINUOUS_DOWN': {
        levelCommand(() => {
          if (!this.isOn(at)) return;
          const cur = this.levelAt(at);
          const target = sp.id === 'CONTINUOUS_UP' ? s.maxLevel : s.minLevel;
          const ms = (Math.abs(target - cur) / fadeRateStepsPerSecond(s.fadeRate)) * 1000;
          this.pushPlan(at, {
            level: { from: cur, to: target, start: at, end: at + ms, offAtEnd: false },
            identifyUntil: -Infinity,
          });
          s.lastActiveLevel = target;
        }, 0);
        return undefined;
      }
      case 'STEP_UP':
        levelCommand(() => {
          if (!this.isOn(at)) return;
          this.setNow(Math.min(s.maxLevel, Math.round(this.levelAt(at)) + 1), at);
        }, 0);
        return undefined;
      case 'STEP_DOWN':
        levelCommand(() => {
          if (!this.isOn(at)) return;
          this.setNow(Math.max(s.minLevel, Math.round(this.levelAt(at)) - 1), at);
        }, 0);
        return undefined;
      case 'STEP_DOWN_AND_OFF':
        levelCommand(() => {
          if (!this.isOn(at)) return;
          const cur = Math.round(this.levelAt(at));
          this.setNow(cur <= s.minLevel ? 0 : cur - 1, at);
        }, 0);
        return undefined;
      case 'ON_AND_STEP_UP':
        levelCommand(() => {
          if (!this.isOn(at)) this.setNow(s.minLevel, at);
          else this.setNow(Math.min(s.maxLevel, Math.round(this.levelAt(at)) + 1), at);
        }, 0);
        return undefined;
      case 'RECALL_MAX_LEVEL':
        levelCommand(() => {
          this.setNow(s.maxLevel, at, true);
        }, 0);
        return undefined;
      case 'RECALL_MIN_LEVEL':
        levelCommand(() => {
          this.setNow(s.minLevel, at, true);
        }, 0);
        return undefined;
      case 'ENABLE_DAPC_SEQUENCE':
        s.dapcSequenceUntil = at + DAPC_SEQUENCE_MS;
        return undefined;
      case 'GO_TO_LAST_ACTIVE_LEVEL': {
        const ms = this.fadeMs();
        levelCommand(() => {
          if (this.isOn(at) && set.goToLastActiveWhenOn === 'no-change') return;
          this.goTo(clamp(s.lastActiveLevel, s.minLevel, s.maxLevel), ms, at);
        }, ms);
        return undefined;
      }
      case 'GO_TO_SCENE': {
        const level = s.scenes[v] ?? MASK;
        const colour = s.sceneColours[v] ?? null;
        const ms = this.fadeMs();
        s.dapcSequenceUntil = -Infinity;
        if (level === MASK && colour === null) return undefined;
        s.powerFailure = false;
        if (level !== MASK) {
          if (level === 0) {
            if (set.dapcZeroWithFade === 'fade-to-min-then-off' && ms > 0 && this.isOn(at)) {
              this.goTo(s.minLevel, ms, at, true);
            } else this.setNow(0, at);
          } else this.goTo(this.clampLevel(level), ms, at);
        }
        if (colour !== null) this.applyStoredColour(colour, at, ms);
        else this.autoActivate(at, ms);
        return undefined;
      }

      // Configuration
      case 'RESET':
        this.reset(at);
        return undefined;
      case 'STORE_ACTUAL_LEVEL_IN_DTR0':
        s.dtr[0] = this.actualLevel(at);
        return undefined;
      case 'SAVE_PERSISTENT_VARIABLES':
        s.deafUntil = at + RESET_DEAF_MS;
        return undefined;
      case 'SET_OPERATING_MODE':
        if (s.dtr[0] === 0) s.operatingMode = 0;
        return undefined;
      case 'RESET_MEMORY_BANK':
        return undefined;
      case 'IDENTIFY_DEVICE':
        if (set.identify === 'flash-min-max') {
          this.pushPlan(at, {
            identifyUntil: at + IDENTIFY_MS,
            identifyMin: s.minLevel,
            identifyMax: s.maxLevel,
          });
        }
        return undefined;
      case 'SET_MAX_LEVEL': {
        let m = s.dtr[0];
        if (m === MASK) m = 254;
        if (m < s.minLevel) m = s.minLevel;
        s.maxLevel = m;
        if (s.lastActiveLevel > m) s.lastActiveLevel = m;
        if (set.maxLowerPullsDown) this.limitRunningLevel(at);
        return undefined;
      }
      case 'SET_MIN_LEVEL': {
        let m = s.dtr[0];
        if (m === MASK || m > s.maxLevel) m = s.maxLevel;
        if (m < set.physicalMinimum) m = set.physicalMinimum;
        s.minLevel = m;
        if (set.minRaiseLifts) this.limitRunningLevel(at);
        return undefined;
      }
      case 'SET_SYSTEM_FAILURE_LEVEL':
        s.systemFailureLevel = s.dtr[0];
        s.systemFailureColour = this.colourToStore(at);
        return undefined;
      case 'SET_POWER_ON_LEVEL':
        s.powerOnLevel = s.dtr[0];
        s.powerOnColour = this.colourToStore(at);
        return undefined;
      case 'SET_FADE_TIME':
        s.fadeTime = Math.min(15, s.dtr[0]);
        return undefined;
      case 'SET_FADE_RATE':
        s.fadeRate = clamp(s.dtr[0], 1, 15);
        return undefined;
      case 'SET_EXTENDED_FADE_TIME':
        s.extendedFade = normaliseExtendedFade(s.dtr[0]);
        return undefined;
      case 'SET_SCENE':
        s.scenes[v] = s.dtr[0];
        s.sceneColours[v] = this.colourToStore(at);
        return undefined;
      case 'REMOVE_FROM_SCENE':
        s.scenes[v] = MASK;
        s.sceneColours[v] = null;
        return undefined;
      case 'ADD_TO_GROUP':
        s.groups |= 1 << v;
        return undefined;
      case 'REMOVE_FROM_GROUP':
        s.groups &= ~(1 << v);
        return undefined;
      case 'SET_SHORT_ADDRESS': {
        const d = s.dtr[0];
        if (d === MASK) s.shortAddress = null;
        else if ((d & 0x81) === 1) s.shortAddress = d >> 1;
        return undefined;
      }
      case 'ENABLE_WRITE_MEMORY':
        s.writeEnabled = true;
        return undefined;

      // Queries
      case 'QUERY_STATUS':
        return this.status(at);
      case 'QUERY_CONTROL_GEAR_PRESENT':
        return yes;
      case 'QUERY_LAMP_FAILURE':
      case 'QUERY_CONTROL_GEAR_FAILURE':
      case 'QUERY_MANUFACTURER_SPECIFIC_MODE':
        return undefined;
      case 'QUERY_LAMP_POWER_ON':
        return this.isOn(at) ? yes : undefined;
      case 'QUERY_LIMIT_ERROR':
        return s.limitError ? yes : undefined;
      case 'QUERY_RESET_STATE':
        return this.inResetState(at) ? yes : undefined;
      case 'QUERY_MISSING_SHORT_ADDRESS':
        return s.shortAddress === null ? yes : undefined;
      case 'QUERY_VERSION_NUMBER':
        return BANK0[0x16];
      case 'QUERY_CONTENT_DTR0':
        return s.dtr[0];
      case 'QUERY_CONTENT_DTR1':
        return s.dtr[1];
      case 'QUERY_CONTENT_DTR2':
        return s.dtr[2];
      case 'QUERY_DEVICE_TYPE': {
        const types = this.deviceTypes;
        if (types.length === 0) return 254;
        if (types.length === 1) return types[0];
        s.deviceTypeQueue = [...types];
        s.deviceTypeChainAt = s.frameCount;
        return 0xff;
      }
      case 'QUERY_NEXT_DEVICE_TYPE': {
        if (s.deviceTypeChainAt !== s.frameCount - 1) return undefined;
        s.deviceTypeChainAt = s.frameCount;
        return s.deviceTypeQueue.shift() ?? 254;
      }
      case 'QUERY_PHYSICAL_MINIMUM':
        return set.physicalMinimum;
      case 'QUERY_POWER_FAILURE':
        return s.powerFailure ? yes : undefined;
      case 'QUERY_OPERATING_MODE':
        return s.operatingMode;
      case 'QUERY_LIGHT_SOURCE_TYPE':
        return 6;
      case 'QUERY_ACTUAL_LEVEL':
        return this.actualLevel(at);
      case 'QUERY_MAX_LEVEL':
        return s.maxLevel;
      case 'QUERY_MIN_LEVEL':
        return s.minLevel;
      case 'QUERY_POWER_ON_LEVEL':
        return s.powerOnLevel;
      case 'QUERY_SYSTEM_FAILURE_LEVEL':
        return s.systemFailureLevel;
      case 'QUERY_FADE_TIME_FADE_RATE':
        return ((s.fadeTime & 0x0f) << 4) | (s.fadeRate & 0x0f);
      case 'QUERY_EXTENDED_FADE_TIME':
        return s.extendedFade;
      case 'QUERY_SCENE_LEVEL':
        return s.scenes[v] ?? MASK;
      case 'QUERY_GROUPS_0_7':
        return s.groups & 0xff;
      case 'QUERY_GROUPS_8_15':
        return (s.groups >> 8) & 0xff;
      case 'QUERY_RANDOM_ADDRESS_H':
        return (s.randomAddress >> 16) & 0xff;
      case 'QUERY_RANDOM_ADDRESS_M':
        return (s.randomAddress >> 8) & 0xff;
      case 'QUERY_RANDOM_ADDRESS_L':
        return s.randomAddress & 0xff;
      case 'READ_MEMORY_LOCATION': {
        if (s.dtr[1] !== 0) return undefined;
        const loc = s.dtr[0];
        s.dtr[0] = Math.min(255, loc + 1);
        return BANK0[loc];
      }

      // Special commands
      case 'TERMINATE':
        s.initialiseUntil = -Infinity;
        s.withdrawn = false;
        return undefined;
      case 'DTR0':
        s.dtr[0] = v;
        return undefined;
      case 'DTR1':
        s.dtr[1] = v;
        return undefined;
      case 'DTR2':
        s.dtr[2] = v;
        return undefined;
      case 'INITIALISE': {
        const mine =
          v === 0 ||
          (v === 0xff && s.shortAddress === null) ||
          (v !== 0xff && s.shortAddress === v >> 1);
        if (mine) {
          s.initialiseUntil = at + INITIALISE_MS;
          s.withdrawn = false;
        }
        return undefined;
      }
      case 'RANDOMISE':
        if (at < s.initialiseUntil) s.randomAddress = nextRandom(s);
        return undefined;
      case 'COMPARE':
        return at < s.initialiseUntil && !s.withdrawn && s.randomAddress <= s.searchAddress
          ? yes
          : undefined;
      case 'WITHDRAW':
        if (at < s.initialiseUntil && s.randomAddress === s.searchAddress) s.withdrawn = true;
        return undefined;
      case 'PING':
      case 'ENABLE_DEVICE_TYPE':
        return undefined;
      case 'SEARCHADDRH':
        s.searchAddress = (s.searchAddress & 0x00ffff) | (v << 16);
        return undefined;
      case 'SEARCHADDRM':
        s.searchAddress = (s.searchAddress & 0xff00ff) | (v << 8);
        return undefined;
      case 'SEARCHADDRL':
        s.searchAddress = (s.searchAddress & 0xffff00) | v;
        return undefined;
      case 'PROGRAM_SHORT_ADDRESS':
        if (at < s.initialiseUntil && s.randomAddress === s.searchAddress) {
          s.shortAddress = v === 0xff ? null : v >> 1;
        }
        return undefined;
      case 'VERIFY_SHORT_ADDRESS':
        return at < s.initialiseUntil && s.shortAddress === v >> 1 && v !== 0xff ? yes : undefined;
      case 'QUERY_SHORT_ADDRESS':
        if (at < s.initialiseUntil && s.randomAddress === s.searchAddress) {
          return s.shortAddress === null ? 0xff : (s.shortAddress << 1) | 1;
        }
        return undefined;
      case 'WRITE_MEMORY_LOCATION':
      case 'WRITE_MEMORY_LOCATION_NO_REPLY':
        // Bank 0 is read only and no other bank exists, so nothing is written.
        return undefined;

      default:
        if (sp.kind === 'dt6') return this.executeDt6(sp, at);
        if (sp.kind === 'dt8') return this.executeDt8(sp, at);
        return undefined;
    }
  }

  /** After MIN or MAX changes: hold the running level and any fade target inside the limits. */
  private limitRunningLevel(at: number): void {
    const s = this.s;
    const p = this.planAt(at);
    const now = levelAt(p.level, at);
    if (now <= 0) return;
    const lim = (x: number) => (x <= 0 ? x : clamp(x, s.minLevel, s.maxLevel));
    const nowLimited = lim(now);
    const to = p.level.offAtEnd ? p.level.to : lim(p.level.to);
    if (nowLimited === now && to === p.level.to) return;
    if (at >= p.level.end || nowLimited !== now) {
      this.pushPlan(at, {
        level: {
          from: nowLimited,
          to: at >= p.level.end ? nowLimited : to,
          start: at,
          end: Math.max(at, p.level.end),
          offAtEnd: p.level.offAtEnd,
        },
      });
    } else {
      this.pushPlan(at, {
        level: { from: now, to, start: at, end: p.level.end, offAtEnd: p.level.offAtEnd },
      });
    }
  }

  private reset(at: number): void {
    const s = this.s;
    const set = this.profile.settings;
    const oldFade = this.fadeMs();
    s.powerOnLevel = 254;
    s.systemFailureLevel = 254;
    s.minLevel = set.physicalMinimum;
    s.maxLevel = 254;
    s.fadeRate = 7;
    s.fadeTime = 0;
    s.extendedFade = 0;
    s.fastFade = 0;
    s.groups = 0;
    s.scenes = Array<number>(16).fill(MASK);
    s.sceneColours = Array<StoredColour | null>(16).fill(null);
    if (set.resetStoredColours === 'mask') {
      s.powerOnColour = null;
      s.systemFailureColour = null;
    }
    s.randomAddress = 0xffffff;
    s.searchAddress = 0xffffff;
    s.limitError = false;
    s.powerFailure = false;
    s.linearCurve = false;
    s.autoActivation = true;
    // Back to the physical limits, which RESET does not change (dali.md section 5).
    s.tcLimits = {
      ...s.tcLimits,
      coolest: s.tcLimits.physicalCoolest,
      warmest: s.tcLimits.physicalWarmest,
    };
    s.tcOutOfRange = false;
    this.clearTemp();
    s.temp.control = MASK;
    s.dapcSequenceUntil = -Infinity;
    s.deafUntil = at + RESET_DEAF_MS;
    const lastActive = s.lastActiveLevel;
    this.pushPlan(at, { linear: false });
    this.goTo(254, set.reset === 'fade' ? oldFade : 0, at);
    if (set.lastActiveAfterReset === 'unchanged') s.lastActiveLevel = lastActive;
  }

  private inResetState(at: number): boolean {
    const s = this.s;
    return (
      Math.round(this.levelAt(at)) === 254 &&
      s.powerOnLevel === 254 &&
      s.systemFailureLevel === 254 &&
      s.minLevel === this.profile.settings.physicalMinimum &&
      s.maxLevel === 254 &&
      s.fadeRate === 7 &&
      s.fadeTime === 0 &&
      s.extendedFade === 0 &&
      s.groups === 0 &&
      s.scenes.every((x) => x === MASK) &&
      s.randomAddress === 0xffffff
    );
  }

  private status(at: number): number {
    const s = this.s;
    return encodeStatus({
      gearFailure: false,
      lampFailure: false,
      lampOn: this.isOn(at),
      limitError: s.limitError,
      fadeRunning: this.fadeRunning(at),
      resetState: this.inResetState(at),
      missingShortAddress: s.shortAddress === null,
      powerFailure: s.powerFailure,
    });
  }

  private executeDt6(sp: CommandSpec, at: number): number | undefined {
    const s = this.s;
    const set = this.profile.settings;
    switch (sp.id) {
      case 'DT6_SELECT_DIMMING_CURVE':
        if (s.dtr[0] === 0) s.linearCurve = false;
        else if (s.dtr[0] === 1 && set.acceptsLinearCurve) s.linearCurve = true;
        this.pushPlan(at, { linear: s.linearCurve });
        return undefined;
      case 'DT6_STORE_DTR_AS_FAST_FADE_TIME': {
        const d = s.dtr[0];
        const min = set.minFastFadeCount;
        if (min === 0 || d === 0) s.fastFade = 0;
        else s.fastFade = clamp(d, min, 27);
        return undefined;
      }
      case 'DT6_QUERY_DIMMING_CURVE':
        return s.linearCurve ? 1 : 0;
      case 'DT6_QUERY_FAST_FADE_TIME':
        return s.fastFade;
      case 'DT6_QUERY_MIN_FAST_FADE_TIME':
        return set.minFastFadeCount;
      case 'DT6_QUERY_GEAR_TYPE':
      case 'DT6_QUERY_FEATURES':
      case 'DT6_QUERY_FAILURE_STATUS':
        return 0;
      case 'DT6_QUERY_POSSIBLE_OPERATING_MODES':
      case 'DT6_QUERY_OPERATING_MODE':
        return 0x01;
      case 'DT6_QUERY_EXTENDED_VERSION_NUMBER':
        return 2;
      default:
        // Yes/no queries answer no. REFERENCE SYSTEM POWER and the current protector are not modelled.
        return undefined;
    }
  }

  private executeDt8(sp: CommandSpec, at: number): number | undefined {
    const s = this.s;
    const m = this.model;
    const d = s.dtr;
    switch (sp.id) {
      case 'DT8_SET_TEMPORARY_TC': {
        if (!m.tc) return undefined;
        const mirek = d[0] | (d[1] << 8);
        if (mirek === 0) return undefined;
        s.temp.tc = mirek;
        s.temp.type = 'tc';
        return undefined;
      }
      case 'DT8_SET_TEMPORARY_RGB':
      case 'DT8_SET_TEMPORARY_WAF': {
        if (m.channels === 0) return undefined;
        const base = sp.id === 'DT8_SET_TEMPORARY_RGB' ? 0 : 3;
        for (let i = 0; i < 3; i++) s.temp.ch[base + i] = d[i as 0 | 1 | 2];
        s.temp.type = 'rgbwaf';
        return undefined;
      }
      case 'DT8_SET_TEMPORARY_RGBWAF_CONTROL':
        if (m.channels > 0) s.temp.control = d[0];
        return undefined;
      case 'DT8_ACTIVATE':
        if (s.temp.control !== MASK) {
          s.rgbwafControl = s.temp.control;
          s.temp.control = MASK;
        }
        this.activate(at, this.fadeMs());
        return undefined;
      case 'DT8_TC_STEP_COOLER':
      case 'DT8_TC_STEP_WARMER': {
        if (!m.tc || s.activeType !== 'tc') return undefined;
        const cur = this.colourNow(at);
        const tc = this.tcClamped(Math.round(cur.tc) + (sp.id === 'DT8_TC_STEP_COOLER' ? -1 : 1));
        const to = { tc, ch: cur.ch };
        this.pushPlan(at, { colour: { from: to, to, start: at, end: at } });
        return undefined;
      }
      case 'DT8_COPY_REPORT_TO_TEMPORARY': {
        const c = this.colourNow(at);
        s.temp = {
          type: s.activeType,
          tc: Math.round(c.tc),
          ch: c.ch.map((v) => Math.round(v)),
          control: s.temp.control,
        };
        return undefined;
      }
      case 'DT8_STORE_TC_LIMIT': {
        if (!m.tc || !this.profile.settings.tcLimitsStorable) return undefined;
        const v = d[0] | (d[1] << 8);
        if (v === MASK16 || v === 0) return undefined;
        const l = s.tcLimits;
        if (d[2] === 0) l.coolest = clamp(v, l.physicalCoolest, l.warmest);
        else if (d[2] === 1) l.warmest = clamp(v, l.coolest, l.physicalWarmest);
        else if (d[2] === 2) l.physicalCoolest = v;
        else if (d[2] === 3) l.physicalWarmest = v;
        return undefined;
      }
      case 'DT8_STORE_GEAR_FEATURES':
        s.autoActivation = (d[0] & 1) === 1;
        return undefined;
      case 'DT8_QUERY_GEAR_FEATURES':
        return s.autoActivation ? 1 : 0;
      case 'DT8_QUERY_COLOUR_STATUS':
        return (s.tcOutOfRange ? 2 : 0) | (s.activeType === 'tc' ? 0x20 : 0x80);
      case 'DT8_QUERY_COLOUR_TYPE_FEATURES':
        return encodeColourTypeFeatures({
          xy: false,
          tc: m.tc,
          primaries: 0,
          rgbwafChannels: m.channels,
        });
      case 'DT8_QUERY_COLOUR_VALUE':
        return this.queryColourValue(at);
      case 'DT8_QUERY_RGBWAF_CONTROL':
        return m.channels > 0 ? s.rgbwafControl : undefined;
      case 'DT8_QUERY_ASSIGNED_COLOUR':
        return d[0] <= 5 ? (m.assigned[d[0]] ?? MASK) : MASK;
      case 'DT8_QUERY_EXTENDED_VERSION_NUMBER':
        return 2;
      default:
        // xy, primary N, calibration and the STORE PRIMARY commands are not modelled: the DA5-L is
        // not known to report those colour types (dali.md section 17 item 17).
        return undefined;
    }
  }

  /**
   * QUERY COLOUR VALUE: the selector is in DTR0. A 16-bit value answers its high byte and leaves the
   * low byte in DTR0. An 8-bit value answers itself. Anything not available is MASK.
   */
  private queryColourValue(at: number): number {
    const s = this.s;
    const m = this.model;
    const sel = s.dtr[0];
    const c = this.colourNow(at);
    const sixteen = (v: number): number => {
      s.dtr[0] = v & 0xff;
      return (v >> 8) & 0xff;
    };
    const tc = (v: number): number => (m.tc ? sixteen(v) : sixteen(MASK16));
    const ch = (i: number, v: number | undefined): number =>
      i < m.channels && v !== undefined ? Math.round(v) : MASK;
    const typeByte = (t: ColourType | 'none'): number =>
      t === 'tc' ? 0x20 : t === 'rgbwaf' ? 0x80 : 0xff;
    if (sel === 2 || sel === 226) return tc(Math.round(c.tc));
    if (sel >= 9 && sel <= 14) return ch(sel - 9, c.ch[sel - 9]);
    if (sel >= 233 && sel <= 238) return ch(sel - 233, c.ch[sel - 233]);
    if (sel === 15 || sel === 239) return m.channels > 0 ? s.rgbwafControl : MASK;
    if (sel === 128) return tc(s.tcLimits.coolest);
    if (sel === 129) return tc(s.tcLimits.physicalCoolest);
    if (sel === 130) return tc(s.tcLimits.warmest);
    if (sel === 131) return tc(s.tcLimits.physicalWarmest);
    if (sel === 194) return s.temp.type === 'tc' ? tc(s.temp.tc) : sixteen(MASK16);
    if (sel >= 201 && sel <= 206)
      return s.temp.type === 'rgbwaf' ? (s.temp.ch[sel - 201] ?? MASK) : MASK;
    if (sel === 207) return s.temp.control;
    if (sel === 208) return typeByte(s.temp.type);
    if (sel === 240) return typeByte(s.activeType);
    // 16-bit values the DA5-L is not modelled to have (xy, primary N): MASK in both bytes.
    const unmodelled16 =
      (sel >= 3 && sel <= 8) ||
      (sel >= 64 && sel <= 81) ||
      (sel >= 195 && sel <= 200) ||
      (sel >= 227 && sel <= 232);
    if (unmodelled16) return sixteen(MASK16);
    if (sel === 0 || sel === 1 || sel === 192 || sel === 193 || sel === 224 || sel === 225)
      return sixteen(MASK16);
    return MASK;
  }
}
