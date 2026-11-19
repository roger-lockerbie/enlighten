/**
 * The view of the hallway, as plain numbers: where the eye is, what it looks at, and the ray
 * through any point of the picture. The renderer builds its camera from the same numbers, so the
 * probe and the picture agree on what is under the pointer.
 */
import type { Scene } from './scene.ts';
import type { V3 } from './vec.ts';
import { cross, dot, len, sub } from './vec.ts';

export interface Camera {
  readonly position: V3;
  readonly target: V3;
  /** The vertical field of view, in degrees. */
  readonly fovY: number;
}

/** The Stage 7 view: standing just inside one end, at eye level, looking down the hallway. */
export function defaultCamera(scene: Scene): Camera {
  return {
    position: [0.35, Math.min(1.6, scene.height - 0.3), scene.width / 2],
    target: [scene.length, 0.9, scene.width / 2],
    fovY: 62,
  };
}

const unit = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The ray from the eye through a point of the picture. `x` and `y` run from -1 to 1 across the
 * picture, with y up, and `aspect` is its width over its height.
 */
export function ray(
  camera: Camera,
  aspect: number,
  x: number,
  y: number,
): { readonly origin: V3; readonly direction: V3 } {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const h = Math.tan((camera.fovY * Math.PI) / 360);
  const w = h * aspect;
  const d: V3 = [
    forward[0] + x * w * right[0] + y * h * up[0],
    forward[1] + x * w * right[1] + y * h * up[1],
    forward[2] + x * w * right[2] + y * h * up[2],
  ];
  return { origin: camera.position, direction: unit(d) };
}

/** Where a point in the room falls in the picture, -1 to 1 each way, or nothing if it is behind the eye. */
export function project(
  camera: Camera,
  aspect: number,
  point: V3,
): { readonly x: number; readonly y: number } | undefined {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const rel = sub(point, camera.position);
  const depth = dot(rel, forward);
  if (!(depth > 1e-9)) return undefined;
  const h = Math.tan((camera.fovY * Math.PI) / 360);
  return { x: dot(rel, right) / (depth * h * aspect), y: dot(rel, up) / (depth * h) };
}
