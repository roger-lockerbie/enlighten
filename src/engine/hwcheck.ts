/**
 * The hardware check (Stage 4 item 9): parts 2 to 4 of the hardware-day checklist in
 * `docs/TEST_PLAN.md` section 10, as code. Each step is automatic (the app sends and records), needs a
 * confirmation and an unlock first, or is manual (a person does it and records what they saw). The
 * results are plain data, saved as JSON for Stage 12.
 *
 * Every frame goes through the engine, the scheduler and the governor like any other source.
 */
import { short } from '../dali/address.ts';
import { framesForAll, rgbwafCommands, tcCommands, type TxFrame } from '../dali/sequences.ts';
import type { Command } from '../dali/codec.ts';
import type { Governor } from '../safety/governor.ts';
import { WARM_MIREK, type ProfileResult, type Submit } from '../safety/profile.ts';
import type { Source } from '../safety/types.ts';
import { colourValue } from './inventory.ts';
import { answers, ask, send } from './submit.ts';
import { CHECK_STEP_INFO, type CheckStepInfo } from './hwcheck-steps.ts';

export type { CheckKind, CheckStepInfo } from './hwcheck-steps.ts';

export type CheckStatus = 'done' | 'failed' | 'recorded' | 'skipped';

/** JSON-safe values. */
export type Value = number | string | boolean | null | Value[] | { [k: string]: Value };

export interface CheckContext {
  readonly submit: Submit;
  readonly governor: Governor;
  /** The addresses the scan found. */
  readonly addresses: readonly number[];
  readonly source: Source;
  wait(ms: number): Promise<void>;
  now(): number;
  applyProfile(n: number): Promise<ProfileResult>;
  /** Panic, as the button does. */
  panic(): Promise<void>;
  /**
   * Resolves when a frame matching `match` is handed to the transport on this connection. Call
   * `cancel` when no longer waiting, so the listener does not outlive the step.
   */
  whenStarted(match: (f: TxFrame) => boolean): { readonly started: Promise<void>; cancel(): void };
}

export interface CheckStep extends CheckStepInfo {
  readonly run?: (ctx: CheckContext) => Promise<Record<string, Value>>;
}

export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly at: number;
  readonly values?: Record<string, Value>;
  readonly note?: string;
  readonly error?: string;
}

const q = (id: string, n: number, value?: number): Command =>
  value === undefined ? { id, address: short(n) } : { id, address: short(n), value };

const v = (x: number | undefined): Value => x ?? null;

/** The read-back that follows a fade write: the guard rests on fade settings only as read (ADR 0019). */
const readFades = (n: number): Command[] => [
  q('QUERY_FADE_TIME_FADE_RATE', n),
  q('QUERY_EXTENDED_FADE_TIME', n),
];

/** Read one query from each address. */
async function each(
  ctx: CheckContext,
  read: (n: number) => Promise<Value>,
): Promise<Record<string, Value>> {
  const out: Record<string, Value> = {};
  for (const n of ctx.addresses) out[`A${String(n)}`] = await read(n);
  return out;
}

const one = (ctx: CheckContext, id: string, n: number, value?: number) =>
  ask(ctx.submit, [q(id, n, value)], ctx.source, id);

const withDtr0 = (ctx: CheckContext, id: string, n: number, dtr: number) =>
  ask(ctx.submit, [{ id: 'DTR0', value: dtr }, q(id, n)], ctx.source, id);

/**
 * Send a light change, asking again while the rate guard holds it for a time. On hardware a colour
 * driver's colour is never known, so each change to it waits out the one before (ADR 0019
 * amendment 1).
 */
async function sendWhenAllowed(
  ctx: CheckContext,
  cmds: readonly Command[],
  label: string,
): Promise<void> {
  for (let tries = 0; ; tries++) {
    const r = await ctx.submit({ frames: framesForAll(cmds), source: ctx.source, label });
    if (r.kind === 'done') return;
    if (r.kind !== 'refused' || r.retryAt === undefined || tries >= HELD_TRIES)
      throw new Error(`${label}: ${r.reason}`);
    await ctx.wait(HELD_RETRY_MS);
  }
}
const HELD_RETRY_MS = 500;
const HELD_TRIES = 40;

/** Load and activate a warm colour, so no temporary colour waits in the gear. */
async function activateColour(ctx: CheckContext, n: number): Promise<void> {
  const facts = ctx.governor.colourFacts(n);
  if (facts === undefined) return;
  const a = short(n);
  if (facts.tc) {
    await sendWhenAllowed(ctx, tcCommands(a, WARM_MIREK, true), 'warm colour');
  } else if (facts.channels > 0) {
    const warm = facts.channels >= 4 ? 3 : 0;
    const mix = [0, 1, 2, 3, 4, 5].map((i) => (i === warm ? 254 : 0)) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    await sendWhenAllowed(ctx, rgbwafCommands(a, mix, true), 'warm colour');
  }
}

