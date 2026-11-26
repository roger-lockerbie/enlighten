/**
 * The application controller (SPEC section 10): plates in, part 301 events through each button's
 * machine, mapped actions out to a host. The host is the engine, which sends everything through the
 * governor with the source `switch`. This file sends nothing itself.
 */
import type { Address } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import type { Clock } from '../bus/clock.ts';
import { Button, EVENT_LABEL, type ButtonEvent } from './button.ts';
import { actionText, targetOf, type Action, type Plate } from './plate.ts';

export type HostResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface Host {
  /** Whether the target is on, or undefined when that is not known. */
  isOn(target: Address): boolean | undefined;
  /** The reason the target cannot be driven (it is not verified), or undefined when it can. */
  blocked(target: Address): string | undefined;
  send(commands: readonly Command[], label: string): Promise<HostResult>;
  recall(a: Extract<Action, { kind: 'scene' }>): Promise<HostResult>;
  run(a: Extract<Action, { kind: 'run' }>): Promise<HostResult>;
  stopRun(): void;
  say(text: string): void;
}

export interface ButtonView {
  readonly down: boolean;
  readonly last?: ButtonEvent;
  readonly stuck: boolean;
}

export interface PlateView {
  readonly id: string;
  readonly buttons: readonly ButtonView[];
  /** Two surfaces held together (KNX plates). */
  readonly multi: boolean;
}

interface Hold {
  readonly action: Action;
  /** The direction chosen when the hold began, kept for every repeat. */
  readonly dir: 'up' | 'down' | 'warmer' | 'cooler' | undefined;
  inFlight: boolean;
  /** A refusal is said once for a hold, not on every repeat. */
  said: boolean;
}

interface Slot {
  readonly machine: Button;
  down: boolean;
  last?: ButtonEvent;
  stuck: boolean;
  hold: Hold | undefined;
  /** Ignored until released: this surface took part in a multi-touch. */
  consumed: boolean;
}

interface Live {
  plate: Plate;
  slots: Slot[];
  /** Alternating directions, per button, remembered across holds. */
  nextDim: ('up' | 'down')[];
  nextTune: ('warmer' | 'cooler')[];
  multi: boolean;
}

export class Controller {
  private plates = new Map<string, Live>();

  constructor(
    private readonly clock: Clock,
    private readonly host: Host,
    private readonly onChange?: () => void,
  ) {}

  /** Whether any button is down or any hold is running. */
  holding(): boolean {
    return [...this.plates.values()].some((l) =>
      l.slots.some((s) => s.down || s.hold !== undefined),
    );
  }

  /** Replace every plate. Buttons that are down are let go, and nothing is sent. */
  setPlates(plates: readonly Plate[]): void {
    this.reset();
    this.plates.clear();
    for (const plate of plates) {
      const live: Live = {
        plate,
        slots: [],
        nextDim: plate.buttons.map(() => 'up'),
        nextTune: plate.buttons.map(() => 'cooler'),
        multi: false,
      };
      plate.buttons.forEach((_b, i) => {
        const slot: Slot = {
          machine: new Button(this.clock, plate.timers, plate.filter, (e) => {
            this.event(live, i, e);
          }),
          down: false,
          stuck: false,
          consumed: false,
          hold: undefined,
        };
        live.slots.push(slot);
      });
      this.plates.set(plate.id, live);
    }
    this.onChange?.();
  }

  /** A button went down or up. An unknown plate or button is ignored. */
  input(plateId: string, index: number, down: boolean): void {
    const live = this.plates.get(plateId);
    const slot = live?.slots[index];
    if (live === undefined || slot === undefined) return;
    if (down === slot.down) return;
    slot.down = down;
    if (down) {
      if (live.plate.multi !== undefined && live.slots.some((s, i) => i !== index && s.down)) {
        this.startMulti(live, live.plate.multi);
        return;
      }
      if (live.multi) {
        slot.consumed = true;
        this.onChange?.();
        return;
      }
      slot.machine.press();
    } else {
      slot.machine.release();
      // A filter that holds back both long press stop and released leaves the hold open: end it.
      if (slot.hold !== undefined) {
        this.endHold(live, index, slot.hold);
        slot.hold = undefined;
      }
      if (slot.consumed) slot.consumed = false;
      if (live.multi && !live.slots.some((s) => s.down)) live.multi = false;
    }
    this.onChange?.();
  }

  private startMulti(live: Live, action: Action): void {
    live.multi = true;
    for (const s of live.slots) {
      if (s.down) {
        s.machine.reset();
        s.consumed = true;
        s.hold = undefined;
      }
    }
    this.host.say(`switch ${live.plate.name}: touched together -> ${actionText(action)}`);
    void this.perform(live, action);
    this.onChange?.();
  }

  /** Let every button go and drop every hold, without sending anything: Panic, a latch, a target change. */
  reset(): void {
    for (const live of this.plates.values()) {
      live.multi = false;
      for (const s of live.slots) {
        s.machine.reset();
        s.down = false;
        s.stuck = false;
        s.consumed = false;
        s.hold = undefined;
      }
    }
    this.onChange?.();
  }

  view(): PlateView[] {
    return [...this.plates.values()].map((l) => ({
      id: l.plate.id,
      multi: l.multi,
      buttons: l.slots.map((s) => ({
        down: s.down,
        ...(s.last === undefined ? {} : { last: s.last }),
        stuck: s.stuck,
      })),
    }));
  }

