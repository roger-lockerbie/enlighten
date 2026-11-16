<!--
  The banner line under the top bar (docs/UI.md section 2): states that need an answer. The panic
  latch with Resume, a lost connection, the can-you-see question, an unverified driver, a stored
  record set aside, and a saved ceiling above the default waiting to be confirmed.
-->
<script lang="ts">
  import { percentText } from '../../dali/curve.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app, tokenProblem }: { app: AppState; tokenProblem: string | undefined } = $props();

  const snap = $derived(app.snap);
  const lost = $derived(
    snap !== undefined &&
      snap.target !== 'simulator' &&
      (snap.connection === 'disconnected' || snap.connection === 'no-hasseb'),
  );
  const unverified = $derived(
    snap === undefined || snap.jobs.length > 0
      ? []
      : snap.devices.filter((d) => !d.verified).map((d) => app.name(d.address)),
  );
</script>

<div class="banners" data-region="banner">
  {#if app.dead !== undefined}
    <p class="banner danger" role="alert">{app.dead}</p>
  {/if}
  {#if tokenProblem !== undefined}
    <p class="banner" role="alert">{tokenProblem}</p>
  {/if}
  {#if snap !== undefined && !snap.hardwareAvailable}
    <p class="banner quiet">
      Hardware and Both need the server. Run <code>python -m server</code> and open the address it prints.
    </p>
  {/if}
  {#if snap?.latched}
    <p class="banner danger" role="alert">
      <span
        >Panic is on: everything stopped and every tape was sent OFF. Nothing is sent until you
        resume.</span
      >
      <button type="button" onclick={() => void app.call({ op: 'resume' })}>Resume</button>
    </p>
  {/if}
  {#if lost && snap !== undefined}
    <p class="banner warn" role="alert">
      <span>
        {snap.connection === 'no-hasseb' ? 'Hardware: no hasseb.' : 'Hardware: disconnected.'}
        {snap.connectionReason ?? ''} Nothing is sent to the simulator in its place.
      </span>
      <button type="button" onclick={() => void app.call({ op: 'reconnect' })}>Reconnect</button>
    </p>
  {/if}
  {#if snap?.askCanSee}
    <p class="banner" role="alert">
      <span>
        Can you see the lights from where you are? If you cannot, the rate unlock stays off for this
        session.
      </span>
      <button type="button" onclick={() => void app.call({ op: 'canSee', can: true })}
        >Yes, I can see them</button
      >
      <button type="button" onclick={() => void app.call({ op: 'canSee', can: false })}>No</button>
    </p>
  {/if}
  {#if snap?.operatorCanSee === false && snap.target !== 'simulator'}
    <p class="banner">
      The operator cannot see the lights. The rate unlock is off for this session.
    </p>
  {/if}
  {#if unverified.length > 0}
    <p class="banner warn" role="status" data-testid="unverified">
      <span>Not verified: {unverified.join(', ')}. See Devices for what did not read back.</span>
    </p>
  {/if}
  {#if app.savedCeiling !== undefined}
    <p class="banner" role="status" data-testid="saved-ceiling">
      <span>
        The app started at the default ceiling. Your saved ceiling is {percentText(
          app.savedCeiling,
        )}% (arc {app.savedCeiling}), and raising it needs you to confirm.
      </span>
      <button
        type="button"
        onclick={() => {
          app.raiseTo = app.savedCeiling;
        }}>Restore {percentText(app.savedCeiling)}%</button
      >
      <button
        type="button"
        onclick={() => {
          app.savedCeiling = undefined;
          app.update({ ceilingArc: app.snap?.ceilingArc ?? app.prefs.ceilingArc });
        }}>Keep the default</button
      >
    </p>
  {/if}
  {#if app.storeProblem !== undefined}
    <p class="banner warn" role="status">
      <span>{app.storeProblem}</span>
      <button
        type="button"
        onclick={() => {
          app.storeProblem = undefined;
        }}>Dismiss</button
      >
    </p>
  {/if}
</div>

<style>
  .banners {
    grid-area: banner;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
  .warn {
    border-left: 4px solid var(--warn);
  }
  .quiet {
    color: var(--text-muted);
    font-size: var(--size-1);
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
  .danger {
    border-left: 4px solid var(--danger);
  }
</style>
