/**
 * The planner (SPEC R5.4, S5.4, ADR 0020). It turns a sequence's steps into rows, each one change to
 * one driver at a time from the start of the run (ADR 0010). A step uses the driver's own fade where
 * one fits its duration, and is chained from several fades where none does. The planner is pure: it
 * reads what each driver is doing when the plan is made and sends nothing.
 *
 * A DALI fade moves the arc level evenly with time, so the levels between chained fades are spaced
 * evenly in arc level, and the chain follows the line one long fade would.
 */
import { addressText, short, type Address } from '../dali/address.ts';
import { commandText, type Command } from '../dali/codec.ts';
import { extendedFades, standardFades } from '../dali/fade.ts';
import { fadeCommands, framesForAll, rgbwafCommands, tcCommands } from '../dali/sequences.ts';
import { planFrames, type BusTiming } from '../bus/timing.ts';
import type { Channels, FadeSetting } from '../engine/engine.ts';
import type { Drive, Edit, LookColour } from './look.ts';
import { MAX_STEP_MS, MAX_STEPS, type Sequence, type Step } from './sequence.ts';
import { colourText, levelText, timeText } from './text.ts';

/** A plan has at most this many rows. */
export const MAX_ROWS = 5000;

/** What the planner needs to know about one driver. */
export interface Driver {
  readonly address: number;
  readonly drive: Drive;
  /** Group membership, one bit a group. */
  readonly groups: number;
  /** The lowest level it holds. A fade from off starts here. */
  readonly minArc: number;
  /** Whether a level command brings in a loaded colour (gear features bit 0). */
  readonly auto: boolean;
  /** The level it is at, or fading to, when the plan is made. */
  readonly arc: number;
  /** The colour it shows when the plan is made, when known. */
  readonly colour: LookColour;
}

export interface PlanRow {
  /** From the start of the run. */
  readonly atMs: number;
  readonly address: number;
  /** The step this row belongs to. */
  readonly step: number;
  readonly arc: number;
  /** The colour sent with the level, or none when it does not change. */
  readonly colour: LookColour;
  readonly fade: FadeSetting;
  readonly fadeMs: number;
  /** The driver's fade differs from the one this plan last set, so it is set first. */
  readonly setFade: boolean;
  /** The level before this row, for the order of colour and level on gear without automatic activation. */
  readonly fromArc: number;
}

export interface Plan {
  readonly rows: readonly PlanRow[];
  /** When the last fade ends. */
  readonly endMs: number;
  /** What the planner left out or changed, in words. */
  readonly notes: readonly string[];
  /** For a repeating effect: the plan starts again this long after it started. */
  readonly periodMs?: number;
}

const NO_FADE: FadeSetting = { kind: 'extended', value: 0 };

interface Piece {
  readonly fade: FadeSetting;
  readonly ms: number;
}

// Longest first. Where a standard fade time and an extended one are the same length, the standard
// one comes first: it takes two frames to set, and the extended one four.
const PIECES: readonly Piece[] = [
  ...standardFades().map((f): Piece => ({ fade: { kind: 'standard', value: f.value }, ms: f.ms })),
  ...extendedFades().map((f): Piece => ({ fade: { kind: 'extended', value: f.value }, ms: f.ms })),
].sort((a, b) => b.ms - a.ms);
const SHORTEST = Math.min(...PIECES.map((p) => p.ms));

/**
 * The driver fades that make up a duration: one where one fits, or the longest that fits and then
 * the rest, and so on. A duration under half the shortest fade is no fade. What is left over at the
 * end, less than the shortest fade, is given to the nearest fade or dropped.
 */
export function fadePieces(ms: number): Piece[] {
  if (ms < SHORTEST / 2) return [{ fade: NO_FADE, ms: 0 }];
  const out: Piece[] = [];
  let rest = ms;
  while (rest >= SHORTEST / 2) {
    const fits = PIECES.find((p) => p.ms <= rest + 0.5);
    // Less than the shortest fade is left: round it up to the shortest.
    const piece = fits ?? PIECES[PIECES.length - 1];
    if (piece === undefined) break;
    out.push(piece);
    rest -= piece.ms;
  }
  return out;
}

const sameFade = (a: FadeSetting | undefined, b: FadeSetting): boolean =>
  a?.kind === b.kind && a.value === b.value;

export function sameColour(a: LookColour, b: LookColour): boolean {
  if (a.kind === 'tc' && b.kind === 'tc') return a.mirek === b.mirek;
  if (a.kind === 'rgbwaf' && b.kind === 'rgbwaf')
    return a.channels.every((v, i) => v === b.channels[i]);
  return a.kind === 'none' && b.kind === 'none';
}

