/**
 * Workspace version 1 to 2 (Stage 6). Version 2 only adds optional keys, scripts and the history
 * settings, so a version 1 file needs nothing but its new number.
 */
import type { Migration } from '../migrate.ts';

export const workspaceTo2: Migration = {
  to: 2,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, version: 2 }
      : data,
};
