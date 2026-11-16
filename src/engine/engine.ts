/**
 * The engine (docs/ARCHITECTURE.md): the one object the page talks to, through the bus worker.
 *
 * It holds two kinds of connection. The simulated bench has one for the whole session. Hardware and
 * Both get a fresh one, with a new governor, an empty shadow and a new router, on every connect and
 * every change of target to either of them (SPEC R1.1a). Every frame from every source goes through a
 * connection's scheduler and governor, and only its router reaches its transport.
 */
import type { Cancel, Clock } from '../bus/clock.ts';
import { Scheduler, type BusRecord, type Gate, type TxResult } from '../bus/scheduler.ts';
import { withFloors, type BusTiming } from '../bus/timing.ts';
import { short } from '../dali/address.ts';
import {
  commandText,
  decode,
  decodeSpec,
  frameText,
  type Command,
  type Frame,
} from '../dali/codec.ts';
import { spec } from '../dali/commands.ts';
import { DAPC_SEQUENCE_MS, extendedFadeMs } from '../dali/fade.ts';
import { rgbwafCommands, tcCommands, type TxFrame } from '../dali/sequences.ts';
import { lowerCeiling, raiseCeiling } from '../safety/ceiling.ts';
import { DEFAULT_CEILING_ARC, Governor, type Outcome } from '../safety/governor.ts';
import {
  applySafetyProfile,
  patient,
  ProfileError,
  scan,
  scanAddress,
  type ProfileResult,
  type Submit,
} from '../safety/profile.ts';
import {
  isPerson,
  type SendResult,
  type Source,
  type Transaction,
  type Unlock,
} from '../safety/types.ts';
import { Da5l } from '../sim/gear.ts';
import { DEFAULT_SETTINGS, type Terminal } from '../sim/profile.ts';
import { DEFAULT_SETUP, unitProfile, type BenchUnit, type UnitSetup } from '../sim/settings.ts';
import { Simulator } from '../sim/simulator.ts';
import { Coalescer, type CoalescedResult } from './coalescer.ts';
import { commission, type CommissionResult } from './commission.ts';
import { DivergenceGate, type Divergence } from './divergence.ts';
import {
  checkReport,
  checkStep,
  CHECK_STEPS,
  type CheckContext,
  type CheckResult,
} from './hwcheck.ts';
import { parseLine, type ParseContext } from '../console/parse.ts';
import { parseScript } from '../script/parse.ts';
import { ConsoleExec, type ConsoleHost, type ConsoleLine } from './console.ts';
import { readFacts, type DriverFacts } from './inventory.ts';
import { Router } from './router.ts';
import { send, StepError, toSubmitted, txOf } from './submit.ts';
import { HARD_WINDOW_MS } from '../safety/rate/guard.ts';
import { TIME_MARGIN_MS } from '../safety/rate/legs.ts';
import type { HardwareTransport, Transport } from './transport.ts';

export type OutputTarget = 'simulator' | 'hardware' | 'both';

/** The hardware connection as the top bar shows it. */
export type Connection = 'none' | 'connecting' | 'ready' | 'no-hasseb' | 'disconnected';

/** The six RGBWAF channel levels, 0 to 254, or 255 to leave a channel as it is. */
export type Channels = readonly [number, number, number, number, number, number];

/** A fade setting from the fade picker: a standard fade time 0 to 15, or an extended fade byte. */
export type FadeSetting =
  | { readonly kind: 'standard'; readonly value: number }
  | { readonly kind: 'extended'; readonly value: number };

export type Intent =
  | { readonly kind: 'commands'; readonly commands: readonly Command[]; readonly label?: string }
  | { readonly kind: 'raw'; readonly a: number; readonly b: number }
  /** A level. `live` marks a moving control: the DAPC sequence makes the gear dim smoothly. */
  | {
      readonly kind: 'level';
      readonly address: number;
      readonly arc: number;
      readonly live?: boolean;
    }
  /** A colour temperature, loaded and activated. */
  | { readonly kind: 'tc'; readonly address: number; readonly mirek: number }
  /** RGBWAF channel levels, loaded and activated. */
  | { readonly kind: 'rgbwaf'; readonly address: number; readonly channels: Channels }
  /**
   * Commit mode's Apply: the fade, then the colour loaded without ACTIVATE, then the level, in one
   * transaction, so automatic activation brings colour and level in together.
   */
  | {
      readonly kind: 'apply';
      readonly address: number;
      readonly fade?: FadeSetting;
      readonly arc?: number;
      readonly mirek?: number;
      readonly channels?: Channels;
    };

export type Answer = number | 'none' | 'collision';

export type RequestResult =
  | {
      readonly ok: true;
      readonly answers: readonly Answer[];
      readonly note?: string;
      readonly queued?: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly retryAt?: number;
      /** Why it failed: the governor refused it, a stop dropped it, or the bus faulted. Refused if absent. */
      readonly kind?: 'refused' | 'dropped' | 'fault';
    };

export interface DeviceView {
  readonly address: number;
  readonly verified: boolean;
  /** Whether the driver's MAX LEVEL matches the ceiling (SPEC R6.4). */
  readonly ceiling: 'verified' | 'pending' | 'mismatch';
  readonly profile?: ProfileResult;
  readonly facts?: DriverFacts;
  /** On hardware: the shadow has a model built from read-backs. */
  readonly modelled: boolean;
}

export interface MonitorLine {
  /** Counts up from 1 for the session, so the page can keep more lines than a snapshot carries. */
  readonly seq: number;
  readonly at: number;
  /** Time on the wire, ms. */
  readonly ms: number;
  /** The address the frame names: A0 to A63, G0 to G15, all, or blank. */
  readonly address: string;
  readonly target: 'simulator' | 'hardware';
  readonly source: Source;
  readonly frame: string;
  readonly text: string;
  readonly result: string;
}

/** What a simulated or shadow unit is doing now, for the bench preview and the playground. */
export interface LightView {
  readonly address: number;
  /** The unit's stable name: A or B on the bench, hw0 and up for the hardware shadow. */
  readonly unit: string;
  /** Arc level now, fractional during a fade. 0 is off. */
  readonly level: number;
  /** The level the gear is heading for. */
  readonly target: number;
  readonly mirek: number;
  readonly channels: readonly number[];
  readonly fadeTime: number;
  readonly extendedFade: number;
  readonly fastFade: number;
  /** What a fast fade count of 27 means for this gear, in ms. */
  readonly fast27Ms: number;
  readonly fading: boolean;
  /** Drive on each output terminal, 0 to 1, and what each carries. */
  readonly terminals: readonly number[];
  readonly labels: readonly Terminal[];
}

/** What happened to the newest value of a live control (SPEC R13.5). */
export interface ControlFeedback {
  /** The control and address, as `level:0`, `tc:0` or `rgbwaf:1`. */
  readonly key: string;
  readonly at: number;
  readonly state: 'sent' | 'clamped' | 'waiting' | 'refused';
  readonly text: string;
}

/** A line of console output, numbered like the monitor so the page can keep its own scrollback. */
export interface ConsoleOut extends ConsoleLine {
  readonly seq: number;
}

/** The running script, for the console's status line. */
export interface ScriptView {
  readonly name: string;
  /** The script line of the step running now, from 1. */
  readonly line: number;
  readonly step: number;
  readonly steps: number;
  /** The pause text while the script waits for Enter. */
  readonly paused?: string;
}

export interface JobView {
  readonly kind: string;
  readonly label: string;
}

export interface Snapshot {
  readonly target: OutputTarget;
  readonly hardwareAvailable: boolean;
  readonly connection: Connection;
  readonly connectionReason?: string;
  readonly firmware?: string;
  /** Ask the operator on connect whether they can see the lights (SPEC S3.2). */
  readonly askCanSee: boolean;
  readonly operatorCanSee?: boolean;
  readonly latched: boolean;
  readonly ceilingArc: number;
  readonly unlocks: readonly Unlock[];
  readonly swingLimit: number;
  readonly inventoryStale: boolean;
  readonly scanned: boolean;
  readonly devices: readonly DeviceView[];
  readonly divergences: readonly Divergence[];
  readonly jobs: readonly JobView[];
  readonly check: readonly CheckResult[];
  readonly commission?: CommissionResult;
  readonly monitor: readonly MonitorLine[];
  readonly console: readonly ConsoleOut[];
  readonly script?: ScriptView;
  readonly notices: readonly string[];
  readonly busUse: number;
  /** The active connection's units: the bench in Simulator, the hardware shadow otherwise. */
  readonly light: readonly LightView[];
  readonly feedback: readonly ControlFeedback[];
  /** The simulated bench's units and how each is set up (SPEC R1.6). */
  readonly bench: readonly { readonly unit: BenchUnit; readonly setup: UnitSetup }[];
}

