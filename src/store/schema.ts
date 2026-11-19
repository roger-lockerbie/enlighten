/**
 * What is stored and what a workspace file holds (ADR 0009, SPEC section 8). Version 1 of the
 * workspace carries the ceiling, preferences and devices. Version 2 adds scripts and the console's
 * history settings (ADR 0014). Preferences version 3 adds the visualiser's exposure, white balance
 * and false-colour view (ADR 0017). Later stages add their keys with a new version and a migration.
 */
import { DEFAULT_HISTORY, MAX_LINE } from '../console/history.ts';
import { ADAPT_MAX_K, ADAPT_MIN_K } from '../light/colour/adapt.ts';
import { EV_MAX, EV_MIN, PRESET_EV } from '../light/colour/exposure.ts';
import { DEFAULT_CEILING_ARC } from '../safety/governor.ts';
import { BUILTIN_SCRIPTS } from '../script/builtin.ts';
import { MAX_BYTES, MAX_LINES, scriptNameProblem } from '../script/parse.ts';
import { parseUnitSetup, type UnitSetup } from '../sim/settings.ts';
import {
  arrayOf,
  bool,
  custom,
  int,
  num,
  object,
  oneOf,
  opt,
  req,
  str,
  textWith,
  uniqueBy,
  utf8Bytes,
  type Result,
  type Schema,
} from './validate.ts';

/** Names are at most 60 characters (SPEC section 8). */
export const MAX_NAME = 60;

export const PAGES = [
  'playground',
  'devices',
  'monitor',
  'settings',
  'scripts',
  'visualiser',
] as const;
export type Page = (typeof PAGES)[number];

const unitSetup: Schema<UnitSetup> = custom(parseUnitSetup);

const alias = object({ address: req(int(0, 63)), alias: req(str(MAX_NAME)) });

export const DRAWER_MIN = 120;
export const DRAWER_MAX = 800;

export const HISTORY_MIN = 100;
export const HISTORY_MAX = 10_000;

export const EXPOSURES = ['night', 'evening', 'day', 'manual'] as const;
export const BALANCES = ['scene', 'daylight', 'kelvin'] as const;
export const FALSE_VIEWS = ['off', 'illuminance', 'luminance'] as const;

const preferencesV3 = object({
  ceilingArc: req(int(1, 254)),
  playgroundMode: req(oneOf('live', 'commit')),
  page: req(oneOf(...PAGES)),
  inspectorOpen: req(bool),
  drawerOpen: req(bool),
  drawerHeight: req(int(DRAWER_MIN, DRAWER_MAX)),
  reducedMotion: req(oneOf('system', 'always')),
  aliases: req(uniqueBy(arrayOf(alias, 64), (a) => a.address, 'address')),
  bench: req(object({ A: opt(unitSetup), B: opt(unitSetup) })),
  /** How many console lines history keeps. */
  historyLength: req(int(HISTORY_MIN, HISTORY_MAX)),
  /** Keep lines that start with a space out of history, as zsh's HIST_IGNORE_SPACE. */
  historyIgnoreSpace: req(bool),
  /** Show an expanded history line for Enter before it runs, as zsh's HIST_VERIFY. */
  verifyMode: req(bool),
  /** The visualiser's exposure: a preset, or the manual EV100 below (ADR 0008). */
  exposure: req(oneOf(...EXPOSURES)),
  exposureEv: req(num(EV_MIN, EV_MAX)),
  /** White balance: adapted to the scene, daylight, or the colour temperature below. */
  whiteBalance: req(oneOf(...BALANCES)),
  whiteBalanceKelvin: req(int(ADAPT_MIN_K, ADAPT_MAX_K)),
  falseColour: req(oneOf(...FALSE_VIEWS)),
});

export type Preferences = Extract<ReturnType<typeof preferencesV3>, { ok: true }>['value'];

export const PREFERENCES_VERSION = 3;

