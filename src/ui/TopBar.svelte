<script lang="ts">
  import type { OutputTarget, Snapshot } from '../engine/engine.ts';
  import type { BusClient } from './bus.ts';
  import { ceilingText, connectionText, TARGETS } from './format.ts';

  let {
    snap,
    client,
    onPanic,
  }: { snap: Snapshot | undefined; client: BusClient; onPanic: () => void } = $props();

  let message = $state('');

  const verified = $derived(snap?.devices.filter((d) => d.verified).length ?? 0);

  async function choose(target: OutputTarget): Promise<void> {
    message = '';
    const r = await client.call({ op: 'setTarget', target });
    if (!r.ok && 'reason' in r) message = r.reason;
  }
</script>

<header class="bar">
  <span class="mark">Enlighten</span>

  <div class="target" role="group" aria-label="Output target">
    {#each TARGETS as t (t.value)}
      <button
        type="button"
        aria-pressed={snap?.target === t.value}
        disabled={snap === undefined || (t.value !== 'simulator' && !snap.hardwareAvailable)}
        onclick={() => choose(t.value)}>{t.label}</button
      >
    {/each}
  </div>

  {#if snap !== undefined}
    <span class="state" data-testid="connection">
      {#if !snap.hardwareAvailable}
        Server: not running
      {:else if snap.target === 'simulator'}
        Simulator
      {:else}
        {connectionText(snap.connection, snap.firmware)}
      {/if}
    </span>
    <span data-testid="ceiling">Ceiling {ceilingText(snap.ceilingArc)}</span>
    <span>{verified}/{snap.devices.length} verified</span>
    <span>Bus {Math.round(snap.busUse * 100)}%</span>
    <span data-testid="unlocks"
      >Unlocks: {snap.unlocks.length === 0 ? 'none' : snap.unlocks.join(', ')}</span
    >
    {#if snap.latched}<span class="latched">Panic latched</span>{/if}
  {/if}

  <button type="button" class="panic" onclick={onPanic}>Panic</button>
</header>
{#if snap !== undefined && !snap.hardwareAvailable}
  <p class="hint">
    Hardware and Both need the server. Run <code>python -m server</code> and open the address it prints.
  </p>
{/if}
{#if message !== ''}<p class="hint" role="status">{message}</p>{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    height: 48px;
    padding: 0 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 10;
    white-space: nowrap;
  }
  .mark {
    font-weight: 600;
  }
  .target {
    display: flex;
  }
  .target button {
    border-radius: 0;
  }
  .target button:first-child {
    border-radius: 4px 0 0 4px;
  }
  .target button:last-child {
    border-radius: 0 4px 4px 0;
  }
  .target button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--bg);
  }
  .state,
  .latched {
    color: var(--text-muted);
  }
  .latched {
    font-weight: 600;
    color: var(--warn);
  }
  .panic {
    margin-left: auto;
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
    font-weight: 600;
    padding: 0.4rem 1.2rem;
  }
  .hint {
    margin: 0.5rem 1rem;
    color: var(--text-muted);
  }
</style>
