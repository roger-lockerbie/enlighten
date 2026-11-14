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
import type { TxFrame } from '../dali/sequences.ts';
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
import { readFacts, type DriverFacts } from './inventory.ts';
import { Router } from './router.ts';
import { StepError, toSubmitted, txOf } from './submit.ts';
import type { HardwareTransport, Transport } from './transport.ts';

export type OutputTarget = 'simulator' | 'hardware' | 'both';

/** The hardware connection as the top bar shows it. */
export type Connection = 'none' | 'connecting' | 'ready' | 'no-hasseb' | 'disconnected';

export type Intent =
  | { readonly kind: 'commands'; readonly commands: readonly Command[]; readonly label?: string }
  | { readonly kind: 'raw'; readonly a: number; readonly b: number }
  | { readonly kind: 'level'; readonly address: number; readonly arc: number };

export type Answer = number | 'none' | 'collision';

export type RequestResult =
  | {
      readonly ok: true;
      readonly answers: readonly Answer[];
      readonly note?: string;
      readonly queued?: boolean;
    }
  | { readonly ok: false; readonly reason: string; readonly retryAt?: number };

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
  readonly at: number;
  readonly target: 'simulator' | 'hardware';
  readonly source: Source;
  readonly frame: string;
  readonly text: string;
  readonly result: string;
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
  readonly notices: readonly string[];
  readonly busUse: number;
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
}

interface LevelValue {
  readonly address: number;
  readonly arc: number;
  readonly source: Source;
}

/** A visible page sends a heartbeat every second. Three seconds without one stops runners (SPEC S4.6). */
export const HEARTBEAT_LIMIT_MS = 3000;
/** The background check in Both: at most one query a second, when the bus is idle (SPEC R1.5). */
export const BACKGROUND_MS = 1000;
/** A divergence asks for a rescan of the address, at most this often. */
export const RESCAN_MIN_MS = 10_000;

const MONITOR_LINES = 300;
const DIVERGENCES = 200;
const NOTICES = 20;

const OK: Outcome = { ok: true };
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
        reason: r.reason,
        ...(r.retryAt === undefined ? {} : { retryAt: r.retryAt }),
      };
    case 'dropped':
    case 'fault':
      return { ok: false, reason: r.reason };
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
  private readonly jobs = new Set<Job>();
  private readonly coalescer: Coalescer<LevelValue>;
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
  private emitPending: Cancel | undefined;
  private disposed = false;

  constructor(o: EngineOptions) {
    this.clock = o.clock;
    this.sim = o.sim;
    this.simTransport = o.simTransport;
    this.hardware = o.hardware;
    this.timing = withFloors(o.timing ?? {});
    this.ceiling = o.ceilingArc ?? DEFAULT_CEILING_ARC;
    this.lastBeat = this.clock.now();
    this.simConn = this.makeConn('simulator');
    this.coalescer = new Coalescer(this.clock, (_key, v) => this.sendLevel(v));
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
    this.emit();
    if (t === 'simulator') return OK;
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
    this.hwConn = undefined;
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
    this.hwConn = undefined;
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
      this.hwConn = undefined;
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
    await Promise.all(all.map((c) => c.scheduler.panic()));
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
    for (const j of this.jobs) j.aborted = true;
    this.coalescer.cancel();
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
  private submitter(conn: Conn, job: Job | undefined): Submit {
    const raw: Submit = async (tx, priority) => {
      if (job?.aborted === true) return { kind: 'dropped', reason: 'Stopped.' };
      if (conn.kind === 'hardware' && this.hwConn !== conn)
        return { kind: 'dropped', reason: 'The hardware connection changed.' };
      return toSubmitted(await conn.scheduler.submit(tx, priority));
    };
    return patient(
      raw,
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
    const job: Job = { kind, label, conn, aborted: false };
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
    for (const j of this.jobs) if (j.conn === conn && j.kind !== 'check') return true;
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
    const last = this.lastRescan.get(d.address) ?? -Infinity;
    if (this.clock.now() - last >= RESCAN_MIN_MS && conn === this.hwConn)
      this.pendingRescan.add(d.address);
    this.emit();
  }

  private background(): void {
    const hw = this.hwConn;
    if (this.target !== 'both' || hw === undefined || this.latched || this.backgroundBusy) return;
    if (hw.scheduler.queued > 0 || this.jobs.size > 0 || this.coalescer.waiting() > 0) return;
    const [n] = this.pendingRescan;
    if (n !== undefined) {
      this.pendingRescan.delete(n);
      this.lastRescan.set(n, this.clock.now());
      // The hardware's values correct the shadow by the safe path: a scan rebuilds its model (ADR 0012).
      void this.runJob(hw, 'rescan', `Rescan A${String(n)}`, async (_job, submit) => {
        await scanAddress(n, hw.governor, submit);
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
    const results = await Promise.all(
      this.conns().map(async (c) => {
        const r = await this.runJob(c, 'ceiling', 'Ceiling', async (_job, submit) =>
          lowering
            ? lowerCeiling(
                c.governor,
                arc,
                submit,
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
    const first = results[0];
    if (first?.ok === true) this.ceiling = arc;
    this.emit();
    return first ?? no('No connection.');
  }

  unlock(u: Unlock, source: Source, confirmed: boolean): Outcome {
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
    switch (intent.kind) {
      case 'level':
        if (!Number.isInteger(intent.address) || intent.address < 0 || intent.address > 63)
          return { ok: false, reason: 'An address is 0 to 63.' };
        if (!Number.isInteger(intent.arc) || intent.arc < 0 || intent.arc > 254)
          return { ok: false, reason: 'A level is an arc level from 0 to 254.' };
        this.coalescer.set(`level:${String(intent.address)}`, {
          address: intent.address,
          arc: intent.arc,
          source,
        });
        return { ok: true, answers: [], queued: true };
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

  private async sendLevel(v: LevelValue): Promise<CoalescedResult> {
    const conn = this.active();
    if (conn === undefined) return { ok: false };
    const tx = txOf([{ id: 'DAPC', address: short(v.address), value: v.arc }], v.source, 'level');
    const r = await conn.scheduler.submit(tx);
    if (r.kind === 'done') return { ok: true };
    return r.kind === 'refused' && r.retryAt !== undefined
      ? { ok: false, retryAt: r.retryAt }
      : { ok: false };
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
  // What the page sees

  private onFrame(conn: Conn, r: BusRecord): void {
    const cmd = decode(r.frame.frame, conn.prev);
    conn.prev = r.frame.frame;
    this.monitor.push({
      at: r.wireStart,
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
    const devices: DeviceView[] = [];
    if (conn !== undefined && g !== undefined) {
      const addresses = [...new Set([...conn.found, ...conn.profiles.keys()])].sort(
        (x, y) => x - y,
      );
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
    }
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
      notices: [...this.notices],
      busUse: conn?.scheduler.utilisation() ?? 0,
    };
  }
}
