<!--
  Switches (SPEC R16, docs/UI.md section 1): virtual plates with one, two or four buttons. The app is
  the application controller: a button runs the part 301 event machine in the bus worker, and what
  each event does is set here. Every action goes through the engine and the governor to the current
  output target, and shows in the console and the bus monitor with the source "switch".
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { short } from '../../dali/address.ts';
  import { MAX_NAME } from '../../design/schema.ts';
  import type { RunDef } from '../../engine/engine.ts';
  import { freeId, plateTarget, rename, runNames } from '../../switch/edit.ts';
  import {
    FAMILY_LABEL,
    MAX_PLATES,
    type Family,
    type Layout,
    type Plate,
  } from '../../switch/plate.ts';
  import { presetPlate } from '../../switch/presets.ts';
  import { parsePlates } from '../../switch/schema.ts';
  import NumberField from '../components/NumberField.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { designOf } from '../design.svelte.ts';
  import ButtonEditor from '../switches/ButtonEditor.svelte';
  import PlateView from '../switches/PlateView.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const design = $derived(designOf(app));
  const plates = $derived(design.value.plates);
  const snap = $derived(app.snap);

  let family = $state<Family>('zencontrol');
  let layout = $state<Layout>(2);
  let address = $state(0);
  let message = $state('');
  let selected = $state<Record<string, number>>({});
  let openId = $state<string | undefined>(undefined);

  const FAMILIES: readonly { value: Family; label: string }[] = [
    { value: 'zencontrol', label: 'zencontrol style' },
    { value: 'coupler', label: 'DALI-2 coupler' },
    { value: 'knx', label: 'KNX through a gateway' },
  ];
  const LAYOUTS: readonly { value: `${Layout}`; label: string }[] = [
    { value: '1', label: '1 button' },
    { value: '2', label: '2 buttons' },
    { value: '4', label: '4 buttons' },
  ];

  const sequenceNames = $derived(design.value.sequences.map((s) => s.name));
  const effectNames = $derived(design.value.effects.map((e) => e.name));

  /** The sequences and effects the plates name, as the worker needs them. */
  function runsFor(ps: readonly Plate[]): RunDef[] {
    const out: RunDef[] = [];
    for (const r of runNames(ps)) {
      if (r.what === 'sequence') {
        const sequence = design.value.sequences.find((s) => s.name === r.name);
        if (sequence !== undefined) out.push({ kind: 'sequence', sequence });
      } else {
        const effect = design.value.effects.find((e) => e.name === r.name);
        if (effect !== undefined) out.push({ kind: 'effect', effect });
      }
    }
    return out;
  }

  // Give the worker the plates as they are, and again after each edit. That also lets go of any
  // button that was held.
  $effect(() => {
    if (!design.loaded) return;
    const ps = JSON.parse(JSON.stringify(plates)) as Plate[];
    const runs = JSON.parse(JSON.stringify(runsFor(ps))) as RunDef[];
    untrack(() => {
      void app.call({ op: 'switchPlates', plates: ps, runs });
    });
  });

  onDestroy(() => {
    void app.call({ op: 'switchPlates', plates: [], runs: [] });
  });

  function add(): void {
    if (plates.length >= MAX_PLATES) {
      message = `At most ${String(MAX_PLATES)} plates can be kept.`;
      return;
    }
    const id = freeId(plates);
    const p = rename(
      presetPlate(id, family, layout, short(address)),
      `Plate ${id.slice(1)}`.slice(0, MAX_NAME),
    );
    design.set({ ...design.value, plates: [...plates, p] });
    message = `Added ${p.name}.`;
  }

  function replace(p: Plate): void {
    // A plate the worker would refuse is not kept, so the page never shows one that is not live.
    const next = plates.map((x) => (x.id === p.id ? p : x));
    const ok = parsePlates(JSON.parse(JSON.stringify(next)));
    if (!ok.ok) {
      message = `Not changed. ${ok.error}`;
      return;
    }
    message = '';
    design.set({ ...design.value, plates: plates.map((x) => (x.id === p.id ? p : x)) });
  }

  function remove(p: Plate): void {
    design.set({ ...design.value, plates: plates.filter((x) => x.id !== p.id) });
    message = `Removed ${p.name}.`;
  }

  function reset(p: Plate): void {
    const fresh = presetPlate(p.id, p.family, p.buttons.length as Layout, plateTarget(p));
    replace({ ...fresh, name: p.name });
    message = `${p.name} is back to its preset.`;
  }

  const defaultAddress = $derived(snap?.devices[0]?.address ?? 0);
