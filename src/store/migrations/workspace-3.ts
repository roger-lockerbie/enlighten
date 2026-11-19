/**
 * Workspace version 2 to 3 (Stage 8). Version 3 only adds optional keys, the Visualiser's set-ups
 * and view settings, so a version 2 file needs nothing but its new number.
 */
import type { Migration } from '../migrate.ts';

export const workspaceTo3: Migration = {
  to: 3,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, version: 3 }
      : data,
};
