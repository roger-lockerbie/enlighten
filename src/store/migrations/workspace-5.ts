/**
 * Workspace version 4 to 5 (Stage 10). Version 5 only adds one optional key, `plates`: the switch
 * plates and their mappings. A version 4 file needs nothing but its new number.
 */
import type { Migration } from '../migrate.ts';

export const workspaceTo5: Migration = {
  to: 5,
  run: (data) =>
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? { ...data, version: 5 }
      : data,
};
