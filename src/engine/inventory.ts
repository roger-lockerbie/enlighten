/**
 * Discovery (SPEC D1 and D2). Stage 3's scan reads what the governor needs. This adds the rest of what
 * each driver reports, for the Devices page and the hardware check, and chooses how to drive it from
 * what it says, never from an assumption.
 */
import { short } from '../dali/address.ts';
import type { Command } from '../dali/codec.ts';
import { queryColourValueCommands } from '../dali/sequences.ts';
import type { Governor } from '../safety/governor.ts';
import type { Submit } from '../safety/profile.ts';
import type { Source } from '../safety/types.ts';
import { answers, ask, StepError } from './submit.ts';

export type DriveMode = 'tc' | 'rgbwaf' | 'level';

export interface ColourFeatures {
  readonly xy: boolean;
  readonly tc: boolean;
  readonly primaries: number;
  readonly channels: number;
}

/** Colour temperature limits in mirek. */
export interface TcLimits {
  readonly coolest?: number | undefined;
  readonly physicalCoolest?: number | undefined;
  readonly warmest?: number | undefined;
  readonly physicalWarmest?: number | undefined;
}

export interface DriverFacts {
  readonly address: number;
  readonly deviceTypes: readonly number[];
  readonly physicalMinimum?: number | undefined;
  readonly minLevel?: number | undefined;
  readonly maxLevel?: number | undefined;
  readonly powerOnLevel?: number | undefined;
  readonly systemFailureLevel?: number | undefined;
  readonly level?: number | undefined;
  readonly fadeTime?: number | undefined;
  readonly fadeRate?: number | undefined;
  readonly extendedFade?: number | undefined;
  readonly fastFade?: number | undefined;
  readonly minFastFade?: number | undefined;
  readonly groups?: number | undefined;
  readonly curve?: 'standard' | 'linear' | undefined;
  readonly colour?: ColourFeatures | undefined;
  readonly tcLimits?: TcLimits | undefined;
  /** The colour assigned to RGBWAF channels 0 to 5, as the code the gear reports. */
  readonly assigned?: readonly (number | undefined)[] | undefined;
  readonly gearFeatures?: number | undefined;
  readonly rgbwafControl?: number | undefined;
  readonly scenes?: readonly (number | undefined)[] | undefined;
  /** How the app drives this address (SPEC D2). */
  readonly drive: DriveMode;
  /** Reads that failed, in words. */
  readonly errors: readonly string[];
}

/** COLOUR TYPE FEATURES: bit 0 xy, bit 1 Tc, bits 2 to 4 primaries, bits 5 to 7 RGBWAF channels. */
export function colourFeatures(byte: number): ColourFeatures {
  return {
    xy: (byte & 1) !== 0,
    tc: (byte & 2) !== 0,
    primaries: (byte >> 2) & 7,
    channels: (byte >> 5) & 7,
  };
}

/** SPEC D2: colour temperature when the gear says it is Tc capable, RGBWAF channels otherwise. */
export function chooseDrive(
  deviceTypes: readonly number[],
  colour: ColourFeatures | undefined,
): DriveMode {
  if (!deviceTypes.includes(8) || colour === undefined) return 'level';
  if (colour.tc) return 'tc';
  if (colour.channels > 0) return 'rgbwaf';
  return 'level';
}

/** 0xFFFF and 0xFF are MASK: the gear has no value. */
const MASK16 = 0xffff;

/** Read a colour value through DTR0 (`docs/research/dali.md` section 11). 16-bit selectors join two bytes. */
export async function colourValue(
  submit: Submit,
  n: number,
  selector: number,
  sixteen: boolean,
  source: Source,
): Promise<number | undefined> {
  const r = await answers(
    submit,
    queryColourValueCommands(short(n), selector),
    source,
    `colour value ${String(selector)}`,
  );
  // Answers: QUERY ACTUAL LEVEL, QUERY COLOUR VALUE (the value, or its high byte), QUERY CONTENT DTR0.
  const hi = r[1];
  const lo = r[2];
  if (typeof hi !== 'number') return undefined;
  if (!sixteen) return hi === 0xff ? undefined : hi;
  if (typeof lo !== 'number') return undefined;
  const v = (hi << 8) | lo;
  return v === MASK16 ? undefined : v;
}

