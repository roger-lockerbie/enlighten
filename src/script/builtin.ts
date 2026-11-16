/**
 * Scripts that ship with the app (SPEC R9.3). `first-light` follows `tools/first_light.py` step for
 * step. Unlike the Python, every level goes through the governor, so `level … 254` is held to the
 * ceiling, and the colour mixes are held to it as well (SPEC R6.6).
 */

export interface BuiltinScript {
  readonly name: string;
  readonly text: string;
}

const FIRST_LIGHT = `# First light for the bench's two Skydance DA5-L drivers (tools/first_light.py).
# Before running it: DA5-L A at light type C2, PWM FA, address 00; DA5-L B at
# light type C5, PWM FA, address 01. Every level here is held to the ceiling.

level all 254
pause "1. Both DALI tapes should be on, at the ceiling."
off all
pause "2. Both should be off."

level 0 254
pause "3. Only tape A (tunable white) should be on. If tape B lit instead, the addresses are swapped."
off 0
level 1 254
pause "4. Only tape B (RGB+CCT) should be on."
off 1

level 0 254
tc 0 2700K
pause "5. Tape A warm white (about 2700 K)."
tc 0 6500K
pause "6. Tape A cool white (about 6500 K). If 5 looked cool and 6 warm, WW and CW are swapped."
off 0

level 1 254
rgb 1 254 0 0
pause "7. Tape B red only."
rgb 1 0 254 0
pause "7. Tape B green only."
rgb 1 0 0 254
pause "7. Tape B blue only."
rgb 1 0 0 0 w 254
pause "7. Tape B first white channel only."
rgb 1 0 0 0 a 254
pause "7. Tape B second white channel only."
off 1
echo "Done. Both tapes off."
`;

export const BUILTIN_SCRIPTS: readonly BuiltinScript[] = [
  { name: 'first-light', text: FIRST_LIGHT },
];

export function builtin(name: string): BuiltinScript | undefined {
  return BUILTIN_SCRIPTS.find((s) => s.name === name.toLowerCase());
}
