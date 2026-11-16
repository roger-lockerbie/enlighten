/**
 * DALI commands by name (SPEC section 6): python-dali's class name in kebab case, built from the
 * command table's `pd` field. Two names are shared by a general command and a device type one
 * (`query-operating-mode`, `query-extended-version-number`): the bare name is the general command,
 * and `dt6-` or `dt8-` names the other. Every device type command also answers to its prefixed name.
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

function build(): ReadonlyMap<string, CommandSpec> {
  const map = new Map<string, CommandSpec>();
  // General commands first, so a shared name goes to the general command.
  const ordered = [...COMMANDS].sort((a, b) => a.deviceType - b.deviceType);
  for (const s of ordered) {
    const name = kebab(s.pd);
    if (!map.has(name)) map.set(name, s);
    if (s.deviceType !== 0) map.set(`dt${String(s.deviceType)}-${name}`, s);
  }
  for (const [name, id] of Object.entries(ALIASES)) map.set(name, spec(id));
  return map;
}

export const DALI_NAMES: ReadonlyMap<string, CommandSpec> = build();

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