const RUNS: Readonly<Record<string, NonNullable<CheckStep['run']>>> = {
  'p2-device-types': (ctx) =>
    each(ctx, async (n) => {
      const first = await one(ctx, 'QUERY_DEVICE_TYPE', n);
      const all: Value[] = [v(first)];
      if (first === 255) {
        for (let i = 0; i < 8; i++) {
          const t = await one(ctx, 'QUERY_NEXT_DEVICE_TYPE', n);
          all.push(v(t));
          if (t === undefined || t === 254) break;
        }
      }
      return all;
    }),
  'p2-colour-features': (ctx) =>
    each(ctx, async (n) => {
      const b = await one(ctx, 'DT8_QUERY_COLOUR_TYPE_FEATURES', n);
      if (b === undefined) return null;
      return {
        byte: b,
        xy: (b & 1) !== 0,
        tc: (b & 2) !== 0,
        primaries: (b >> 2) & 7,
        channels: (b >> 5) & 7,
      };
    }),
  'p2-assigned-colours': (ctx) =>
    each(ctx, async (n) => {
      const out: Value[] = [];
      for (let ch = 0; ch < 6; ch++)
        out.push(v(await withDtr0(ctx, 'DT8_QUERY_ASSIGNED_COLOUR', n, ch)));
      return out;
    }),
  'p2-limits': (ctx) =>
    each(ctx, async (n) => ({
      physicalMinimum: v(await one(ctx, 'QUERY_PHYSICAL_MINIMUM', n)),
      min: v(await one(ctx, 'QUERY_MIN_LEVEL', n)),
      max: v(await one(ctx, 'QUERY_MAX_LEVEL', n)),
    })),
  'p2-power-levels': (ctx) =>
    each(ctx, async (n) => ({
      powerOn: v(await one(ctx, 'QUERY_POWER_ON_LEVEL', n)),
      systemFailure: v(await one(ctx, 'QUERY_SYSTEM_FAILURE_LEVEL', n)),
    })),
  'p2-fades': (ctx) =>
    each(ctx, async (n) => {
      const fr = await one(ctx, 'QUERY_FADE_TIME_FADE_RATE', n);
      return {
        fadeTimeRate: v(fr),
        fadeTime: fr === undefined ? null : (fr >> 4) & 0x0f,
        fadeRate: fr === undefined ? null : fr & 0x0f,
        extendedFade: v(await one(ctx, 'QUERY_EXTENDED_FADE_TIME', n)),
        fastFade: v(await one(ctx, 'DT6_QUERY_FAST_FADE_TIME', n)),
        minFastFade: v(await one(ctx, 'DT6_QUERY_MIN_FAST_FADE_TIME', n)),
      };
    }),
  'p2-curve-features': (ctx) =>
    each(ctx, async (n) => ({
      curve: v(await one(ctx, 'DT6_QUERY_DIMMING_CURVE', n)),
      gearFeatures: v(await one(ctx, 'DT8_QUERY_GEAR_FEATURES', n)),
      rgbwafControl: v(await one(ctx, 'DT8_QUERY_RGBWAF_CONTROL', n)),
    })),
  'p2-tc-limits': (ctx) =>
    each(ctx, async (n) => ({
      coolest: v(await colourValue(ctx.submit, n, 128, true, ctx.source)),
      physicalCoolest: v(await colourValue(ctx.submit, n, 129, true, ctx.source)),
      warmest: v(await colourValue(ctx.submit, n, 130, true, ctx.source)),
      physicalWarmest: v(await colourValue(ctx.submit, n, 131, true, ctx.source)),
    })),
  'p2-scenes-groups': (ctx) =>
    each(ctx, async (n) => {
      const scenes: Value[] = [];
      for (let k = 0; k < 16; k++) scenes.push(v(await one(ctx, 'QUERY_SCENE_LEVEL', n, k)));
      return {
        scenes,
        groups0to7: v(await one(ctx, 'QUERY_GROUPS_0_7', n)),
        groups8to15: v(await one(ctx, 'QUERY_GROUPS_8_15', n)),
      };
    }),
  'p2-colour-as-shipped': (ctx) =>
    each(ctx, async (n) => {
      const channels: Value[] = [];
      for (let sel = 233; sel <= 238; sel++)
        channels.push(v(await colourValue(ctx.submit, n, sel, false, ctx.source)));
      return { tc: v(await colourValue(ctx.submit, n, 226, true, ctx.source)), channels };
    }),
  'p2-store-tc-limit': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const store = (value: number) =>
      send(
        ctx.submit,
        [
          { id: 'DTR0', value: value & 0xff },
          { id: 'DTR1', value: (value >> 8) & 0xff },
          // DTR2 0 is the coolest limit (IEC 62386-209).
          { id: 'DTR2', value: 0 },
          q('DT8_STORE_TC_LIMIT', n),
        ],
        ctx.source,
        'STORE COLOUR TEMPERATURE Tc LIMIT',
      );
    const before = await colourValue(ctx.submit, n, 128, true, ctx.source);
    if (before === undefined)
      return { address: n, before: null, skipped: 'The driver has no coolest limit.' };
    const trial = before + 1;
    await store(trial);
    const after = await colourValue(ctx.submit, n, 128, true, ctx.source);
    await store(before);
    const restored = await colourValue(ctx.submit, n, 128, true, ctx.source);
    // The warmest limit too: a coolest limit at the warmest cannot move warmer, which would read
    // as a store that did not take.
    const warmest = await colourValue(ctx.submit, n, 130, true, ctx.source);
    return {
      address: n,
      before,
      warmest: v(warmest),
      stored: trial,
      after: v(after),
      changed: after === trial,
      restored: restored === before,
    };
  },
  'p2-versions': (ctx) =>
    each(ctx, async (n) => {
      const bank0: Value[] = [];
      // READ MEMORY LOCATION moves DTR0 on, and the governor then treats DTR0 as unknown (SPEC
      // section 5), so each read sets the bank and the location again.
      for (let i = 0; i < 27; i++) {
        const byte = await ask(
          ctx.submit,
          [{ id: 'DTR1', value: 0 }, { id: 'DTR0', value: i }, q('READ_MEMORY_LOCATION', n)],
          ctx.source,
          'READ MEMORY LOCATION',
        );
        bank0.push(v(byte));
      }
      return {
        version: v(await one(ctx, 'QUERY_VERSION_NUMBER', n)),
        dt6: v(await one(ctx, 'DT6_QUERY_EXTENDED_VERSION_NUMBER', n)),
        dt8: v(await one(ctx, 'DT8_QUERY_EXTENDED_VERSION_NUMBER', n)),
        bank0,
      };
    }),
  'p3-status-report': async (ctx) => {
    const n = ctx.addresses[0] ?? 0;
    return { address: n, status: v(await one(ctx, 'QUERY_STATUS', n)) };
  },
  'p3-empty-address': async (ctx) => {
    const n = Array.from({ length: 64 }, (_, i) => i).find((i) => !ctx.addresses.includes(i)) ?? 63;
    const t0 = ctx.now();
    const [r] = await answers(
      ctx.submit,
      [q('QUERY_ACTUAL_LEVEL', n)],
      ctx.source,
      'empty address',
    );
    return { address: n, answer: r ?? null, ms: Math.round(ctx.now() - t0) };
  },
  'p3-throughput': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const t0 = ctx.now();
    for (let i = 0; i < 100; i++)
      await send(ctx.submit, [{ id: 'DTR0', value: i }], ctx.source, 'DTR0');
    const t1 = ctx.now();
    for (let i = 0; i < 100; i++) await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
    const t2 = ctx.now();
    return {
      address: n,
      commandsPerSecond: Math.round((100 * 1000) / Math.max(1, t1 - t0)),
      queriesPerSecond: Math.round((100 * 1000) / Math.max(1, t2 - t1)),
    };
  },
  'p3-store-gear-features': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const store = (value: number) =>
      send(
        ctx.submit,
        [{ id: 'DTR0', value }, q('DT8_STORE_GEAR_FEATURES', n)],
        ctx.source,
        'STORE GEAR FEATURES/STATUS',
      );
    const before = await one(ctx, 'DT8_QUERY_GEAR_FEATURES', n);
    if (before === undefined) return { address: n, before: null, skipped: 'No answer.' };
    const trial = (before & 1) ^ 1;
    await store(trial);
    const after = await one(ctx, 'DT8_QUERY_GEAR_FEATURES', n);
    await store(before & 1);
    const restored = await one(ctx, 'DT8_QUERY_GEAR_FEATURES', n);
    return {
      address: n,
      before,
      stored: trial,
      after: v(after),
      changed: after !== undefined && (after & 1) === trial,
      restored: restored !== undefined && (restored & 1) === (before & 1),
    };
  },
  'p4-profile': async (ctx) => {
    const out: Record<string, Value> = {};
    for (const n of ctx.addresses) {
      const r = await ctx.applyProfile(n);
      out[`A${String(n)}`] = {
        verified: r.verified,
        reason: r.reason ?? null,
        mismatches: r.mismatches.map((m) => ({
          what: m.what,
          expected: m.expected,
          actual: v(m.actual),
        })),
      };
    }
    return out;
  },
  'p4-system-failure-fade': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const physMin = (await one(ctx, 'QUERY_PHYSICAL_MINIMUM', n)) ?? 1;
    const fade = await one(ctx, 'QUERY_FADE_TIME_FADE_RATE', n);
    // Fade time 6 is 4.0 s (dali.md section 7).
    await send(
      ctx.submit,
      [{ id: 'DTR0', value: 6 }, q('SET_FADE_TIME', n), ...readFades(n)],
      ctx.source,
      'SET FADE TIME',
    );
    await send(
      ctx.submit,
      [{ id: 'DTR0', value: physMin }, q('SET_SYSTEM_FAILURE_LEVEL', n)],
      ctx.source,
      'SET SYSTEM FAILURE LEVEL',
    );
    return {
      address: n,
      systemFailureLevel: physMin,
      fadeTimeWas: fade === undefined ? null : (fade >> 4) & 0x0f,
      restore: 'Write the safety profile again, and set the fade time back.',
    };
  },
  'p4-max-below-level': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const target = Math.min(200, ctx.governor.ceilingArc);
    const lowered = Math.min(150, target - 1);
    // A colour driver takes a level only after an ACTIVATE, and the level then waits out the
    // colour's window (ADR 0019 amendment 1).
    await activateColour(ctx, n);
    await sendWhenAllowed(ctx, [{ id: 'DAPC', address: short(n), value: target }], 'DAPC');
    await ctx.wait(2000);
    const before = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
    await sendWhenAllowed(
      ctx,
      [{ id: 'DTR0', value: lowered }, q('SET_MAX_LEVEL', n)],
      'SET MAX LEVEL',
    );
    const atOnce = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
    await ctx.wait(2000);
    const after2s = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
    const profile = await ctx.applyProfile(n);
    await sendWhenAllowed(ctx, [{ id: 'OFF', address: short(n) }], 'OFF');
    return {
      address: n,
      level: target,
      maxLevel: lowered,
      before: v(before),
      atOnce: v(atOnce),
      after2s: v(after2s),
      pulledDown: atOnce !== undefined && atOnce <= lowered,
      profileVerified: profile.verified,
    };
  },
  'p4-panic-in-flight': async (ctx) => {
    const n = ctx.addresses[0];
    if (n === undefined) return { skipped: 'No driver was found.' };
    const fade = await one(ctx, 'QUERY_FADE_TIME_FADE_RATE', n);
    const time = fade === undefined ? 0 : (fade >> 4) & 0x0f;
    const watch = ctx.whenStarted((f) => f.sendTwice);
    const sending = send(
      ctx.submit,
      [{ id: 'DTR0', value: time }, q('SET_FADE_TIME', n), ...readFades(n)],
      ctx.source,
      'SET FADE TIME',
    ).then(
      () => 'sent',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    // If the frame is refused or dropped before it starts, there is nothing to panic over.
    const first = await Promise.race([
      watch.started.then(() => 'started' as const),
      sending.then(() => 'ended' as const),
    ]).finally(() => {
      watch.cancel();
    });
    if (first === 'ended')
      return { address: n, configuration: await sending, inFlight: false, panicked: false };
    // A moment for the server to take the frame onto the hasseb, then panic.
    await ctx.wait(5);
    await ctx.panic();
    const configuration = await sending;
    return {
      address: n,
      configuration,
      inFlight: configuration === 'sent',
      latched: ctx.governor.isLatched,
    };
  },
};

export const CHECK_STEPS: readonly CheckStep[] = CHECK_STEP_INFO.map((info) => {
  const run = RUNS[info.id];
  return run === undefined ? info : { ...info, run };
});

/** The step with this id. */
export function checkStep(id: string): CheckStep | undefined {
  return CHECK_STEPS.find((s) => s.id === id);
}

/** The record for Stage 12, as JSON text. */
export function checkReport(
  results: readonly CheckResult[],
  meta: Readonly<Record<string, string | number>>,
): string {
  const steps = CHECK_STEPS.map((s) => {
    const r = results.filter((x) => x.id === s.id).at(-1);
    return {
      id: s.id,
      part: s.part,
      title: s.title,
      kind: s.kind,
      status: r?.status ?? 'not run',
      ...(r?.values === undefined ? {} : { values: r.values }),
      ...(r?.note === undefined ? {} : { note: r.note }),
      ...(r?.error === undefined ? {} : { error: r.error }),
    };
  });
  return JSON.stringify(
    { check: 'Enlighten hardware check, parts 2 to 4', ...meta, steps },
    null,
    2,
  );
}
