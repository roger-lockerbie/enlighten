/**
 * Which driver each mount follows: the one at the mount's short address (SPEC R14.2). The light
 * comes from the active connection, so the picture follows the simulated bench in Simulator and
 * the hardware's shadow in Hardware and Both. An address with no driver has no drive, and its
 * mounts stay unlit.
 */
import type { LightView } from '../../engine/engine.ts';
import type { Drive } from '../../light/emitter.ts';

export function drivesFor(light: readonly LightView[]): Map<number, Drive> {
  const out = new Map<number, Drive>();
  for (const l of light) out.set(l.address, { terminals: l.terminals, labels: l.labels });
  return out;
}
