/**
 * Preferences version 2 to 3 (Stage 7): the visualiser's exposure, white balance and false-colour
 * view, at their defaults (ADR 0017).
 */
import type { Migration } from '../migrate.ts';

export const preferencesTo3: Migration = {
  to: 3,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? {
          ...data,
          exposure: 'evening',
          exposureEv: 4,
          whiteBalance: 'scene',
          whiteBalanceKelvin: 4000,
          falseColour: 'off',
        }
      : data,
};
