/**
 * The migrations for each kind of record, one file per step from version 2 on, each tested against a
 * fixture of the older shape. Version 1 is the first, so both lists are empty.
 */
import type { Migration } from '../migrate.ts';

export const PREFERENCES_MIGRATIONS: readonly Migration[] = [];
export const WORKSPACE_MIGRATIONS: readonly Migration[] = [];