export interface EngineOptions {
  readonly clock: Clock;
  /** The simulated bench, and the transport the worker built for it. */
  readonly sim: Simulator;
  readonly simTransport: Transport;
  readonly timing?: Partial<BusTiming>;
  /** Present only when the page came from the server with a token (SPEC R1.3). */
  readonly hardware?: HardwareTransport;
  readonly ceilingArc?: number;
  /** How the bench's units were built, when not from the defaults (SPEC R1.6). */
  readonly bench?: Partial<Record<BenchUnit, UnitSetup>>;
  /** Scan the simulated bench and write its profile at start. On by default. */
  readonly startScan?: boolean;
}

interface Conn {
  readonly id: number;
  readonly kind: 'simulator' | 'hardware';
  readonly governor: Governor;
  readonly scheduler: Scheduler;
  readonly router: Router;
  readonly facts: Map<number, DriverFacts>;
  readonly profiles: Map<number, ProfileResult>;
  found: number[];
  scanned: boolean;
  prev: Frame | undefined;
  nextCheck: number;
}

interface Job {
  readonly kind: string;
  readonly label: string;
  readonly conn: Conn;
  aborted: boolean;
  /** Why it was stopped, for the console. */
  why?: string;
  /** Ends a console or script wait at once when the job is stopped. */
  readonly wakers?: Set<() => void>;
}

/** Console lines and scripts are a person's or a script's work, not the engine's own (ADR 0014). */
const CONSOLE_JOBS: readonly string[] = ['console', 'script'];

type LiveValue = (
  | { readonly kind: 'level'; readonly arc: number; readonly live: boolean }
  | { readonly kind: 'tc'; readonly mirek: number }
  | { readonly kind: 'rgbwaf'; readonly channels: Channels }
) & { readonly address: number; readonly source: Source };

/** The longest the simulated bench's OFFs before a rebuild may take. */
const REBUILD_HOLD_MS = 60_000;
/** How soon work held during a rebuild asks again. */
const REBUILD_RETRY_MS = 250;

/** How much sooner than the gear's 200 ms the engine starts a new DAPC sequence. */
const SEQUENCE_MARGIN_MS = 100;

/** A visible page sends a heartbeat every second. Three seconds without one stops runners (SPEC S4.6). */
export const HEARTBEAT_LIMIT_MS = 3000;
/** The background check in Both: at most one query a second, when the bus is idle (SPEC R1.5). */
export const BACKGROUND_MS = 1000;
/** A divergence asks for a rescan of the address, at most this often. */
export const RESCAN_MIN_MS = 10_000;

const MONITOR_LINES = 300;
const CONSOLE_LINES = 500;
/** The console lines one snapshot carries. The page keeps its own scrollback. */
const CONSOLE_SNAPSHOT = 200;
const DIVERGENCES = 200;
const NOTICES = 20;

const OK: Outcome = { ok: true };

/** A request that only asks: every command expects a reply, so none changes the light. */
function queriesOnly(intent: Intent): boolean {
  if (intent.kind === 'commands')
    return intent.commands.every((c) => {
      try {
        return spec(c.id).reply !== 'none';
      } catch {
        return false;
      }
    });
  if (intent.kind === 'raw')
    return (decodeSpec({ a: intent.a & 0xff, b: intent.b & 0xff })?.reply ?? 'none') !== 'none';
  return false;
}

