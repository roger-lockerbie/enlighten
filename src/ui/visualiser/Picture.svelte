<!--
  One picture of a hallway (SPEC R10, ADR 0017, ADR 0018): its canvas, renderer and light solver,
  and the probe over it. The Visualiser shows one, or two side by side in the A/B view.

  A geometry or material change is solved again shortly after the last change, and the old picture
  stays until the new bounced light is ready. The new picture then replaces it in one step, at most
  once a second, so editing cannot make the picture dim and brighten fast (SPEC S6.1). The first
  picture shows direct light at once. The camera moves only
  when a person moves it, by dragging, the wheel, or W, A, S and D. The arrow keys move the probe.
  The picture has no motion of its own (SPEC S6.3).
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Atlas } from '../../light/atlas.ts';
  import { layout } from '../../light/atlas.ts';
  import type { Camera } from '../../light/camera.ts';
  import { ray } from '../../light/camera.ts';
  import type { FalseScale } from '../../light/colour/falsecolour.ts';
  import type { Display } from '../../light/colour/xyz.ts';
  import type { Frame } from '../../light/frame.ts';
  import { rippleTables } from '../../light/frame.ts';
  import type { Geometry } from '../../light/geometry.ts';
  import { buildGeometry, pick } from '../../light/geometry.ts';
  import type { Reading } from '../../light/probe.ts';
  import { probe } from '../../light/probe.ts';
  import type { Response } from '../../light/response.ts';
  import type { Scene } from '../../light/scene.ts';
  import { geometryText } from '../../light/scene.ts';
  import { LightStore } from '../../store/light.ts';
  import type { Store } from '../../store/store.ts';
  import { startLightWorker } from '../../workers/policy.ts';
  import type { HallwayRenderer } from './renderer.ts';
  import type { SolveState } from './solver.ts';
  import { LightSolver } from './solver.ts';

  let {
    store,
    scene,
    camera,
    frameFor,
    ev,
    falseScale,
    name,
    testid = 'hallway',
    reading = $bindable(),
    solve = $bindable(),
    display = $bindable(),
    renderer = $bindable(),
    onturn,
    onwalk,
    onzoom,
  }: {
    store: Store;
    scene: Scene;
    camera: Camera;
    /** The frame for a scene: the picture may show the scene before an edit for a moment. */
    frameFor: (s: Scene) => Frame;
    ev: number;
    falseScale: FalseScale | undefined;
    /** What the picture is called for a screen reader: "The hallway", or "Set-up B". */
    name: string;
    testid?: string;
    reading?: Reading | undefined;
    solve?: SolveState;
    display?: Display;
    renderer?: HallwayRenderer | undefined;
    onturn: (yaw: number, pitch: number) => void;
    onwalk: (forward: number, right: number) => void;
    onzoom: (steps: number) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let problem = $state<string | undefined>(undefined);

  /** The surfaces the picture shows, and the scene they were built from. */
  interface Shown {
    readonly key: string;
    readonly scene: Scene;
    readonly geometry: Geometry;
    readonly atlas: Atlas;
  }
  let shown = $state.raw<Shown | undefined>(undefined);
  let response = $state.raw<Response | undefined>(undefined);
  /** How many times the picture has changed to new surfaces, for the e2e tests. */
  let swaps = $state(0);
  let lastSwap = Number.NEGATIVE_INFINITY;
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  /** The probe's place in the picture, 0 to 1 from the top left. */
  let at = $state({ x: 0.5, y: 0.75 });

  let solver: LightSolver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;

  const geometryKey = $derived(geometryText(scene));
  /** The scene drawn: the new one, unless its geometry is still waiting for its light. */
  const shownScene = $derived(
    shown === undefined ? undefined : shown.key === geometryKey ? scene : shown.scene,
  );
  const frame = $derived(shownScene === undefined ? undefined : frameFor(shownScene));

  /** Show new surfaces with their light, no sooner than a second after the last change. */
  function show(next: Shown, light: Response | undefined, st: SolveState): void {
    clearTimeout(swapTimer);
    // Surfaces built from the same geometry as those shown are no change to see.
    const same = shown?.key === next.key;
    const apply = (): void => {
      if (gone) return;
      if (!same) {
        swaps += 1;
        lastSwap = performance.now();
      }
      shown = next;
      response = light;
      solve = st;
    };
    const wait = lastSwap + 1000 - performance.now();
    if (same || wait <= 0) apply();
    else swapTimer = setTimeout(apply, wait);
  }

  /** A new geometry: new surfaces, solved shortly after the last change. */
  $effect(() => {
    // Read so the effect runs again when, and only when, the geometry's text changes.
    if (geometryKey === '') return;
    const s = untrack(() => scene);
    const g = buildGeometry(s);
    const a = layout(g);
    const next = new LightSolver(new LightStore(store.lightBackend()), startLightWorker, a);
    const first = solver === undefined;
    solver?.dispose();
    solver = next;
    const candidate: Shown = { key: geometryKey, scene: s, geometry: g, atlas: a };
    // The first picture shows its direct light at once. Later ones wait for their light.
    if (first) {
      shown = candidate;
      response = undefined;
    }
    clearTimeout(swapTimer);
    solve = { state: 'solving', done: 0, total: s.mounts.length };
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        void next.solve(s, (st) => {
          if (solver !== next || gone) return;
          if (st.state === 'solving') solve = st;
          else show(candidate, st.state === 'ready' ? st.response : undefined, st);
        });
      },
      first ? 0 : 250,
    );
  });

  // The surfaces, the dot patterns, and everything set on them. A change of tape or cover keeps
  // the solve: it only weights each mount's response.
  $effect(() => {
    const r = renderer;
    const sh = shown;
    const sc = shownScene;
    if (r === undefined || sh === undefined || sc === undefined) return;
    r.setScene(
      sh.geometry,
      sh.atlas,
      rippleTables(sc),
      untrack(() => camera),
    );
    untrack(() => {
      r.setResponse(response);
      if (frame !== undefined) r.setFrame(frame);
      r.setExposure(ev);
      r.setFalseColour(falseScale);
    });
  });
  $effect(() => {
    renderer?.setCamera(camera);
  });
  $effect(() => {
    renderer?.setResponse(response);
  });
  $effect(() => {
    if (frame !== undefined) renderer?.setFrame(frame);
  });
  $effect(() => {
    renderer?.setExposure(ev);
  });
  $effect(() => {
    renderer?.setFalseColour(falseScale);
  });

  $effect(() => {
    const r = renderer;
    const g = shown?.geometry;
    const resp = response;
    const f = frame;
    if (
      r === undefined ||
      g === undefined ||
      f === undefined ||
      resp?.layers.length !== f.mounts.length
    ) {
      reading = undefined;
      return;
    }
    const line = ray(camera, r.aspect, at.x * 2 - 1, 1 - at.y * 2);
    const hit = pick(g, line.origin, line.direction);
    reading =
      hit === undefined
        ? undefined
        : probe(
            g,
            resp,
            f.mounts.map((m) => m.raw),
            hit.face,
            hit.s,
            hit.t,
          );
  });

  onMount(() => {
    let observer: ResizeObserver | undefined;
    let live: HallwayRenderer | undefined;
    // three.js loads only when this page is opened (ADR 0002).
    import('./renderer.ts')
      .then(({ HallwayRenderer }) => {
        if (gone || canvas === undefined) return;
        const made = new HallwayRenderer(canvas);
        live = made;
        const el = canvas;
        const fit = (): void => {
          made.resize(el.clientWidth, el.clientHeight);
        };
        fit();
        observer = new ResizeObserver(fit);
        observer.observe(el);
        display = made.display;
        renderer = made;
      })
      .catch(() => {
        problem = 'The hallway could not be drawn. It needs WebGL 2.';
      });
    return () => {
      observer?.disconnect();
      live?.dispose();
    };
  });

  onDestroy(() => {
    gone = true;
    clearTimeout(timer);
    clearTimeout(swapTimer);
    solver?.dispose();
  });

  // Pointer: a drag turns the view, a move without a drag places the probe.
  let drag: { x: number; y: number; id: number; moved: boolean } | undefined;

  function place(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    at = {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  function down(e: PointerEvent): void {
    place(e);
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  }

  function move(e: PointerEvent): void {
    if (drag?.id !== e.pointerId || (e.buttons & 1) === 0) {
      drag = undefined;
      place(e);
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    // A press that barely moves is a click, which places the probe and turns nothing.
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    drag = { ...drag, x: e.clientX, y: e.clientY, moved: true };
    // A drag the picture's height turns the view by its field of view. A picture with no height
    // (a layout change mid-drag) turns nothing, so no turn is ever not a number (S8-L5).
    const height = el.getBoundingClientRect().height;
    if (!(height > 0)) return;
    const perPx = camera.fovY / height;
    if (Number.isFinite(dx * perPx) && Number.isFinite(dy * perPx)) onturn(dx * perPx, -dy * perPx);
  }

  function up(e: PointerEvent): void {
    if (drag?.id === e.pointerId) drag = undefined;
  }

  /**
   * The wheel moves one step for each 100 px of scroll, so a trackpad's stream of small events, and
   * the momentum after it, move the view in proportion, not one step an event. A sideways scroll
   * moves nothing (S8-L2).
   */
  let wheelSum = 0;
  function wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.deltaY === 0 || !Number.isFinite(e.deltaY)) return;
    const px =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaY * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaY * 400
          : e.deltaY;
    wheelSum += px;
    if (Math.abs(wheelSum) < 100) return;
    const steps = wheelSum < 0 ? 1 : -1;
    wheelSum = 0;
    onzoom(steps);
  }

  /** WASD walk 250 mm a press, with Shift 1 m. The arrow keys move the probe. */
  function key(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const walk: Record<string, readonly [number, number]> = {
      w: [1, 0],
      s: [-1, 0],
      a: [0, -1],
      d: [0, 1],
    };
    const w = walk[e.key.toLowerCase()];
    if (w !== undefined) {
      e.preventDefault();
      const stepM = e.shiftKey ? 1 : 0.25;
      onwalk(w[0] * stepM, w[1] * stepM);
      return;
    }
    const step = e.shiftKey ? 0.1 : 0.02;
    const nudge: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = nudge[e.key];
    if (d === undefined) return;
    e.preventDefault();
    at = {
      x: Math.min(1, Math.max(0, at.x + d[0])),
      y: Math.min(1, Math.max(0, at.y + d[1])),
    };
  }
</script>

<div class="wrap">
  <button
    type="button"
    class="frame"
    aria-label={`${name}. Move the pointer, or use the arrow keys, to place the probe. Drag to look around, use the wheel to move in, or W, A, S and D to walk.`}
    onpointermove={move}
    onpointerdown={down}
    onpointerup={up}
    onpointercancel={up}
    onwheel={wheel}
    onkeydown={key}
    data-testid={testid}
    data-swaps={swaps}
  >
    <canvas bind:this={canvas} data-testid={`${testid}-canvas`}></canvas>
    <span class="cross" style:left={`${String(at.x * 100)}%`} style:top={`${String(at.y * 100)}%`}
    ></span>
  </button>
  {#if problem !== undefined}<p class="warn" role="alert">{problem}</p>{/if}
</div>

<style>
  .wrap {
    min-width: 0;
  }
  .frame {
    display: block;
    padding: 0;
    position: relative;
    background: var(--viewport);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    aspect-ratio: 16 / 9;
    max-height: 62vh;
    width: 100%;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .cross {
    position: absolute;
    width: 13px;
    height: 13px;
    margin: -7px 0 0 -7px;
    border: 1px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px #000;
    pointer-events: none;
  }
  .warn {
    color: var(--warning, #e0b050);
  }
</style>
