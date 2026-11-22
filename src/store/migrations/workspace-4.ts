/**
 * Workspace version 3 to 4 (Stage 9). Version 4 only adds optional keys: looks, slots, sequences,
 * effects, and a simulated driver's light type on a device. A version 3 file needs nothing but its
 * new number.
 */
import type { Migration } from '../migrate.ts';

export const workspaceTo4: Migration = {
  to: 4,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, version: 4 }
      : data,
};
