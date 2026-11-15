/**
 * The hardware check (Stage 4 item 9): parts 2 to 4 of the hardware-day checklist in
 * `docs/TEST_PLAN.md` section 10, as code. Each step is automatic (the app sends and records), needs a
 * confirmation and an unlock first, or is manual (a person does it and records what they saw). The
 * results are plain data, saved as JSON for Stage 12.
 *
 * Every frame goes through the engine, the scheduler and the governor like any other source.
 */
import { short } from '../dali/address.ts';
import { rgbwafCommands, tcCommands, type TxFrame } from '../dali/sequences.ts';
import type { Command } from '../dali/codec.ts';
import type { Governor } from '../safety/governor.ts';
import { WARM_MIREK, type ProfileResult, type Submit } from '../safety/profile.ts';
import type { Source, Unlock } from '../safety/types.ts';
import { colourValue } from './inventory.ts';
import { answers, ask, send } from './submit.ts';

export type CheckKind = 'auto' | 'confirm' | 'manual';
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

export interface CheckStep {
  readonly id: string;
  readonly part: 2 | 3 | 4;
  readonly title: string;
  /** What the person does or watches. */
  readonly how: string;
  readonly kind: CheckKind;
  readonly unlock?: Unlock;
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

/** Load and activate a warm colour, so this session knows the gear's colour. */
async function knownColour(ctx: CheckContext, n: number): Promise<void> {
  const facts = ctx.governor.colourFacts(n);
  if (facts === undefined) return;
  const a = short(n);
  if (facts.tc) {
    await send(ctx.submit, tcCommands(a, WARM_MIREK, true), ctx.source, 'warm colour');
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
    await send(ctx.submit, rgbwafCommands(a, mix, true), ctx.source, 'warm colour');
  }
}

export const CHECK_STEPS: readonly CheckStep[] = [
  {
    id: 'p2-device-types',
    part: 2,
    title: 'Device types',
    how: 'Reads QUERY DEVICE TYPE, and QUERY NEXT DEVICE TYPE when the answer is 255.',
    kind: 'auto',
    run: (ctx) =>
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
  },
  {
    id: 'p2-colour-features',
    part: 2,
    title: 'Colour type features',
    how: 'Settles how C2 and C5 present colour: Tc capable, xy capable, RGBWAF channel count.',
    kind: 'auto',
    run: (ctx) =>
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
  },
  {
    id: 'p2-assigned-colours',
    part: 2,
    title: 'Assigned colour for channels 0 to 5',
    how: 'QUERY ASSIGNED COLOUR with DTR0 set to each channel.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => {
        const out: Value[] = [];
        for (let ch = 0; ch < 6; ch++)
          out.push(v(await withDtr0(ctx, 'DT8_QUERY_ASSIGNED_COLOUR', n, ch)));
        return out;
      }),
  },
  {
    id: 'p2-limits',
    part: 2,
    title: 'Physical minimum, MIN LEVEL, MAX LEVEL',
    how: 'Three queries per driver.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => ({
        physicalMinimum: v(await one(ctx, 'QUERY_PHYSICAL_MINIMUM', n)),
        min: v(await one(ctx, 'QUERY_MIN_LEVEL', n)),
        max: v(await one(ctx, 'QUERY_MAX_LEVEL', n)),
      })),
  },
  {
    id: 'p2-power-levels',
    part: 2,
    title: 'POWER ON LEVEL and SYSTEM FAILURE LEVEL',
    how: 'Two queries per driver.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => ({
        powerOn: v(await one(ctx, 'QUERY_POWER_ON_LEVEL', n)),
        systemFailure: v(await one(ctx, 'QUERY_SYSTEM_FAILURE_LEVEL', n)),
      })),
  },
  {
    id: 'p2-fades',
    part: 2,
    title: 'Fade time and rate, extended fade, fast fade and its minimum',
    how: 'Four queries per driver.',
    kind: 'auto',
    run: (ctx) =>
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
  },
  {
    id: 'p2-curve-features',
    part: 2,
    title: 'Dimming curve, gear features, RGBWAF control',
    how: 'Three queries per driver. Gear features bit 0 is automatic activation.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => ({
        curve: v(await one(ctx, 'DT6_QUERY_DIMMING_CURVE', n)),
        gearFeatures: v(await one(ctx, 'DT8_QUERY_GEAR_FEATURES', n)),
        rgbwafControl: v(await one(ctx, 'DT8_QUERY_RGBWAF_CONTROL', n)),
      })),
  },
  {
    id: 'p2-tc-limits',
    part: 2,
    title: 'Colour temperature limits, all four',
    how: 'QUERY COLOUR VALUE with selectors 128 to 131, in mirek.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => ({
        coolest: v(await colourValue(ctx.submit, n, 128, true, ctx.source)),
        physicalCoolest: v(await colourValue(ctx.submit, n, 129, true, ctx.source)),
        warmest: v(await colourValue(ctx.submit, n, 130, true, ctx.source)),
        physicalWarmest: v(await colourValue(ctx.submit, n, 131, true, ctx.source)),
      })),
  },
  {
    id: 'p2-scenes-groups',
    part: 2,
    title: 'All 16 scene levels and both group bytes',
    how: 'Eighteen queries per driver.',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => {
        const scenes: Value[] = [];
        for (let k = 0; k < 16; k++) scenes.push(v(await one(ctx, 'QUERY_SCENE_LEVEL', n, k)));
        return {
          scenes,
          groups0to7: v(await one(ctx, 'QUERY_GROUPS_0_7', n)),
          groups8to15: v(await one(ctx, 'QUERY_GROUPS_8_15', n)),
        };
      }),
  },
  {
    id: 'p2-colour-as-shipped',
    part: 2,
    title: 'The colour as shipped',
    how: 'QUERY COLOUR VALUE selectors 226 (Tc) and 233 to 238 (channels).',
    kind: 'auto',
    run: (ctx) =>
      each(ctx, async (n) => {
        const channels: Value[] = [];
        for (let sel = 233; sel <= 238; sel++)
          channels.push(v(await colourValue(ctx.submit, n, sel, false, ctx.source)));
        return { tc: v(await colourValue(ctx.submit, n, 226, true, ctx.source)), channels };
      }),
  },
  {
    id: 'p2-store-tc-limit',
    part: 2,
    title: 'Whether colour temperature limits can be stored',
    how: 'On the first driver: read the coolest limit, store it one mirek warmer with STORE COLOUR TEMPERATURE Tc LIMIT, read it back, then store the original and read it again. A store that does not take shows as no change.',
    kind: 'confirm',
    unlock: 'expert',
    run: async (ctx) => {
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
  },
  {
    id: 'p2-versions',
    part: 2,
    title: 'Version numbers and memory bank 0',
    how: 'QUERY VERSION NUMBER, the DT6 and DT8 extended versions, and memory bank 0 locations 0 to 26.',
    kind: 'auto',
    run: (ctx) =>
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
  },
  {
    id: 'p3-status-report',
    part: 3,
    title: 'All 10 bytes of a reply report',
    how: 'Start the server with --trace. Run this step: it sends QUERY STATUS to the first driver. Copy the reply report line from the server output into the note. It settles byte 4 (1 or 8) and whether byte 2 echoes the sequence number.',
    kind: 'auto',
    run: async (ctx) => {
      const n = ctx.addresses[0] ?? 0;
      return { address: n, status: v(await one(ctx, 'QUERY_STATUS', n)) };
    },
  },
  {
    id: 'p3-empty-address',
    part: 3,
    title: 'A query to an empty address',
    how: 'QUERY ACTUAL LEVEL to the first address no driver holds. Records the answer and the time taken.',
    kind: 'auto',
    run: async (ctx) => {
      const n =
        Array.from({ length: 64 }, (_, i) => i).find((i) => !ctx.addresses.includes(i)) ?? 63;
      const t0 = ctx.now();
      const [r] = await answers(
        ctx.submit,
        [q('QUERY_ACTUAL_LEVEL', n)],
        ctx.source,
        'empty address',
      );
      return { address: n, answer: r ?? null, ms: Math.round(ctx.now() - t0) };
    },
  },
  {
    id: 'p3-throughput',
    part: 3,
    title: 'Throughput',
    how: 'One hundred commands, then one hundred queries, each sent when the last result arrives. The commands are DTR0 loads: the same 16-bit frame with no reply as a level command, and no light changes, so the rate guard does not slow them.',
    kind: 'auto',
    run: async (ctx) => {
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
  },
  {
    id: 'p3-send-twice-gap',
    part: 3,
    title: 'The gap between the two frames of a send-twice command',
    how: 'With a scope or a second interface sniffing the bus, send a configuration command and measure the gap. It passes at 13.5 to 14.7 ms.',
    kind: 'manual',
  },
  {
    id: 'p3-store-gear-features',
    part: 3,
    title: 'STORE GEAR FEATURES/STATUS and read back',
    how: 'On the first driver: read gear features, store it with automatic activation turned the other way, read it back, then store the original and read it again. Settles ENABLE DEVICE TYPE with send-twice commands: a store that does not take shows as no change.',
    kind: 'confirm',
    unlock: 'expert',
    run: async (ctx) => {
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
  },
  {
    id: 'p3-unplug',
    part: 3,
    title: 'Unplug the hasseb mid-session',
    how: 'Unplug the USB cable. The app should show the fault, and the tapes should do what SYSTEM FAILURE LEVEL says (stay where they are). Record what happened, then plug it back in.',
    kind: 'manual',
  },
  {
    id: 'p4-profile',
    part: 4,
    title: 'Write the safety profile to every driver and read it back',
    how: 'The same profile the app writes on connect.',
    kind: 'auto',
    run: async (ctx) => {
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
  },
  {
    id: 'p4-power-cycle',
    part: 4,
    title: 'Power-cycle the drivers',
    how: 'Switch the drivers off and on. They should stay off. Film the first second and look for any flash.',
    kind: 'manual',
  },
  {
    id: 'p4-bus-supply',
    part: 4,
    title: 'Pull the bus supply for a second',
    how: 'The level should not change.',
    kind: 'manual',
  },
  {
    id: 'p4-system-failure-fade',
    part: 4,
    title: 'SYSTEM FAILURE LEVEL with a fade',
    how: 'The app sets SYSTEM FAILURE LEVEL to the physical minimum and a 4 s fade time on the first driver. Pull the bus supply for two seconds and record whether the light steps or fades, and what it does when the bus returns. Then run "Write the safety profile" again, which restores SYSTEM FAILURE LEVEL 255; set the fade time back from the note.',
    kind: 'confirm',
    run: async (ctx) => {
      const n = ctx.addresses[0];
      if (n === undefined) return { skipped: 'No driver was found.' };
      const physMin = (await one(ctx, 'QUERY_PHYSICAL_MINIMUM', n)) ?? 1;
      const fade = await one(ctx, 'QUERY_FADE_TIME_FADE_RATE', n);
      // Fade time 6 is 4.0 s (dali.md section 7).
      await send(
        ctx.submit,
        [{ id: 'DTR0', value: 6 }, q('SET_FADE_TIME', n)],
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
  },
  {
    id: 'p4-power-on-colour',
    part: 4,
    title: 'The stored power-on colour',
    how: 'The profile stores a warm power-on colour. Power-cycle the drivers, raise the level from the app, and record the colour.',
    kind: 'manual',
  },
  {
    id: 'p4-max-below-level',
    part: 4,
    title: 'Lower MAX LEVEL below the present level',
    how: 'The app sets the first driver to arc level 200 (or the ceiling, if lower), lowers MAX LEVEL to 150, and reads the level at once and after 2 s. It then writes the safety profile again and turns the driver off.',
    kind: 'confirm',
    run: async (ctx) => {
      const n = ctx.addresses[0];
      if (n === undefined) return { skipped: 'No driver was found.' };
      const target = Math.min(200, ctx.governor.ceilingArc);
      const lowered = Math.min(150, target - 1);
      // A whole colour set this session on every driver makes the colours known, so the rate guard
      // can predict the change instead of counting it as an unknown hard step (ADR 0011).
      for (const a of ctx.addresses) await knownColour(ctx, a);
      await send(
        ctx.submit,
        [{ id: 'DAPC', address: short(n), value: target }],
        ctx.source,
        'DAPC',
      );
      await ctx.wait(2000);
      const before = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
      await send(
        ctx.submit,
        [{ id: 'DTR0', value: lowered }, q('SET_MAX_LEVEL', n)],
        ctx.source,
        'SET MAX LEVEL',
      );
      const atOnce = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
      await ctx.wait(2000);
      const after2s = await one(ctx, 'QUERY_ACTUAL_LEVEL', n);
      const profile = await ctx.applyProfile(n);
      await send(ctx.submit, [{ id: 'OFF', address: short(n) }], ctx.source, 'OFF');
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
  },
  {
    id: 'p4-panic-timing',
    part: 4,
    title: 'Panic: button, Escape twice, closing the tab',
    how: 'Try each with the tapes lit. Time each to dark, for example by filming.',
    kind: 'manual',
  },
  {
    id: 'p4-panic-in-flight',
    part: 4,
    title: 'Panic while a send-twice frame is in flight',
    how: 'The app sends a configuration command (sent twice) and panics as soon as that frame is handed to the transport. Check in the server --trace output that TERMINATE and OFF came after the configuration frame, never between its two copies. The result records whether the frame went out or was dropped. Resume afterwards.',
    kind: 'confirm',
    run: async (ctx) => {
      const n = ctx.addresses[0];
      if (n === undefined) return { skipped: 'No driver was found.' };
      const fade = await one(ctx, 'QUERY_FADE_TIME_FADE_RATE', n);
      const time = fade === undefined ? 0 : (fade >> 4) & 0x0f;
      const watch = ctx.whenStarted((f) => f.sendTwice);
      const sending = send(
        ctx.submit,
        [{ id: 'DTR0', value: time }, q('SET_FADE_TIME', n)],
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
  },
  {
    id: 'p4-stop-server',
    part: 4,
    title: 'Stop the server with Ctrl-C',
    how: 'With the tapes lit, press Ctrl-C in the server terminal. The tapes should go off.',
    kind: 'manual',
  },
];

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
