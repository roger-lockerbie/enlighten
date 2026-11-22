/**
 * The migrations for each kind of record, one file per step from version 2 on, each tested against a
 * fixture of the older shape.
 */
import type { Migration } from '../migrate.ts';
import { preferencesTo2 } from './preferences-2.ts';
import { preferencesTo3 } from './preferences-3.ts';
import { preferencesTo4 } from './preferences-4.ts';
import { workspaceTo2 } from './workspace-2.ts';
import { workspaceTo3 } from './workspace-3.ts';

export const PREFERENCES_MIGRATIONS: readonly Migration[] = [
  preferencesTo2,
  preferencesTo3,
  preferencesTo4,
];
export const WORKSPACE_MIGRATIONS: readonly Migration[] = [workspaceTo2, workspaceTo3];
/** History and scripts start at version 1. */
export const HISTORY_MIGRATIONS: readonly Migration[] = [];
export const SCRIPTS_MIGRATIONS: readonly Migration[] = [];
