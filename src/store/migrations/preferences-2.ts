/**
 * Preferences version 1 to 2 (Stage 6): the console's history length, the leading-space rule and
 * verify mode, at their defaults (ADR 0014).
 */
import type { Migration } from '../migrate.ts';

export const preferencesTo2: Migration = {
  to: 2,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, historyLength: 1000, historyIgnoreSpace: false, verifyMode: true }
      : data,
};
