<!--
  The camera (SPEC R15.2): walk at eye level, orbit the middle of the hallway, or come close to a
  mount to judge its dots, with presets down the hall and at a wall. Every setting has a number
  field, so the view can be set from the keyboard as well as by dragging the picture. A preset is
  a cut, never a move: nothing on the page animates.
-->
<script lang="ts">
  import type { View } from '../../light/camera.ts';
  import {
    ORBIT_DISTANCE,
    PITCH_LIMIT,
    atWall,
    defaultOrbit,
    downHall,
    fitWalk,
  } from '../../light/camera.ts';
  import type { Scene, Side } from '../../light/scene.ts';
  import { KIND_NAMES } from '../../light/setup.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';

  let {
    scene,
    view,
    selected,
    onview,
  }: {
    scene: Scene;
    view: View;
    /** The mount the close-up and "at the wall" start from. */
    selected: string | undefined;
    onview: (v: View) => void;
  } = $props();

  type Mode = View['mode'];
  const wallSide = $derived<Side>(
    scene.mounts.find((m) => m.id === selected)?.side ?? scene.mounts[0]?.side ?? 'left',
  );

  function choose(mode: Mode): void {
    if (mode === view.mode && mode !== 'close') return;
    if (mode === 'walk') onview(downHall(scene));
    else if (mode === 'orbit') onview(defaultOrbit());
    else onview({ mode: 'close', mount: selected ?? scene.mounts[0]?.id ?? 'm1' });
  }
</script>

<div class="stack" data-testid="camera">
  <div class="row">
    <Segmented
      label="Camera"
      options={[
        { value: 'walk', label: 'Walk' },
        { value: 'orbit', label: 'Orbit' },
        { value: 'close', label: 'Close up', disabled: scene.mounts.length === 0 },
      ]}
      value={view.mode}
      onchange={choose}
      testid="camera-mode"
    />
    <button
      type="button"
      onclick={() => {
        onview(downHall(scene));
      }}
      data-testid="camera-down"
    >
      Down the hall
    </button>
    <button
      type="button"
      onclick={() => {
        onview(atWall(scene, wallSide));
      }}
      data-testid="camera-wall"
    >
      At the {wallSide} wall
    </button>
  </div>

  {#if view.mode === 'walk'}
    {@const w = fitWalk(scene, view)}
    <div class="row">
      <NumberField
        label="Along"
        value={w.x}
        min={0}
        max={scene.length}
        step={0.25}
        decimals={2}
        unit="m"
        onchange={(x: number) => {
          onview(fitWalk(scene, { ...w, x }));
        }}
        testid="camera-x"
      />
      <NumberField
        label="Across"
        value={w.z}
        min={0}
        max={scene.width}
        step={0.05}
        decimals={2}
        unit="m"
        onchange={(z: number) => {
          onview(fitWalk(scene, { ...w, z }));
        }}
        testid="camera-z"
      />
      <NumberField
        label="Turn"
        value={w.yaw}
        min={-180}
        max={180}
        step={5}
        unit="°"
        onchange={(yaw: number) => {
          onview({ ...w, yaw });
        }}
        testid="camera-yaw"
      />
      <NumberField
        label="Tilt"
        value={w.pitch}
        min={-PITCH_LIMIT}
        max={PITCH_LIMIT}
        step={5}
        unit="°"
        onchange={(pitch: number) => {
          onview({ ...w, pitch });
        }}
        testid="camera-pitch"
      />
    </div>
  {:else if view.mode === 'orbit'}
    {@const o = view}
    <div class="row">
      <NumberField
        label="Turn"
        value={o.yaw}
        min={-180}
        max={180}
        step={5}
        unit="°"
        onchange={(yaw: number) => {
          onview({ ...o, yaw });
        }}
        testid="camera-yaw"
      />
      <NumberField
        label="Tilt"
        value={o.pitch}
        min={-PITCH_LIMIT}
        max={PITCH_LIMIT}
        step={5}
        unit="°"
        onchange={(pitch: number) => {
          onview({ ...o, pitch });
        }}
        testid="camera-pitch"
      />
      <NumberField
        label="Distance"
        value={o.distance}
        min={ORBIT_DISTANCE.min}
        max={ORBIT_DISTANCE.max}
        step={0.25}
        decimals={2}
        unit="m"
        onchange={(distance: number) => {
          onview({ ...o, distance });
        }}
        testid="camera-distance"
      />
    </div>
  {:else}
    {@const c = view}
    <label class="field">
      <span>Close on</span>
      <select
        value={c.mount}
        onchange={(e) => {
          onview({ mode: 'close', mount: e.currentTarget.value });
        }}
        data-testid="camera-mount"
      >
        {#each scene.mounts as m (m.id)}
          <option value={m.id}>{KIND_NAMES[m.kind]}, {m.side} wall ({m.id})</option>
        {/each}
      </select>
    </label>
  {/if}
  <p class="muted small">
    Drag the picture to look around, use the wheel to move in, and W, A, S and D to walk. Shift
    takes longer steps.
  </p>
</div>

<style>
  .row {
    gap: var(--space-3);
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
