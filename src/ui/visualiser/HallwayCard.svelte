<!--
  The hallway (SPEC R10.1, R11.3): its size, its ends, and each surface's finish by preset or by
  reflectance, with where each preset's figure came from.
-->
<script lang="ts">
  import type { Edit, Setup, Surface } from '../../light/setup.ts';
  import {
    HALL_LIMITS,
    MATERIALS,
    REFLECTANCE_MAX,
    materialFor,
    setHallway,
    setReflectance,
  } from '../../light/setup.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatusChip from '../components/StatusChip.svelte';

  let {
    setup,
    edit,
  }: {
    setup: Setup;
    edit: (change: (s: Setup) => Edit) => void;
  } = $props();

  const s = $derived(setup.scene);
  const SURFACES: readonly { id: Surface; name: string }[] = [
    { id: 'ceiling', name: 'Ceiling' },
    { id: 'walls', name: 'Walls' },
    { id: 'floor', name: 'Floor' },
  ];
</script>

<div class="stack">
  <div class="row">
    <NumberField
      label="Length"
      value={s.length}
      min={HALL_LIMITS.length.min}
      max={HALL_LIMITS.length.max}
      step={0.1}
      decimals={2}
      unit="m"
      onchange={(length: number) => {
        edit((x) => setHallway(x, { length }));
      }}
      testid="hall-length"
    />
    <NumberField
      label="Width"
      value={s.width}
      min={HALL_LIMITS.width.min}
      max={HALL_LIMITS.width.max}
      step={0.05}
      decimals={2}
      unit="m"
      onchange={(width: number) => {
        edit((x) => setHallway(x, { width }));
      }}
      testid="hall-width"
    />
    <NumberField
      label="Height"
      value={s.height}
      min={HALL_LIMITS.height.min}
      max={HALL_LIMITS.height.max}
      step={0.05}
      decimals={2}
      unit="m"
      onchange={(height: number) => {
        edit((x) => setHallway(x, { height }));
      }}
      testid="hall-height"
    />
    <Segmented
      label="End walls"
      options={[
        { value: 'closed', label: 'Closed' },
        { value: 'open', label: 'Open' },
      ]}
      value={s.endWalls}
      onchange={(endWalls: 'closed' | 'open') => {
        edit((x) => setHallway(x, { endWalls }));
      }}
      testid="hall-ends"
    />
  </div>

  {#each SURFACES as surface (surface.id)}
    {@const value = s.reflectance[surface.id]}
    {@const preset = materialFor(surface.id, value)}
    <div class="row material">
      <label class="field">
        <span>{surface.name}</span>
        <select
          value={preset?.id ?? 'custom'}
          onchange={(e) => {
            const m = MATERIALS[surface.id].find((x) => x.id === e.currentTarget.value);
            if (m !== undefined) edit((x) => setReflectance(x, surface.id, m.reflectance));
          }}
          data-testid={`material-${surface.id}`}
        >
          {#each MATERIALS[surface.id] as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
          <option value="custom" disabled={preset !== undefined}>Chosen reflectance</option>
        </select>
      </label>
      <NumberField
        label="Reflectance"
        {value}
        min={0}
        max={REFLECTANCE_MAX}
        step={0.01}
        decimals={2}
        onchange={(v: number) => {
          edit((x) => setReflectance(x, surface.id, v));
        }}
        testid={`reflectance-${surface.id}`}
      />
      <span class="muted small basis">
        {#if preset === undefined}
          Chosen by hand.
        {:else}
          {#if !preset.sourced}<StatusChip kind="assumed" />{/if}
          {preset.basis}.
        {/if}
      </span>
    </div>
  {/each}
  <p class="muted small">
    Surfaces are taken as neutral and matte. A tinted or glossy finish is outside this version.
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
  .basis {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    flex: 1 1 14rem;
  }
</style>
