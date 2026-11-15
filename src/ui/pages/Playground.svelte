<!-- The Playground (docs/UI.md section 1): drive one device with sliders and pickers. -->
<script lang="ts">
  import Segmented from '../components/Segmented.svelte';
  import BenchPreview from '../playground/BenchPreview.svelte';
  import DevicePanel from '../playground/DevicePanel.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const snap = $derived(app.snap);
  const devices = $derived(snap?.devices ?? []);
</script>

<div class="page stack">
  <header class="row top">
    <h1>Playground</h1>
    <Segmented
      label="Send mode"
      options={[
        { value: 'live', label: 'Live' },
        { value: 'commit', label: 'Commit' },
      ]}
      value={app.prefs.playgroundMode}
      onchange={(m: 'live' | 'commit') => {
        app.update({ playgroundMode: m });
      }}
      testid="send-mode"
    />
    <span class="muted small">
      {app.prefs.playgroundMode === 'live'
        ? 'Live: changes go out as you move a control, as fast as the bus and the rate guard allow.'
        : 'Commit: nothing goes out until you press Apply.'}
    </span>
  </header>

  {#if snap === undefined}
    <p class="muted">Starting.</p>
  {:else if devices.length === 0}
    <p class="muted">
      {snap.jobs.length > 0 ? 'Scanning the bus.' : 'No driver answered the scan. See Devices.'}
    </p>
  {:else}
    <div class="panels">
      {#each devices as d (d.address)}
        <DevicePanel {app} device={d} light={snap.light.find((l) => l.address === d.address)} />
      {/each}
    </div>
  {/if}
  <BenchPreview {app} light={snap?.light ?? []} />
</div>

<style>
  .top {
    gap: var(--space-4);
  }
  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(24rem, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
</style>
