<!--
  The selected mount, in the inspector (docs/UI.md, wireframe 03): kind, wall, height, facing,
  tape, cover, the opening, where it runs, its address and whether it is mirrored. Each default
  says where it came from and whether it is sourced or assumed (SPEC R11.2). A change is made to
  every mount linked to this one, except the address, which is each mount's own.
-->
<script lang="ts">
  import { DIFFUSERS } from '../../light/diffuser.ts';
  import type { DiffuserId, Mount, MountKind, Scene, TapeId } from '../../light/scene.ts';
  import { MOUNT_DEFAULTS } from '../../light/scene.ts';
  import type { Edit, LengthField, MountFields, Setup } from '../../light/setup.ts';
  import {
    KIND_NAMES,
    TAPE_CHOICES,
    facingOf,
    isMirrored,
    mirror,
    mountLimits,
    removeMount,
    setFacing,
    setMountField,
  } from '../../light/setup.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import Toggle from '../components/Toggle.svelte';

  let {
    setup,
    mount,
    label,
    edit,
    message,
  }: {
    setup: Setup;
    mount: Mount;
    /** Which set-up, in the A/B view. */
    label: string;
    edit: (change: (s: Setup) => Edit) => void;
    message: string;
  } = $props();

  const scene = $derived<Scene>(setup.scene);
  const limits = $derived(mountLimits(scene));
  const facing = $derived(facingOf(setup, mount.id) ?? mount.facing);
  const mirrored = $derived(isMirrored(setup, mount.id));
  const kinds: readonly MountKind[] = ['skirting', 'reveal', 'channel'];
  const diffusers = Object.keys(DIFFUSERS) as DiffuserId[];

  type Sourced = 'height' | 'slotHeight' | 'slotDepth' | 'setback' | 'aperture' | 'depth';
  /** The lengths shown in millimetres, and the ones in metres. */
  const MM: readonly Sourced[] = ['slotHeight', 'slotDepth', 'setback', 'aperture', 'depth'];

  function source(field: Sourced): { text: string; assumed: boolean } {
    const d = MOUNT_DEFAULTS[mount.kind][field];
    if (Math.abs(mount[field] - d.value) > 1e-9) {
      return {
        text: `Changed from the default of ${String(Math.round(d.value * 1000))} mm.`,
        assumed: false,
      };
    }
    return { text: `${d.basis}.`, assumed: !d.sourced };
  }

  const set = <K extends keyof MountFields>(field: K, value: MountFields[K]): void => {
    edit((s) => setMountField(s, mount.id, field, value));
  };
  const setLength = (field: LengthField, metres: number): void => {
    edit((s) => setMountField(s, mount.id, field, metres));
  };
</script>

