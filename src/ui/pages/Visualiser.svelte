<!--
  The Visualiser (SPEC R10 to R12, R14.2, R15; ADR 0008, ADR 0017 and ADR 0018): the hallway as the
  light engine predicts it. The hallway and its mounts are edited here and in the inspector, with
  presets. The camera walks, orbits or comes close to a mount. The A/B view shows two set-ups side
  by side, driven by the same devices, with one exposure and one white balance.

  The picture follows the active connection's output, which the rate guard already limits, and
  draws only when that, the set-up or the view changes. It has no motion of its own (SPEC S6.3).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { View } from '../../light/camera.ts';
  import {
    cameraFor,
    defaultCamera,
    downHall,
    turnBy,
    walkBy,
    zoomBy,
  } from '../../light/camera.ts';
  import { PRESET_EV, clampEv, whiteLuminance } from '../../light/colour/exposure.ts';
  import type { FalseScale } from '../../light/colour/falsecolour.ts';
  import { paletteAt, ticks } from '../../light/colour/falsecolour.ts';
  import { cct } from '../../light/colour/locus.ts';
  import type { Display } from '../../light/colour/xyz.ts';
  import { DIFFUSERS } from '../../light/diffuser.ts';
  import { TAPES, undriven } from '../../light/emitter.ts';
  import type { Frame } from '../../light/frame.ts';
  import { buildFrame, rippleTables, roomLight } from '../../light/frame.ts';
  import { buildGeometry } from '../../light/geometry.ts';
  import { layout } from '../../light/atlas.ts';
  import type { Reading } from '../../light/probe.ts';
  import type { Saved } from '../../light/saved.ts';
  import { defaultSaved, parseSaved } from '../../light/saved.ts';
  import type { Mount, MountKind, Side } from '../../light/scene.ts';
  import { MAX_MOUNTS, sixMountScene } from '../../light/scene.ts';
  import type { Edit, Setup } from '../../light/setup.ts';
  import {
    KIND_NAMES,
    PRESETS,
    TAPE_CHOICES,
    addMount,
    applyPreset,
    facingOf,
    linked,
  } from '../../light/setup.ts';
  import { BALANCES, EXPOSURES, FALSE_VIEWS, type Preferences } from '../../store/schema.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import Toggle from '../components/Toggle.svelte';
  import type { AppState } from '../state.svelte.ts';
  import CameraBar from '../visualiser/CameraBar.svelte';
  import { drivesFor } from '../visualiser/drives.ts';
  import HallwayCard from '../visualiser/HallwayCard.svelte';
  import MountEditor from '../visualiser/MountEditor.svelte';
  import Picture from '../visualiser/Picture.svelte';
  import PresetDiagram from '../visualiser/PresetDiagram.svelte';
  import type { HallwayRenderer, Measured } from '../visualiser/renderer.ts';
  import type { SolveState } from '../visualiser/solver.ts';

  let { app }: { app: AppState } = $props();

  /** The set-ups and view, from the store. Nothing is drawn until they are read. */
  let saved = $state.raw<Saved | undefined>(undefined);
  let selected = $state<string | undefined>(undefined);
  let message = $state('');

  let renderer = $state<HallwayRenderer | undefined>(undefined);
  let display = $state<Display>('srgb');
  let solveA = $state<SolveState>({ state: 'solving', done: 0, total: 0 });
  let solveB = $state<SolveState>({ state: 'solving', done: 0, total: 0 });
  let readingA = $state<Reading | undefined>(undefined);
  let readingB = $state<Reading | undefined>(undefined);
  let measured = $state<Measured | undefined>(undefined);

  const setupA = $derived(saved?.a);
  const setupB = $derived(saved?.b);
  const compare = $derived(saved?.compare ?? false);
  const editing = $derived<'a' | 'b'>(compare ? (saved?.editing ?? 'a') : 'a');
  const current = $derived(editing === 'a' ? setupA : setupB);
  const view = $derived<View | undefined>(saved?.view);
  const selectedMount = $derived(current?.scene.mounts.find((m) => m.id === selected));

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
  // One white for both pictures in the A/B view (ADR 0008): each is balanced to the light of both.
  const frameA = $derived<Frame | undefined>(
    setupA === undefined
      ? undefined
      : buildFrame(setupA.scene, drives, {
          display,
          balance,
          ...(compare && setupB !== undefined
            ? { alongside: roomLight(setupB.scene, drives) }
            : {}),
        }),
  );
  const frameB = $derived<Frame | undefined>(
    setupB === undefined || !compare
      ? undefined
      : buildFrame(setupB.scene, drives, {
          display,
          balance,
          ...(setupA === undefined ? {} : { alongside: roomLight(setupA.scene, drives) }),
        }),
  );
  const desaturated = $derived(
    [...(frameA?.mounts ?? []), ...(frameB?.mounts ?? [])].some((m) => m.desaturated),
  );
  const whiteKelvin = $derived(
    frameA === undefined ? 0 : Math.round(cct(frameA.white).kelvin / 10) * 10,
  );

  onMount(() => {
    let gone = false;
    app.store
      .loadVisualiser(parseSaved, defaultSaved())
      .then((r) => {
        if (gone) return;
        if (r.problem !== undefined) app.storeProblem = r.problem;
        saved = r.value;
        selected = r.value[r.value.compare ? r.value.editing : 'a'].scene.mounts[0]?.id;
      })
      .catch(() => {
        if (!gone) saved = defaultSaved();
      });
    app.inspector = inspector;
    return () => {
      gone = true;
      clearTimeout(saveTimer);
      if (pending !== undefined) void store(pending);
      if (app.inspector === inspector) app.inspector = undefined;
    };
  });

  // Saved shortly after the last change.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: Saved | undefined;
  function store(s: Saved): Promise<void> {
    pending = undefined;
    return app.store.saveVisualiser(parseSaved, s).catch(() => {
      app.storeProblem = 'The visualiser set-ups could not be saved.';
    });
  }
  function keep(next: Saved): void {
    saved = next;
    pending = next;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (pending !== undefined) void store(pending);
    }, 400);
  }

  /** Make an edit to the set-up being edited, or say why it is refused. */
  function edit(change: (s: Setup) => Edit): void {
    const s = saved;
    if (s === undefined) return;
    const side = s.compare ? s.editing : 'a';
    const before = s[side];
    const r = change(before);
    if (!r.ok) {
      message = r.reason;
      return;
    }
    message = '';
    keep({ ...s, [side]: r.setup });
    const ids = new Set(before.scene.mounts.map((m) => m.id));
    const added = r.setup.scene.mounts.find((m) => !ids.has(m.id));
    if (added !== undefined && r.setup.scene.mounts.length > before.scene.mounts.length) {
      select(added.id);
    } else if (!r.setup.scene.mounts.some((m) => m.id === selected)) {
      select(r.setup.scene.mounts[0]?.id);
    }
  }

  /** Select a mount. The close-up follows the selection, so it is never of a mount that has gone. */
  function select(id: string | undefined): void {
    selected = id;
    const s = saved;
    if (s?.view.mode !== 'close') return;
    if (id !== undefined) keep({ ...s, view: { mode: 'close', mount: id } });
    else keep({ ...s, view: downHall(s[s.compare ? s.editing : 'a'].scene) });
  }

  function setView(v: View): void {
    if (saved !== undefined) keep({ ...saved, view: v });
  }
  const sceneForView = $derived(current?.scene);
  function onturn(yaw: number, pitch: number): void {
    if (view !== undefined) setView(turnBy(view, yaw, pitch));
  }
  function onwalk(forward: number, right: number): void {
    if (view?.mode === 'walk' && sceneForView !== undefined) {
      setView(walkBy(sceneForView, view, forward, right));
    }
  }
  function onzoom(steps: number): void {
    if (view !== undefined && sceneForView !== undefined) {
      setView(zoomBy(sceneForView, view, steps));
    }
  }

  function setCompare(on: boolean): void {
    if (saved === undefined) return;
    keep({ ...saved, compare: on, editing: on ? saved.editing : 'a' });
    select((on ? saved[saved.editing] : saved.a).scene.mounts[0]?.id);
  }
  function setEditing(side: 'a' | 'b'): void {
    if (saved === undefined) return;
    keep({ ...saved, editing: side });
    select(saved[side].scene.mounts[0]?.id);
    message = '';
  }
  function copyAtoB(): void {
    if (saved !== undefined) keep({ ...saved, b: saved.a });
  }

  // Adding a mount
  let addKind = $state<MountKind>('channel');
  let addSide = $state<Side>('left');

  const fixed = (v: number): string =>
    v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toPrecision(2);
  const sideName = (s: Side): string => (s === 'left' ? 'Left' : 'Right');
  const tapeName = (t: Mount['tape']): string => TAPE_CHOICES.find((c) => c.id === t)?.label ?? t;

  function summary(s: Setup, m: Mount): string {
    const f = facingOf(s, m.id);
    const way =
      m.kind === 'channel'
        ? 'facing in'
        : m.kind === 'skirting'
          ? 'facing down'
          : `facing ${f === 'both' ? 'up and down' : (f ?? m.facing)}`;
    const at = m.kind === 'skirting' ? '' : ` at ${String(Math.round(m.height * 1000))} mm`;
    const cover = m.diffuser === 'none' ? 'no cover' : `${DIFFUSERS[m.diffuser].name} cover`;
    return `${sideName(m.side)}: ${KIND_NAMES[m.kind].toLowerCase()}${at}, ${way}. ${tapeName(m.tape)}, address ${String(m.address)}, ${cover}.`;
  }

  /** Why a mount may be dark or partly dark whatever is sent. */
  function driverNote(m: Mount): string | undefined {
    const d = drives.get(m.address);
    if (d === undefined) return `No driver at address ${String(m.address)}.`;
    const missing = undriven(d, m.tape);
    if (missing.length === 0) return undefined;
    return `Its driver does not feed the tape's ${missing.join(', ')}.`;
  }

  function linkNote(s: Setup, m: Mount): string | undefined {
    const twin = linked(s, m.id, 'mirror');
    return twin === undefined ? undefined : `Mirrored with ${twin}.`;
  }

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
        [0, full],
        [1, full],
      ]),
      { display, balance },
    );
    try {
      measured = await r.measure(g, layout(g), rippleTables(six), defaultCamera(six), lit, ev);
    } finally {
      measuring = false;
    }
  }

  function solveText(s: SolveState): string {
    if (s.state === 'solving') {
      return `Working out the bounced light: ${String(s.done)} of ${String(s.total)} mounts.`;
    }
    if (s.state === 'failed') return `The bounced light could not be worked out: ${s.reason}`;
    return `Bounced light ready (${s.cached ? 'kept from before' : 'just solved'}, ${String(s.response.patches)} patches).`;
  }
