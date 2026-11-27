<!--
  The top bar (docs/UI.md section 2): wordmark, output target and connection, the ceiling with its
  verified count, bus use, unlocks, and Panic at the far right. Nothing is ever drawn over it.
-->
<script lang="ts">
  import type { OutputTarget } from '../../engine/engine.ts';
  import Segmented from '../components/Segmented.svelte';
  import { ceilingText, connectionText, TARGETS } from '../format.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app, onPanic }: { app: AppState; onPanic: () => void } = $props();

  const snap = $derived(app.snap);
  const verified = $derived(snap?.devices.filter((d) => d.verified).length ?? 0);
  let message = $state('');

  async function choose(target: OutputTarget): Promise<void> {
    message = '';
    const r = await app.call({ op: 'setTarget', target });
    if (!r.ok && 'reason' in r) message = r.reason;
  }
</script>

<header class="bar" data-region="topbar" tabindex="-1" aria-label="Top bar">
  <span class="mark">Enlighten</span>

  <Segmented
    label="Output target"
    options={TARGETS.map((t) => ({
      value: t.value,
      label: t.label,
      disabled: t.value !== 'simulator' && snap?.hardwareAvailable !== true,
    }))}
    value={snap?.target}
    disabled={snap === undefined}
    onchange={(t: OutputTarget) => void choose(t)}
  />

  {#if snap !== undefined}
    <span class="muted" data-testid="connection">
      {#if !snap.hardwareAvailable}
        Server: not running
      {:else if snap.target === 'simulator'}
        Simulator
      {:else}
        {connectionText(snap.connection, snap.firmware)}
      {/if}
    </span>
    <button
      type="button"
      class="ceiling"
      data-testid="ceiling"
      aria-label={`Ceiling ${ceilingText(snap.ceilingArc)}. Change the ceiling.`}
      onclick={() => {
        app.ceilingOpen = true;
      }}
    >
      Ceiling {ceilingText(snap.ceilingArc)}
    </button>
    <span data-testid="verified">{verified}/{snap.devices.length} verified</span>
    <span>Bus {Math.round(snap.busUse * 100)}%</span>
    <span data-testid="unlocks">
      Unlocks: {snap.unlocks.length === 0 ? 'none' : snap.unlocks.join(', ')}
    </span>
    {#if snap.unlocks.length > 0}
      <button type="button" onclick={() => void app.call({ op: 'lock' })}>Lock all</button>
    {/if}
    {#if snap.latched}<span class="latched" data-testid="latched">▲ Panic latched</span>{/if}
  {/if}

  <button type="button" class="panic" onclick={onPanic} aria-keyshortcuts="Escape Escape">
    Panic
  </button>
</header>
{#if message !== ''}<p class="hint" role="status">{message}</p>{/if}

<style>
  .bar {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--topbar);
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    position: relative;
    z-index: 30;
    white-space: nowrap;
    overflow: hidden;
  }
  .mark {
    font-size: var(--size-3);
    font-weight: 500;
  }
  .ceiling {
    background: transparent;
  }
  .latched {
    color: var(--warn);
    font-weight: 500;
  }
  .panic {
    margin-left: auto;
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
    font-weight: 500;
    padding: var(--space-1) var(--space-5);
  }
  .hint {
    position: fixed;
    top: var(--topbar);
    right: var(--space-4);
    z-index: 30;
    background: var(--raised);
    border: 1px solid var(--line);
    padding: var(--space-2) var(--space-3);
  }
</style>
