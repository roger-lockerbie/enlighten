/**
 * Which driver each mount follows. Stage 7's mounts name the bench units A and B (SPEC R14.1). In
 * the simulator those are the units' own names. In Hardware and Both the shadow units are named by
 * address, so the lowest address stands for A and the next for B.
 */
import type { LightView } from '../../engine/engine.ts';
import type { Drive } from '../../light/emitter.ts';

export function drivesFor(light: readonly LightView[]): Map<string, Drive> {
  const out = new Map<string, Drive>();
  const sorted = [...light].sort((a, b) => a.address - b.address);
  sorted.forEach((l, i) => {
    const drive: Drive = { terminals: l.terminals, labels: l.labels };
    out.set(l.unit, drive);
    const bench = i === 0 ? 'A' : i === 1 ? 'B' : undefined;
    if (bench !== undefined && !sorted.some((x) => x.unit === bench)) out.set(bench, drive);
  });
  return out;
}
