/**
 * What the planner needs to know about each driver, from what the scan read and what the light is
 * doing now. The page and the worker both build it from the same snapshot fields, so a preview and
 * a run plan the same rows.
 */
import type { Driver } from '../design/plan.ts';
import type { LookColour } from '../design/look.ts';
import type { Channels, DeviceView, LightView } from './engine.ts';

export function driversFrom(devices: readonly DeviceView[], light: readonly LightView[]): Driver[] {
  const out: Driver[] = [];
  for (const d of devices) {
    const f = d.facts;
    // A driver that is not verified or not read yet takes no part: the governor would refuse it.
    if (f === undefined || !d.verified) continue;
    const l = light.find((x) => x.address === d.address);
    const colour: LookColour =
      l === undefined
        ? { kind: 'none' }
        : f.drive === 'tc' && l.mirek > 0
          ? { kind: 'tc', mirek: Math.round(l.mirek) }
          : f.drive === 'rgbwaf'
            ? {
                kind: 'rgbwaf',
                channels: l.channels.map((v) => Math.round(v)) as unknown as Channels,
              }
            : { kind: 'none' };
    out.push({
      address: d.address,
      drive: f.drive,
      groups: d.groups ?? f.groups ?? 0,
      minArc: f.minLevel ?? f.physicalMinimum ?? 1,
      auto: ((f.gearFeatures ?? 0) & 1) === 1,
      arc: Math.round(l?.target ?? 0),
      colour,
    });
  }
  return out;
}
