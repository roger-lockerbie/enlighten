<!--
  The brightness ceiling (SPEC R6): set as output %, stored as an arc level rounded down. Lowering
  takes effect at once. Raising needs the new value typed (wireframe 04).
-->
<script lang="ts">
  import { percentText, percentToArcFloor } from '../../dali/curve.ts';
  import Confirmation from '../components/Confirmation.svelte';
  import Dialog from '../components/Dialog.svelte';
  import NumberField from '../components/NumberField.svelte';
  import StatusChip from '../components/StatusChip.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const current = $derived(app.snap?.ceilingArc ?? app.prefs.ceilingArc);
  // The dialog holds an arc level. A typed % becomes the arc level it rounds down to. The present
  // ceiling is shown as its own arc level, so opening and closing never moves it (DALI review S5-D5).
  let arc = $state(220);

  $effect(() => {
    if (app.ceilingOpen) {
      arc = current;
      app.ceilingMessage = '';
    }
  });

  async function lower(): Promise<void> {
    if (await app.setCeiling(arc, false)) app.ceilingOpen = false;
  }

  async function raise(): Promise<void> {
    const to = app.raiseTo;
    app.raiseTo = undefined;
    if (to === undefined) return;
    if (await app.setCeiling(to, true)) app.ceilingOpen = false;
    else app.ceilingOpen = true;
  }
</script>

<Dialog
  open={app.ceilingOpen && app.raiseTo === undefined}
  title="Brightness ceiling"
  onclose={() => {
    app.ceilingOpen = false;
  }}
  testid="ceiling-dialog"
>
  <div class="stack">
    <p>
      Now {percentText(current)}% (arc {current}). A comfort limit written to every driver's MAX
      LEVEL. Lowering takes effect at once. Raising asks you to confirm.
    </p>
    <div class="row">
      <NumberField
        label="New ceiling"
        value={Number(percentText(arc))}
        min={0.1}
        max={100}
        step={0.5}
        decimals={1}
        unit="%"
        onchange={(v: number) => {
          arc = Math.max(1, percentToArcFloor(v));
        }}
        testid="ceiling-percent"
      />
      <span class="muted" data-testid="ceiling-arc">arc {arc} ({percentText(arc)}%)</span>
    </div>
    <ul class="drivers">
      {#each app.snap?.devices ?? [] as d (d.address)}
        <li class="row">
          <span>{app.name(d.address)}</span>
          <StatusChip kind={d.ceiling} />
          <span class="muted small">MAX LEVEL {d.facts?.maxLevel ?? 'not read'}</span>
        </li>
      {/each}
    </ul>
    {#if app.ceilingMessage !== ''}
      <p role="alert" data-testid="ceiling-message">{app.ceilingMessage}</p>
    {/if}
    <div class="row end">
      <button
        type="button"
        onclick={() => {
          app.ceilingOpen = false;
        }}
      >
        Close
      </button>
      <button type="button" class="primary" disabled={arc >= current} onclick={() => void lower()}>
        Lower now
      </button>
      <button
        type="button"
        disabled={arc <= current}
        onclick={() => {
          app.raiseTo = arc;
        }}
      >
        Raise
      </button>
    </div>
  </div>
</Dialog>

<Confirmation
  open={app.raiseTo !== undefined}
  title="Raise the brightness ceiling?"
  lines={app.raiseTo === undefined
    ? []
    : [
        `From ${percentText(current)}% (arc ${String(current)}) to ${percentText(app.raiseTo)}% (arc ${String(app.raiseTo)}).`,
        'MAX LEVEL will be rewritten in every driver and read back.',
        'Lowering it again takes effect at once.',
      ]}
  expect={app.raiseTo === undefined ? '' : percentText(app.raiseTo)}
  confirmLabel="Raise"
  onconfirm={() => void raise()}
  oncancel={() => {
    app.raiseTo = undefined;
  }}
  testid="raise-dialog"
/>

<style>
  .drivers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .end {
    justify-content: flex-end;
  }
</style>
