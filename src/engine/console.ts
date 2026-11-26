/**
 * The console's executor (ADR 0006, SPEC section 6). It runs one parsed console command against the
 * engine with a source, `console` for a typed line and `script` for a script step, and prints what
 * happened. Every frame goes through `Engine.request`, so through the scheduler and the governor, like
 * any other source (SPEC S2.2). Nothing here sends a frame itself.
 *
 * `explain` runs the same code with a host that cannot send (ADR 0023): where a real run would
 * submit an intent, it asks the engine what the intent would be as commands and prints them.
 */
import type { Address } from '../dali/address.ts';
import { commandText, decode, decodeSpec, frameText, type Command } from '../dali/codec.ts';
import { spec } from '../dali/commands.ts';
import { percentText } from '../dali/curve.ts';
import { extendedFades, fadeInUse, standardFades } from '../dali/fade.ts';
import { decodeFadeTimeRate } from '../dali/reply.ts';
import {
  fadeCommands,
  mirekToKelvin,
  framesFor,
  queryColourValueCommands,
  rgbwafCommands,
  tcCommands,
} from '../dali/sequences.ts';
import { help } from '../console/help.ts';
import type {
  ConsoleCommand,
  QueryWhat,
  Target,
  TargetName,
  UnlockName,
} from '../console/parse.ts';
import { COLLISION, NO_REPLY, replyText, type Answer } from '../console/replies.ts';
import { lineOf } from '../console/unparse.ts';
import { msText } from '../console/values.ts';
import type { Outcome } from '../safety/governor.ts';
import type { Source } from '../safety/types.ts';
import type { DeviceView, FadeSetting, Intent, OutputTarget, RequestResult } from './engine.ts';

/** How a line of console output reads: `out` is plain, the rest are prefixed so colour is never needed. */
export type ConsoleLineKind =
  'out' | 'reply' | 'note' | 'refused' | 'fault' | 'error' | 'step' | 'pause' | 'echo';

