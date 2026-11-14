/**
 * The Skydance DA5-L profile (`docs/research/da5-l.md`, `docs/research/dali.md` section 16).
 *
 * Every behaviour the research could not confirm is a setting here, with a default, the source of
 * that default and the hardware-day check that settles it. Nothing below is a hard-coded guess in
 * the model. These settings shape the simulated bench only (SPEC R1.6): the governor never takes
 * its assumptions about hardware from them.
 */

export type LightType = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

/**
 * How a colour light type presents colour on the bus.
 * - C2: `tc` (Tc capable) or `rgbwaf` (two linked RGBWAF channels).
 * - C5: `rgbwaf` (five channels, W warm and A cool) or `tc` (Tc beside three RGB channels).
 * C1 has no colour. C3 and C4 are RGBWAF with three and four channels.
 */
export type Presentation = 'tc' | 'rgbwaf';

/** What each of the five output terminals carries. */
export type Terminal = 'R' | 'G' | 'B' | 'W' | 'WW' | 'CW' | 'mono' | 'unused';

export interface TcLimits {
  /** Mirek. Coolest is the smallest number. */
  readonly coolest: number;
  readonly warmest: number;
  readonly physicalCoolest: number;
  readonly physicalWarmest: number;
}

export interface Da5lSettings {
  physicalMinimum: number;
  maxLowerPullsDown: boolean;
  minRaiseLifts: boolean;
  fadeFromOff: 'jump-to-min' | 'from-zero';
  commandDuringFade: 'from-present' | 'from-target';
  queryDuringFade: 'present' | 'target';
  dapcZeroWithFade: 'fade-to-min-then-off' | 'immediate';
  powerUpOutput: 'off' | 'max';
  systemFailure: 'step' | 'fade';
  busReturn: 'stays' | 'power-on-level';
  sendTwiceCancelledByOtherFrame: boolean;
  enableDeviceTypeForm: 'both' | 'once' | 'before-each';
  temporaryClearedAfterActivate: boolean;
  colourFade: 'fade-time' | 'instant';
  tcOutOfLimits: 'clamp-and-flag' | 'ignore';
  storedColour: 'temporary-or-mask' | 'temporary-or-actual';
  channelLaw: 'linear' | 'curve';
  tcMix: 'constant-total' | 'both-high-middle';
  goToLastActiveWhenOn: 'no-change' | 'go';
  upDownRounding: 'accumulate' | 'round-each';
  identify: 'flash-min-max' | 'none';
  reset: 'immediate' | 'fade';
  deviceTypes: 'dt6-and-dt8' | 'dt8-only';
  tcLimits: TcLimits;
  pwmSteps: number;
  acceptsLinearCurve: boolean;
  autoActivation: boolean;
  minFastFadeCount: number;
  rgbwafControl: number;
  c2Terminals: readonly Terminal[];
  c5Whites: 'w-warm-a-cool' | 'w-cool-a-warm';
  factoryPowerOnLevel: number;
  factorySystemFailureLevel: number;
  factoryMaxLevel: number;
  factoryChannelLevel: number;
  factoryTc: 'warmest' | 'coolest';
  tcLimitsStorable: boolean;
  resetStoredColours: 'mask' | 'kept';
  lastActiveAfterReset: 'max' | 'unchanged';
  fastFade27Ms: 675 | 700;
}

export interface SettingInfo {
  readonly key: keyof Da5lSettings;
  readonly unknown: string;
  readonly default: string;
  readonly alternative: string;
  readonly source: string;
  readonly hardwareDay: string;
}

