/**
 * The view of the hallway, as plain numbers: where the eye is, what it looks at, and the ray
 * through any point of the picture. The renderer builds its camera from the same numbers, so the
 * probe and the picture agree on what is under the pointer.
 *
 * A person chooses a view (SPEC R15.2): walking at eye level, orbiting the middle of the
 * hallway, or close on one mount to judge its dots. Every view keeps the eye inside the room,
 * because the room's faces are drawn from inside only. A view moves only when a person moves it.
 */
import type { Mount, Scene, Side } from './scene.ts';
import { span } from './scene.ts';
import type { V3 } from './vec.ts';
import { add, cross, dot, len, mulS, sub } from './vec.ts';

export interface Camera {
  readonly position: V3;
  readonly target: V3;
  /** The vertical field of view, in degrees. */
  readonly fovY: number;
  /** The nearest distance drawn, in metres. */
  readonly near: number;
}

const FOV = 62;
const NEAR = 0.02;

/** The Stage 7 view: standing just inside one end, at eye level, looking down the hallway. */
export function defaultCamera(scene: Scene): Camera {
  return {
    position: [0.35, eyeHeight(scene), scene.width / 2],
    target: [scene.length, 0.9, scene.width / 2],
    fovY: FOV,
    near: NEAR,
  };
}

/** Eye level, held 300 mm below the ceiling. */
export const eyeHeight = (scene: Scene): number => Math.min(1.6, scene.height - 0.3);

/** How close the eye comes to a surface, in metres. */
export const MARGIN = 0.15;
/** How close the close-up comes to a surface. */
const CLOSE_MARGIN = 0.01;

/** Hold a point inside the room, `margin` from every face. */
export function keepInside(scene: Scene, p: V3, margin = MARGIN): V3 {
  const clamp = (v: number, hi: number): number => Math.min(hi - margin, Math.max(margin, v));
  return [clamp(p[0], scene.length), clamp(p[1], scene.height), clamp(p[2], scene.width)];
}

// Views

/** Walking: where you stand along and across the hallway, and where you look, in degrees. */
export interface WalkView {
  readonly mode: 'walk';
  readonly x: number;
  readonly z: number;
  /** 0 looks down the hallway, 90 at the right wall, -90 at the left. */
  readonly yaw: number;
  /** Up is positive. */
  readonly pitch: number;
}

/** Orbiting the middle of the hallway, from a direction and a distance. */
export interface OrbitView {
  readonly mode: 'orbit';
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
}

/** Close on one mount, to judge its dots (SPEC R15.1). */
export interface CloseView {
  readonly mode: 'close';
  readonly mount: string;
}

export type View = WalkView | OrbitView | CloseView;

export const PITCH_LIMIT = 80;
export const ORBIT_DISTANCE = { min: 0.3, max: 12 } as const;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The way a yaw and pitch look. */
function direction(yaw: number, pitch: number): V3 {
  const p = rad(pitch);
  const y = rad(yaw);
  return [Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y)];
}

/** Yaw into -180 to 180, pitch into its limits. */
function tidy<T extends { yaw: number; pitch: number }>(v: T): T {
  const yaw = ((((v.yaw + 180) % 360) + 360) % 360) - 180;
  return { ...v, yaw, pitch: Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, v.pitch)) };
}

/** Down the hallway from just inside the near end: the Stage 7 view, as a walk. */
export function downHall(scene: Scene): WalkView {
  const eye = eyeHeight(scene);
  return {
    mode: 'walk',
    x: 0.35,
    z: scene.width / 2,
    yaw: 0,
    pitch: deg(Math.atan2(0.9 - eye, scene.length - 0.35)),
  };
}

/** Halfway along, at the far side, looking at one wall from its skirting to above eye level. */
export function atWall(scene: Scene, side: Side): WalkView {
  return {
    mode: 'walk',
    x: scene.length / 2,
    z: side === 'left' ? scene.width - MARGIN : MARGIN,
    yaw: side === 'left' ? -90 : 90,
    pitch: -20,
  };
}

export function defaultOrbit(): OrbitView {
  return { mode: 'orbit', yaw: -30, pitch: -30, distance: 2.5 };
}

/** The point an orbit turns about: the middle of the hallway. */
export const orbitCentre = (scene: Scene): V3 => [
  scene.length / 2,
  scene.height / 2,
  scene.width / 2,
];

/** A walk held inside the room, with its angles tidied. */
export function fitWalk(scene: Scene, v: WalkView): WalkView {
  const p = keepInside(scene, [v.x, eyeHeight(scene), v.z]);
  return tidy({ ...v, x: p[0], z: p[2] });
}

/** The camera for a view of a scene. A close view of a mount that is not there looks down the hallway. */
export function cameraFor(scene: Scene, view: View): Camera {
  switch (view.mode) {
    case 'walk': {
      const v = fitWalk(scene, view);
      const position: V3 = [v.x, eyeHeight(scene), v.z];
      return { position, target: add(position, direction(v.yaw, v.pitch)), fovY: FOV, near: NEAR };
    }
    case 'orbit': {
      const v = tidy(view);
      const distance = Math.min(ORBIT_DISTANCE.max, Math.max(ORBIT_DISTANCE.min, v.distance));
      const centre = orbitCentre(scene);
      const position = keepInside(scene, sub(centre, mulS(direction(v.yaw, v.pitch), distance)));
      return { position, target: centre, fovY: FOV, near: NEAR };
    }
    case 'close': {
      const m = scene.mounts.find((x) => x.id === view.mount);
      return m === undefined ? cameraFor(scene, downHall(scene)) : closeOn(scene, m);
    }
  }
}

