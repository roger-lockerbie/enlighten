/**
 * Preferences version 3 to 4 (Stage 9): the simulated drivers beyond the bench's two, none at first
 * (ADR 0020).
 */
import type { Migration } from '../migrate.ts';

export const preferencesTo4: Migration = {
  to: 4,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, extras: [] }
      : data,
};
