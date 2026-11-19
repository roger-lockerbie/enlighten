/**
 * One frame's numbers (ADR 0008): what each mount is giving out now, as the colour the display
 * will show. A DALI change costs only this, with no solve.
 */
import type { WhiteBalance } from './colour/adapt.ts';
import { adaptation, adaptedWhite } from './colour/adapt.ts';
import { toneFactor, whiteLuminance } from './colour/exposure.ts';
import { mapToGamut } from './colour/gamut.ts';
import type { Display, Vec3, Xy } from './colour/xyz.ts';
import { displayMatrix, encodeSrgb, mul } from './colour/xyz.ts';
import { DIFFUSERS, ripple } from './diffuser.ts';
import type { Drive, Emitted } from './emitter.ts';
import { TAPES, emitted } from './emitter.ts';
import type { Scene } from './scene.ts';

/** The most emitters one tape carries. */
export const MAX_CHANNELS = 5;

export interface MountLight {
  /** Light per metre as measured: XYZ with Y in lumens. The probe reads this. */
  readonly raw: Vec3;
  /** The same light as the display will show it: white balanced and inside the gamut. Y is unchanged. */
  readonly shown: Vec3;
  /** Each channel of the tape as shown, for the dots on the lit surface. */
  readonly channels: readonly Vec3[];
  /** True when a channel's colour is more saturated than the display can show. */
  readonly desaturated: boolean;
}

export interface Frame {
  readonly mounts: readonly MountLight[];
  /** The white the picture is balanced to. */
  readonly white: Xy;
}

export interface FrameSettings {
  readonly display: Display;
  readonly balance: WhiteBalance;
  /**
   * Light from a set-up shown beside this one. The A/B view balances both pictures to one white
   * (ADR 0008), so "adapted to the scene" adapts to the light of both together.
   */
  readonly alongside?: Vec3;
}

/** What each mount gives out per metre, from the driver at its address. */
function emissions(scene: Scene, drives: ReadonlyMap<number, Drive>): Emitted[] {
  return scene.mounts.map((m) => emitted(drives.get(m.address), m.tape, m.diffuser));
}

/** The light of a scene as a whole, XYZ with Y in lumens: each mount by its length. */
export function roomLight(scene: Scene, drives: ReadonlyMap<number, Drive>): Vec3 {
  return total(scene, emissions(scene, drives));
}

function total(scene: Scene, raw: readonly Emitted[]): Vec3 {
  let sum: Vec3 = [0, 0, 0];
  scene.mounts.forEach((m, i) => {
    const e = raw[i]?.xyz ?? [0, 0, 0];
    sum = [sum[0] + e[0] * m.length, sum[1] + e[1] * m.length, sum[2] + e[2] * m.length];
  });
  return sum;
}

/** The frame for a scene and what the driver at each mount's address is putting out. */
export function buildFrame(
  scene: Scene,
  drives: ReadonlyMap<number, Drive>,
  settings: FrameSettings,
): Frame {
  const raw = emissions(scene, drives);
  // The room's light as a whole, for "adapted to the scene".
  const own = total(scene, raw);
  const other = settings.alongside ?? [0, 0, 0];
  const white = adaptedWhite(settings.balance, [
    own[0] + other[0],
    own[1] + other[1],
    own[2] + other[2],
  ]);
  const adapt = adaptation(white);
  const mounts = raw.map((e): MountLight => {
    let desaturated = false;
    const channels = e.channels.map((c): Vec3 => {
      if (!(c[1] > 0)) return [0, 0, 0];
      const a = mul(adapt, c);
      // Adapting changes Y a little. The picture stays photometric, so put it back.
      const k = a[1] > 0 ? c[1] / a[1] : 0;
      const mapped = mapToGamut([a[0] * k, c[1], a[2] * k], settings.display);
      desaturated ||= mapped.moved;
      return mapped.xyz;
    });
    const shown = channels.reduce<Vec3>(
      (s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]],
      [0, 0, 0],
    );
    return { raw: e.xyz, shown, channels, desaturated };
  });
  return { mounts, white };
}

export interface RippleTable {
  /** The repeat of the tape's pattern, in metres. */
  readonly period: number;
  /** One row per channel of the tape, in the tape's channel order. */
  readonly rows: readonly Float32Array[];
}

/** The pattern along each mount's lit surface. It changes with the tape, cover and depth only. */
export function rippleTables(scene: Scene): RippleTable[] {
  return scene.mounts.map((m) => {
    const tape = TAPES[m.tape];
    const haze = DIFFUSERS[m.diffuser].haze;
    return {
      period: tape.period,
      rows: tape.channels.map((c) => ripple(tape.period, tape.chip, c.offset, m.depth, haze)),
    };
  });
}

/**
 * The display colour of a matte surface, as the shader computes it: illuminance as XYZ in lux,
 * to luminance, to the display's linear RGB over the exposure's white, through the tone curve and
 * the transfer curve. Each channel is 0 to 1.
 */
export function shade(illuminance: Vec3, reflectance: number, ev: number, display: Display): Vec3 {
  const k = reflectance / Math.PI / whiteLuminance(ev);
  const rgb = mul(displayMatrix(display), [
    illuminance[0] * k,
    illuminance[1] * k,
    illuminance[2] * k,
  ]);
  const r = Math.max(0, rgb[0]);
  const g = Math.max(0, rgb[1]);
  const b = Math.max(0, rgb[2]);
  const t = toneFactor(Math.max(r, g, b));
  return [encodeSrgb(r * t), encodeSrgb(g * t), encodeSrgb(b * t)];
}