/** The colour part way from one to another. Colours of different kinds do not mix: the end is used. */
function between(from: LookColour, to: LookColour, f: number): LookColour {
  if (from.kind === 'tc' && to.kind === 'tc')
    return { kind: 'tc', mirek: Math.round(from.mirek + (to.mirek - from.mirek) * f) };
  if (from.kind === 'rgbwaf' && to.kind === 'rgbwaf')
    return {
      kind: 'rgbwaf',
      channels: to.channels.map((v, i) => {
        const a = from.channels[i] ?? 255;
        if (v === 255) return a;
        return a === 255 ? v : Math.round(a + (v - a) * f);
      }) as unknown as Channels,
    };
  return to;
}

/** A colour with what a new one leaves alone filled in from the one before. */
function over(before: LookColour, next: LookColour): LookColour {
  if (next.kind === 'none') return before;
  if (next.kind === 'rgbwaf' && before.kind === 'rgbwaf')
    return {
      kind: 'rgbwaf',
      channels: next.channels.map((v, i) =>
        v === 255 ? (before.channels[i] ?? 255) : v,
      ) as unknown as Channels,
    };
  return next;
}

/** The drivers a target reaches. */
export function reached(target: Address, drivers: readonly Driver[]): Driver[] {
  if (target.kind === 'short') return drivers.filter((d) => d.address === target.n);
  if (target.kind === 'group') return drivers.filter((d) => ((d.groups >> target.n) & 1) === 1);
  return target.kind === 'broadcast' ? [...drivers] : [];
}

const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function stepProblem(s: Step, i: number): string | undefined {
  const n = `Step ${String(i + 1)}`;
  if (!Number.isInteger(s.arc) || s.arc < 0 || s.arc > 254)
    return `${n}: a level is an arc level from 0 to 254.`;
  if (!Number.isInteger(s.durationMs) || s.durationMs < 0 || s.durationMs > MAX_STEP_MS)
    return `${n}: a step lasts from 0 to 24 hours.`;
  return undefined;
}

interface State {
  arc: number;
  colour: LookColour;
  fade: FadeSetting | undefined;
}

/**
 * Plan a sequence for the drivers there are. `ceiling` is the brightness ceiling: a level above it
 * is planned at it, since the governor would hold it there.
 */
export function planSequence(
  seq: Sequence,
  drivers: readonly Driver[],
  ceiling: number,
): Edit<Plan> {
  if (seq.steps.length === 0) return bad('A sequence needs at least one step.');
  if (seq.steps.length > MAX_STEPS)
    return bad(`A sequence has at most ${String(MAX_STEPS)} steps.`);
  const rows: PlanRow[] = [];
  const notes = new Set<string>();
  const state = new Map<number, State>(
    drivers.map((d) => [d.address, { arc: d.arc, colour: d.colour, fade: undefined }]),
  );
  let start = 0;
  let end = 0;
  let endMs = 0;
  for (const [i, s] of seq.steps.entries()) {
    const problem = stepProblem(s, i);
    if (problem !== undefined) return bad(problem);
    if (s.together !== true || i === 0) start = end;
    end = Math.max(s.together === true ? end : 0, start + s.durationMs);
    const members = reached(s.target, drivers);
    if (members.length === 0)
      notes.add(`Step ${String(i + 1)}: no driver at ${addressText(s.target)}, so it is skipped.`);
    const arc = Math.min(s.arc, ceiling);
    if (arc !== s.arc) notes.add('A level above the ceiling is planned at the ceiling.');
    const pieces = fadePieces(s.durationMs);
    const total = pieces.reduce((sum, p) => sum + p.ms, 0);
    for (const d of members) {
      const st = state.get(d.address);
      if (st === undefined) continue;
      let colour = s.colour;
      if (colour.kind !== 'none' && colour.kind !== d.drive) {
        notes.add(
          `A${String(d.address)} does not take ${colour.kind === 'tc' ? 'a colour temperature' : 'RGBWAF channel levels'}: it gets the level only.`,
        );
        colour = { kind: 'none' };
      }
      const from = { arc: st.arc, colour: st.colour };
      const to = over(from.colour, colour);
      const a0 = from.arc === 0 ? d.minArc : from.arc;
      const a1 = arc === 0 ? d.minArc : arc;
      let before = 0;
      for (const [k, p] of pieces.entries()) {
        const last = k === pieces.length - 1;
        const f = total === 0 ? 1 : (before + p.ms) / total;
        const nextArc = last ? arc : Math.round(a0 + (a1 - a0) * f);
        const nextColour = last ? to : between(from.colour, to, f);
        const at = start + before;
        before += p.ms;
        const colourChanges = !sameColour(nextColour, st.colour);
        if (nextArc === st.arc && !colourChanges) continue;
        rows.push({
          atMs: at,
          address: d.address,
          step: i,
          arc: nextArc,
          colour: colourChanges ? nextColour : { kind: 'none' },
          fade: p.fade,
          fadeMs: p.ms,
          setFade: !sameFade(st.fade, p.fade),
          fromArc: st.arc,
        });
        endMs = Math.max(endMs, at + p.ms);
        st.arc = nextArc;
        st.colour = nextColour;
        st.fade = p.fade;
        if (rows.length > MAX_ROWS)
          return bad(`This sequence needs more than ${String(MAX_ROWS)} changes. Make it shorter.`);
      }
    }
  }
  rows.sort((a, b) => a.atMs - b.atMs);
  return { ok: true, value: { rows, endMs: Math.max(endMs, end), notes: [...notes] } };
}