<section class="stack editor" aria-labelledby="mount-h" data-testid="mount-editor">
  <h3 id="mount-h">
    {label}{KIND_NAMES[mount.kind]} on the {mount.side} wall
  </h3>

  <Segmented
    label="Kind"
    options={kinds.map((k) => ({ value: k, label: KIND_NAMES[k] }))}
    value={mount.kind}
    onchange={(k: MountKind) => {
      set('kind', k);
    }}
    testid="mount-kind"
  />
  <Segmented
    label="Wall"
    options={[
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' },
    ]}
    value={mount.side}
    onchange={(v: 'left' | 'right') => {
      set('side', v);
    }}
    testid="mount-side"
  />

  {#if mount.kind !== 'skirting'}
    <div class="field">
      <NumberField
        label={mount.kind === 'channel' ? 'Height of its centre' : 'Height of the opening'}
        value={mount.height * 1000}
        min={limits.height.min * 1000}
        max={limits.height.max * 1000}
        step={10}
        unit="mm"
        onchange={(v: number) => {
          setLength('height', v / 1000);
        }}
        testid="mount-height"
      />
      {#if source('height').text !== ''}
        <p class="muted small">{source('height').text}</p>
      {/if}
    </div>
  {:else}
    <p class="muted small">The slot sits at floor level.</p>
  {/if}

  {#if mount.kind === 'reveal'}
    <Segmented
      label="Facing"
      options={[
        { value: 'up', label: 'Up' },
        { value: 'down', label: 'Down' },
        { value: 'both', label: 'Both' },
      ]}
      value={facing}
      onchange={(f: 'up' | 'down' | 'both') => {
        edit((s) => setFacing(s, mount.id, f));
      }}
      testid="mount-facing"
    />
  {:else}
    <p class="muted small">
      {mount.kind === 'channel' ? 'Faces into the hallway.' : 'Faces down at the floor.'}
    </p>
  {/if}

  <label class="field">
    <span>Tape</span>
    <select
      value={mount.tape}
      onchange={(e) => {
        set('tape', e.currentTarget.value as TapeId);
      }}
      data-testid="mount-tape"
    >
      {#each TAPE_CHOICES as t (t.id)}
        <option value={t.id}>{t.label}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span>Cover</span>
    <select
      value={mount.diffuser}
      onchange={(e) => {
        set('diffuser', e.currentTarget.value as DiffuserId);
      }}
      data-testid="mount-diffuser"
    >
      {#each diffusers as d (d)}
        <option value={d}>
          {DIFFUSERS[d].name}, {Math.round(DIFFUSERS[d].transmission * 100)}% through
        </option>
      {/each}
    </select>
    <span class="muted small">{DIFFUSERS[mount.diffuser].transmissionBasis}.</span>
  </label>

  {#each MM.filter((f) => mount.kind !== 'channel' || f === 'aperture' || f === 'depth') as f (f)}
    {@const src = source(f)}
    <div class="field">
      <NumberField
        label={limits[f].label}
        value={mount[f] * 1000}
        min={limits[f].min * 1000}
        max={limits[f].max * 1000}
        step={0.5}
        decimals={1}
        unit="mm"
        onchange={(v: number) => {
          setLength(f, v / 1000);
        }}
        testid={`mount-${f}`}
      />
      <p class="muted small source">
        {#if src.assumed}<StatusChip kind="assumed" />{/if}
        {src.text}
      </p>
    </div>
  {/each}

  <div class="row">
    <NumberField
      label="Start"
      value={mount.start}
      min={limits.start.min}
      max={limits.start.max}
      step={0.05}
      decimals={2}
      unit="m"
      onchange={(v: number) => {
        setLength('start', v);
      }}
      testid="mount-start"
    />
    <NumberField
      label="Length"
      value={mount.length}
      min={limits.length.min}
      max={limits.length.max}
      step={0.05}
      decimals={2}
      unit="m"
      onchange={(v: number) => {
        setLength('length', v);
      }}
      testid="mount-length"
    />
  </div>

  <NumberField
    label="Voltage drop at the far end"
    value={mount.gradient * 100}
    min={0}
    max={50}
    step={5}
    unit="%"
    onchange={(v: number) => {
      set('gradient', v / 100);
    }}
    testid="mount-gradient"
  />

  <NumberField
    label="DALI address"
    value={mount.address}
    min={0}
    max={63}
    onchange={(v: number) => {
      set('address', Math.round(v));
    }}
    testid="mount-address"
  />

  <Toggle
    label="Mirror on the other wall"
    checked={mirrored}
    onchange={(on: boolean) => {
      edit((s) => mirror(s, mount.id, on));
    }}
    testid="mount-mirror"
  />

  <p class="small" role="status" data-testid="mount-message">{message}</p>

  <button
    type="button"
    class="danger"
    onclick={() => {
      edit((s) => removeMount(s, mount.id));
    }}
    data-testid="mount-remove"
  >
    Remove this mount
  </button>
</section>

<style>
  .editor {
    gap: var(--space-3);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .source {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    flex-wrap: wrap;
  }
  .row {
    gap: var(--space-3);
  }
</style>
