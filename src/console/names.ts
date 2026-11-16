/**
 * DALI commands by name (SPEC section 6): python-dali's class name in kebab case, built from the
 * command table's `pd` field. Every device type command also answers to its name with a `dt6-` or
 * `dt8-` prefix. Where a general command shares a name with a device type one
 * (`query-operating-mode`), the bare name is the general command. Where only device type commands
 * share it (`query-extended-version-number`, DT6 and DT8), the bare name reaches neither, and the
 * console asks for the prefix (S6-D4).
 */
import { COMMANDS, spec, type CommandSpec } from '../dali/commands.ts';

/** `general.QueryActualLevel` to `query-actual-level`, `general.SearchaddrH` to `searchaddr-h`. */
export function kebab(pd: string): string {
  const cls = pd.slice(pd.lastIndexOf('.') + 1);
  return cls
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Extra names: the spec's example name for the Tc command, kept as an alias. */
const ALIASES: Readonly<Record<string, string>> = {
  'set-temporary-colour-temperature-tc': 'DT8_SET_TEMPORARY_TC',
};

/** Bare names that only device type commands share, with the prefixed names that reach them. */
const SHARED = new Map<string, string[]>();

function build(): ReadonlyMap<string, CommandSpec> {
  const map = new Map<string, CommandSpec>();
  const byBare = new Map<string, CommandSpec[]>();
  for (const s of COMMANDS) {
    const name = kebab(s.pd);
    byBare.set(name, [...(byBare.get(name) ?? []), s]);
    if (s.deviceType !== 0) map.set(`dt${String(s.deviceType)}-${name}`, s);
  }
  for (const [name, specs] of byBare) {
    const general = specs.find((s) => s.deviceType === 0);
    const first = specs[0];
    if (general !== undefined) map.set(name, general);
    else if (specs.length === 1 && first !== undefined) map.set(name, first);
    else SHARED.set(name, specs.map((s) => `dt${String(s.deviceType)}-${name}`).sort());
  }
  for (const [name, id] of Object.entries(ALIASES)) map.set(name, spec(id));
  return map;
}

export const DALI_NAMES: ReadonlyMap<string, CommandSpec> = build();

/** For a bare name that only device type commands share, the prefixed names to choose from. */
export function sharedNames(name: string): readonly string[] | undefined {
  return SHARED.get(name.toLowerCase());
}

/** The command a name stands for, case-insensitive. */
export function byName(name: string): CommandSpec | undefined {
  return DALI_NAMES.get(name.toLowerCase());
}

/** The name the console shows for a command: the shortest name that reaches it. */
export function nameOf(id: string): string {
  let best: string | undefined;
  for (const [name, s] of DALI_NAMES) {
    if (s.id !== id || name in ALIASES) continue;
    if (best === undefined || name.length < best.length) best = name;
  }
  return best ?? id.toLowerCase();
}