/**
 * The commands for one row: the fade when it changes, the colour loaded as the temporary colour,
 * then the level. Gear with automatic activation brings the colour in with the level. Other gear
 * gets ACTIVATE: before the level when the light is off or getting brighter, after it when it is
 * getting dimmer, so the light between is never brighter than at either end (as Apply, ADR 0013).
 */
export function rowCommands(row: PlanRow, auto: boolean): Command[] {
  const a = short(row.address);
  const cmds: Command[] = [];
  if (row.setFade) cmds.push(...fadeCommands(a, row.fade));
  const colourFirst = row.fromArc <= 0 || row.arc >= row.fromArc;
  const activate = !auto && colourFirst;
  if (row.colour.kind === 'tc') cmds.push(...tcCommands(a, row.colour.mirek, activate));
  if (row.colour.kind === 'rgbwaf') cmds.push(...rgbwafCommands(a, row.colour.channels, activate));
  cmds.push({ id: 'DAPC', address: a, value: row.arc });
  if (row.colour.kind !== 'none' && !auto && !colourFirst)
    cmds.push({ id: 'DT8_ACTIVATE', address: a });
  return cmds;
}

/** A fade setting as an integrator would write it. */
export function fadeSettingText(f: FadeSetting, ms: number): string {
  if (ms === 0) return 'no fade';
  return f.kind === 'standard'
    ? `${timeText(ms)} (fade time ${String(f.value)})`
    : `${timeText(ms)} (extended fade 0x${f.value.toString(16).toUpperCase().padStart(2, '0')})`;
}

/** A row in words: what is sent, its values and its fade (SPEC R5.6). */
export function rowText(row: PlanRow): { command: string; values: string; fade: string } {
  const colour = row.colour.kind === 'none' ? '' : `, ${colourText(row.colour)}`;
  return {
    command:
      row.colour.kind === 'none'
        ? 'level'
        : row.colour.kind === 'tc'
          ? 'level and colour temperature'
          : 'level and RGBWAF channels',
    values: `arc ${String(row.arc)} (${levelText(row.arc)})${colour}`,
    fade: fadeSettingText(row.fade, row.fadeMs),
  };
}

export interface PlannedFrame {
  /** When the frame starts on the wire, from the start of the run, if the bus is free. */
  readonly atMs: number;
  readonly address: number;
  readonly text: string;
}

/**
 * Every frame of a plan with its time (SPEC R5.4), as the planner expects the bus to carry them:
 * each row's frames start at the row's time, or when the frames before them have gone.
 */
export function planFramesOf(
  plan: Plan,
  auto: (address: number) => boolean,
  timing: BusTiming,
): PlannedFrame[] {
  const out: PlannedFrame[] = [];
  let free = 0;
  for (const row of plan.rows) {
    const cmds = rowCommands(row, auto(row.address));
    const texts = cmds.flatMap((c) =>
      framesForAll([c]).map((_f, i, all) =>
        all.length > 1 && i === 0 ? 'ENABLE DEVICE TYPE 8' : commandText(c),
      ),
    );
    const times = planFrames(framesForAll(cmds), Math.max(free, row.atMs), timing);
    times.forEach((t, i) => {
      out.push({ atMs: t.wireStart, address: row.address, text: texts[i] ?? '' });
    });
    free = times.at(-1)?.end ?? free;
  }
  return out;
}

/** Frames a second each address is sent over a plan, and the share of the bus the plan uses. */
export function planCost(
  plan: Plan,
  auto: (address: number) => boolean,
  timing: BusTiming,
): { perAddress: Map<number, number>; busShare: number } {
  const span = Math.max(1, plan.periodMs ?? plan.endMs);
  const perAddress = new Map<number, number>();
  let busy = 0;
  for (const row of plan.rows) {
    const frames = framesForAll(rowCommands(row, auto(row.address)));
    const times = planFrames(frames, 0, timing);
    busy += times.at(-1)?.end ?? 0;
    perAddress.set(row.address, (perAddress.get(row.address) ?? 0) + frames.length);
  }
  for (const [a, n] of perAddress) perAddress.set(a, (n * 1000) / span);
  return { perAddress, busShare: Math.min(1, busy / span) };
}