export const DEFAULT_PREFERENCES: Preferences = {
  ceilingArc: DEFAULT_CEILING_ARC,
  playgroundMode: 'live',
  page: 'playground',
  inspectorOpen: true,
  drawerOpen: false,
  drawerHeight: 220,
  reducedMotion: 'system',
  aliases: [],
  bench: {},
  historyLength: DEFAULT_HISTORY,
  historyIgnoreSpace: false,
  verifyMode: true,
  exposure: 'evening',
  exposureEv: PRESET_EV.evening,
  whiteBalance: 'scene',
  whiteBalanceKelvin: 4000,
  falseColour: 'off',
};

export function checkPreferences(x: unknown): Result<Preferences> {
  return preferencesV3(x, '');
}

// -------------------------------------------------------------------------------------------------
// Console history and scripts (ADR 0014)

export const HISTORY_VERSION = 1;

const storedLine = object({
  line: req(str(MAX_LINE)),
  at: req(int(0, Number.MAX_SAFE_INTEGER)),
});

const historyV1 = object({ lines: req(arrayOf(storedLine, HISTORY_MAX)) });

export type StoredHistory = Extract<ReturnType<typeof historyV1>, { ok: true }>['value'];

export function checkHistory(x: unknown): Result<StoredHistory> {
  return historyV1(x, '');
}

/** The most scripts the store and a workspace file hold. */
export const MAX_SCRIPTS = 100;

const scriptName = textWith((x) => {
  const bad = scriptNameProblem(x);
  if (bad !== undefined) return bad;
  if (BUILTIN_SCRIPTS.some((b) => b.name === x.toLowerCase()))
    return `"${x}" is the name of a built-in script.`;
  return undefined;
});

/** A script's text is only data: its size is checked here, and it is parsed when it runs. */
const scriptText = textWith((x) => {
  if (utf8Bytes(x) > MAX_BYTES) return `a script is at most ${String(MAX_BYTES / 1024)} kB.`;
  if (x.split(/\r\n|\n|\r/).length > MAX_LINES)
    return `a script is at most ${String(MAX_LINES)} lines.`;
  return undefined;
});

const script = object({ name: req(scriptName), text: req(scriptText) });

const scriptList = uniqueBy(arrayOf(script, MAX_SCRIPTS), (s) => s.name.toLowerCase(), 'name');

export const SCRIPTS_VERSION = 1;

const scriptsV1 = object({ scripts: req(scriptList) });

export type StoredScripts = Extract<ReturnType<typeof scriptsV1>, { ok: true }>['value'];
export type StoredScript = StoredScripts['scripts'][number];

export function checkScripts(x: unknown): Result<StoredScripts> {
  return scriptsV1(x, '');
}

// -------------------------------------------------------------------------------------------------
// The workspace file

export const WORKSPACE_FORMAT = 'enlighten-workspace';
export const WORKSPACE_VERSION = 2;

const workspaceDevice = object({
  address: req(int(0, 63)),
  alias: opt(str(MAX_NAME)),
  /** For the simulated unit at this address only (SPEC R1.6). */
  presentation: opt(oneOf('tc', 'rgbwaf')),
  settings: opt(
    custom((x) => {
      const r = parseUnitSetup({ presentation: 'tc', settings: x });
      return typeof r === 'string' ? r : r.settings;
    }),
  ),
});

const workspaceV2 = object({
  format: req(oneOf(WORKSPACE_FORMAT)),
  version: req(oneOf(2)),
  ceiling: opt(int(1, 254)),
  preferences: opt(
    object({
      playgroundMode: opt(oneOf('live', 'commit')),
      reducedMotion: opt(oneOf('system', 'always')),
      historyLength: opt(int(HISTORY_MIN, HISTORY_MAX)),
      historyIgnoreSpace: opt(bool),
      /** Read, but an import can only turn it on (SPEC section 8). */
      verifyMode: opt(bool),
    }),
  ),
  devices: opt(uniqueBy(arrayOf(workspaceDevice, 64), (d) => d.address, 'address')),
  scripts: opt(scriptList),
});

export type Workspace = Extract<ReturnType<typeof workspaceV2>, { ok: true }>['value'];

export function checkWorkspace(x: unknown): Result<Workspace> {
  return workspaceV2(x, '');
}
