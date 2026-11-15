/**
 * Which simulator profile settings a person can change on the Devices page, and the values each may
 * take (SPEC R1.6). These shape the simulated bench only. Every value is checked here, whether it
 * comes from the page, from IndexedDB or from a workspace file.
 */
import {
  da5l,
  DEFAULT_SETTINGS,
  type Da5lProfile,
  type Da5lSettings,
  type Presentation,
} from './profile.ts';

export type SettingEdit =
  | { readonly kind: 'choice'; readonly values: readonly (string | number | boolean)[] }
  | { readonly kind: 'range'; readonly min: number; readonly max: number }
  /** Shown with its source, but not changed from the page in this version. */
  | { readonly kind: 'fixed' };

const yesNo = { kind: 'choice', values: [true, false] } as const;
const choice = (...values: readonly (string | number)[]): SettingEdit => ({
  kind: 'choice',
  values,
});
const range = (min: number, max: number): SettingEdit => ({ kind: 'range', min, max });

/** One entry per setting. The first value of a choice is the researched default. */
export const SETTING_EDIT: Readonly<Record<keyof Da5lSettings, SettingEdit>> = {
  physicalMinimum: range(1, 254),
  maxLowerPullsDown: yesNo,
  minRaiseLifts: yesNo,
  fadeFromOff: choice('jump-to-min', 'from-zero'),
  commandDuringFade: choice('from-present', 'from-target'),
  queryDuringFade: choice('present', 'target'),
  dapcZeroWithFade: choice('fade-to-min-then-off', 'immediate'),
  powerUpOutput: choice('off', 'max'),
  systemFailure: choice('step', 'fade'),
  busReturn: choice('stays', 'power-on-level'),
  sendTwiceCancelledByOtherFrame: yesNo,
  enableDeviceTypeForm: choice('both', 'once', 'before-each'),
  temporaryClearedAfterActivate: yesNo,
  colourFade: choice('fade-time', 'instant'),
  tcOutOfLimits: choice('clamp-and-flag', 'ignore'),
  storedColour: choice('temporary-or-mask', 'temporary-or-actual'),
  channelLaw: choice('linear', 'curve'),
  tcMix: choice('constant-total', 'both-high-middle'),
  goToLastActiveWhenOn: choice('no-change', 'go'),
  upDownRounding: choice('accumulate', 'round-each'),
  identify: choice('flash-min-max', 'none'),
  reset: choice('immediate', 'fade'),
  deviceTypes: choice('dt6-and-dt8', 'dt8-only'),
  tcLimits: { kind: 'fixed' },
  pwmSteps: range(0, 65_535),
  acceptsLinearCurve: yesNo,
  autoActivation: yesNo,
  minFastFadeCount: range(0, 27),
  rgbwafControl: range(0, 255),
  c2Terminals: { kind: 'fixed' },
  c5Whites: choice('w-warm-a-cool', 'w-cool-a-warm'),
  factoryPowerOnLevel: range(0, 255),
  factorySystemFailureLevel: range(0, 255),
  factoryMaxLevel: range(1, 254),
  factoryChannelLevel: range(0, 254),
  factoryTc: choice('warmest', 'coolest'),
  tcLimitsStorable: yesNo,
  resetStoredColours: choice('mask', 'kept'),
  lastActiveAfterReset: choice('max', 'unchanged'),
  fastFade27Ms: choice(675, 700),
};

export const PRESENTATIONS: readonly Presentation[] = ['tc', 'rgbwaf'];

/** A simulated unit's set-up: how it presents colour, and the settings that differ from defaults. */
export interface UnitSetup {
  readonly presentation: Presentation;
  readonly settings: Readonly<Partial<Da5lSettings>>;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether one value is allowed for one setting. */
export function settingAllowed(key: string, value: unknown): boolean {
  if (!own(SETTING_EDIT, key)) return false;
  const edit = SETTING_EDIT[key as keyof Da5lSettings];
  switch (edit.kind) {
    case 'choice':
      return edit.values.some((v) => v === value);
    case 'range':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= edit.min &&
        value <= edit.max
      );
    case 'fixed':
      return false;
  }
}

/**
 * Check settings from anywhere: a plain object whose keys are editable settings and whose values are
 * allowed. Returns a fresh object with only the values that differ from the defaults, or a reason.
 */
export function parseSettings(input: unknown): Partial<Da5lSettings> | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return 'Settings are an object.';
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const value: unknown = (input as Record<string, unknown>)[key];
    if (!settingAllowed(key, value)) return `The setting ${key.slice(0, 40)} has no such value.`;
    if (DEFAULT_SETTINGS[key as keyof Da5lSettings] !== value) out[key] = value;
  }
  // Gear built with its factory MAX LEVEL under its physical minimum has no level it can hold.
  const min = (out['physicalMinimum'] as number | undefined) ?? DEFAULT_SETTINGS.physicalMinimum;
  const max = (out['factoryMaxLevel'] as number | undefined) ?? DEFAULT_SETTINGS.factoryMaxLevel;
  if (max < min) return 'The factory MAX LEVEL is below the physical minimum.';
  return out;
}

/** Check a unit set-up from anywhere. */
export function parseUnitSetup(input: unknown): UnitSetup | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return 'A unit set-up is an object.';
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (k !== 'presentation' && k !== 'settings') return `Unknown key ${k.slice(0, 40)}.`;
  const presentation = o['presentation'];
  if (presentation !== 'tc' && presentation !== 'rgbwaf') return 'A presentation is tc or rgbwaf.';
  const settings = parseSettings(o['settings'] ?? {});
  if (typeof settings === 'string') return settings;
  return { presentation, settings };
}

/** The bench's two units (SPEC R14.1): A is a DA5-L in C2, B a DA5-L in C5. */
export type BenchUnit = 'A' | 'B';

export const DEFAULT_SETUP: Readonly<Record<BenchUnit, UnitSetup>> = {
  A: { presentation: 'tc', settings: {} },
  B: { presentation: 'rgbwaf', settings: {} },
};

/**
 * A bench set-up the session can start with: a unit whose physical minimum is above the starting
 * ceiling falls back to its default set-up, since nothing may raise the ceiling to suit it.
 */
export function fitBench(
  bench: Partial<Record<BenchUnit, UnitSetup>>,
  ceiling: number,
): Record<BenchUnit, UnitSetup> {
  const fit = (u: BenchUnit): UnitSetup => {
    const s = bench[u] ?? DEFAULT_SETUP[u];
    return (s.settings.physicalMinimum ?? DEFAULT_SETTINGS.physicalMinimum) > ceiling
      ? DEFAULT_SETUP[u]
      : s;
  };
  return { A: fit('A'), B: fit('B') };
}

/** The profile a bench unit is built from, for a set-up. */
export function unitProfile(unit: BenchUnit, setup: UnitSetup): Da5lProfile {
  return da5l(unit === 'A' ? 'C2' : 'C5', setup.presentation, setup.settings);
}
