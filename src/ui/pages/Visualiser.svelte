<!--
  The Visualiser (SPEC R10, ADR 0008 and ADR 0017): the hallway as the light engine predicts it.
  Stage 7 shows one fixed hallway from one fixed camera, with the engine's controls: exposure, white
  balance, false colour and the probe. Stage 8 adds the hallway and mount editors and the cameras.

  The picture follows the simulator's output, which the rate guard already limits, and draws only
  when that changes. It has no motion of its own (SPEC S6.3).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { defaultCamera, ray } from '../../light/camera.ts';
  import { PRESET_EV, clampEv, whiteLuminance } from '../../light/colour/exposure.ts';
  import type { FalseScale } from '../../light/colour/falsecolour.ts';
  import { paletteAt, ticks } from '../../light/colour/falsecolour.ts';
  import { cct } from '../../light/colour/locus.ts';
  import type { Display } from '../../light/colour/xyz.ts';
  import { DIFFUSERS } from '../../light/diffuser.ts';
  import { TAPES } from '../../light/emitter.ts';
  import { buildFrame, rippleTables } from '../../light/frame.ts';
  import { buildGeometry, pick } from '../../light/geometry.ts';
  import { layout } from '../../light/atlas.ts';
  import type { Reading } from '../../light/probe.ts';
  import { probe } from '../../light/probe.ts';
  import { defaultScene, sixMountScene } from '../../light/scene.ts';
  import { LightStore } from '../../store/light.ts';
  import { BALANCES, EXPOSURES, FALSE_VIEWS, type Preferences } from '../../store/schema.ts';
  import { startLightWorker } from '../../workers/policy.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import type { AppState } from '../state.svelte.ts';
  import { drivesFor } from '../visualiser/drives.ts';
  import type { HallwayRenderer, Measured } from '../visualiser/renderer.ts';
  import type { SolveState } from '../visualiser/solver.ts';
  import { LightSolver } from '../visualiser/solver.ts';

  let { app }: { app: AppState } = $props();

  // One fixed hallway and view in Stage 7.
  const scene = defaultScene();
  const geometry = buildGeometry(scene);
  const atlas = layout(geometry);
  const camera = defaultCamera(scene);
  const tables = rippleTables(scene);

  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let renderer = $state<HallwayRenderer | undefined>(undefined);
  let display = $state<Display>('srgb');
  let problem = $state<string | undefined>(undefined);
  let solve = $state<SolveState>({ state: 'solving', done: 0, total: scene.mounts.length });
  let measured = $state<Measured | undefined>(undefined);
  /** The probe's place in the picture, 0 to 1 from the top left. */
  let at = $state({ x: 0.5, y: 0.75 });

  const prediction = $derived(app.snap !== undefined && app.snap.target !== 'simulator');
  const ev = $derived(
    app.prefs.exposure === 'manual' ? clampEv(app.prefs.exposureEv) : PRESET_EV[app.prefs.exposure],
  );
  const balance = $derived(
    app.prefs.whiteBalance === 'kelvin'
      ? ({ mode: 'kelvin', kelvin: app.prefs.whiteBalanceKelvin } as const)
      : ({ mode: app.prefs.whiteBalance } as const),
  );
  const falseScale = $derived<FalseScale | undefined>(
    app.prefs.falseColour === 'off'
      ? undefined
      : app.prefs.falseColour === 'illuminance'
        ? { quantity: 'illuminance', min: 0.1, decades: 4 }
        : { quantity: 'luminance', min: 0.01, decades: 4 },
  );
  const drives = $derived(drivesFor(app.snap?.light ?? []));
  const frame = $derived(buildFrame(scene, drives, { display, balance }));
  const response = $derived(solve.state === 'ready' ? solve.response : undefined);
  const desaturated = $derived(frame.mounts.some((m) => m.desaturated));
  const whiteKelvin = $derived(Math.round(cct(frame.white).kelvin / 10) * 10);

  const reading = $derived.by((): Reading | undefined => {
    if (response === undefined || renderer === undefined) return undefined;
    const r = ray(camera, renderer.aspect, at.x * 2 - 1, 1 - at.y * 2);
    const hit = pick(geometry, r.origin, r.direction);
    if (hit === undefined) return undefined;
    return probe(
      geometry,
      response,
      frame.mounts.map((m) => m.raw),
      hit.face,
      hit.s,
      hit.t,
    );
  });

  onMount(() => {
    const solver = new LightSolver(
      new LightStore(app.store.lightBackend()),
      startLightWorker,
      atlas,
    );
    let live: HallwayRenderer | undefined;
    let gone = false;
    let observer: ResizeObserver | undefined;
    void solver.solve(scene, (s) => {
      solve = s;
    });
    // three.js loads only when this page is opened (ADR 0002).
    import('../visualiser/renderer.ts')
      .then(({ HallwayRenderer }) => {
        if (gone || canvas === undefined) return;
        const made = new HallwayRenderer(canvas);
        live = made;
        made.setScene(geometry, atlas, tables, camera);
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
      gone = true;
      observer?.disconnect();
      solver.dispose();
      live?.dispose();
    };
  });

  $effect(() => {
    renderer?.setResponse(response);
  });
  $effect(() => {
    renderer?.setFrame(frame);
  });
  $effect(() => {
    renderer?.setExposure(ev);
  });
  $effect(() => {
    renderer?.setFalseColour(falseScale);
  });

  function point(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    at = {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  function nudge(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.02;
    const move: Record<string, readonly [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = move[e.key];
    if (d === undefined) return;
    e.preventDefault();
    at = {
      x: Math.min(1, Math.max(0, at.x + d[0])),
      y: Math.min(1, Math.max(0, at.y + d[1])),
    };
  }

  const fixed = (v: number): string =>
    v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toPrecision(2);

  const SURFACE: Record<string, string> = {
    floor: 'Floor',
    ceiling: 'Ceiling',
    left: 'Left wall',
    right: 'Right wall',
    end0: 'Near end wall',
    end1: 'Far end wall',
  };
  const surfaceName = (name: string): string => SURFACE[name] ?? 'Inside an opening';

  const legend = $derived(
    falseScale === undefined
      ? []
      : ticks(falseScale)
          .filter((t) => Number.isInteger(Math.log10(t.value) + 1e-9) || t.position === 1)
          .map((t) => {
            const c = paletteAt(t.position);
            return {
              label:
                t.value >= 1 ? String(Math.round(t.value)) : String(Number(t.value.toPrecision(1))),
              colour: `rgb(${c.map((v) => String(Math.round(v * 255))).join(' ')})`,
            };
          }),
  );

  let measuring = $state(false);

  /**
   * Time the frame with six mounts, all lit, which is what the budget is set for (Perf-frame). It
   * is drawn off screen, a frame at a time, so the picture and the page are left alone.
   */
  async function measure(): Promise<void> {
    const r = renderer;
    if (r === undefined || measuring) return;
    measuring = true;
    const six = sixMountScene();
    const g = buildGeometry(six);
    const full = { terminals: [1, 1, 1, 1, 1], labels: ['R', 'G', 'B', 'WW', 'CW'] as const };
    const lit = buildFrame(
      six,
      new Map([
        ['A', full],
        ['B', full],
      ]),
      { display, balance },
    );
    try {
      measured = await r.measure(g, layout(g), rippleTables(six), defaultCamera(six), lit, ev);
    } finally {
      measuring = false;
    }
  }
</script>

<div class="page stack">
  <header class="row top">
    <h1>Visualiser</h1>
    <StatusChip kind={prediction ? 'prediction' : 'estimated'} />
    <span class="muted small" data-testid="solve-status" role="status">
      {#if solve.state === 'solving'}
        Working out the bounced light: {solve.done} of {solve.total} mounts.
      {:else if solve.state === 'failed'}
        The bounced light could not be worked out: {solve.reason}
      {:else}
        Bounced light ready ({solve.cached ? 'kept from before' : 'just solved'},
        {solve.response.patches} patches).
      {/if}
    </span>
  </header>

  <div class="view">
    <button
      type="button"
      class="frame"
      aria-label="The hallway. Move the pointer, or use the arrow keys, to place the probe."
      onpointermove={point}
      onpointerdown={point}
      onkeydown={nudge}
      data-testid="hallway"
    >
      <canvas bind:this={canvas} data-testid="hallway-canvas"></canvas>
      <span class="cross" style:left={`${String(at.x * 100)}%`} style:top={`${String(at.y * 100)}%`}
      ></span>
    </button>
    {#if problem !== undefined}<p class="warn" role="alert">{problem}</p>{/if}
  </div>

  <section class="card" aria-labelledby="probe-h">
    <h2 id="probe-h">Probe</h2>
    <p data-testid="probe" aria-live="polite">
      {#if reading === undefined}
        {response === undefined ? 'Waiting for the bounced light.' : 'Nothing under the probe.'}
      {:else}
        <strong>{surfaceName(reading.surface)}</strong>:
        <span data-testid="probe-lux">{fixed(reading.lux)}</span> lux ({fixed(reading.directLux)}
        straight from a tape),
        <span data-testid="probe-luminance">{fixed(reading.luminance)}</span>
        cd/m²{#if reading.colour !== undefined},
          {Math.round(reading.colour.kelvin / 10) * 10} K, Duv {reading.colour.duv.toFixed(4)}, x
          {reading.colour.xy.x.toFixed(3)} y {reading.colour.xy.y.toFixed(3)}{/if}.
      {/if}
    </p>
    <p class="muted small">
      Lux and colour are the light as a meter would read it, before white balance. Move the pointer
      over the picture, or focus it and use the arrow keys.
    </p>
  </section>

  <section class="card controls" aria-labelledby="view-h">
    <h2 id="view-h">View</h2>
    <div class="row">
      <Segmented
        label="Exposure"
        options={EXPOSURES.map((e) => ({
          value: e,
          label: { night: 'Night-adapted', evening: 'Evening', day: 'Day', manual: 'Manual' }[e],
        }))}
        value={app.prefs.exposure}
        onchange={(exposure: Preferences['exposure']) => {
          app.update({ exposure });
        }}
        testid="exposure"
      />
      <NumberField
        label="EV"
        value={ev}
        min={-4}
        max={12}
        step={0.5}
        decimals={1}
        disabled={app.prefs.exposure !== 'manual'}
        onchange={(exposureEv: number) => {
          app.update({ exposureEv });
        }}
        testid="exposure-ev"
      />
      <span class="muted small" data-testid="exposure-white">
        White is {fixed(whiteLuminance(ev))} cd/m². Exposure never adjusts by itself.
      </span>
    </div>
    <div class="row">
      <Segmented
        label="White balance"
        options={BALANCES.map((b) => ({
          value: b,
          label: { scene: 'Adapted to the scene', daylight: 'Daylight', kelvin: 'Chosen' }[b],
        }))}
        value={app.prefs.whiteBalance}
        onchange={(whiteBalance: Preferences['whiteBalance']) => {
          app.update({ whiteBalance });
        }}
        testid="balance"
      />
      <NumberField
        label="Colour temperature"
        value={app.prefs.whiteBalanceKelvin}
        min={2000}
        max={10000}
        step={100}
        unit="K"
        disabled={app.prefs.whiteBalance !== 'kelvin'}
        onchange={(whiteBalanceKelvin: number) => {
          app.update({ whiteBalanceKelvin: Math.round(whiteBalanceKelvin) });
        }}
        testid="balance-kelvin"
      />
      <span class="muted small" data-testid="balance-white">
        {app.prefs.whiteBalance === 'daylight'
          ? 'Balanced to daylight (D65).'
          : `Balanced to ${String(whiteKelvin)} K.`}
      </span>
    </div>
    <div class="row">
      <Segmented
        label="Show"
        options={FALSE_VIEWS.map((v) => ({
          value: v,
          label: { off: 'Picture', illuminance: 'Lux', luminance: 'cd/m²' }[v],
        }))}
        value={app.prefs.falseColour}
        onchange={(falseColour: Preferences['falseColour']) => {
          app.update({ falseColour });
        }}
        testid="false-colour"
      />
      {#if falseScale !== undefined}
        <ol class="legend" aria-label="False colour scale" data-testid="legend">
          {#each legend as l (l.label)}
            <li><span class="swatch" style:--c={l.colour}></span>{l.label}</li>
          {/each}
          <li class="muted">{falseScale.quantity === 'illuminance' ? 'lux' : 'cd/m²'}</li>
        </ol>
      {/if}
    </div>
  </section>

  <section class="card" aria-labelledby="about-h">
    <h2 id="about-h">What this shows</h2>
    <p class="small">
      A best-effort estimate of how the light might look, not a measurement. Tape output and colour
      are placeholders until the tapes are measured, and surfaces are taken as neutral and matte.
      {#if desaturated}
        A screen cannot show LED colours at full saturation, so the saturated colours here are paler
        than the real tape.
      {/if}
      {display === 'p3' ? 'This screen shows Display P3.' : 'This screen shows sRGB.'}
    </p>
    <ul class="small mounts" data-testid="mounts">
      {#each scene.mounts as m, i (m.id)}
        {@const out = frame.mounts[i]?.raw ?? [0, 0, 0]}
        {@const sum = out[0] + out[1] + out[2]}
        <li data-testid={`mount-${String(i)}`}>
          {TAPES[m.tape].name}, cover: {DIFFUSERS[m.diffuser].name}, in a
          {m.kind === 'skirting'
            ? 'skirting slot'
            : m.kind === 'channel'
              ? 'flush channel'
              : 'reveal'}
          on the {m.side} wall, following driver {m.unit}:
          <span data-testid={`mount-${String(i)}-flux`}>{out[1].toFixed(2)}</span> lm/m now{#if sum > 0},
            x <span data-testid={`mount-${String(i)}-x`}>{(out[0] / sum).toFixed(5)}</span>
            y <span data-testid={`mount-${String(i)}-y`}>{(out[1] / sum).toFixed(5)}</span>{/if}.
        </li>
      {/each}
    </ul>
    <div class="row">
      <button
        type="button"
        onclick={() => void measure()}
        disabled={renderer === undefined || measuring}
        data-testid="measure">Measure frame time</button
      >
      {#if measured !== undefined}
        <span class="small" data-testid="measured">
          {#if measured.frames === 0}
            Too slow to measure on {measured.gpu}.
          {:else}
            {measured.ms.toFixed(2)} ms a frame with six mounts at 1440 by 900, over
            {measured.frames} frames{measured.stopped ? ', stopped early' : ''}, on {measured.gpu}.
          {/if}
        </span>
      {/if}
    </div>
  </section>
</div>

<style>
  .top {
    gap: var(--space-4);
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
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .legend {
    display: flex;
    gap: var(--space-3);
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: var(--size-1);
    font-variant-numeric: tabular-nums;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--c);
    border: 1px solid var(--line);
  }
  .mounts {
    margin: var(--space-2) 0 var(--space-3);
    padding-left: var(--space-4);
  }
  .warn {
    color: var(--warning, #e0b050);
  }
</style>
