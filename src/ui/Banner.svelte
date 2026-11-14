<script lang="ts">
  import type { Snapshot } from '../engine/engine.ts';
  import type { BusClient } from './bus.ts';

  let {
    snap,
    client,
    dead,
    tokenProblem,
  }: {
    snap: Snapshot | undefined;
    client: BusClient;
    dead: string | undefined;
    tokenProblem: string | undefined;
  } = $props();

  const lost = $derived(
    snap !== undefined &&
      snap.target !== 'simulator' &&
      (snap.connection === 'disconnected' || snap.connection === 'no-hasseb'),
  );
</script>

{#if dead !== undefined}
  <p class="banner danger" role="alert">{dead}</p>
{/if}
{#if tokenProblem !== undefined}
  <p class="banner" role="alert">{tokenProblem}</p>
{/if}
{#if snap?.latched}
  <p class="banner warn" role="alert">
    Panic is on: everything stopped and every tape was sent OFF. Nothing is sent until you resume.
    <button type="button" onclick={() => client.call({ op: 'resume' })}>Resume</button>
  </p>
{/if}
{#if lost && snap !== undefined}
  <p class="banner warn" role="alert">
    {snap.connection === 'no-hasseb' ? 'Hardware: no hasseb.' : 'Hardware: disconnected.'}
    {snap.connectionReason ?? ''} Nothing is sent to the simulator in its place.
    <button type="button" onclick={() => client.call({ op: 'reconnect' })}>Reconnect</button>
  </p>
{/if}
{#if snap?.askCanSee}
  <p class="banner" role="alert">
    Can you see the lights from where you are? If you cannot, the rate unlock stays off for this
    session.
    <button type="button" onclick={() => client.call({ op: 'canSee', can: true })}
      >Yes, I can see them</button
    >
    <button type="button" onclick={() => client.call({ op: 'canSee', can: false })}>No</button>
  </p>
{/if}
{#if snap?.operatorCanSee === false && snap.target !== 'simulator'}
  <p class="banner">The operator cannot see the lights. The rate unlock is off for this session.</p>
{/if}

<style>
  .banner {
    margin: 0;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .warn {
    border-left: 4px solid var(--warn);
  }
  .danger {
    border-left: 4px solid var(--danger);
  }
  button {
    margin-left: 0.75rem;
  }
</style>