/**
 * Everything a driver reports, after `scan` has run for it. Values the scan already read come from the
 * governor; the rest are read here. A failed read is noted and the others go on.
 */
export async function readFacts(
  n: number,
  governor: Governor,
  submit: Submit,
  source: Source = 'internal',
): Promise<DriverFacts> {
  const a = short(n);
  const info = governor.addressInfo(n);
  const types = info?.deviceTypes ?? [];
  const errors: string[] = [];
  const q = (id: string, value?: number): Command =>
    value === undefined ? { id, address: a } : { id, address: a, value };
  const read = async <T>(what: string, f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof StepError)) throw e;
      errors.push(`${what}: ${e.message}`);
      return undefined;
    }
  };

  const powerOnLevel = await read('POWER ON LEVEL', () =>
    ask(submit, [q('QUERY_POWER_ON_LEVEL')], source, 'power on level'),
  );
  const systemFailureLevel = await read('SYSTEM FAILURE LEVEL', () =>
    ask(submit, [q('QUERY_SYSTEM_FAILURE_LEVEL')], source, 'system failure level'),
  );
  let minFastFade: number | undefined;
  if (types.includes(6)) {
    minFastFade = await read('MIN FAST FADE TIME', () =>
      ask(submit, [q('DT6_QUERY_MIN_FAST_FADE_TIME')], source, 'min fast fade time'),
    );
  }

  let colour: ColourFeatures | undefined;
  let tcLimits: TcLimits | undefined;
  let assigned: (number | undefined)[] | undefined;
  let gearFeatures: number | undefined;
  let rgbwafControl: number | undefined;
  if (types.includes(8)) {
    const byte = await read('COLOUR TYPE FEATURES', () =>
      ask(submit, [q('DT8_QUERY_COLOUR_TYPE_FEATURES')], source, 'colour type features'),
    );
    colour = byte === undefined ? undefined : colourFeatures(byte);
    gearFeatures = await read('GEAR FEATURES', () =>
      ask(submit, [q('DT8_QUERY_GEAR_FEATURES')], source, 'gear features'),
    );
    if (colour?.tc === true) {
      const lim = async (sel: number) =>
        read(`Tc limit ${String(sel)}`, () => colourValue(submit, n, sel, true, source));
      tcLimits = {
        coolest: await lim(128),
        physicalCoolest: await lim(129),
        warmest: await lim(130),
        physicalWarmest: await lim(131),
      };
    }
    if (colour !== undefined && colour.channels > 0) {
      rgbwafControl = await read('RGBWAF CONTROL', () =>
        ask(submit, [q('DT8_QUERY_RGBWAF_CONTROL')], source, 'RGBWAF control'),
      );
      assigned = [];
      for (let ch = 0; ch < 6; ch++) {
        assigned.push(
          await read(`assigned colour ${String(ch)}`, () =>
            ask(
              submit,
              [{ id: 'DTR0', value: ch }, q('DT8_QUERY_ASSIGNED_COLOUR')],
              source,
              'assigned colour',
            ),
          ),
        );
      }
    }
  }

  const after = governor.addressInfo(n);
  return {
    address: n,
    deviceTypes: types,
    physicalMinimum: after?.physicalMinimum,
    minLevel: after?.minLevel,
    maxLevel: after?.maxLevel,
    powerOnLevel,
    systemFailureLevel,
    level: after?.level,
    fadeTime: after?.fadeTime,
    fadeRate: after?.fadeRate,
    extendedFade: after?.extendedFade,
    fastFade: after?.fastFade,
    minFastFade,
    groups: after?.groups,
    curve: after?.linearCurve === undefined ? undefined : after.linearCurve ? 'linear' : 'standard',
    colour,
    tcLimits,
    assigned,
    gearFeatures,
    rgbwafControl,
    scenes: after?.scenes ? [...after.scenes] : undefined,
    drive: chooseDrive(types, colour),
    errors,
  };
}