/** Defaults until hardware day, each from the research. */
export const DEFAULT_SETTINGS: Readonly<Da5lSettings> = {
  physicalMinimum: 85,
  maxLowerPullsDown: true,
  minRaiseLifts: true,
  fadeFromOff: 'jump-to-min',
  commandDuringFade: 'from-present',
  queryDuringFade: 'present',
  dapcZeroWithFade: 'fade-to-min-then-off',
  powerUpOutput: 'off',
  systemFailure: 'step',
  busReturn: 'stays',
  sendTwiceCancelledByOtherFrame: true,
  enableDeviceTypeForm: 'both',
  temporaryClearedAfterActivate: true,
  colourFade: 'fade-time',
  tcOutOfLimits: 'clamp-and-flag',
  storedColour: 'temporary-or-mask',
  channelLaw: 'linear',
  tcMix: 'constant-total',
  goToLastActiveWhenOn: 'no-change',
  upDownRounding: 'accumulate',
  identify: 'flash-min-max',
  reset: 'immediate',
  deviceTypes: 'dt6-and-dt8',
  tcLimits: { coolest: 154, warmest: 370, physicalCoolest: 154, physicalWarmest: 370 },
  pwmSteps: 0,
  acceptsLinearCurve: true,
  autoActivation: true,
  minFastFadeCount: 0,
  rgbwafControl: 0,
  c2Terminals: ['WW', 'CW', 'WW', 'CW', 'unused'],
  c5Whites: 'w-warm-a-cool',
  factoryPowerOnLevel: 254,
  factorySystemFailureLevel: 254,
  factoryMaxLevel: 254,
  factoryChannelLevel: 254,
  factoryTc: 'warmest',
  tcLimitsStorable: true,
  resetStoredColours: 'mask',
  lastActiveAfterReset: 'max',
  fastFade27Ms: 675,
};