function checkChannels(ch: readonly number[]): string | undefined {
  if (ch.length !== 6 || ch.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return 'Channels are six levels from 0 to 254, or 255 to leave one as it is.';
  return undefined;
}
const no = (reason: string): Outcome => ({ ok: false, reason });

function resultText(r: SendResult): string {
  switch (r.kind) {
    case 'sent':
      return 'sent';
    case 'reply':
      return `reply ${String(r.byte)}`;
    case 'no-reply':
      return 'no answer';
    case 'framing-error':
      return 'framing error';
    case 'fault':
      return `fault: ${r.reason}`;
    case 'refused':
      return `refused: ${r.reason}`;
  }
}

function answersOf(tx: Transaction, results: readonly SendResult[]): Answer[] {
  const out: Answer[] = [];
  results.forEach((r, i) => {
    if (tx.frames[i]?.expectReply !== true) return;
    out.push(r.kind === 'reply' ? r.byte : r.kind === 'framing-error' ? 'collision' : 'none');
  });
  return out;
}

function fromTx(r: TxResult): RequestResult {
  switch (r.kind) {
    case 'done':
      return {
        ok: true,
        answers: answersOf(r.tx, r.results),
        ...(r.note === undefined ? {} : { note: r.note }),
      };
    case 'refused':
      return {
        ok: false,
        kind: 'refused',
        reason: r.reason,
        ...(r.retryAt === undefined ? {} : { retryAt: r.retryAt }),
      };
    case 'dropped':
    case 'fault':
      return { ok: false, kind: r.kind, reason: r.reason };
  }
}

export class Engine {
  private readonly clock: Clock;
  private readonly sim: Simulator;
  private readonly simTransport: Transport;
  private readonly hardware: HardwareTransport | undefined;
  private readonly timing: BusTiming;
  private ceiling: number;
  private target: OutputTarget = 'simulator';
  private connection: Connection = 'none';
  private connectionReason: string | undefined;
  private connectAttempt = 0;
  private latched = false;
  private askCanSee = false;
  private canSee: boolean | undefined;
  private connCount = 0;
  private readonly simConn: Conn;
  private hwConn: Conn | undefined;
  /** Panic only, for the hardware transport while no hardware connection is in use. */
  private readonly standby: Scheduler | undefined;
  private readonly jobs = new Set<Job>();
  private readonly coalescer: Coalescer<LiveValue>;
  private readonly feedback = new Map<string, ControlFeedback>();
  /** When each address last took a live DAPC, for the DAPC sequence. */
  private readonly lastLiveDapc = new Map<number, number>();
  private monitorSeq = 0;
  private consoleSeq = 0;
  private readonly consoleOut: ConsoleOut[] = [];
  private scriptView: ScriptView | undefined;
  /** Continues a paused script. */
  private continueScript: (() => void) | undefined;
  /** After the bench is rebuilt, light changes on it wait until this time. */
  private benchHoldUntil = -Infinity;
  private benchSetup: Readonly<Record<BenchUnit, UnitSetup>>;
  private readonly divergences: Divergence[] = [];
  private readonly monitor: MonitorLine[] = [];
  private readonly notices: string[] = [];
  private checkResults: CheckResult[] = [];
  private lastCommission: CommissionResult | undefined;
  private readonly pendingRescan = new Set<number>();
  private readonly lastRescan = new Map<number, number>();
  private backgroundBusy = false;
  private lastBeat: number;
  /** The watchdog starts with the page's first heartbeat that says it is visible. */
  private pageVisible = false;
  private tick: Cancel | undefined;
  private readonly listeners = new Set<(s: Snapshot) => void>();
  private readonly startListeners = new Set<(f: TxFrame, conn: Conn | undefined) => void>();
  private emitPending: Cancel | undefined;
  private disposed = false;

  constructor(o: EngineOptions) {
    this.clock = o.clock;
    this.sim = o.sim;
    this.simTransport = o.simTransport;
    this.hardware = o.hardware;
    this.timing = withFloors(o.timing ?? {});
    this.ceiling = o.ceilingArc ?? DEFAULT_CEILING_ARC;
    this.benchSetup = { ...DEFAULT_SETUP, ...o.bench };
    this.lastBeat = this.clock.now();
    this.simConn = this.makeConn('simulator');
    if (this.hardware !== undefined) this.standby = this.makeStandby(this.hardware);
    this.coalescer = new Coalescer(this.clock, (key, v) => this.sendLive(key, v));
    this.scheduleTick();
    if (o.startScan !== false) void this.inventory(this.simConn);
  }

  /** Stop the engine's own timers. Used by tests and when the worker ends. */
  dispose(): void {
    this.disposed = true;
    this.tick?.();
    this.emitPending?.();
    this.coalescer.cancel();
  }

  // -----------------------------------------------------------------------------------------------
  // Connections

  private makeConn(kind: 'simulator' | 'hardware'): Conn {
    const id = ++this.connCount;
    const governor = new Governor({
      target: kind,
      shadow: kind === 'simulator' ? this.sim : new Simulator([]),
      timing: this.timing,
      ceilingArc: this.ceiling,
      shadowFedByTransport: kind === 'simulator',
      connectedAt: this.clock.now(),
    });
    if (this.latched) governor.latch();
    const transport = kind === 'simulator' ? this.simTransport : this.hardware;
    if (transport === undefined) throw new Error('No hardware transport.');
    const router = new Router({
      transport,
      clock: this.clock,
      issuer: governor,
      onRefused: (reason) => {
        this.notice(`The router refused a frame: ${reason}`);
      },
    });
    // The gate and the scheduler call back into the connection once it exists.
    const ref: { conn?: Conn } = {};
    const gate: Gate =
      kind === 'hardware'
        ? new DivergenceGate(
            governor,
            () => {
              const c = ref.conn;
              return (
                c !== undefined &&
                this.target === 'both' &&
                this.hwConn === c &&
                !this.inventoryRunning(c)
              );
            },
            (d) => {
              if (ref.conn !== undefined) this.divergence(ref.conn, d);
            },
          )
        : governor;
    const scheduler = new Scheduler({
      clock: this.clock,
      sink: router,
      gate,
      timing: this.timing,
      onFrame: (r) => {
        if (ref.conn !== undefined) this.onFrame(ref.conn, r);
      },
      onStart: (f) => {
        for (const l of this.startListeners) l(f, ref.conn);
      },
    });
    const conn: Conn = {
      id,
      kind,
      governor,
      scheduler,
      router,
      facts: new Map(),
      profiles: new Map(),
      found: [],
      scanned: false,
      prev: undefined,
      nextCheck: 0,
    };
    ref.conn = conn;
    return conn;
  }

  /**
   * A scheduler for the hardware transport that can only panic. Its gate refuses every transaction
   * and its router's governor has issued no approval, so panic's TERMINATE and OFF are the only
   * frames it can send. Panic uses it when no hardware connection is in use.
   */
  private makeStandby(transport: HardwareTransport): Scheduler {
    const refuseAll: Gate = {
      judge: () => ({ kind: 'refuse', reason: 'The hardware is not in use.' }),
      observe: () => undefined,
      latch: () => undefined,
    };
    const router = new Router({ transport, clock: this.clock, issuer: { issued: () => false } });
    return new Scheduler({ clock: this.clock, sink: router, gate: refuseAll, timing: this.timing });
  }

  /**
   * A hardware connection is replaced or lost: latch its governor, drop its queue, and close its
   * router, so nothing it had queued can reach the bus after a later panic (security review H1).
   */
  private retireHardware(): void {
    const c = this.hwConn;
    if (c === undefined) return;
    this.hwConn = undefined;
    c.governor.latch();
    c.scheduler.close();
    c.router.close();
  }

  private active(): Conn | undefined {
    return this.target === 'simulator' ? this.simConn : this.hwConn;
  }

  private conns(): Conn[] {
    return this.hwConn === undefined ? [this.simConn] : [this.simConn, this.hwConn];
  }

  /** Change the output target (SPEC R1.1). Stops runners first and sends no level. */
  async setTarget(t: OutputTarget, source: Source): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person changes the output target.');
    if (t !== 'simulator' && this.hardware === undefined)
      return no(
        'Hardware needs the server. Start it with "python -m server" and open the address it prints.',
      );
    this.stopRunners('The output target changed.');
    this.target = t;
    this.feedback.clear();
    if (t === 'simulator') {
      // Anything the hardware connection still had queued must not go out after the change. The
      // server connection stays open and idle, so the real lights are not turned off by this.
      this.retireHardware();
      this.emit();
      return OK;
    }
    this.emit();
    return this.connectHardware();
  }

  /** Connect again after the hardware dropped. */
  async reconnect(source: Source): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person reconnects.');
    if (this.target === 'simulator') return no('The output target is Simulator.');
    return this.connectHardware();
  }

  private async connectHardware(): Promise<Outcome> {
    const hw = this.hardware;
    if (hw === undefined) return no('There is no server.');
    const attempt = ++this.connectAttempt;
    // Nothing learned before carries over: a new governor, an empty shadow (SPEC R1.1a).
    this.retireHardware();
    this.askCanSee = false;
    this.canSee = undefined;
    this.connection = 'connecting';
    this.connectionReason = undefined;
    this.emit();
    if (hw.state() !== 'ready') {
      try {
        await hw.connect();
      } catch (e) {
        if (attempt !== this.connectAttempt) return no('A newer connection replaced this one.');
        this.connection = 'disconnected';
        this.connectionReason = e instanceof Error ? e.message : String(e);
        this.emit();
        return no(this.connectionReason);
      }
    }
    if (attempt !== this.connectAttempt || this.target === 'simulator')
      return no('The target changed while connecting.');
    if (hw.info()?.attached === false) {
      this.connection = 'no-hasseb';
      this.connectionReason = 'The server has no hasseb attached.';
      this.emit();
      return no(this.connectionReason);
    }
    const conn = this.makeConn('hardware');
    this.hwConn = conn;
    this.connection = 'ready';
    this.askCanSee = true;
    this.emit();
    void this.inventory(conn);
    return OK;
  }

  /** The worker reports the server transport's state here. */
  onTransportState(state: string, reason?: string): void {
    if (state !== 'down' && state !== 'fault') return;
    if (this.connection === 'connecting') return; // connectHardware reports its own failure.
    const had = this.hwConn !== undefined;
    this.retireHardware();
    this.connectAttempt++;
    if (this.target !== 'simulator' && had) this.stopRunners('The hardware connection dropped.');
    // SPEC R1.8: show it, stop, and send nothing to the simulator in its place.
    this.connection = 'disconnected';
    this.connectionReason = reason;
    this.askCanSee = false;
    this.emit();
  }

  /** The server says the hasseb came or went. */
  onDevice(attached: boolean): void {
    if (!attached) {
      const had = this.hwConn !== undefined;
      this.retireHardware();
      if (this.target !== 'simulator' && had) this.stopRunners('The hasseb was unplugged.');
      this.connection = 'no-hasseb';
      this.connectionReason = 'The hasseb was unplugged.';
      this.askCanSee = false;
      this.emit();
      return;
    }
    if (this.target !== 'simulator' && this.connection === 'no-hasseb') void this.connectHardware();
  }

  // -----------------------------------------------------------------------------------------------
  // Panic, runners and the page's heartbeat

  /** Panic (SPEC S4): stop every runner, latch every governor, and send TERMINATE and OFF everywhere. */
  async panic(): Promise<void> {
    this.latched = true;
    this.stopRunners('Panic.');
    const all = this.conns();
    for (const c of all) c.governor.latch();
    this.emit();
    const stops = all.map((c) => c.scheduler.panic());
    // The server may be connected with no hardware connection in use: after a change to Simulator,
    // or while a connect is under way. Its lights still get panic (DALI re-review).
    if (
      this.hwConn === undefined &&
      this.standby !== undefined &&
      this.hardware?.state() === 'ready'
    )
      stops.push(this.standby.panic());
    await Promise.all(stops);
    this.emit();
  }

  /** Lift the latch. Only a person can. Nothing is sent by resuming. */
  resume(source: Source): Outcome {
    if (!isPerson(source)) return no('Only a person can resume after panic.');
    for (const c of this.conns()) c.governor.resume(source);
    this.latched = false;
    this.emit();
    return OK;
  }

  /** Stop every runner: jobs end at their next frame, and waiting live values are dropped. */
  stopRunners(why: string): void {
    if (this.jobs.size > 0 || this.coalescer.waiting() > 0) this.notice(`Stopped: ${why}`);
    for (const j of this.jobs) this.abort(j, why);
    this.coalescer.cancel();
  }

  private abort(j: Job, why: string): void {
    if (!j.aborted) j.why = why;
    j.aborted = true;
    for (const w of j.wakers ?? []) w();
    j.wakers?.clear();
  }

  /** The page's heartbeat, with whether it is visible (SPEC S4.6). */
  heartbeat(visible: boolean): void {
    this.lastBeat = this.clock.now();
    this.pageVisible = visible;
  }

  private scheduleTick(): void {
    if (this.disposed) return;
    this.tick = this.clock.at(this.clock.now() + BACKGROUND_MS, () => {
      this.onTick();
      this.scheduleTick();
    });
  }

  private onTick(): void {
    const now = this.clock.now();
    if (this.pageVisible && now - this.lastBeat > HEARTBEAT_LIMIT_MS && this.jobs.size > 0) {
      this.stopRunners('The page stopped answering, so it could not offer Panic.');
    }
    this.background();
  }

  // -----------------------------------------------------------------------------------------------
  // Jobs

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.at(this.clock.now() + ms, resolve);
    });
  }

  /** A `Submit` bound to a connection and a job. Refusals with a retry time are retried (`patient`). */
  /** A `Submit` bound to a connection and a job, that returns the first refusal as it is. */
  private rawSubmitter(conn: Conn, job: Job | undefined): Submit {
    return async (tx, priority) => {
      if (job?.aborted === true) return { kind: 'dropped', reason: 'Stopped.' };
      if (conn.kind === 'hardware' && this.hwConn !== conn)
        return { kind: 'dropped', reason: 'The hardware connection changed.' };
      return toSubmitted(await conn.scheduler.submit(tx, priority));
    };
  }

  private submitter(conn: Conn, job: Job | undefined): Submit {
    return patient(
      this.rawSubmitter(conn, job),
      (ms) => this.wait(ms),
      () => this.clock.now(),
    );
  }

  private async runJob<T>(
    conn: Conn,
    kind: string,
    label: string,
    fn: (job: Job, submit: Submit) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    const job: Job = { kind, label, conn, aborted: false, wakers: new Set() };
    this.jobs.add(job);
    this.emit();
    try {
      return { ok: true, value: await fn(job, this.submitter(conn, job)) };
    } catch (e) {
      if (e instanceof StepError || e instanceof ProfileError) {
        this.notice(`${label}: ${e.message}`);
        return { ok: false, reason: e.message };
      }
      throw e;
    } finally {
      this.jobs.delete(job);
      this.emit();
    }
  }

  private inventoryRunning(conn: Conn): boolean {
    for (const j of this.jobs)
      if (j.conn === conn && j.kind !== 'check' && !CONSOLE_JOBS.includes(j.kind)) return true;
    return false;
  }

  /** Scan, write the safety profile, and read everything each driver reports (SPEC D1, S1.1). */
  private async inventory(conn: Conn): Promise<Outcome> {
    const r = await this.runJob(conn, 'scan', 'Scan and safety profile', async (job, submit) => {
      await this.inventoryIn(conn, job, submit);
    });
    return r.ok ? OK : no(r.reason);
  }

  private async inventoryIn(conn: Conn, job: Job, submit: Submit): Promise<void> {
    const found = await scan(conn.governor, submit);
    conn.found = found;
    conn.scanned = true;
    conn.facts.clear();
    this.emit();
    for (const n of found) {
      if (job.aborted) return;
      conn.profiles.set(n, await applySafetyProfile(n, conn.governor, submit));
      this.emit();
    }
    for (const n of found) {
      if (job.aborted) return;
      conn.facts.set(n, await readFacts(n, conn.governor, submit));
      this.emit();
    }
  }

  /** Scan again on request. */
  async rescan(source: Source): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person starts a scan.');
    const conn = this.active();
    if (conn === undefined) return no('Hardware: disconnected.');
    return this.inventory(conn);
  }

  /** Write the safety profile to every driver again (S1.1), from the Devices page. */
  async reapplyProfile(source: Source): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person re-applies the profile.');
    const conn = this.active();
    if (conn === undefined) return no('Hardware: disconnected.');
    const r = await this.runJob(conn, 'profile', 'Safety profile', async (job, submit) => {
      for (const n of conn.found) {
        if (job.aborted) return;
        conn.profiles.set(n, await applySafetyProfile(n, conn.governor, submit));
        this.emit();
      }
    });
    return r.ok ? OK : no(r.reason);
  }

  // -----------------------------------------------------------------------------------------------
  // Both: divergence and the background check

  private divergence(conn: Conn, d: Divergence): void {
    this.divergences.push(d);
    if (this.divergences.length > DIVERGENCES) this.divergences.shift();
    if (conn === this.hwConn) this.pendingRescan.add(d.address);
    this.emit();
  }

  private background(): void {
    const hw = this.hwConn;
    if (this.target !== 'both' || hw === undefined || this.latched || this.backgroundBusy) return;
    const busy = [...this.jobs].some((j) => !CONSOLE_JOBS.includes(j.kind));
    if (hw.scheduler.queued > 0 || busy || this.coalescer.waiting() > 0) return;
    const now = this.clock.now();
    const n = [...this.pendingRescan].find(
      (a) => now - (this.lastRescan.get(a) ?? -Infinity) >= RESCAN_MIN_MS,
    );
    if (n !== undefined) {
      this.pendingRescan.delete(n);
      this.lastRescan.set(n, now);
      // The hardware's values correct the shadow by the safe path: a scan rebuilds its model (ADR 0012).
      // A rescan that cannot model the address (a fade was running) stays pending, and is tried
      // again no sooner than RESCAN_MIN_MS later.
      void this.runJob(hw, 'rescan', `Rescan A${String(n)}`, async (_job, submit) => {
        await scanAddress(n, hw.governor, submit);
      }).then(() => {
        if (this.hwConn === hw && hw.governor.addressInfo(n)?.modelled !== true)
          this.pendingRescan.add(n);
      });
      return;
    }
    const modelled = hw.found.filter((a) => hw.governor.addressInfo(a)?.modelled === true);
    if (modelled.length === 0) return;
    const a = modelled[hw.nextCheck++ % modelled.length];
    if (a === undefined) return;
    this.backgroundBusy = true;
    void hw.scheduler
      .submit(
        txOf([{ id: 'QUERY_ACTUAL_LEVEL', address: short(a) }], 'internal', 'background check'),
        'background',
      )
      .finally(() => {
        this.backgroundBusy = false;
      });
  }

  /** Clear the divergence log. */
  clearDivergences(): void {
    this.divergences.length = 0;
    this.emit();
  }

  // -----------------------------------------------------------------------------------------------
  // Settings

  async setCeiling(arc: number, source: Source, confirmed = false): Promise<Outcome> {
    const lowering = arc < this.ceiling;
    // A rebuilt simulated unit may not have been scanned yet, so its set-up is checked too (SPEC R6.5).
    const benchMin = Math.max(
      ...(['A', 'B'] as const).map(
        (u) => this.benchSetup[u].settings.physicalMinimum ?? DEFAULT_SETTINGS.physicalMinimum,
      ),
    );
    if (lowering && arc < benchMin)
      return no(
        `A simulated driver cannot go below arc level ${String(benchMin)}. That is the lowest ceiling it can hold.`,
      );
    const results = await Promise.all(
      this.conns().map(async (c) => {
        const r = await this.runJob(c, 'ceiling', 'Ceiling', async (job, submit) =>
          lowering
            ? // lowerCeiling waits for the rate guard itself, and works its holds out again before
              // each attempt, so it takes a submit that does not retry (DALI review S5-L4).
              lowerCeiling(
                c.governor,
                arc,
                this.rawSubmitter(c, job),
                source,
                () => this.clock.now(),
                (ms) => this.wait(ms),
              )
            : raiseCeiling(c.governor, arc, submit, source, confirmed),
        );
        if (r.ok && r.value.ok)
          for (const p of r.value.profiles ?? []) c.profiles.set(p.address, p);
        return r.ok ? r.value : { ok: false as const, reason: r.reason };
      }),
    );
    // Report what happened where the lights are: the active connection (security review L1).
    const conns = this.conns();
    const active = this.active();
    const i = active === undefined ? 0 : conns.indexOf(active);
    const mine = results[i] ?? results[0];
    if (mine === undefined) return no('No connection.');
    if (mine.ok) this.ceiling = arc;
    this.emit();
    if (!mine.ok) return mine;
    const failed = (mine.profiles ?? [])
      .filter((p) => !p.verified)
      .map((p) => `A${String(p.address)}`);
    if (failed.length > 0)
      return no(
        `The ceiling is now arc level ${String(arc)}, but MAX LEVEL did not take on ${failed.join(', ')}. Write the safety profile again.`,
      );
    return OK;
  }

  unlock(u: Unlock, source: Source, confirmed: boolean): Outcome {
    // On hardware the operator answers first whether they can see the lights (security review L4).
    if (u === 'rate' && this.hwConn !== undefined && this.canSee === undefined)
      return no('Answer whether you can see the lights first.');
    let out: Outcome = OK;
    for (const c of this.conns()) {
      const r = c.governor.unlock(u, source, confirmed);
      if (c === this.active()) out = r;
    }
    this.emit();
    return out;
  }

  lock(u?: Unlock): void {
    for (const c of this.conns()) c.governor.lock(u);
    this.emit();
  }

  setSwingLimit(n: number, source: Source): Outcome {
    let out: Outcome = OK;
    for (const c of this.conns()) {
      const r = c.governor.setSwingLimit(n, source);
      if (c === this.active()) out = r;
    }
    this.emit();
    return out;
  }

  /** The operator's answer on connect (SPEC S3.2, THREAT_MODEL 3.5). */
  answerCanSee(can: boolean, source: Source): Outcome {
    const hw = this.hwConn;
    if (hw === undefined) return no('Hardware: disconnected.');
    const r = hw.governor.setOperatorCanSee(can, source);
    if (r.ok) {
      this.canSee = can;
      this.askCanSee = false;
    }
    this.emit();
    return r;
  }

  // -----------------------------------------------------------------------------------------------
  // Requests

  async request(intent: Intent, source: Source): Promise<RequestResult> {
    const conn = this.active();
    if (conn === undefined) return { ok: false, reason: 'Hardware: disconnected.' };
    if (!queriesOnly(intent)) {
      const held = this.benchHeld(conn);
      if (
        held !== undefined &&
        intent.kind !== 'level' &&
        intent.kind !== 'tc' &&
        intent.kind !== 'rgbwaf'
      )
        return held;
    }
    switch (intent.kind) {
      case 'level':
        if (!Number.isInteger(intent.address) || intent.address < 0 || intent.address > 63)
          return { ok: false, reason: 'An address is 0 to 63.' };
        if (!Number.isInteger(intent.arc) || intent.arc < 0 || intent.arc > 254)
          return { ok: false, reason: 'A level is an arc level from 0 to 254.' };
        this.coalescer.set(`level:${String(intent.address)}`, {
          kind: 'level',
          address: intent.address,
          arc: intent.arc,
          live: intent.live === true,
          source,
        });
        return { ok: true, answers: [], queued: true };
      case 'tc': {
        const bad = this.checkColour(conn, intent.address, 'tc');
        if (bad !== undefined) return { ok: false, reason: bad };
        if (!Number.isInteger(intent.mirek) || intent.mirek < 1 || intent.mirek > 0xfffe)
          return { ok: false, reason: 'A colour temperature is 1 to 65534 mirek.' };
        this.coalescer.set(`tc:${String(intent.address)}`, {
          kind: 'tc',
          address: intent.address,
          mirek: intent.mirek,
          source,
        });
        return { ok: true, answers: [], queued: true };
      }
      case 'rgbwaf': {
        const bad =
          this.checkColour(conn, intent.address, 'rgbwaf') ?? checkChannels(intent.channels);
        if (bad !== undefined) return { ok: false, reason: bad };
        this.coalescer.set(`rgbwaf:${String(intent.address)}`, {
          kind: 'rgbwaf',
          address: intent.address,
          channels: intent.channels,
          source,
        });
        return { ok: true, answers: [], queued: true };
      }
      case 'apply': {
        const cmds = this.compileApply(conn, intent);
        if (typeof cmds === 'string') return { ok: false, reason: cmds };
        if (cmds.length === 0) return { ok: false, reason: 'Nothing to apply.' };
        return fromTx(await conn.scheduler.submit(txOf(cmds, source, 'apply')));
      }
      case 'raw': {
        const frame: Frame = { a: intent.a & 0xff, b: intent.b & 0xff };
        const s = decodeSpec(frame);
        const f: TxFrame = {
          frame,
          sendTwice: s?.sendTwice ?? false,
          expectReply: (s?.reply ?? 'none') !== 'none',
        };
        const tx: Transaction = { frames: [f], source, label: `raw ${frameText(frame)}` };
        return fromTx(await conn.scheduler.submit(tx));
      }
      case 'commands': {
        for (const c of intent.commands) {
          try {
            spec(c.id);
          } catch {
            return { ok: false, reason: `Unknown command ${c.id}.` };
          }
        }
        let tx: Transaction;
        try {
          tx = txOf(
            intent.commands,
            source,
            intent.label ?? intent.commands.map(commandText).join(', '),
          );
        } catch (e) {
          return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
        return fromTx(await conn.scheduler.submit(tx));
      }
    }
  }

  /** SPEC D2: drive each address the way it reports it can be driven. */
  private checkColour(conn: Conn, address: number, drive: 'tc' | 'rgbwaf'): string | undefined {
    if (!Number.isInteger(address) || address < 0 || address > 63) return 'An address is 0 to 63.';
    const facts = conn.facts.get(address);
    if (facts === undefined) return `A${String(address)} has not been read yet.`;
    if (facts.drive !== drive)
      return drive === 'tc'
        ? `A${String(address)} does not report colour temperature control.`
        : `A${String(address)} does not report RGBWAF channels.`;
    return undefined;
  }

  private compileApply(conn: Conn, i: Extract<Intent, { kind: 'apply' }>): Command[] | string {
    const n = i.address;
    if (!Number.isInteger(n) || n < 0 || n > 63) return 'An address is 0 to 63.';
    const a = short(n);
    const cmds: Command[] = [];
    if (i.fade !== undefined) {
      const v = i.fade.value;
      if (i.fade.kind === 'standard') {
        if (!Number.isInteger(v) || v < 0 || v > 15) return 'A fade time is 0 to 15.';
        cmds.push({ id: 'DTR0', value: v }, { id: 'SET_FADE_TIME', address: a });
      } else {
        // 0 is no fade at all. Other bytes must name a time (dali.md section 7).
        if (!Number.isInteger(v) || v < 0 || (v !== 0 && extendedFadeMs(v) === 0))
          return 'That is not an extended fade time.';
        // The extended fade is used only while the fade time is 0 (dali.md section 7).
        cmds.push(
          { id: 'DTR0', value: 0 },
          { id: 'SET_FADE_TIME', address: a },
          { id: 'DTR0', value: v },
          { id: 'SET_EXTENDED_FADE_TIME', address: a },
        );
      }
    }
    if (i.mirek !== undefined && i.channels !== undefined)
      return 'Apply a colour temperature or channels, not both.';
    // The DAPC brings a loaded colour in only if the gear reports automatic activation (gear features
    // bit 0, dali.md section 11). Otherwise, or if it was not read, ACTIVATE is sent as well: before
    // the level when the light is off or getting brighter, so the new colour starts at the dimmer
    // end, and after it when the light is getting dimmer. The light between the two is then never
    // brighter than at the start or the end (DALI review S5-D3).
    const auto = ((conn.facts.get(n)?.gearFeatures ?? 0) & 1) === 1;
    const present = conn.governor.shadow.byShortAddress(n)?.gear.levelAt(this.clock.now()) ?? 0;
    const colourFirst = i.arc === undefined || present <= 0 || i.arc >= present;
    const activate = i.arc === undefined || (!auto && colourFirst);
    const activateAfter = i.arc !== undefined && !auto && !colourFirst;
    if (i.mirek !== undefined) {
      const bad = this.checkColour(conn, n, 'tc');
      if (bad !== undefined) return bad;
      if (!Number.isInteger(i.mirek) || i.mirek < 1 || i.mirek > 0xfffe)
        return 'A colour temperature is 1 to 65534 mirek.';
      cmds.push(...tcCommands(a, i.mirek, activate));
    }
    if (i.channels !== undefined) {
      const bad = this.checkColour(conn, n, 'rgbwaf') ?? checkChannels(i.channels);
      if (bad !== undefined) return bad;
      cmds.push(...rgbwafCommands(a, i.channels, activate));
    }
    if (i.arc !== undefined) {
      if (!Number.isInteger(i.arc) || i.arc < 0 || i.arc > 254)
        return 'A level is an arc level from 0 to 254.';
      cmds.push({ id: 'DAPC', address: a, value: i.arc });
      if (activateAfter && (i.mirek !== undefined || i.channels !== undefined))
        cmds.push({ id: 'DT8_ACTIVATE', address: a });
    }
    return cmds;
  }

  private async sendLive(key: string, v: LiveValue): Promise<CoalescedResult> {
    const conn = this.active();
    if (conn === undefined) return { ok: false };
    const held = this.benchHeld(conn);
    if (held !== undefined && !held.ok) {
      if (held.retryAt === undefined) {
        this.setFeedback(key, this.clock.now(), 'refused', `Refused: ${held.reason}`);
        return { ok: false };
      }
      this.setFeedback(key, this.clock.now(), 'waiting', `Waiting: ${held.reason}`);
      return { ok: false, retryAt: held.retryAt };
    }
    const a = short(v.address);
    const now = this.clock.now();
    let cmds: Command[];
    let label: string;
    switch (v.kind) {
      case 'level':
        cmds = [];
        // A moving control keeps a DAPC sequence going: the gear fades over 200 ms between them.
        // The time is taken when the last DAPC finished, which is later than the gear heard it, so a
        // margin keeps a sequence going only while it surely is (DALI review S5-D4).
        if (
          v.live &&
          now - (this.lastLiveDapc.get(v.address) ?? -Infinity) >
            DAPC_SEQUENCE_MS - SEQUENCE_MARGIN_MS
        )
          cmds.push({ id: 'ENABLE_DAPC_SEQUENCE', address: a });
        cmds.push({ id: 'DAPC', address: a, value: v.arc });
        label = 'level';
        break;
      case 'tc':
        cmds = tcCommands(a, v.mirek, true);
        label = 'colour temperature';
        break;
      case 'rgbwaf':
        cmds = rgbwafCommands(a, v.channels, true);
        label = 'colour';
        break;
    }
    const r = await conn.scheduler.submit(txOf(cmds, v.source, label));
    const at = this.clock.now();
    if (r.kind === 'done') {
      if (v.kind === 'level') {
        if (v.live) this.lastLiveDapc.set(v.address, at);
        else this.lastLiveDapc.delete(v.address);
      }
      const sent = r.tx.frames.map((f) => decode(f.frame)).filter((c) => c?.id === 'DAPC');
      const what =
        v.kind === 'level'
          ? `level ${String(sent[0]?.value ?? v.arc)}`
          : v.kind === 'tc'
            ? `${String(v.mirek)} mirek`
            : `channels ${v.channels.join(' ')}`;
      this.setFeedback(
        key,
        at,
        r.note !== undefined && r.note !== '' ? 'clamped' : 'sent',
        r.note !== undefined && r.note !== '' ? `Sent ${what}. ${r.note}` : `Sent ${what}.`,
      );
      return { ok: true };
    }
    if (r.kind === 'refused' && r.retryAt !== undefined) {
      this.setFeedback(key, at, 'waiting', `Waiting: ${r.reason}`);
      return { ok: false, retryAt: r.retryAt };
    }
    this.setFeedback(key, at, 'refused', `Refused: ${r.reason}`);
    return { ok: false };
  }

  private setFeedback(
    key: string,
    at: number,
    state: ControlFeedback['state'],
    text: string,
  ): void {
    this.feedback.set(key, { key, at, state, text });
    this.emitSoon();
  }

  /**
   * Set up the simulated bench again (SPEC R1.6): each unit is rebuilt with its new profile and
   * starts off, the simulator's governor starts afresh, and the bench is scanned and given its
   * profile again. Nothing here reaches the hardware connection.
   */
  async setBench(setup: Partial<Record<BenchUnit, UnitSetup>>, source: Source): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person changes the simulator settings.');
    if (setup.A === undefined && setup.B === undefined) return no('Nothing to change.');
    // One rebuild at a time, so one cannot end the other's hold (DALI review S5-D15).
    if (this.benchHoldUntil === Infinity)
      return no('The simulated bench is being rebuilt. Try again when it is done.');
    const units = (['A', 'B'] as const).filter((u) => setup[u] !== undefined);
    const tooHigh = (): Outcome | undefined => {
      for (const u of units) {
        const min = setup[u]?.settings.physicalMinimum ?? DEFAULT_SETTINGS.physicalMinimum;
        if (min > this.ceiling)
          return no(
            `Unit ${u} could not go as low as the ceiling (arc ${String(this.ceiling)}) with a physical minimum of ${String(min)}. Lower the physical minimum, or raise the ceiling to at least arc ${String(min)} first.`,
          );
      }
      return undefined;
    };
    const early = tooHigh();
    if (early !== undefined) return early;
    if (this.target === 'simulator') this.stopRunners('The simulator settings changed.');
    // The rate guard reads each unit's history from its gear, and new gear has none. So each lit
    // unit is first turned off through the governor, which judges that step and makes it wait if it
    // must. While that happens, and for the hard step window after the rebuild, the governor lets
    // nothing but OFF through, from any source or job, and the engine turns requests away (DALI
    // review S5-D1). Nothing about the light is then changed by the rebuild itself.
    const reason = 'the simulated bench is being rebuilt';
    this.benchHoldUntil = Infinity;
    // The end is not known yet, so work held meanwhile asks again every quarter second, and a
    // ceiling lowered now does not wait for the whole hold (DALI review S5-D13).
    this.simConn.governor.holdLightChanges(
      this.clock.now() + REBUILD_HOLD_MS,
      reason,
      REBUILD_RETRY_MS,
    );
    // Any way out of the OFF job, a thrown error included, ends the open-ended hold.
    const release = () => {
      this.benchHoldUntil = -Infinity;
      this.simConn.governor.holdLightChanges(
        this.clock.now() + HARD_WINDOW_MS + TIME_MARGIN_MS,
        reason,
      );
    };
    let off: Awaited<ReturnType<typeof this.runJob<void>>>;
    try {
      off = await this.runJob(
        this.simConn,
        'settings',
        'Simulator settings',
        async (_job, submit) => {
          for (const u of units) {
            const g = this.sim.unit(u)?.gear;
            const n = g?.shortAddress;
            if (g === undefined || n === null || n === undefined) continue;
            if (g.finalLevel() <= 0 && g.levelAt(this.clock.now()) <= 0) continue;
            await send(
              submit,
              [{ id: 'OFF', address: short(n) }],
              source,
              'off before the rebuild',
            );
          }
        },
      );
    } catch (e) {
      release();
      throw e;
    }
    const lit = units.filter((u) => {
      const g = this.sim.unit(u)?.gear;
      return g !== undefined && (g.finalLevel() > 0 || g.levelAt(this.clock.now()) > 0);
    });
    if (!off.ok || lit.length > 0) {
      release();
      return no(
        `The simulated units could not be turned off first: ${off.ok ? `unit ${lit.join(', ')} is still lit` : off.reason}`,
      );
    }
    // The ceiling may have been lowered while the units were turned off (DALI review S5-D14).
    const late = tooHigh();
    if (late !== undefined) {
      release();
      return late;
    }
    const now = this.clock.now();
    for (const unit of units) {
      const next = setup[unit];
      if (next === undefined) continue;
      const old = this.sim.unit(unit)?.gear;
      const gear = new Da5l(unitProfile(unit, next), {
        shortAddress: old?.shortAddress ?? (unit === 'A' ? 0 : 1),
        at: now,
        ...(unit === 'B' ? { seed: 0x1234567 } : {}),
      });
      this.sim.replace({ id: unit, gear }, (u) => u.id === unit);
      this.benchSetup = { ...this.benchSetup, [unit]: next };
    }
    // The new gear has no history for the rate guard, so light changes on the simulated bench wait
    // for the hard step window to pass (SPEC S3.3). The simulated connection keeps its governor and
    // scheduler, so no second frame can share the simulated bus with one already on it.
    this.benchHoldUntil = now + HARD_WINDOW_MS + TIME_MARGIN_MS;
    this.simConn.governor.holdLightChanges(this.benchHoldUntil, reason);
    this.lastLiveDapc.clear();
    this.simConn.facts.clear();
    this.simConn.profiles.clear();
    if (this.target === 'simulator') this.feedback.clear();
    this.emit();
    void this.inventory(this.simConn);
    return OK;
  }

  /**
   * While the simulated bench is being rebuilt, refuse light changes. In the 2 s after, refuse them
   * with a retry time. The governor holds them too, for jobs as well as requests.
   */
  private benchHeld(conn: Conn): RequestResult | undefined {
    if (conn !== this.simConn || this.clock.now() >= this.benchHoldUntil) return undefined;
    return this.benchHoldUntil === Infinity
      ? { ok: false, reason: 'The simulated bench is being rebuilt.' }
      : {
          ok: false,
          reason: 'The simulated bench was just rebuilt. Light changes wait 2 s.',
          retryAt: this.benchHoldUntil,
        };
  }

  // -----------------------------------------------------------------------------------------------
  // Commissioning and the hardware check

  /** SPEC D3: behind the `reset` unlock and a typed confirmation, from a person only. */
  async commission(source: Source, typed: string): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person can commission drivers.');
    const conn = this.active();
    if (conn === undefined) return no('Hardware: disconnected.');
    if (!conn.governor.isUnlocked('reset')) return no('Commissioning needs the reset unlock.');
    if (typed !== 'commission') return no('Type "commission" to confirm.');
    const r = await this.runJob(conn, 'commission', 'Commissioning', async (job, submit) => {
      const result = await commission({
        submit,
        source,
        used: new Set(conn.found),
        wait: (ms) => this.wait(ms),
        stopped: () => job.aborted,
      });
      this.lastCommission = result;
      // New addresses: scan, write the profile and read everything again (SPEC S1.1).
      await this.inventoryIn(conn, job, submit);
      return result;
    });
    return r.ok ? OK : no(r.reason);
  }

  /**
   * Run or record one step of the hardware check. Manual steps record the note. Confirm steps need
   * `confirmed` and, where named, the unlock.
   */
  async runCheck(
    id: string,
    source: Source,
    opts: { readonly confirmed?: boolean; readonly note?: string; readonly skip?: boolean } = {},
  ): Promise<Outcome> {
    if (!isPerson(source)) return no('Only a person runs the hardware check.');
    const step = checkStep(id);
    if (step === undefined) return no('There is no such step.');
    const conn = this.active();
    if (conn === undefined) return no('Hardware: disconnected.');
    const note = opts.note?.slice(0, 2000);
    const record = (r: Omit<CheckResult, 'id' | 'at'>) => {
      this.checkResults.push({ id, at: this.clock.now(), ...r });
      this.emit();
    };
    if (opts.skip === true) {
      record({ status: 'skipped', ...(note === undefined ? {} : { note }) });
      return OK;
    }
    if (step.kind === 'manual' || step.run === undefined) {
      record({ status: 'recorded', ...(note === undefined ? {} : { note }) });
      return OK;
    }
    if (step.kind === 'confirm' && opts.confirmed !== true)
      return no('This step needs a confirmation.');
    if (step.unlock !== undefined && !conn.governor.isUnlocked(step.unlock))
      return no(`This step needs the ${step.unlock} unlock.`);
    const run = step.run;
    const r = await this.runJob(conn, 'check', step.title, async (_job, submit) => {
      const ctx: CheckContext = {
        submit,
        governor: conn.governor,
        addresses: conn.found,
        source,
        wait: (ms) => this.wait(ms),
        now: () => this.clock.now(),
        applyProfile: async (n) => {
          const p = await applySafetyProfile(n, conn.governor, submit);
          conn.profiles.set(n, p);
          return p;
        },
        panic: () => this.panic(),
        whenStarted: (match) => {
          let l: ((f: TxFrame, c: Conn | undefined) => void) | undefined;
          const started = new Promise<void>((resolve) => {
            const listener = (f: TxFrame, c: Conn | undefined) => {
              if (c !== conn || !match(f)) return;
              this.startListeners.delete(listener);
              resolve();
            };
            l = listener;
            this.startListeners.add(listener);
          });
          return {
            started,
            cancel: () => {
              if (l !== undefined) this.startListeners.delete(l);
            },
          };
        },
      };
      return run(ctx);
    });
    if (r.ok) record({ status: 'done', values: r.value, ...(note === undefined ? {} : { note }) });
    else record({ status: 'failed', error: r.reason, ...(note === undefined ? {} : { note }) });
    return r.ok ? OK : no(r.reason);
  }

  /** The hardware check's results as JSON for Stage 12. */
  checkReportText(): string {
    const info = this.hardware?.info();
    return checkReport(this.checkResults, {
      target: this.target,
      ...(info === undefined
        ? {}
        : { firmware: `${String(info.fwMajor)}.${String(info.fwMinor)}` }),
      steps: CHECK_STEPS.length,
    });
  }

  clearCheck(): void {
    this.checkResults = [];
    this.emit();
  }

  // -----------------------------------------------------------------------------------------------
  // The console and scripts (SPEC sections 6 and 7, ADR 0014)

  private say(l: ConsoleLine): void {
    this.consoleOut.push({ ...l, seq: ++this.consoleSeq });
    if (this.consoleOut.length > CONSOLE_LINES) this.consoleOut.shift();
    this.emitSoon();
  }

  private consoleBusy(): Job | undefined {
    return [...this.jobs].find((j) => CONSOLE_JOBS.includes(j.kind));
  }

  /** The engine as the console's executor sees it, for one job. */
  private consoleHost(job: Job): ConsoleHost {
    const stopped = () => job.aborted;
    return {
      request: async (intent, source) => {
        if (job.aborted) return { ok: false, kind: 'dropped', reason: job.why ?? 'Stopped.' };
        return this.request(intent, source);
      },
      devices: () => this.deviceViews(),
      ceilingArc: () => this.ceiling,
      target: () => this.target,
      connectionText: () =>
        this.target === 'simulator'
          ? 'The simulated bench is in use.'
          : `Hardware: ${this.connection}${this.connectionReason === undefined ? '' : `, ${this.connectionReason}`}.`,
      setCeiling: (arc, source, confirmed) => this.setCeiling(arc, source, confirmed),
      setTarget: (t, source) => this.setTarget(t, source),
      rescan: (source) => this.rescan(source),
      reapplyProfile: (source) => this.reapplyProfile(source),
      unlock: (u, source, confirmed) => this.unlock(u, source, confirmed),
      lock: (u) => {
        this.lock(u);
      },
      resume: (source) => this.resume(source),
      panic: () => this.panic(),
      now: () => this.clock.now(),
      sleep: (ms) => this.sleepIn(job, ms),
      stopped,
    };
  }

  /** A wait that ends early when its job is stopped. */
  private sleepIn(job: Job, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (job.aborted) {
        resolve();
        return;
      }
      const done = () => {
        cancel();
        job.wakers?.delete(done);
        resolve();
      };
      const cancel = this.clock.at(this.clock.now() + ms, done);
      job.wakers?.add(done);
    });
  }

  /**
   * Run one typed console line with the source `console`. The worker parses the text again with the
   * page's aliases, and never trusts a parse the page did. Output goes to the console stream.
   */
  async console(line: string, ctx: ParseContext, confirmed = false): Promise<Outcome> {
    const busy = this.consoleBusy();
    if (busy !== undefined) {
      const why =
        busy.kind === 'script'
          ? 'A script is running. Ctrl-C stops it.'
          : 'A line is still running. Ctrl-C stops it.';
      this.say({ kind: 'refused', text: `refused: ${why}` });
      return no(why);
    }
    const p = parseLine(line, ctx);
    if (!p.ok) {
      this.say({ kind: 'error', text: p.error });
      this.emit();
      return no(p.error);
    }
    if (p.command === undefined) return OK;
    const command = p.command;
    const conn = this.active() ?? this.simConn;
    const r = await this.runJob(conn, 'console', line.slice(0, 60), async (job) => {
      const exec = new ConsoleExec(this.consoleHost(job), {
        source: 'console',
        confirmed,
        out: (l) => {
          this.say(l);
        },
      });
      const done = await exec.run(command);
      if (job.aborted && command.cmd !== 'panic')
        this.say({ kind: 'note', text: `Stopped: ${job.why ?? 'interrupted'}` });
      return done;
    });
    this.emit();
    return r.ok && r.value ? OK : no(r.ok ? 'The line did not finish.' : r.reason);
  }

  /**
   * Run a script as a job with the source `script` (SPEC section 7). The text is parsed whole first,
   * and nothing runs if any line has an error. Panic, Ctrl-C, a target change and the heartbeat
   * watchdog stop it between steps and during a wait or a pause (S4.6).
   */
  async runScript(name: string, text: string, ctx: ParseContext): Promise<Outcome> {
    if (this.consoleBusy() !== undefined) {
      const why = 'A script or a line is running. Ctrl-C stops it.';
      this.say({ kind: 'refused', text: `refused: ${why}` });
      return no(why);
    }
    const parsed = parseScript(text, ctx);
    if (!parsed.ok) {
      for (const e of parsed.errors)
        this.say({
          kind: 'error',
          text: e.line === 0 ? e.text : `line ${String(e.line)}: ${e.text}`,
        });
      this.emit();
      return no(`The script ${name} has errors, so nothing ran.`);
    }
    const conn = this.active();
    if (conn === undefined) {
      this.say({ kind: 'refused', text: 'refused: Hardware: disconnected.' });
      return no('Hardware: disconnected.');
    }
    const steps = parsed.steps;
    this.say({ kind: 'note', text: `Running ${name}: ${String(steps.length)} steps.` });
    const r = await this.runJob(conn, 'script', `Script ${name}`, async (job) => {
      const exec = new ConsoleExec(this.consoleHost(job), {
        source: 'script',
        out: (l) => {
          this.say(l);
        },
      });
      const stopped = () => job.aborted;
      for (const [i, s] of steps.entries()) {
        if (stopped()) break;
        this.scriptView = { name, line: s.line, step: i + 1, steps: steps.length };
        this.say({ kind: 'step', text: `${String(s.line)}: ${s.text}` });
        if (s.command.cmd === 'pause') {
          const text = s.command.text ?? 'Paused.';
          this.scriptView = { ...this.scriptView, paused: text };
          this.say({ kind: 'pause', text: `${text} Press Enter to go on, Ctrl-C to stop.` });
          this.emit();
          await this.pauseIn(job);
          continue;
        }
        this.emit();
        if (!(await exec.run(s.command))) {
          if (!stopped()) {
            this.say({ kind: 'refused', text: `${name} stopped at line ${String(s.line)}.` });
            return false;
          }
          break;
        }
      }
      if (stopped()) {
        this.say({ kind: 'note', text: `${name} stopped: ${job.why ?? 'interrupted'}` });
        return false;
      }
      this.say({ kind: 'note', text: `${name} finished.` });
      return true;
    });
    this.scriptView = undefined;
    this.continueScript = undefined;
    this.emit();
    return r.ok && r.value ? OK : no(r.ok ? `${name} did not finish.` : r.reason);
  }

  private pauseIn(job: Job): Promise<void> {
    return new Promise((resolve) => {
      if (job.aborted) {
        resolve();
        return;
      }
      const done = () => {
        this.continueScript = undefined;
        job.wakers?.delete(done);
        resolve();
      };
      this.continueScript = done;
      job.wakers?.add(done);
    });
  }

  /** Enter at a script's pause. */
  scriptContinue(): Outcome {
    const go = this.continueScript;
    if (go === undefined) return no('No script is waiting.');
    if (this.scriptView !== undefined) {
      const v = this.scriptView;
      this.scriptView = { name: v.name, line: v.line, step: v.step, steps: v.steps };
    }
    go();
    return OK;
  }

  /** Ctrl-C: stop the running console line or script, and nothing else. */
  stopConsole(): void {
    for (const j of this.jobs) if (CONSOLE_JOBS.includes(j.kind)) this.abort(j, 'Ctrl-C.');
    this.emit();
  }

  // -----------------------------------------------------------------------------------------------
  // What the page sees

  private onFrame(conn: Conn, r: BusRecord): void {
    // SPEC R1.9: a transport fault stops running work, not only the job that saw it.
    if (r.result.kind === 'fault' && conn === this.active())
      this.stopRunners(`A frame faulted: ${r.result.reason}`);
    const cmd = decode(r.frame.frame, conn.prev);
    conn.prev = r.frame.frame;
    const a = cmd?.address;
    this.monitor.push({
      seq: ++this.monitorSeq,
      at: r.wireStart,
      ms: Math.max(0, r.end - r.wireStart),
      address:
        a === undefined
          ? ''
          : a.kind === 'short'
            ? `A${String(a.n)}`
            : a.kind === 'group'
              ? `G${String(a.n)}`
              : a.kind === 'broadcast'
                ? 'all'
                : 'unaddressed',
      target: conn.kind,
      source: r.source,
      frame: frameText(r.frame.frame),
      text: cmd === undefined ? 'unknown frame' : commandText(cmd),
      result: resultText(r.result),
    });
    if (this.monitor.length > MONITOR_LINES) this.monitor.shift();
    this.emitSoon();
  }

  private notice(text: string): void {
    this.notices.push(text);
    if (this.notices.length > NOTICES) this.notices.shift();
    this.emitSoon();
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.emitPending?.();
    this.emitPending = undefined;
    if (this.listeners.size === 0) return;
    const s = this.snapshot();
    for (const l of this.listeners) l(s);
    // The bench preview follows a fade at the snapshot rate, and stops when everything settles.
    if (s.light.some((l) => l.fading)) this.emitSoon();
  }

  /** At most ten snapshots a second for frame-by-frame changes. */
  private emitSoon(): void {
    if (this.emitPending !== undefined || this.disposed) return;
    this.emitPending = this.clock.at(this.clock.now() + 100, () => {
      this.emitPending = undefined;
      this.emit();
    });
  }

  snapshot(): Snapshot {
    const conn = this.active();
    const g = conn?.governor;
    const info = this.hardware?.info();
    const devices = this.deviceViews();
    return {
      target: this.target,
      hardwareAvailable: this.hardware !== undefined,
      connection: this.connection,
      ...(this.connectionReason === undefined ? {} : { connectionReason: this.connectionReason }),
      ...(info === undefined
        ? {}
        : { firmware: `${String(info.fwMajor)}.${String(info.fwMinor)}` }),
      askCanSee: this.askCanSee,
      ...(this.canSee === undefined ? {} : { operatorCanSee: this.canSee }),
      latched: this.latched,
      ceilingArc: this.ceiling,
      unlocks:
        g === undefined
          ? []
          : (['rate', 'reset', 'expert'] as const).filter((u) => g.isUnlocked(u)),
      swingLimit: g?.swingLimit ?? 1,
      inventoryStale: g?.inventoryStale ?? true,
      scanned: conn?.scanned ?? false,
      devices,
      divergences: [...this.divergences],
      jobs: [...this.jobs].map((j) => ({ kind: j.kind, label: j.label })),
      check: [...this.checkResults],
      ...(this.lastCommission === undefined ? {} : { commission: this.lastCommission }),
      monitor: this.monitor.slice(-50),
      console: this.consoleOut.slice(-CONSOLE_SNAPSHOT),
      ...(this.scriptView === undefined ? {} : { script: this.scriptView }),
      notices: [...this.notices],
      busUse: conn?.scheduler.utilisation() ?? 0,
      light: conn === undefined ? [] : this.lightOf(conn),
      feedback: [...this.feedback.values()],
      bench: (['A', 'B'] as const).map((unit) => ({ unit, setup: this.benchSetup[unit] })),
    };
  }

  private deviceViews(): DeviceView[] {
    const conn = this.active();
    const g = conn?.governor;
    const devices: DeviceView[] = [];
    if (conn === undefined || g === undefined) return devices;
    const addresses = [...new Set([...conn.found, ...conn.profiles.keys()])].sort((x, y) => x - y);
    for (const n of addresses) {
      const i = g.addressInfo(n);
      const profile = conn.profiles.get(n);
      const facts = conn.facts.get(n);
      const verified = i?.verified === true;
      const mismatch = profile !== undefined && !profile.verified;
      devices.push({
        address: n,
        verified,
        ceiling: verified ? 'verified' : mismatch ? 'mismatch' : 'pending',
        modelled: i?.modelled === true,
        ...(profile === undefined ? {} : { profile }),
        ...(facts === undefined ? {} : { facts }),
      });
    }
    return devices;
  }

  private lightOf(conn: Conn): LightView[] {
    const now = this.clock.now();
    const out: LightView[] = [];
    for (const u of conn.governor.shadow.all) {
      const n = u.gear.shortAddress;
      if (n === null) continue;
      const st = u.gear.snapshot();
      const colour = u.gear.colourAt(now);
      const drive = u.gear.outputAt(now);
      out.push({
        address: n,
        unit: u.id,
        level: u.gear.levelAt(now),
        target: u.gear.finalLevel(),
        mirek: colour.tc,
        channels: [...colour.ch],
        fadeTime: st.fadeTime,
        extendedFade: st.extendedFade,
        fastFade: st.fastFade,
        fast27Ms: u.gear.profile.settings.fastFade27Ms,
        fading: u.gear.settlesAt() > now,
        terminals: [...drive.terminals],
        labels: [...drive.labels],
      });
    }
    return out.sort((x, y) => x.address - y.address);
  }
}