export interface ConsoleLine {
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

/** An intent as the commands it would be sent as, with anything worth saying about how they go. */
export interface Compiled {
  readonly commands: readonly Command[];
  readonly notes: readonly string[];
}

/** The engine as the executor sees it. */
export interface ConsoleHost {
  request(intent: Intent, source: Source): Promise<RequestResult>;
  /**
   * What an intent would be sent as, or why it cannot be built. It sends nothing, asks the governor
   * nothing and changes nothing: `explain` rests on that.
   */
  compile(intent: Intent): Compiled | string;
  devices(): readonly DeviceView[];
  ceilingArc(): number;
  /** DTR0 to DTR2 as the governor knows them now, undefined where unknown. */
  dtr(): readonly (number | undefined)[];
  target(): OutputTarget;
  connectionText(): string;
  setCeiling(arc: number, source: Source, confirmed: boolean): Promise<Outcome>;
  setTarget(t: OutputTarget, source: Source): Promise<Outcome>;
  rescan(source: Source): Promise<Outcome>;
  reapplyProfile(source: Source): Promise<Outcome>;
  /** RESET one driver, then OFF and the safety profile (SPEC section 5). */
  reset(n: number, source: Source): Promise<Outcome>;
  unlock(u: UnlockName, source: Source, confirmed: boolean): Outcome;
  lock(u?: UnlockName): void;
  resume(source: Source): Outcome;
  panic(): Promise<void>;
  now(): number;
  /** Wait, ending early if the run is stopped. */
  sleep(ms: number): Promise<void>;
  stopped(): boolean;
}

export interface ExecOptions {
  readonly source: Source;
  /** A typed confirmation from a person, for an unlock or a raise of the ceiling. */
  readonly confirmed?: boolean;
  readonly out: (line: ConsoleLine) => void;
}

/** The longest a step waits for the rate guard before it gives up (ADR 0014). */
export const RATE_WAIT_LIMIT_MS = 10_000;

const TARGET_OF: Readonly<Record<TargetName, OutputTarget>> = {
  simulator: 'simulator',
  hardware: 'hardware',
  both: 'both',
};

/** An address as the console's own words name it: A0, G0, all, unaddressed. */
const addressText = (a: Address): string =>
  a.kind === 'short'
    ? `A${String(a.n)}`
    : a.kind === 'group'
      ? `G${String(a.n)}`
      : a.kind === 'broadcast'
        ? 'all'
        : 'unaddressed';

const levelText = (arc: number) =>
  arc === 0 ? '0 (off)' : `${String(arc)} (${percentText(arc)}%)`;

/**
 * The fade setting nearest a time, from the values the driver has. "No fade" (fade time 0) is one of
 * them. While the fade time is 0, a DT6 fast fade time above 0 wins over the extended fade (dali.md
 * section 7), so on such gear the extended values are left out and fade time 0 means the fast fade
 * (DALI review S6-D6).
 */
export function nearestFade(
  ms: number,
  extended: boolean,
  fastFade = 0,
): { setting: FadeSetting; ms: number; text: string } {
  const fast = fastFade > 0 ? fastFade * 25 : 0;
  const none = {
    setting: { kind: 'extended', value: 0 } as FadeSetting,
    ms: fast,
    text: fast > 0 ? 'fade time 0, so the fast fade' : 'no fade',
  };
  if (ms === 0) return none;
  let best = none;
  const consider = (setting: FadeSetting, optMs: number, text: string) => {
    if (Math.abs(optMs - ms) < Math.abs(best.ms - ms)) best = { setting, ms: optMs, text };
  };
  for (const f of standardFades())
    consider({ kind: 'standard', value: f.value }, f.ms, `fade time ${String(f.value)}`);
  if (extended && fast === 0)
    for (const f of extendedFades())
      consider(
        { kind: 'extended', value: f.value },
        f.ms,
        `extended fade 0x${f.value.toString(16).toUpperCase().padStart(2, '0')}`,
      );
  return best;
}

/**
 * The queries that read an address's fade settings back. On hardware the guard rests on them only as
 * read back, so they follow every write (ADR 0019 amendment 2). A group or broadcast cannot be read.
 */
export function fadeReadBack(a: Address): Command[] {
  if (a.kind !== 'short') return [];
  return [
    { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
    { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
  ];
}

const EXPLAIN_SENDS_NOTHING = 'explain sends nothing.';

/**
 * A host for `explain`: it reads what the real one reads and can do nothing else. Every method that
 * would send a frame or change the app's state refuses, so a mistake in the executor's explain path
 * cannot reach the bus (ADR 0023).
 */
export function dryHost(real: ConsoleHost): ConsoleHost {
  const refused: Outcome = { ok: false, reason: EXPLAIN_SENDS_NOTHING };
  return {
    request: () => Promise.resolve({ ok: false, reason: EXPLAIN_SENDS_NOTHING, kind: 'refused' }),
    compile: (intent) => real.compile(intent),
    devices: () => real.devices(),
    ceilingArc: () => real.ceilingArc(),
    dtr: () => real.dtr(),
    target: () => real.target(),
    connectionText: () => real.connectionText(),
    setCeiling: () => Promise.resolve(refused),
    setTarget: () => Promise.resolve(refused),
    rescan: () => Promise.resolve(refused),
    reapplyProfile: () => Promise.resolve(refused),
    reset: () => Promise.resolve(refused),
    unlock: () => refused,
    lock: () => undefined,
    resume: () => refused,
    panic: () => Promise.resolve(),
    now: () => real.now(),
    sleep: () => Promise.resolve(),
    stopped: () => real.stopped(),
  };
}

/** Lines `explain` prints for some commands: the line that sends each, its frames, and its name. */
export function explainLines(cmds: readonly Command[]): string[] {
  const rows = cmds.map((c) => {
    const frames = framesFor(c);
    const main = frames[frames.length - 1];
    const s = spec(c.id);
    const hex = frames.map((f) => frameText(f.frame)).join(', ') + (s.sendTwice ? ' x2' : '');
    const name =
      (s.deviceType === 0 ? '' : `ENABLE DEVICE TYPE ${String(s.deviceType)}, then `) +
      commandText(c) +
      (s.sendTwice ? ', sent twice' : '') +
      (main?.expectReply === true ? ', answers' : '');
    return { line: lineOf(c), hex, name };
  });
  const w1 = Math.min(44, Math.max(...rows.map((r) => r.line.length)));
  const w2 = Math.max(...rows.map((r) => r.hex.length));
  return rows.map((r) => `  ${r.line.padEnd(w1)}  ${r.hex.padEnd(w2)}  ${r.name}`);
}

/** Frames on the bus for some commands, a send-twice command counting twice. */
export function frameCount(cmds: readonly Command[]): number {
  return cmds.reduce((n, c) => n + framesFor(c).reduce((m, f) => m + (f.sendTwice ? 2 : 1), 0), 0);
}

export class ConsoleExec {
  private readonly host: ConsoleHost;
  private readonly o: ExecOptions;
  /** True for the executor `explain` runs: it prints what would be sent and sends nothing. */
  private readonly dry: boolean;
  /** In an explain: the commands and frames shown so far. */
  private shown = { commands: 0, frames: 0 };

  constructor(host: ConsoleHost, o: ExecOptions, dry = false) {
    this.host = host;
    this.o = o;
    this.dry = dry;
  }

  private out(kind: ConsoleLineKind, text: string): void {
    // An explain has no results to report: nothing was sent and nothing answered.
    if (this.dry && (kind === 'out' || kind === 'reply')) return;
    this.o.out({ kind, text });
  }

  /**
   * `explain <line>`: run the line with a host that cannot send, printing what each step would be
   * sent as. The governor is not asked, because asking it records an approval (ADR 0023).
   */
  private async explain(c: Extract<ConsoleCommand, { cmd: 'explain' }>): Promise<boolean> {
    const target = this.host.target();
    this.o.out({
      kind: 'out',
      text: `explain ${c.line}: with the target ${target}, this would send:`,
    });
    const dry = new ConsoleExec(dryHost(this.host), this.o, true);
    await dry.run(c.inner);
    const { commands, frames } = dry.shown;
    const plural = (n: number, w: string) => `${String(n)} ${w}${n === 1 ? '' : 's'}`;
    this.o.out({
      kind: 'out',
      text:
        commands === 0
          ? 'Nothing would be sent.'
          : `${plural(commands, 'command')}, ${plural(frames, 'frame')} on the bus. Nothing was sent.`,
    });
    if (commands > 0)
      this.o.out({
        kind: 'note',
        text: 'The governor judges a line when it is sent, and may clamp, hold or refuse it.',
      });
    return true;
  }

  /** In an explain: print an intent as its commands, in place of submitting it. */
  private show(intent: Intent): RequestResult {
    const c = this.host.compile(intent);
    if (typeof c === 'string') return { ok: false, reason: c, kind: 'refused' };
    for (const l of explainLines(c.commands)) this.o.out({ kind: 'out', text: l });
    for (const n of c.notes) this.o.out({ kind: 'note', text: n });
    // The one thing the governor would do that can be told from here: its clamp to the ceiling.
    const ceiling = this.host.ceilingArc();
    for (const d of c.commands)
      if (d.id === 'DAPC' && d.value !== undefined && d.value !== 255 && d.value > ceiling)
        this.o.out({
          kind: 'note',
          text: `The ceiling is ${String(ceiling)}, so the governor would send DAPC ${String(d.value)} as ${String(ceiling)}.`,
        });
    this.shown.commands += c.commands.length;
    this.shown.frames += frameCount(c.commands);
    return { ok: true, answers: [] };
  }

  /** Run one command. False when it was refused, faulted or stopped, which ends a script. */
  async run(c: ConsoleCommand): Promise<boolean> {
    switch (c.cmd) {
      case 'level':
        return this.each(c.to, (a, many) => this.level(a, c.arc, c.fadeMs, many));
      case 'off':
        return this.each(c.to, (a, many) =>
          this.sendAll([{ id: 'OFF', address: a }], `off ${addressText(a)}`, many),
        );
      case 'on':
        return this.each(c.to, (a, many) =>
          this.sendAll(
            [{ id: 'GO_TO_LAST_ACTIVE_LEVEL', address: a }],
            `on ${addressText(a)}`,
            many,
          ),
        );
      case 'tc':
        return this.each(c.to, (a, many) => this.colour(a, { mirek: c.mirek }, c.arc, many));
      case 'rgb':
        return this.each(c.to, (a, many) =>
          this.colour(a, { channels: c.channels }, undefined, many),
        );
      case 'fade':
        return this.each(c.to, (a, many) => this.fade(a, c.ms, c.rate, many));
      case 'scene':
        return this.each(c.to, (a, many) => this.scene(a, c, many));
      case 'group':
        return this.each(c.to, (a, many) =>
          this.sendAll(
            [{ id: c.op === 'add' ? 'ADD_TO_GROUP' : 'REMOVE_FROM_GROUP', address: a, value: c.n }],
            `${addressText(a)} ${c.op === 'add' ? 'joined' : 'left'} g${String(c.n)}`,
            many,
          ),
        );
      case 'query':
        return this.each(c.to, (a, many) => this.query(a, c.what, many));
      case 'dali':
        if (c.to === undefined) return this.dali(c.id, undefined, c.value, false);
        return this.each(c.to, (a, many) => this.dali(c.id, a, c.value, many));
      case 'raw':
        return this.raw(c.a, c.b, c.twice);
      case 'devices':
        this.devices();
        return true;
      case 'scan':
        return this.outcome(
          await this.host.rescan(this.o.source),
          'Scanned, and the safety profile written.',
        );
      case 'profile':
        if (c.apply === true)
          return this.outcome(
            await this.host.reapplyProfile(this.o.source),
            'The safety profile was written again.',
          );
        this.profile(c.to);
        return true;
      case 'cap':
        return this.cap(c.arc);
      case 'target':
        if (c.target === undefined) {
          this.out('out', `target ${this.host.target()}. ${this.host.connectionText()}`);
          return true;
        }
        return this.outcome(
          await this.host.setTarget(TARGET_OF[c.target], this.o.source),
          `target ${TARGET_OF[c.target]}`,
        );
      case 'panic':
        await this.host.panic();
        this.out(
          'note',
          'Panic: everything stopped and every light sent OFF. Type resume to go on.',
        );
        return false;
      case 'resume':
        return this.outcome(this.host.resume(this.o.source), 'Resumed. Nothing was sent.');
      case 'unlock':
        return this.outcome(
          this.host.unlock(c.name, this.o.source, this.o.confirmed === true),
          `Unlocked ${c.name} until the page reloads. "lock ${c.name}" drops it.`,
        );
      case 'lock':
        this.host.lock(c.name);
        this.out(
          'out',
          c.name === undefined ? 'Every unlock dropped.' : `Dropped the ${c.name} unlock.`,
        );
        return true;
      case 'echo':
        // Its own kind, shown with a prefix, so echoed text cannot pass for the app's own (S6-I2).
        this.out('echo', c.text);
        return true;
      case 'wait':
        await this.host.sleep(c.ms);
        return !this.host.stopped();
      case 'help':
        for (const l of help(c.find === undefined ? c.topic : { find: c.find }, 'other'))
          this.out('out', l);
        return true;
      case 'explain':
        return this.explain(c);
      case 'pause':
        this.out('error', 'pause works only in a script.');
        return false;
      case 'trace':
      case 'history':
      case 'clear':
      case 'use':
      case 'run':
      case 'scripts':
        this.out('error', `${c.cmd} is a console command and cannot run here.`);
        return false;
    }
  }

  /** Run once per address, in order, stopping at the first that fails or a stop. */
  private async each(
    to: Target,
    f: (a: Address, many: boolean) => Promise<boolean>,
  ): Promise<boolean> {
    const many = to.length > 1;
    for (const a of to) {
      if (this.host.stopped()) return false;
      if (!(await f(a, many))) return false;
    }
    return true;
  }

  private outcome(r: Outcome, done: string): boolean {
    if (r.ok) this.out('out', done);
    else this.out('refused', `refused: ${r.reason}`);
    return r.ok;
  }

  /**
   * Submit an intent. A refusal with a retry time waits for it, up to RATE_WAIT_LIMIT_MS, so a step
   * the rate guard holds goes when the guard allows it. Any other refusal is final.
   */
  private async submit(
    first: Intent,
    again?: () => Promise<Intent | undefined>,
  ): Promise<RequestResult> {
    if (this.dry) return this.show(first);
    const start = this.host.now();
    let said = false;
    let intent = first;
    for (;;) {
      const r = await this.host.request(intent, this.o.source);
      if (r.ok || r.retryAt === undefined || this.host.stopped()) return r;
      const wait = r.retryAt - this.host.now();
      if (this.host.now() + Math.max(0, wait) - start > RATE_WAIT_LIMIT_MS) return r;
      if (!said) {
        this.out('note', `waiting ${msText(Math.max(0, wait))} for the rate guard: ${r.reason}`);
        said = true;
      }
      await this.host.sleep(Math.max(1, wait));
      if (this.host.stopped()) return { ok: false, reason: 'Stopped.', kind: 'dropped' };
      // A step built from something read before the wait is built again from a fresh read.
      if (again !== undefined) {
        const next = await again();
        if (next === undefined)
          return { ok: false, reason: 'Nothing was sent after the wait.', kind: 'refused' };
        intent = next;
      }
    }
  }

  /** Print a failure as a refusal or a fault, never as "no reply" (SPEC section 6). */
  private failed(r: Extract<RequestResult, { ok: false }>, prefix: string): false {
    if (r.kind === 'fault') this.out('fault', `${prefix}fault: ${r.reason}`);
    else if (r.kind === 'dropped') this.out('refused', `${prefix}stopped: ${r.reason}`);
    else this.out('refused', `${prefix}refused: ${r.reason}`);
    return false;
  }

  /** On hardware, the read-back that follows a fade setting (ADR 0019 amendment 2). */
  private readBack(a: Address): Command[] {
    return this.host.target() === 'simulator' ? [] : fadeReadBack(a);
  }

  private prefix(a: Address | undefined, many: boolean): string {
    return many && a !== undefined ? `${addressText(a)}: ` : '';
  }

  private async sendAll(
    cmds: Command[],
    done: string,
    many: boolean,
    a?: Address,
  ): Promise<boolean> {
    const r = await this.submit({ kind: 'commands', commands: cmds, label: done });
    if (!r.ok) return this.failed(r, this.prefix(a ?? cmds[cmds.length - 1]?.address, many));
    this.out('out', r.note === undefined ? done : `${done}, clamped: ${r.note}`);
    return true;
  }

  /** The answers to a list of queries, or a printed failure. */
  private async ask(
    cmds: Command[],
    label: string,
    a: Address,
    many: boolean,
  ): Promise<readonly Answer[] | undefined> {
    const r = await this.submit({ kind: 'commands', commands: cmds, label });
    if (!r.ok) {
      this.failed(r, this.prefix(a, many));
      return undefined;
    }
    return r.answers;
  }

  private facts(a: Address) {
    return a.kind === 'short'
      ? this.host.devices().find((d) => d.address === a.n)?.facts
      : undefined;
  }

  private async level(
    a: Address,
    arc: number,
    fadeMs: number | undefined,
    many: boolean,
  ): Promise<boolean> {
    let fade: ReturnType<typeof nearestFade> | undefined;
    if (fadeMs !== undefined) {
      const f = this.facts(a);
      fade = nearestFade(fadeMs, f?.extendedFade !== undefined, f?.fastFade ?? 0);
      if (fade.ms !== fadeMs)
        this.out('note', `${this.prefix(a, many)}nearest fade is ${fade.text}, ${msText(fade.ms)}`);
    }
    const done = `${addressText(a)} level ${levelText(arc)}${fade === undefined ? '' : ` over ${msText(fade.ms)}`}`;
    if (a.kind === 'short') {
      const r = await this.submit({
        kind: 'apply',
        address: a.n,
        arc,
        ...(fade === undefined ? {} : { fade: fade.setting }),
      });
      if (!r.ok) return this.failed(r, this.prefix(a, many));
      this.out('out', r.note === undefined ? done : `${done}, clamped: ${r.note}`);
      return true;
    }
    const cmds = [
      // A group or broadcast, whose fade settings cannot be read back.
      ...(fade === undefined ? [] : fadeCommands(a, fade.setting)),
      { id: 'DAPC', address: a, value: arc },
    ];
    return this.sendAll(cmds, done, many, a);
  }

  /**
   * Members of a group or broadcast, from the groups the governor tracks now. Gear whose groups are
   * not known counts as a possible member, as the governor counts it (S6-D2).
   */
  private members(a: Address): DeviceView[] {
    const all = this.host.devices();
    if (a.kind === 'broadcast') return [...all];
    if (a.kind === 'group')
      return all.filter((d) => d.groups === undefined || (d.groups & (1 << a.n)) !== 0);
    return [];
  }

  private async colour(
    a: Address,
    c: { mirek: number } | { channels: readonly [number, number, number, number, number, number] },
    arc: number | undefined,
    many: boolean,
  ): Promise<boolean> {
    const what =
      'mirek' in c
        ? `${String(Math.round(mirekToKelvin(c.mirek)))}K (${String(c.mirek)} mirek)`
        : `channels ${c.channels.slice(0, 5).join(' ')}`;
    const done = `${addressText(a)} ${what}${arc === undefined ? '' : `, level ${levelText(arc)}`}`;
    if (a.kind === 'short') {
      const r = await this.submit({
        kind: 'apply',
        address: a.n,
        ...c,
        ...(arc === undefined ? {} : { arc }),
      });
      if (!r.ok) return this.failed(r, this.prefix(a, many));
      this.out('out', r.note === undefined ? done : `${done}, clamped: ${r.note}`);
      return true;
    }
    // SPEC D2: a group takes a colour only when every member the app knows reports that control.
    const drive = 'mirek' in c ? 'tc' : 'rgbwaf';
    const members = this.members(a);
    if (a.kind === 'unaddressed' || members.length === 0) {
      this.out(
        'refused',
        `${this.prefix(a, many)}refused: no known gear at ${addressText(a)} reports that colour control.`,
      );
      return false;
    }
    const odd = members.filter((m) => m.facts?.drive !== drive).map((m) => `A${String(m.address)}`);
    if (odd.length > 0) {
      this.out(
        'refused',
        `${this.prefix(a, many)}refused: ${odd.join(', ')} ${odd.length === 1 ? 'does' : 'do'} not report ${drive === 'tc' ? 'colour temperature control' : 'RGBWAF channels'}.`,
      );
      return false;
    }
    // ACTIVATE goes before the level when the light is off or getting brighter, and after it when
    // it is getting dimmer, as the Apply intent does (S5-D3, S6-D1). The brightest member decides.
    const present = Math.max(0, ...members.map((m) => m.level ?? 0));
    const colourFirst = arc === undefined || present <= 0 || arc >= present;
    const cmds: Command[] =
      'mirek' in c
        ? tcCommands(a, c.mirek, colourFirst)
        : rgbwafCommands(a, c.channels, colourFirst);
    if (arc !== undefined) cmds.push({ id: 'DAPC', address: a, value: arc });
    if (!colourFirst) cmds.push({ id: 'DT8_ACTIVATE', address: a });
    return this.sendAll(cmds, done, many, a);
  }

  private async fade(
    a: Address,
    ms: number | undefined,
    rate: number | undefined,
    many: boolean,
  ): Promise<boolean> {
    const p = this.prefix(a, many);
    if (rate !== undefined)
      return this.sendAll(
        [{ id: 'DTR0', value: rate }, { id: 'SET_FADE_RATE', address: a }, ...this.readBack(a)],
        `${addressText(a)} fade rate ${String(rate)}`,
        many,
        a,
      );
    if (ms !== undefined) {
      const facts = this.facts(a);
      const f = nearestFade(ms, facts?.extendedFade !== undefined, facts?.fastFade ?? 0);
      return this.sendAll(
        [...fadeCommands(a, f.setting), ...this.readBack(a)],
        `${addressText(a)} fade ${f.text}, ${msText(f.ms)}`,
        many,
        a,
      );
    }
    const ans = await this.ask(
      [
        { id: 'QUERY_FADE_TIME_FADE_RATE', address: a },
        { id: 'QUERY_EXTENDED_FADE_TIME', address: a },
      ],
      `fade ${addressText(a)}`,
      a,
      many,
    );
    if (ans === undefined) return false;
    const [tr, ext] = ans;
    this.out('reply', p + replyText('QUERY_FADE_TIME_FADE_RATE', tr ?? 'none'));
    this.out('reply', p + replyText('QUERY_EXTENDED_FADE_TIME', ext ?? 'none'));
    if (typeof tr === 'number' && typeof ext === 'number') {
      const f = this.facts(a);
      this.out('note', p + fadeInUse(decodeFadeTimeRate(tr).fadeTime, ext, f?.fastFade ?? 0).why);
    }
    return true;
  }

  private async scene(
    a: Address,
    c: Extract<ConsoleCommand, { cmd: 'scene' }>,
    many: boolean,
  ): Promise<boolean> {
    const p = this.prefix(a, many);
    if (c.op === 'recall')
      return this.sendAll(
        [{ id: 'GO_TO_SCENE', address: a, value: c.n }],
        `${addressText(a)} scene ${String(c.n)}`,
        many,
        a,
      );
    if (c.op === 'remove')
      return this.sendAll(
        [{ id: 'REMOVE_FROM_SCENE', address: a, value: c.n }],
        `${addressText(a)} scene ${String(c.n)} removed`,
        many,
        a,
      );
    if (a.kind !== 'short') {
      this.out('error', `scene ${c.op} takes short addresses, so each one can be read back.`);
      return false;
    }
    if (c.op === 'list') {
      const ans = await this.ask(
        Array.from({ length: 16 }, (_, n) => ({ id: 'QUERY_SCENE_LEVEL', address: a, value: n })),
        `scene list ${addressText(a)}`,
        a,
        many,
      );
      if (ans === undefined) return false;
      ans.forEach((v, n) => {
        const t =
          v === 'none'
            ? NO_REPLY
            : v === 'collision'
              ? COLLISION
              : v === 255
                ? 'not in scene'
                : levelText(v);
        this.out('reply', `${p}scene ${String(n).padStart(2)}: ${t}`);
      });
      return true;
    }
    // Store: the present level or the one given, then read it back.
    const readLevel = async (): Promise<number | undefined> => {
      const now = await this.ask(
        [{ id: 'QUERY_ACTUAL_LEVEL', address: a }],
        `level ${addressText(a)}`,
        a,
        many,
      );
      if (now === undefined) return undefined;
      const v = now[0];
      if (typeof v !== 'number') {
        this.out('error', `${p}The driver did not say its level, so nothing was stored.`);
        return undefined;
      }
      // 255 is MASK: starting up, or a lamp error. Storing it would take the address out of the
      // scene (DALI review S6-D11).
      if (v === 255) {
        this.out(
          'error',
          `${p}The driver reports MASK (starting up, or a lamp error), so nothing was stored.`,
        );
        return undefined;
      }
      return v;
    };
    let arc: number | undefined;
    if (this.dry && c.arc === undefined) {
      // Nothing answers in an explain, so the level that would be read is not known.
      await this.ask(
        [{ id: 'QUERY_ACTUAL_LEVEL', address: a }],
        `level ${addressText(a)}`,
        a,
        many,
      );
      this.out('note', `${p}DTR0 then carries the level that was read. It is shown as 0 here.`);
      arc = 0;
    } else arc = c.arc ?? (await readLevel());
    if (arc === undefined) return false;
    const storeIntent = (v: number): Intent => ({
      kind: 'commands',
      commands: [
        { id: 'DTR0', value: v },
        { id: 'SET_SCENE', address: a, value: c.n },
        { id: 'QUERY_SCENE_LEVEL', address: a, value: c.n },
      ],
      label: `scene store ${addressText(a)} ${String(c.n)}`,
    });
    // The present level is read again after a wait for the rate guard, so a level from before the
    // wait is never stored (DALI review S6-D9).
    const r = await this.submit(
      storeIntent(arc),
      c.arc === undefined
        ? async () => {
            const v = await readLevel();
            if (v === undefined) return undefined;
            arc = v;
            return storeIntent(v);
          }
        : undefined,
    );
    if (!r.ok) return this.failed(r, p);
    if (this.dry) return true;
    const back = r.answers[0];
    if (back !== arc) {
      this.out(
        'error',
        `${p}scene ${String(c.n)} reads back ${typeof back === 'number' ? levelText(back) : NO_REPLY}, not ${levelText(arc)}.`,
      );
      return false;
    }
    this.out('out', `${addressText(a)} scene ${String(c.n)} holds ${levelText(arc)}, read back`);
    return true;
  }

  private async query(a: Address, what: QueryWhat, many: boolean): Promise<boolean> {
    const p = this.prefix(a, many);
    const ids =
      what === 'summary'
        ? [
            'QUERY_STATUS',
            'QUERY_ACTUAL_LEVEL',
            'QUERY_MIN_LEVEL',
            'QUERY_MAX_LEVEL',
            'QUERY_PHYSICAL_MINIMUM',
            'QUERY_POWER_ON_LEVEL',
            'QUERY_SYSTEM_FAILURE_LEVEL',
            'QUERY_FADE_TIME_FADE_RATE',
            'QUERY_EXTENDED_FADE_TIME',
            'QUERY_DEVICE_TYPE',
            'QUERY_GROUPS_0_7',
            'QUERY_GROUPS_8_15',
          ]
        : what === 'fade'
          ? ['QUERY_FADE_TIME_FADE_RATE', 'QUERY_EXTENDED_FADE_TIME']
          : what === 'groups'
            ? ['QUERY_GROUPS_0_7', 'QUERY_GROUPS_8_15']
            : what === 'tc'
              ? undefined
              : [what.id];
    if (ids === undefined) {
      // Tc: selector 2 asks for the colour temperature; the reply is the high byte, DTR0 the low.
      const ans = await this.ask(
        queryColourValueCommands(a, 2),
        `query ${addressText(a)} tc`,
        a,
        many,
      );
      if (ans === undefined) return false;
      const [, hi, lo] = ans;
      if (typeof hi !== 'number' || typeof lo !== 'number') {
        this.out(
          'reply',
          `${p}colour temperature: ${hi === 'collision' || lo === 'collision' ? COLLISION : NO_REPLY}`,
        );
        return true;
      }
      const m = (hi << 8) | lo;
      this.out(
        'reply',
        m === 0xffff
          ? `${p}colour temperature: none (MASK)`
          : `${p}colour temperature ${String(m)} mirek (${String(Math.round(mirekToKelvin(m)))}K)`,
      );
      return true;
    }
    const ans = await this.ask(
      ids.map((id) => ({ id, address: a })),
      `query ${addressText(a)}`,
      a,
      many,
    );
    if (ans === undefined) return false;
    ids.forEach((id, i) => {
      this.out('reply', p + replyText(id, ans[i] ?? 'none'));
    });
    return true;
  }

  private async dali(
    id: string,
    a: Address | undefined,
    value: number | undefined,
    many: boolean,
  ): Promise<boolean> {
    if (id === 'RESET') return this.reset(a);
    const s = spec(id);
    const cmd: Command = {
      id,
      ...(a === undefined ? {} : { address: a }),
      ...(value === undefined ? {} : { value }),
    };
    const label = [
      s.label.toLowerCase(),
      a === undefined ? '' : addressText(a),
      value === undefined ? '' : String(value),
    ]
      .filter((x) => x !== '')
      .join(' ');
    // A command that reads a DTR says the value it will use. Other work, such as a background read
    // in Both or a live control, can set a DTR between two typed lines (DALI review S6-D3).
    if (s.reads.length > 0) {
      const d = this.host.dtr();
      const text = s.reads
        .map((n) => `DTR${String(n)} = ${d[n] === undefined ? 'unknown' : String(d[n])}`)
        .join(', ');
      this.out('note', `${this.prefix(a, many)}uses ${text}`);
    }
    const r = await this.submit({ kind: 'commands', commands: [cmd], label });
    if (!r.ok) return this.failed(r, this.prefix(a, many));
    if (s.reply === 'none') {
      this.out('out', r.note === undefined ? `sent ${label}` : `sent ${label}, clamped: ${r.note}`);
      return true;
    }
    this.out('reply', this.prefix(a, many) + replyText(id, r.answers[0] ?? 'none'));
    return true;
  }

  /**
   * RESET goes only through the engine's reset, which sends OFF 350 ms later and writes the safety
   * profile again. A bare RESET left the driver at full with MAX LEVEL 254 (DALI review S6-R1).
   */
  private async reset(a: Address | undefined): Promise<boolean> {
    if (a?.kind !== 'short') {
      this.out(
        'refused',
        'refused: RESET goes to one short address at a time, so its OFF and the safety profile can follow.',
      );
      return false;
    }
    const at = `A${String(a.n)}`;
    this.out(
      'note',
      `${at} goes to full output for about 0.3 s, then OFF, then the safety profile is written again.`,
    );
    if (this.dry) {
      this.show({ kind: 'commands', commands: [{ id: 'RESET', address: a }] });
      this.out(
        'note',
        'The OFF and the safety profile that follow are not listed. It needs the reset unlock.',
      );
      return true;
    }
    const r = await this.host.reset(a.n, this.o.source);
    if (!r.ok) {
      this.out('refused', `refused: ${r.reason}`);
      return false;
    }
    this.out('out', `${at} reset, off, and the safety profile verified`);
    return true;
  }

  private async raw(a: number, b: number, twice: boolean): Promise<boolean> {
    const s = decodeSpec({ a, b });
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
    const label = `raw ${hex(a)} ${hex(b)}`;
    // The server checks the flags against its own decoding, so x2 must match the command.
    if (s === undefined) {
      // Device type opcodes decode only after ENABLE DEVICE TYPE (S6-D7).
      this.out(
        'refused',
        `refused: ${label} is not a supported command on its own. Use the command's name, which adds ENABLE DEVICE TYPE.`,
      );
      return false;
    }
    if (twice && !s.sendTwice) {
      this.out('refused', `refused: ${label} is not a send-twice command, so x2 does not apply.`);
      return false;
    }
    if (s.id === 'RESET') return this.reset(decode({ a, b })?.address);
    const r = await this.submit({ kind: 'raw', a, b });
    if (!r.ok) return this.failed(r, '');
    const note = s.sendTwice && !twice ? ' (sent twice, as the command needs)' : '';
    if (s.reply === 'none') {
      this.out('out', `sent ${label}${note}${r.note === undefined ? '' : `, clamped: ${r.note}`}`);
      return true;
    }
    this.out('reply', replyText(s.id, r.answers[0] ?? 'none'));
    return true;
  }

  private devices(): void {
    const ds = this.host.devices();
    if (ds.length === 0) {
      this.out('out', 'No devices found. Type scan to look again.');
      return;
    }
    for (const d of ds) {
      const f = d.facts;
      const parts = [
        `A${String(d.address)}`,
        d.verified ? 'verified' : 'unverified',
        f === undefined
          ? 'not read yet'
          : f.drive === 'tc'
            ? 'colour temperature'
            : f.drive === 'rgbwaf'
              ? 'RGBWAF'
              : 'level only',
      ];
      if (f?.minLevel !== undefined) parts.push(`min ${String(f.minLevel)}`);
      if (f?.maxLevel !== undefined) parts.push(`max ${String(f.maxLevel)}`);
      const groups = d.groups;
      if (groups !== undefined && groups !== 0)
        parts.push(
          `groups ${Array.from({ length: 16 }, (_, i) => i)
            .filter((i) => groups & (1 << i))
            .map((i) => `g${String(i)}`)
            .join(' ')}`,
        );
      this.out('out', parts.join('  '));
    }
  }

  private profile(to: Target | undefined): void {
    const shorts = to?.flatMap((a) => (a.kind === 'short' ? [a.n] : []));
    const ds = this.host
      .devices()
      .filter((d) => shorts === undefined || shorts.includes(d.address));
    if (ds.length === 0) {
      this.out('out', 'No devices to show.');
      return;
    }
    for (const d of ds) {
      const p = d.profile;
      if (p === undefined) {
        this.out('out', `A${String(d.address)}: the safety profile has not been written yet.`);
        continue;
      }
      this.out(
        'out',
        `A${String(d.address)}: ${p.verified ? 'verified' : `not verified${p.reason === undefined ? '' : `: ${p.reason}`}`}`,
      );
      for (const m of p.mismatches)
        this.out(
          'note',
          `  ${m.what}: expected ${String(m.expected)}, read ${m.actual === undefined ? 'nothing' : String(m.actual)}`,
        );
      for (const u of p.unconfirmed) this.out('note', `  ${u}: not yet confirmed on hardware`);
    }
  }

  private async cap(arc: number | undefined): Promise<boolean> {
    const now = this.host.ceilingArc();
    if (arc === undefined) {
      this.out('out', `ceiling ${String(now)} (${percentText(now)}%)`);
      return true;
    }
    if (arc === now) {
      this.out('out', `The ceiling is already ${String(now)} (${percentText(now)}%).`);
      return true;
    }
    if (arc > now && this.o.source !== 'console') {
      this.out('refused', 'refused: a script cannot raise the ceiling.');
      return false;
    }
    return this.outcome(
      await this.host.setCeiling(arc, this.o.source, this.o.confirmed === true),
      `ceiling ${String(arc)} (${percentText(arc)}%)`,
    );
  }
}