/** Where a mount's lit surface is, at the middle of its run, and the way it faces. */
export function litCentre(scene: Scene, m: Mount): { readonly point: V3; readonly normal: V3 } {
  const zw = m.side === 'left' ? 0 : scene.width;
  const into = m.side === 'left' ? 1 : -1;
  const x = m.start + m.length / 2;
  if (m.kind === 'channel') return { point: [x, m.height, zw], normal: [0, 0, into] };
  const sp = span(m);
  const up = m.kind === 'reveal' && m.facing === 'up';
  return {
    point: [x, up ? sp.y0 : sp.y1, zw - into * m.setback],
    normal: [0, up ? 1 : -1, 0],
  };
}

/**
 * Close to the lit surface with a narrow field of view. A flush channel is seen from 150 mm in
 * front. A tape in a slot or reveal is seen at a slant from 300 mm out and 200 mm to the side its
 * light goes, as a person would see it. A skirting slot's light goes to the floor, where no eye
 * can be, so it is seen from above instead, with its lip in the way, as it would be.
 */
function closeOn(scene: Scene, m: Mount): Camera {
  const { point, normal } = litCentre(scene, m);
  const into: V3 = [0, 0, m.side === 'left' ? 1 : -1];
  let position: V3;
  if (m.kind === 'channel') {
    position = add(point, add(mulS(into, 0.15), [-0.05, 0, 0]));
  } else {
    const side = point[1] + normal[1] * 0.2;
    const lift = side > MARGIN && side < scene.height - MARGIN ? 0.2 : -0.2;
    position = add(point, add(mulS(into, 0.3), add(mulS(normal, lift), [-0.05, 0, 0])));
  }
  return {
    position: keepInside(scene, position, CLOSE_MARGIN),
    target: point,
    fovY: 30,
    near: 0.005,
  };
}

// Moving a view

/** Walk forward and to the right, in metres, along the floor. */
export function walkBy(scene: Scene, v: WalkView, forward: number, right: number): WalkView {
  const y = rad(v.yaw);
  return fitWalk(scene, {
    ...v,
    x: v.x + forward * Math.cos(y) - right * Math.sin(y),
    z: v.z + forward * Math.sin(y) + right * Math.cos(y),
  });
}

/** Turn a walk or an orbit by degrees. A close view does not turn. */
export function turnBy<V extends View>(v: V, yaw: number, pitch: number): V {
  if (v.mode === 'close') return v;
  return tidy({ ...v, yaw: v.yaw + yaw, pitch: v.pitch + pitch });
}

/** Move in by steps: an orbit comes closer, a walk steps forward 250 mm a step. */
export function zoomBy<V extends View>(scene: Scene, v: V, steps: number): V {
  if (v.mode === 'orbit') {
    const distance = v.distance * Math.pow(0.87, steps);
    return {
      ...v,
      distance: Math.min(ORBIT_DISTANCE.max, Math.max(ORBIT_DISTANCE.min, distance)),
    };
  }
  if (v.mode === 'walk') return walkBy(scene, v, 0.25 * steps, 0) as V;
  return v;
}

/** Check an untrusted value as a view. */
export function parseView(v: unknown): View | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  if (Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  const n = (x: unknown, lo: number, hi: number): number | undefined =>
    typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x + 0 : undefined;
  switch (o['mode']) {
    case 'walk': {
      if (keys !== 'mode,pitch,x,yaw,z') return undefined;
      const x = n(o['x'], 0, 12);
      const z = n(o['z'], 0, 1.5);
      const yaw = n(o['yaw'], -180, 180);
      const pitch = n(o['pitch'], -PITCH_LIMIT, PITCH_LIMIT);
      if (x === undefined || z === undefined || yaw === undefined || pitch === undefined) {
        return undefined;
      }
      return { mode: 'walk', x, z, yaw, pitch };
    }
    case 'orbit': {
      if (keys !== 'distance,mode,pitch,yaw') return undefined;
      const yaw = n(o['yaw'], -180, 180);
      const pitch = n(o['pitch'], -PITCH_LIMIT, PITCH_LIMIT);
      const distance = n(o['distance'], ORBIT_DISTANCE.min, ORBIT_DISTANCE.max);
      if (yaw === undefined || pitch === undefined || distance === undefined) return undefined;
      return { mode: 'orbit', yaw, pitch, distance };
    }
    case 'close': {
      const mount = o['mount'];
      if (keys !== 'mode,mount' || typeof mount !== 'string' || !/^[a-z0-9-]{1,16}$/.test(mount)) {
        return undefined;
      }
      return { mode: 'close', mount };
    }
    default:
      return undefined;
  }
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