</script>

<div class="page stack">
  <h1>Switches</h1>
  <p class="muted">
    Virtual plates. The app plays the application controller: a button makes part 301 events, and
    what each event does is set here. Every action goes through the governor to the current target.
    A plate does nothing on an address that is not verified. KNX plates reach DALI through a gateway
    in a real house, so their behaviour here is an example.
  </p>
  {#if snap === undefined || !design.loaded}
    <p class="muted">Starting.</p>
  {:else}
    <section class="card stack" aria-labelledby="add-h">
      <h2 id="add-h">Add a plate</h2>
      <div class="row wrap">
        <Segmented
          label="Plate style"
          options={FAMILIES}
          value={family}
          onchange={(v: Family) => {
            family = v;
          }}
          testid="plate-family"
        />
        <Segmented
          label="Buttons"
          options={LAYOUTS}
          value={String(layout) as `${Layout}`}
          onchange={(v: `${Layout}`) => {
            layout = Number(v) as Layout;
          }}
          testid="plate-layout"
        />
        <NumberField
          label="Address"
          value={address}
          min={0}
          max={63}
          onchange={(v: number) => {
            address = v;
          }}
          testid="plate-address"
        />
        <button type="button" data-testid="plate-add" onclick={add}>Add plate</button>
        <button
          type="button"
          onclick={() => {
            address = defaultAddress;
          }}
        >
          Use the first driver
        </button>
      </div>
      <p class="muted small">
        {FAMILY_LABEL[family]}, {layout}
        {layout === 1 ? 'button' : 'buttons'}.
      </p>
    </section>

    {#if plates.length === 0}
      <p class="muted" data-testid="no-plates">No plates yet.</p>
    {/if}

    {#each plates as p (p.id)}
      <section class="stack" aria-label={p.name} data-testid={`plate-section-${p.id}`}>
        <div class="row wrap">
          <label class="row">
            Name
            <input
              type="text"
              value={p.name}
              maxlength={MAX_NAME}
              autocomplete="off"
              data-testid={`plate-name-${p.id}`}
              onchange={(e) => {
                const n = e.currentTarget.value.trim();
                if (n === '') e.currentTarget.value = p.name;
                else replace(rename(p, n));
              }}
            />
          </label>
          <span class="muted">{FAMILY_LABEL[p.family]}</span>
          <button
            type="button"
            aria-pressed={openId === p.id}
            data-testid={`plate-edit-${p.id}`}
            onclick={() => {
              openId = openId === p.id ? undefined : p.id;
            }}
          >
            Edit mapping
          </button>
          <button
            type="button"
            onclick={() => {
              reset(p);
            }}
          >
            Back to preset
          </button>
          <button
            type="button"
            data-testid={`plate-remove-${p.id}`}
            onclick={() => {
              remove(p);
            }}
          >
            Remove
          </button>
        </div>
        <PlateView
          {app}
          plate={p}
          selected={selected[p.id] ?? 0}
          onselect={(i: number) => {
            selected = { ...selected, [p.id]: i };
          }}
        />
        {#if openId === p.id}
          <ButtonEditor
            plate={p}
            button={selected[p.id] ?? 0}
            sequences={sequenceNames}
            effects={effectNames}
            onchange={replace}
          />
        {/if}
      </section>
    {/each}
    <p role="status" aria-live="polite" data-testid="switches-message">{message}</p>
  {/if}
</div>

<style>
  .wrap {
    flex-wrap: wrap;
  }
</style>
