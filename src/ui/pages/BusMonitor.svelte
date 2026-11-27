<!--
  The bus monitor (SPEC R13.7): every frame with its decoded name, address, source, time, reply and
  the governor's verdict, and bus use as a percentage. The divergence log for Both is the second view.
  Every value is a text node.
-->
<script lang="ts">
  import type { MonitorLine } from '../../engine/engine.ts';
  import Segmented from '../components/Segmented.svelte';
  import Toggle from '../components/Toggle.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const SHOWN = 300;
  let view = $state<'frames' | 'divergences'>('frames');
  let address = $state('any');
  let source = $state('any');

  const lines = $derived(app.monitor);
  const addresses = $derived(
    [...new Set(lines.map((l) => l.address).filter((a) => a !== ''))].sort(),
  );
  const sources = $derived([...new Set(lines.map((l) => l.source))].sort());
  const filtered = $derived(
    lines
      .filter(
        (l) =>
          (address === 'any' || l.address === address) && (source === 'any' || l.source === source),
      )
      .slice(-SHOWN)
      .reverse(),
  );

  const verdict = (l: MonitorLine) => (l.result.startsWith('refused') ? 'refused' : 'sent');
  const reply = (l: MonitorLine) =>
    l.result.startsWith('refused')
      ? l.result.slice('refused: '.length)
      : l.result === 'sent'
        ? ''
        : l.result;
  const time = (ms: number) => `${(ms / 1000).toFixed(3)} s`;
</script>

<div class="page stack">
  <header class="row">
    <h1>Bus monitor</h1>
    <span data-testid="bus-use">Bus use {Math.round((app.snap?.busUse ?? 0) * 100)}%</span>
    <Segmented
      label="View"
      options={[
        { value: 'frames', label: 'Frames' },
        { value: 'divergences', label: 'Divergence log' },
      ]}
      value={view}
      onchange={(v: 'frames' | 'divergences') => {
        view = v;
      }}
    />
  </header>

  {#if view === 'frames'}
    <div class="row">
      <label class="row">
        <span class="muted">Address</span>
        <select bind:value={address} data-testid="filter-address">
          <option value="any">any</option>
          {#each addresses as a (a)}<option value={a}>{a}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span class="muted">Source</span>
        <select bind:value={source} data-testid="filter-source">
          <option value="any">any</option>
          {#each sources as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>
      <Toggle
        label="Pause"
        checked={app.monitorPaused}
        onchange={(v: boolean) => {
          app.monitorPaused = v;
        }}
      />
      <button
        type="button"
        onclick={() => {
          app.clearMonitor();
        }}
      >
        Clear
      </button>
      <span class="muted small">
        {lines.length} frames kept, the newest {Math.min(SHOWN, filtered.length)} shown first.
      </span>
    </div>
    {#if filtered.length === 0}
      <p class="muted" data-testid="monitor-empty">No frames yet.</p>
    {:else}
      <div class="scroll">
        <table data-testid="monitor">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Target</th>
              <th scope="col">Source</th>
              <th scope="col">Frame</th>
              <th scope="col">Command</th>
              <th scope="col">Address</th>
              <th scope="col">Reply</th>
              <th scope="col">Verdict</th>
              <th scope="col">Wire</th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as l (l.seq)}
              <tr data-testid="monitor-row">
                <td>{time(l.at)}</td>
                <td>{l.target === 'hardware' ? 'hardware' : 'simulator'}</td>
                <td>{l.source}</td>
                <td class="mono">{l.frame}</td>
                <td>{l.text}</td>
                <td>{l.address}</td>
                <td>{reply(l)}</td>
                <td class:refused={verdict(l) === 'refused'}>{verdict(l)}</td>
                <td>{l.ms.toFixed(1)} ms</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    <p class="muted">
      In Both, each query answer the simulator predicted differently from the hardware.
    </p>
    {#if (app.snap?.divergences.length ?? 0) === 0}
      <p class="muted" data-testid="divergence-empty">No divergence.</p>
    {:else}
      <div class="scroll">
        <table data-testid="divergences">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Address</th>
              <th scope="col">Query</th>
              <th scope="col">Frame</th>
              <th scope="col">Simulator</th>
              <th scope="col">Hardware</th>
            </tr>
          </thead>
          <tbody>
            {#each app.snap?.divergences ?? [] as d, i (i)}
              <tr>
                <td>{time(d.at)}</td>
                <td>A{d.address}</td>
                <td>{d.command}</td>
                <td class="mono">{d.frame}</td>
                <td>{d.shadow}</td>
                <td>{d.hardware}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button type="button" onclick={() => void app.call({ op: 'clearDivergences' })}>Clear</button>
    {/if}
  {/if}
</div>

<style>
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
  }
  td {
    white-space: nowrap;
  }
  .refused {
    color: var(--danger);
  }
</style>
