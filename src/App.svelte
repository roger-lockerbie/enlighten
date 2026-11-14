<script lang="ts">
  import type { Snapshot } from './engine/engine.ts';
  import Banner from './ui/Banner.svelte';
  import { BusClient, readToken } from './ui/bus.ts';
  import Devices from './ui/Devices.svelte';
  import HardwareCheck from './ui/HardwareCheck.svelte';
  import TopBar from './ui/TopBar.svelte';

  // The token leaves the address bar at once, goes to the bus worker, and the page keeps no copy.
  const read = readToken();
  const client = new BusClient(read.token);
  const tokenProblem = read.problem;

  let snap = $state<Snapshot | undefined>(undefined);
  let dead = $state<string | undefined>(undefined);
  client.onSnapshot((s) => {
    snap = s;
  });
  client.onDead((why) => {
    dead = why;
  });

  function panic(): void {
    client.panic();
  }

  // Escape twice within 500 ms is panic, from anywhere on the page (SPEC S4.2).
  let lastEscape = -Infinity;
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const now = e.timeStamp;
    if (now - lastEscape <= 500) {
      lastEscape = -Infinity;
      panic();
    } else {
      lastEscape = now;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<TopBar {snap} {client} onPanic={panic} />
<Banner {snap} {client} {dead} {tokenProblem} />

<main>
  {#if snap === undefined}
    <p>Starting the bus worker.</p>
  {:else}
    <h1>Enlighten</h1>
    <p class="muted">
      An interim page for Stage 4: devices, the safety profile, commissioning, the hardware check
      and the divergence log. Stage 5 builds the full shell and playground.
    </p>
    <Devices {snap} {client} />
    <HardwareCheck {snap} {client} />
  {/if}
</main>

<style>
  main {
    max-width: 90rem;
    margin: 0 auto;
    padding: 1rem 1.5rem 4rem;
  }
  h1 {
    margin: 0.5rem 0;
    font-size: 1.4rem;
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
  }
</style>
