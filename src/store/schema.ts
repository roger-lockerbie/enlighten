/**
 * What is stored and what a workspace file holds (ADR 0009, SPEC section 8). Version 1 of the
 * workspace carries the ceiling, preferences and devices. Later stages add their keys with a new
 * version and a migration.
 */
import { DEFAULT_CEILING_ARC } from '../safety/governor.ts';
import { parseUnitSetup, type UnitSetup } from '../sim/settings.ts';
import {
  arrayOf,
  bool,
  custom,
  int,
  object,
  oneOf,
  opt,
  req,
  str,
  uniqueBy,
  type Result,
  type Schema,
} from './validate.ts';

/** Names are at most 60 characters (SPEC section 8). */
export const MAX_NAME = 60;

export const PAGES = ['playground', 'devices', 'monitor', 'settings'] as const;
export type Page = (typeof PAGES)[number];

const unitSetup: Schema<UnitSetup> = custom(parseUnitSetup);

const alias = object({ address: req(int(0, 63)), alias: req(str(MAX_NAME)) });

export const DRAWER_MIN = 120;
export const DRAWER_MAX = 800;

const preferencesV1 = object({
  ceilingArc: req(int(1, 254)),
  playgroundMode: req(oneOf('live', 'commit')),
  page: req(oneOf(...PAGES)),
  inspectorOpen: req(bool),
  drawerOpen: req(bool),
  drawerHeight: req(int(DRAWER_MIN, DRAWER_MAX)),
  reducedMotion: req(oneOf('system', 'always')),
  aliases: req(uniqueBy(arrayOf(alias, 64), (a) => a.address, 'address')),
  bench: req(object({ A: opt(unitSetup), B: opt(unitSetup) })),
});

export type Preferences = Extract<ReturnType<typeof preferencesV1>, { ok: true }>['value'];

export const PREFERENCES_VERSION = 1;

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
};

export function checkPreferences(x: unknown): Result<Preferences> {
  return preferencesV1(x, '');
}

// -------------------------------------------------------------------------------------------------
// The workspace file

export const WORKSPACE_FORMAT = 'enlighten-workspace';
export const WORKSPACE_VERSION = 1;

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

const workspaceV1 = object({
  format: req(oneOf(WORKSPACE_FORMAT)),
  version: req(oneOf(1)),
  ceiling: opt(int(1, 254)),
  preferences: opt(
    object({
      playgroundMode: opt(oneOf('live', 'commit')),
      reducedMotion: opt(oneOf('system', 'always')),
    }),
  ),
  devices: opt(uniqueBy(arrayOf(workspaceDevice, 64), (d) => d.address, 'address')),
});

export type Workspace = Extract<ReturnType<typeof workspaceV1>, { ok: true }>['value'];

export function checkWorkspace(x: unknown): Result<Workspace> {
  return workspaceV1(x, '');
}
