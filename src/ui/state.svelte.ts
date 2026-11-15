/**
 * The page's state: the newest snapshot, the stored preferences, and the bus monitor's history. One
 * instance, made by App.svelte once the preferences are loaded, so the bus worker starts with the
 * stored ceiling and bench set-up (ADR 0009).
 */
import { DEFAULT_CEILING_ARC } from '../safety/governor.ts';
import type { MonitorLine, Snapshot } from '../engine/engine.ts';
import type { CallResult } from '../engine/protocol.ts';
import { DEFAULT_PREFERENCES, type Preferences } from '../store/schema.ts';
import type { Store } from '../store/store.ts';
import type { BusClient } from './bus.ts';

/** Lines the bus monitor keeps in the page. The worker sends its newest 50 with each snapshot. */
export const MONITOR_KEEP = 2000;

export class AppState {
  readonly client: BusClient;
  readonly store: Store;
  snap = $state<Snapshot | undefined>(undefined);
  dead = $state<string | undefined>(undefined);
  prefs = $state<Preferences>(DEFAULT_PREFERENCES);
  /** A stored record that could not be used, for the banner. */
  storeProblem = $state<string | undefined>(undefined);
  /** A stored ceiling above the default, offered back with a confirmation rather than applied. */
  savedCeiling = $state<number | undefined>(undefined);
  /** The device the playground and inspector show. */
  selected = $state(0);
  monitor = $state<MonitorLine[]>([]);
  monitorPaused = $state(false);
  /** The ceiling dialog, and a raise waiting for its typed confirmation. */
  ceilingOpen = $state(false);
  raiseTo = $state<number | undefined>(undefined);
  /** The last answer to a ceiling change, shown in its dialog. */
  ceilingMessage = $state('');
  /** The ceiling the worker started with, so it is not saved over a pending restore offer. */
  private readonly startCeiling: number;
  private lastSeq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    client: BusClient,
    store: Store,
    prefs: Preferences,
    startCeiling: number,
    problem?: string,
  ) {
    this.client = client;
    this.store = store;
    this.prefs = prefs;
    this.startCeiling = startCeiling;
    this.storeProblem = problem;
    if (prefs.ceilingArc > startCeiling) this.savedCeiling = prefs.ceilingArc;
    client.onSnapshot((s) => {
      this.onSnapshot(s);
    });
    client.onDead((why) => {
      this.dead = why;
    });
  }

  private onSnapshot(s: Snapshot): void {
    this.snap = s;
    if (!this.monitorPaused) {
      const fresh = s.monitor.filter((l) => l.seq > this.lastSeq);
      if (fresh.length > 0) {
        this.lastSeq = fresh.at(-1)?.seq ?? this.lastSeq;
        const next = [...this.monitor, ...fresh];
        this.monitor = next.length > MONITOR_KEEP ? next.slice(-MONITOR_KEEP) : next;
      }
    } else {
      this.lastSeq = s.monitor.at(-1)?.seq ?? this.lastSeq;
    }
    // The ceiling is stored as the engine reports it, unless a higher saved one is still on offer
    // and nothing has changed since the start.
    const pending = this.savedCeiling !== undefined && s.ceilingArc === this.startCeiling;
    if (!pending && s.ceilingArc !== this.prefs.ceilingArc) {
      this.savedCeiling = undefined;
      this.update({ ceilingArc: s.ceilingArc });
    }
  }

  /** Change preferences and save them shortly after. */
  update(change: Partial<Preferences>): void {
    this.prefs = { ...this.prefs, ...change };
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.store.savePreferences($state.snapshot(this.prefs)).catch(() => {
        this.storeProblem = 'Preferences could not be saved.';
      });
    }, 250);
  }

  /**
   * Every call the page makes. Values from the page's state are Svelte proxies, which postMessage
   * cannot clone, so each call is posted as a plain snapshot.
   */
  call(call: Parameters<BusClient['call']>[0]): Promise<CallResult> {
    return this.client.call($state.snapshot(call));
  }

  /** Lower at once (SPEC R6.2), or ask for a typed confirmation to raise (R6.3). */
  async setCeiling(arc: number, confirmed: boolean): Promise<boolean> {
    const current = this.snap?.ceilingArc ?? this.prefs.ceilingArc;
    if (arc > current && !confirmed) {
      this.raiseTo = arc;
      return false;
    }
    const r = await this.call({ op: 'setCeiling', arc, confirmed });
    this.ceilingMessage = r.ok ? '' : 'reason' in r ? r.reason : 'Refused.';
    if (r.ok && arc > current) this.savedCeiling = undefined;
    return r.ok;
  }

  clearMonitor(): void {
    this.monitor = [];
  }

  /** The device's name: its alias, or its address. */
  name(address: number): string {
    const a = this.prefs.aliases.find((x) => x.address === address)?.alias;
    return a === undefined || a === '' ? `A${String(address)}` : `A${String(address)} ${a}`;
  }
}

/** The ceiling a session starts at: the stored one, unless it is above the default (ADR 0013). */
export function startCeiling(stored: number): number {
  return Math.min(stored, DEFAULT_CEILING_ARC);
}