/** Where each default comes from and how hardware day settles it. The Devices page lists these. */
export const SETTINGS_INFO: readonly SettingInfo[] = [
  {
    key: 'physicalMinimum',
    unknown: 'The physical minimum',
    default: '85 (about 1%)',
    alternative: '1',
    source: 'da5-l.md "The 1% floor": the manual gives a range of 1 to 100%',
    hardwareDay: 'QUERY PHYSICAL MINIMUM (TEST_PLAN 10 part 2)',
  },
  {
    key: 'maxLowerPullsDown',
    unknown: 'Lowering MAX LEVEL pulls the level down',
    default: 'yes, at once',
    alternative: 'no',
    source: 'dali.md section 16; python-dali tests/fakes.py:228-230',
    hardwareDay: 'DAPC 200, SET MAX LEVEL 150, query (part 4)',
  },
  {
    key: 'minRaiseLifts',
    unknown: 'Raising MIN LEVEL lifts the level',
    default: 'yes, at once',
    alternative: 'no',
    source: 'dali.md section 16',
    hardwareDay: 'Level 100, SET MIN LEVEL 150, query (part 5)',
  },
  {
    key: 'fadeFromOff',
    unknown: 'Fade up from off',
    default: 'jump to MIN, then fade',
    alternative: 'fade from level 0',
    source: 'dali.md section 7 and 16',
    hardwareDay: 'Fade time 8 s, DAPC 254 from off, query every 100 ms (part 5)',
  },
  {
    key: 'commandDuringFade',
    unknown: 'A new command during a fade',
    default: 'stops where it is and starts from there',
    alternative: 'starts from the old target',
    source: 'dali.md section 7 and 16',
    hardwareDay: 'A second DAPC mid-fade, and DAPC 255 mid-fade (part 5)',
  },
  {
    key: 'queryDuringFade',
    unknown: 'QUERY ACTUAL LEVEL during a fade',
    default: 'the present level',
    alternative: 'the target',
    source: 'dali.md section 7 and 16',
    hardwareDay: 'The same log (part 5)',
  },
  {
    key: 'dapcZeroWithFade',
    unknown: 'DAPC 0 with a fade time',
    default: 'fade to MIN over the fade time, then off',
    alternative: 'off at once',
    source: 'dali.md section 7 (KL against the DALI-2 text)',
    hardwareDay: 'Fade time 4 s, DAPC 0, log (part 5)',
  },
  {
    key: 'powerUpOutput',
    unknown: 'Output in the first 0.6 s after power-up',
    default: 'off',
    alternative: 'MAX LEVEL',
    source: 'dali.md section 4 and 16; DiiA does not tick "first light under 500 ms"',
    hardwareDay: 'Power-cycle with POWER ON LEVEL 0 and 254, and film it (part 4)',
  },
  {
    key: 'systemFailure',
    unknown: 'System failure: step or fade',
    default: 'step',
    alternative: 'fade',
    source: 'dali.md section 4 and 16',
    hardwareDay: 'Unplug the bus supply for a second (part 4)',
  },
  {
    key: 'busReturn',
    unknown: 'What happens when the bus returns',
    default: 'the level stays',
    alternative: 'POWER ON LEVEL',
    source: 'dali.md section 16',
    hardwareDay: 'Unplug the bus supply for a second (part 4)',
  },
  {
    key: 'sendTwiceCancelledByOtherFrame',
    unknown: 'Does a frame to another address cancel a send-twice pair',
    default: 'yes',
    alternative: 'no',
    source: 'dali.md section 6 (Beckhoff TC3 [9837733003])',
    hardwareDay: 'SET MAX LEVEL, a DAPC to the other driver, SET MAX LEVEL again (part 5)',
  },
  {
    key: 'enableDeviceTypeForm',
    unknown: 'ENABLE DEVICE TYPE before each copy of a send-twice DT8 command',
    default: 'accept both forms, and log which arrived',
    alternative: 'only once, or only before each copy',
    source: 'dali.md section 6; hasseb.md section 2',
    hardwareDay: 'STORE GEAR FEATURES/STATUS through the hasseb, then read back (part 3)',
  },
  {
    key: 'temporaryClearedAfterActivate',
    unknown: 'Temporary colour after ACTIVATE',
    default: 'cleared to MASK',
    alternative: 'kept',
    source: 'dali.md section 11 and 16',
    hardwareDay: 'QUERY COLOUR VALUE selector 208 before and after (part 5)',
  },
  {
    key: 'colourFade',
    unknown: 'Colour fades',
    default: 'use the fade time',
    alternative: 'instant',
    source: 'dali.md section 11 and 16 (Ozuno, Dynalite)',
    hardwareDay: 'Fade time 4 s, ACTIVATE a new Tc, watch (part 5)',
  },
  {
    key: 'tcOutOfLimits',
    unknown: 'Tc outside the limits',
    default: 'clamped, with colour status bit 1 set',
    alternative: 'ignored',
    source: 'dali.md section 11; python-dali tests/fakes.py:442-448',
    hardwareDay: 'Request 1000 mirek, then read Tc and the status (part 5)',
  },
  {
    key: 'storedColour',
    unknown: 'What SET SCENE, SET POWER ON LEVEL and SET SYSTEM FAILURE LEVEL store as colour',
    default: 'the temporary colour if set, otherwise MASK',
    alternative: 'the temporary colour if set, otherwise the actual colour',
    source: 'dali.md section 9 and 16',
    hardwareDay: 'Store each with and without a temporary colour (part 5)',
  },
  {
    key: 'channelLaw',
    unknown: 'RGBWAF channel level against arc level',
    default: 'output = curve(arc level) x channel / 254',
    alternative: 'output = curve(arc level) x curve(channel)',
    source: 'dali.md section 11; da5-l.md unknowns',
    hardwareDay: 'Lux sweeps of one channel (part 6)',
  },
  {
    key: 'tcMix',
    unknown: 'Tc mixing law',
    default: 'linear cross-fade at constant total (placeholder)',
    alternative: 'both channels high in the middle',
    source: 'da5-l.md profile defaults',
    hardwareDay: 'Sweep Tc at a fixed level with a lux meter (part 6)',
  },
  {
    key: 'goToLastActiveWhenOn',
    unknown: 'GO TO LAST ACTIVE LEVEL when already on',
    default: 'no change',
    alternative: 'goes to the last active level',
    source: 'dali.md section 16',
    hardwareDay: 'Send it at a known level and query (part 5)',
  },
  {
    key: 'upDownRounding',
    unknown: 'UP and DOWN step rounding',
    default: 'accumulate fractions',
    alternative: 'round each command',
    source: 'dali.md section 7 and 16',
    hardwareDay: 'Twenty UPs at fade rate 15, query after each (part 5)',
  },
  {
    key: 'identify',
    unknown: 'IDENTIFY DEVICE on the DA5-L',
    default: 'flash between MIN and MAX for 10 s',
    alternative: 'nothing visible',
    source: 'dali.md section 13 and 16',
    hardwareDay: 'Only with the tapes covered, once (part 5)',
  },
  {
    key: 'reset',
    unknown: 'RESET: immediate or faded',
    default: 'immediate',
    alternative: 'faded over the old fade time',
    source: 'dali.md section 5 and 16',
    hardwareDay: 'Covered tapes, once (part 5)',
  },
  {
    key: 'deviceTypes',
    unknown: 'Device types reported in the colour light types',
    default: 'DT6 and DT8 (certified to parts 207 and 209)',
    alternative: 'DT8 only',
    source: 'da5-l.md certification and unknowns',
    hardwareDay: 'QUERY DEVICE TYPE and QUERY NEXT DEVICE TYPE (part 2)',
  },
  {
    key: 'tcLimits',
    unknown: 'Tc limits in C2',
    default: '2700 to 6500 K (370 to 154 mirek), a placeholder from tape A',
    alternative: 'any limits',
    source: 'da5-l.md profile defaults',
    hardwareDay: 'QUERY COLOUR VALUE 128 to 131 (part 2)',
  },
  {
    key: 'pwmSteps',
    unknown: 'PWM steps at FA',
    default: 'no quantisation (0)',
    alternative: 'quantise to a number of steps',
    source: 'da5-l.md "PWM steps at 16 kHz"',
    hardwareDay: 'Count distinct lux readings at the bottom of the range (part 6)',
  },
  {
    key: 'acceptsLinearCurve',
    unknown: 'Whether SELECT DIMMING CURVE to linear is honoured',
    default: 'yes (the worse case for the ceiling)',
    alternative: 'no',
    source: 'dali.md section 12; da5-l.md',
    hardwareDay: 'QUERY DIMMING CURVE (part 2). The app never sends the command.',
  },
  {
    key: 'autoActivation',
    unknown: 'Automatic activation as shipped',
    default: 'on (the reset value)',
    alternative: 'off',
    source: 'dali.md section 5 and 11',
    hardwareDay: 'QUERY GEAR FEATURES/STATUS bit 0 (part 2)',
  },
  {
    key: 'minFastFadeCount',
    unknown: 'Fast fade time support',
    default: '0 (not supported)',
    alternative: 'a minimum count from 1 to 27',
    source: 'dali.md section 12; da5-l.md unknowns',
    hardwareDay: 'QUERY MIN FAST FADE TIME (part 2)',
  },
  {
    key: 'rgbwafControl',
    unknown: 'RGBWAF control as shipped',
    default: '0 (channel control, no links)',
    alternative: 'any control byte',
    source: 'da5-l.md unknowns',
    hardwareDay: 'QUERY RGBWAF CONTROL (part 2)',
  },
  {
    key: 'c2Terminals',
    unknown: 'C2 terminal order',
    default: 'WW, CW, WW, CW, unused (from the DA4-L sibling)',
    alternative: 'any order',
    source: 'da5-l.md light types; DA4-L manual',
    hardwareDay: 'Light each white in turn and look (part 6)',
  },
  {
    key: 'c5Whites',
    unknown: 'Channel to colour mapping in C5',
    default: 'W warm, A cool (the label order R, G, B, WW, CW)',
    alternative: 'W cool, A warm',
    source: 'da5-l.md colour accounts and unknowns',
    hardwareDay: 'QUERY ASSIGNED COLOUR, then light each white in turn (part 2 and part 6)',
  },
  {
    key: 'factoryPowerOnLevel',
    unknown: 'POWER ON LEVEL as shipped',
    default: '254 (the DALI reset value)',
    alternative: 'any level, or 255 (MASK) as Lunatone ships',
    source: 'dali.md section 4 (LUNA); da5-l.md profile defaults',
    hardwareDay: 'QUERY POWER ON LEVEL before any write (part 2)',
  },
  {
    key: 'factorySystemFailureLevel',
    unknown: 'SYSTEM FAILURE LEVEL as shipped',
    default: '254 (the DALI reset value)',
    alternative: 'any level, or 255',
    source: 'dali.md section 4; da5-l.md profile defaults',
    hardwareDay: 'QUERY SYSTEM FAILURE LEVEL before any write (part 2)',
  },
  {
    key: 'factoryMaxLevel',
    unknown: 'MAX LEVEL as shipped',
    default: '254 (the DALI reset value)',
    alternative: 'any level',
    source: 'dali.md section 3; da5-l.md profile defaults',
    hardwareDay: 'QUERY MAX LEVEL before any write (part 2)',
  },
  {
    key: 'factoryChannelLevel',
    unknown: 'RGBWAF channel levels as shipped',
    default: '254 on every channel (the worst case for the ceiling)',
    alternative: 'any level',
    source: 'No source. Chosen as the worst case.',
    hardwareDay: 'QUERY COLOUR VALUE selectors 233 to 238 before any write (part 2)',
  },
  {
    key: 'factoryTc',
    unknown: 'Colour temperature as shipped',
    default: 'the physical warmest limit',
    alternative: 'the physical coolest limit',
    source: 'No source.',
    hardwareDay: 'QUERY COLOUR VALUE selector 226 before any write (part 2)',
  },
  {
    key: 'tcLimitsStorable',
    unknown: 'Whether Tc limits can be stored',
    default: 'yes',
    alternative: 'no',
    source: 'da5-l.md unknowns',
    hardwareDay:
      'STORE COLOUR TEMPERATURE Tc LIMIT, then read back (part 2, with the expert unlock)',
  },
  {
    key: 'resetStoredColours',
    unknown: 'DT8 power-on and failure colours after RESET',
    default: 'MASK',
    alternative: 'kept',
    source: 'dali.md section 5 ("manufacturer dependent")',
    hardwareDay: 'Read them back after the covered-tape RESET (part 5)',
  },
  {
    key: 'lastActiveAfterReset',
    unknown: 'The DALI-2 last active level after RESET',
    default: 'MAX LEVEL (254)',
    alternative: 'unchanged',
    source: 'dali.md section 5',
    hardwareDay: 'GO TO LAST ACTIVE LEVEL after the covered-tape RESET and OFF (part 5)',
  },
  {
    key: 'fastFade27Ms',
    unknown: 'Fast fade time at a count of 27',
    default: '675 ms (25 ms a count)',
    alternative: "700 ms (Beckhoff's table)",
    source: 'dali.md section 7 (PD gear/led.py against TC3)',
    hardwareDay: 'Only if QUERY MIN FAST FADE TIME shows support: time a fade at count 27 (part 5)',
  },
];