</script>

{#snippet inspector()}
  {#if current !== undefined && selectedMount !== undefined}
    <MountEditor
      setup={current}
      mount={selectedMount}
      label={compare ? `${editing === 'a' ? 'A' : 'B'}: ` : ''}
      {edit}
      {message}
    />
  {:else}
    <p class="muted">Select a mount on the Visualiser to change it here.</p>
  {/if}
{/snippet}

{#snippet readingText(r: Reading | undefined, suffix: string)}
  {#if r === undefined}
    {(suffix === '' ? solveA : solveB).state === 'ready'
      ? 'Nothing under the probe.'
      : 'Waiting for the bounced light.'}
  {:else}
    <strong>{surfaceName(r.surface)}</strong>:
    <span data-testid={`probe${suffix}-lux`}>{fixed(r.lux)}</span> lux ({fixed(r.directLux)}
    straight from a tape),
    <span data-testid={`probe${suffix}-luminance`}>{fixed(r.luminance)}</span>
    cd/m²{#if r.colour !== undefined},
      {Math.round(r.colour.kelvin / 10) * 10} K, Duv {r.colour.duv.toFixed(4)}, x
      {r.colour.xy.x.toFixed(3)} y {r.colour.xy.y.toFixed(3)}{/if}.
  {/if}
{/snippet}

{#snippet mountLines(s: Setup, f: Frame | undefined, prefix: string)}
  <ul class="small mounts" data-testid={`mounts${prefix}`}>
    {#each s.scene.mounts as m, i (m.id)}
      {@const out = f?.mounts[i]?.raw ?? [0, 0, 0]}
      {@const sum = out[0] + out[1] + out[2]}
      {@const note = driverNote(m)}
      <li data-testid={`mount${prefix}-${String(i)}`}>
        {TAPES[m.tape].name}, cover: {DIFFUSERS[m.diffuser].name}, in a
        {KIND_NAMES[m.kind].toLowerCase()} on the {m.side} wall, following address {m.address}:
        <span data-testid={`mount${prefix}-${String(i)}-flux`}>{out[1].toFixed(2)}</span> lm/m now{#if sum > 0},
          x <span data-testid={`mount${prefix}-${String(i)}-x`}>{(out[0] / sum).toFixed(5)}</span>
          y
          <span data-testid={`mount${prefix}-${String(i)}-y`}>{(out[1] / sum).toFixed(5)}</span
          >{/if}.{#if note !== undefined}
          <span class="warn-text">{note}</span>{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="page stack">
  <header class="row top">
    <h1>Visualiser</h1>
    <StatusChip kind={prediction ? 'prediction' : 'estimated'} />
    <span class="muted small" data-testid="solve-status" role="status">
      {compare ? 'A: ' : ''}{solveText(solveA)}
    </span>
    {#if compare}
      <span class="muted small" data-testid="solve-status-b" role="status">
        B: {solveText(solveB)}
      </span>
    {/if}
  </header>

  {#if saved === undefined || setupA === undefined || view === undefined || frameA === undefined}
    <p class="muted" role="status">Reading the set-up.</p>
  {:else}
    <section class="card" aria-labelledby="camera-h">
      <h2 id="camera-h" class="sr-only">Camera</h2>
      <div class="row spread">
        <CameraBar scene={(current ?? setupA).scene} {view} {selected} onview={setView} />
        <Toggle label="A/B view" checked={compare} onchange={setCompare} testid="ab-toggle" />
      </div>
    </section>

    <div class="pictures" class:two={compare}>
      <figure>
        {#if compare}<figcaption>A</figcaption>{/if}
        <Picture
          store={app.store}
          scene={setupA.scene}
          camera={cameraFor(setupA.scene, view)}
          frame={frameA}
          {ev}
          {falseScale}
          name={compare ? 'Set-up A' : 'The hallway'}
          bind:reading={readingA}
          bind:solve={solveA}
          bind:display
          bind:renderer
          {onturn}
          {onwalk}
          {onzoom}
        />
      </figure>
      {#if compare && setupB !== undefined && frameB !== undefined}
        <figure>
          <figcaption>B</figcaption>
          <Picture
            store={app.store}
            scene={setupB.scene}
            camera={cameraFor(setupB.scene, view)}
            frame={frameB}
            {ev}
            {falseScale}
            name="Set-up B"
            testid="hallway-b"
            bind:reading={readingB}
            bind:solve={solveB}
            {onturn}
            {onwalk}
            {onzoom}
          />
        </figure>
      {/if}
    </div>

    <section class="card" aria-labelledby="probe-h">
      <h2 id="probe-h">Probe</h2>
      <p data-testid="probe" aria-live="polite">
        {compare ? 'A: ' : ''}{@render readingText(readingA, '')}
      </p>
      {#if compare}
        <p data-testid="probe-b" aria-live="polite">B: {@render readingText(readingB, '-b')}</p>
      {/if}
      <p class="muted small">
        Lux and colour are the light as a meter would read it, before white balance. Move the
        pointer over the picture, or focus it and use the arrow keys.
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
            : `Balanced to ${String(whiteKelvin)} K${compare ? ', for both set-ups' : ''}.`}
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

    {#if current !== undefined}
      <section class="card stack" aria-labelledby="mounts-h">
        <div class="row spread">
          <h2 id="mounts-h">Mounts</h2>
          {#if compare}
            <div class="row">
              <Segmented
                label="Editing"
                options={[
                  { value: 'a', label: 'Set-up A' },
                  { value: 'b', label: 'Set-up B' },
                ]}
                value={editing}
                onchange={setEditing}
                testid="editing"
              />
              <button type="button" onclick={copyAtoB} data-testid="copy-a-to-b">Copy A to B</button
              >
            </div>
          {/if}
        </div>
        <ul class="mount-list" data-testid="mount-list">
          {#each current.scene.mounts as m (m.id)}
            {@const note = driverNote(m)}
            {@const link = linkNote(current, m)}
            <li>
              <button
                type="button"
                class="mount-row"
                aria-pressed={m.id === selected}
                onclick={() => {
                  select(m.id);
                  message = '';
                  if (!app.prefs.inspectorOpen) app.update({ inspectorOpen: true });
                }}
                data-testid={`mount-row-${m.id}`}
              >
                <span>{summary(current, m)}</span>
                {#if link !== undefined}<span class="muted small">{link}</span>{/if}
                {#if note !== undefined}<span class="small warn-text">{note}</span>{/if}
              </button>
            </li>
          {:else}
            <li class="muted">No mounts. Add one, or choose a preset.</li>
          {/each}
        </ul>
        <div class="row add">
          <label class="field">
            <span>Kind</span>
            <select bind:value={addKind} data-testid="add-kind">
              <option value="skirting">{KIND_NAMES.skirting}</option>
              <option value="reveal">{KIND_NAMES.reveal}</option>
              <option value="channel">{KIND_NAMES.channel}</option>
            </select>
          </label>
          <label class="field">
            <span>Wall</span>
            <select bind:value={addSide} data-testid="add-side">
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <button
            type="button"
            disabled={current.scene.mounts.length >= MAX_MOUNTS}
            onclick={() => {
              edit((s) => addMount(s, addKind, addSide));
            }}
            data-testid="add-mount">Add a mount</button
          >
          <span class="muted small">
            {current.scene.mounts.length} of {MAX_MOUNTS} mounts. Select one to change it in the inspector.
          </span>
        </div>
        <p class="small" role="status" data-testid="setup-message">{message}</p>

        <h3>Presets</h3>
        <ul class="presets">
          {#each PRESETS as p (p.id)}
            <li>
              <button
                type="button"
                class="preset"
                aria-describedby={`preset-${p.id}`}
                onclick={() => {
                  edit((s) => applyPreset(s, p.id));
                }}
                data-testid={`preset-${p.id}`}
              >
                <PresetDiagram scene={p.build(current.scene).scene} />
                <span>{p.name}</span>
              </button>
              <p class="muted small" id={`preset-${p.id}`}>{p.description}</p>
            </li>
          {/each}
        </ul>
        <p class="muted small">A preset replaces the mounts and keeps the hallway.</p>
      </section>

      <section class="card" aria-labelledby="hall-h">
        <h2 id="hall-h">Hallway{compare ? ` (${editing === 'a' ? 'A' : 'B'})` : ''}</h2>
        <HallwayCard setup={current} {edit} />
      </section>
    {/if}

    <section class="card" aria-labelledby="about-h">
      <h2 id="about-h">What this shows</h2>
      <p class="small">
        A best-effort estimate of how the light might look, not a measurement. Tape output and
        colour are placeholders until the tapes are measured, and surfaces are taken as neutral and
        matte. Each mount follows the driver at its address, as the active connection reports it.
        {#if desaturated}
          A screen cannot show LED colours at full saturation, so the saturated colours here are
          paler than the real tape.
        {/if}
        {display === 'p3' ? 'This screen shows Display P3.' : 'This screen shows sRGB.'}
      </p>
      {#if compare}<h3>Set-up A</h3>{/if}
      {@render mountLines(setupA, frameA, '')}
      {#if compare && setupB !== undefined}
        <h3>Set-up B</h3>
        {@render mountLines(setupB, frameB, '-b')}
      {/if}
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
  {/if}
</div>

<style>
  .top {
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .spread {
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .pictures {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }
  .pictures.two {
    grid-template-columns: 1fr 1fr;
  }
  figure {
    margin: 0;
    min-width: 0;
  }
  figcaption {
    font-size: var(--size-1);
    color: var(--text-muted);
    margin-bottom: var(--space-1);
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
  .mount-list,
  .presets {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .mount-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .mount-row {
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .mount-row[aria-pressed='true'] {
    border-color: var(--accent);
  }
  .add {
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--space-3);
  }
  .preset {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