  private event(live: Live, i: number, e: ButtonEvent): void {
    const slot = live.slots[i];
    const cfg = live.plate.buttons[i];
    if (slot === undefined || cfg === undefined) return;
    slot.last = e;
    if (e === 'stuck') slot.stuck = true;
    if (e === 'free') slot.stuck = false;
    const mapped = cfg.mapping[e];
    const where = `switch ${live.plate.name} ${String(i + 1)}`;
    // A hold runs on repeats of the action that long press start began.
    if (e === 'longRepeat') {
      const hold = slot.hold;
      if (hold !== undefined && !hold.inFlight) void this.repeat(live, hold);
      this.onChange?.();
      return;
    }
    if (e === 'longStop' || e === 'stuck' || e === 'released') {
      if (slot.hold !== undefined) {
        this.endHold(live, i, slot.hold);
        slot.hold = undefined;
      }
    }
    if (mapped === undefined || mapped.kind === 'none') {
      this.host.say(`${where}: ${EVENT_LABEL[e]}`);
      this.onChange?.();
      return;
    }
    this.host.say(`${where}: ${EVENT_LABEL[e]} -> ${actionText(mapped)}`);
    if (e === 'longStart' && (mapped.kind === 'dim' || mapped.kind === 'tune')) {
      const dir = this.chooseDir(live, i, mapped);
      slot.hold = { action: mapped, dir, inFlight: false, said: false };
      void this.repeat(live, slot.hold);
    } else void this.perform(live, mapped);
    this.onChange?.();
  }

  private chooseDir(live: Live, i: number, a: Action): Hold['dir'] {
    if (a.kind === 'dim') return a.dir === 'alternate' ? (live.nextDim[i] ?? 'up') : a.dir;
    if (a.kind === 'tune') return a.dir === 'alternate' ? (live.nextTune[i] ?? 'cooler') : a.dir;
    return undefined;
  }

  /** The hold ends: an alternating direction flips for the next hold (research section 6). */
  private endHold(live: Live, i: number, hold: Hold): void {
    if (hold.action.kind === 'dim' && hold.action.dir === 'alternate')
      live.nextDim[i] = hold.dir === 'up' ? 'down' : 'up';
    if (hold.action.kind === 'tune' && hold.action.dir === 'alternate')
      live.nextTune[i] = hold.dir === 'warmer' ? 'cooler' : 'warmer';
  }

  private async repeat(live: Live, hold: Hold): Promise<void> {
    const a = hold.action;
    if (a.kind !== 'dim' && a.kind !== 'tune') return;
    hold.inFlight = true;
    try {
      const blocked = this.host.blocked(a.target);
      if (blocked !== undefined) {
        if (!hold.said) this.host.say(`${live.plate.name}: nothing sent. ${blocked}`);
        hold.said = true;
        return;
      }
      const commands = this.holdCommands(a, hold.dir);
      const r = await this.host.send(commands, `switch ${live.plate.name}: ${actionText(a)}`);
      if (!r.ok && !hold.said) this.host.say(`${live.plate.name}: refused. ${r.reason}`);
      if (!r.ok) hold.said = true;
    } finally {
      hold.inFlight = false;
    }
  }

  private holdCommands(a: Extract<Action, { kind: 'dim' | 'tune' }>, dir: Hold['dir']): Command[] {
    if (a.kind === 'dim') {
      if (dir === 'down') return [{ id: 'DOWN', address: a.target }];
      // From off, ON AND STEP UP brings the light on at its minimum (research section 6).
      return [
        { id: this.host.isOn(a.target) === false ? 'ON_AND_STEP_UP' : 'UP', address: a.target },
      ];
    }
    return [
      { id: dir === 'warmer' ? 'DT8_TC_STEP_WARMER' : 'DT8_TC_STEP_COOLER', address: a.target },
    ];
  }

  private async perform(live: Live, a: Action): Promise<void> {
    const name = live.plate.name;
    const t = targetOf(a);
    if (t !== undefined) {
      const blocked = this.host.blocked(t);
      if (blocked !== undefined) {
        this.host.say(`${name}: nothing sent. ${blocked}`);
        return;
      }
    }
    let r: HostResult;
    const label = `switch ${name}: ${actionText(a)}`;
    switch (a.kind) {
      case 'none':
        return;
      case 'toggle':
        r = await this.host.send(
          [
            this.host.isOn(a.target) === true
              ? { id: 'OFF', address: a.target }
              : {
                  id: a.on === 'last' ? 'GO_TO_LAST_ACTIVE_LEVEL' : 'RECALL_MAX_LEVEL',
                  address: a.target,
                },
          ],
          label,
        );
        break;
      case 'on':
        r = await this.host.send([{ id: 'RECALL_MAX_LEVEL', address: a.target }], label);
        break;
      case 'off':
        r = await this.host.send([{ id: 'OFF', address: a.target }], label);
        break;
      case 'scene':
        r = await this.host.recall(a);
        break;
      case 'run':
        r = await this.host.run(a);
        break;
      case 'stop':
        this.host.stopRun();
        return;
      default:
        return;
    }
    if (!r.ok) this.host.say(`${name}: refused. ${r.reason}`);
  }
}