export interface Da5lProfile {
  readonly lightType: LightType;
  readonly presentation: Presentation;
  readonly settings: Readonly<Da5lSettings>;
}

export function da5l(
  lightType: LightType,
  presentation: Presentation = 'tc',
  settings: Partial<Da5lSettings> = {},
): Da5lProfile {
  const defaultPresentation: Presentation = lightType === 'C2' ? 'tc' : 'rgbwaf';
  return {
    lightType,
    presentation: lightType === 'C2' || lightType === 'C5' ? presentation : defaultPresentation,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Driver A on the bench: C2 with tape A. Driver B: C5 with tape B (SPEC R14.1). */
export const benchA = (s: Partial<Da5lSettings> = {}) => da5l('C2', 'tc', s);
export const benchB = (s: Partial<Da5lSettings> = {}) => da5l('C5', 'rgbwaf', s);

export interface ColourModel {
  readonly dt8: boolean;
  readonly tc: boolean;
  /** RGBWAF channels the gear reports (0 to 6). */
  readonly channels: number;
  /** QUERY ASSIGNED COLOUR for channels 0 to 5: 1 red, 2 green, 3 blue, 4 white, 5 amber, 255 none. */
  readonly assigned: readonly number[];
  /** What each terminal carries. */
  readonly terminals: readonly Terminal[];
  /** For each terminal: the RGBWAF channel it follows, 'warm' or 'cool' for Tc, 'arc' for C1, or none. */
  readonly sources: readonly (number | 'warm' | 'cool' | 'arc' | null)[];
}

export function colourModel(p: Da5lProfile): ColourModel {
  const none = [255, 255, 255, 255, 255, 255];
  switch (p.lightType) {
    case 'C1':
      return {
        dt8: false,
        tc: false,
        channels: 0,
        assigned: none,
        terminals: ['mono', 'mono', 'mono', 'mono', 'mono'],
        sources: ['arc', 'arc', 'arc', 'arc', 'arc'],
      };
    case 'C2': {
      const t = p.settings.c2Terminals;
      if (p.presentation === 'tc') {
        return {
          dt8: true,
          tc: true,
          channels: 0,
          assigned: none,
          terminals: t,
          sources: t.map((x) => (x === 'WW' ? 'warm' : x === 'CW' ? 'cool' : null)),
        };
      }
      return {
        dt8: true,
        tc: false,
        channels: 2,
        assigned: [4, 5, 255, 255, 255, 255],
        terminals: t,
        sources: t.map((x) => (x === 'WW' ? 0 : x === 'CW' ? 1 : null)),
      };
    }
    case 'C3':
      return {
        dt8: true,
        tc: false,
        channels: 3,
        assigned: [1, 2, 3, 255, 255, 255],
        terminals: ['R', 'G', 'B', 'unused', 'unused'],
        sources: [0, 1, 2, null, null],
      };
    case 'C4':
      return {
        dt8: true,
        tc: false,
        channels: 4,
        assigned: [1, 2, 3, 4, 255, 255],
        terminals: ['R', 'G', 'B', 'W', 'unused'],
        sources: [0, 1, 2, 3, null],
      };
    case 'C5':
      if (p.presentation === 'tc') {
        return {
          dt8: true,
          tc: true,
          channels: 3,
          assigned: [1, 2, 3, 255, 255, 255],
          terminals: ['R', 'G', 'B', 'WW', 'CW'],
          sources: [0, 1, 2, 'warm', 'cool'],
        };
      }
      return {
        dt8: true,
        tc: false,
        channels: 5,
        assigned: [1, 2, 3, 4, 5, 255],
        terminals: ['R', 'G', 'B', 'WW', 'CW'],
        sources: p.settings.c5Whites === 'w-warm-a-cool' ? [0, 1, 2, 3, 4] : [0, 1, 2, 4, 3],
      };
  }
}

/** The device types QUERY DEVICE TYPE reports. */
export function deviceTypes(p: Da5lProfile): number[] {
  if (p.lightType === 'C1') return [6];
  return p.settings.deviceTypes === 'dt6-and-dt8' ? [6, 8] : [8];
}

/**
 * Relative luminance weight of each terminal, for the rate guard's luminance trace (SPEC S3.1a).
 * Placeholders until the tapes are measured: Rec. 709 weights for R, G and B, 1 for whites.
 */
export const LUMINANCE_WEIGHT: Readonly<Record<Terminal, number>> = {
  R: 0.2126,
  G: 0.7152,
  B: 0.0722,
  W: 1,
  WW: 1,
  CW: 1,
  mono: 1,
  unused: 0,
};
