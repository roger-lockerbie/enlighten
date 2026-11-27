<!--
  The inspector (docs/UI.md section 2): detail for what is selected. On the Playground, the selected
  device's stored values as read back, and its safety profile. On the Visualiser, the selected
  mount's editor, which that page supplies. It can be collapsed.
-->
<script lang="ts">
  import type { Page } from '../../store/schema.ts';
  import StatusChip from '../components/StatusChip.svelte';
  import { assignedText, driveText, kelvin, num } from '../format.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app, page }: { app: AppState; page: Page } = $props();

  const device = $derived(app.snap?.devices.find((d) => d.address === app.selected));
  const f = $derived(device?.facts);
  let message = $state('');

  /** Group membership is a 16-bit mask, one bit a group. */
  function groupsText(mask: number | undefined): string {
    if (mask === undefined) return 'not read';
    const g = Array.from({ length: 16 }, (_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
    return g.length === 0 ? 'none' : g.join(', ');
  }

  async function reapply(): Promise<void> {
    message = '';
    const r = await app.call({ op: 'reapplyProfile' });
    message = r.ok ? 'Profile written and read back.' : 'reason' in r ? r.reason : 'Refused.';
  }
</script>

<aside class="inspector" aria-labelledby="inspector-h" data-region="inspector" tabindex="-1">
  <header class="row head">
    <h2 id="inspector-h">Inspector</h2>
    <button
      type="button"
      onclick={() => {
        app.update({ inspectorOpen: false });
      }}
    >
      Hide
    </button>
  </header>
  {#if page === 'visualiser'}
    {#if app.inspector !== undefined}
      {@render app.inspector()}
    {:else}
      <p class="muted">Select a mount on the Visualiser to change it here.</p>
    {/if}
  {:else if page !== 'playground'}
    <p class="muted">Select a device on the Playground to see its stored values here.</p>
  {:else if device === undefined}
    <p class="muted">No device selected.</p>
  {:else}
    <div class="row">
      <h3>{app.name(device.address)}</h3>
      <StatusChip kind={device.ceiling} />
    </div>
    <dl data-testid="inspector-values">
      <dt>Driven by</dt>
      <dd>{driveText(f?.drive)}</dd>
      <dt>Actual level</dt>
      <dd>{num(f?.level)}</dd>
      <dt>MAX LEVEL</dt>
      <dd>
        {num(f?.maxLevel)}
        {f?.maxLevel === app.snap?.ceilingArc ? ' matches the ceiling' : ''}
      </dd>
      <dt>MIN LEVEL</dt>
      <dd>{num(f?.minLevel)}</dd>
      <dt>Physical minimum</dt>
      <dd>{num(f?.physicalMinimum)}</dd>
      <dt>Power on</dt>
      <dd>
        {f?.powerOnLevel === 0 ? '0 (off)' : num(f?.powerOnLevel)}
        <StatusChip kind="not yet confirmed on hardware" />
      </dd>
      <dt>System failure</dt>
      <dd>{f?.systemFailureLevel === 255 ? '255 (no change)' : num(f?.systemFailureLevel)}</dd>
      <dt>Fade time, rate</dt>
      <dd>{num(f?.fadeTime)}, {num(f?.fadeRate)}</dd>
      <dt>Extended fade</dt>
      <dd>{num(f?.extendedFade)}</dd>
      {#if f?.tcLimits !== undefined}
        <dt>Tc limits</dt>
        <dd>{kelvin(f.tcLimits.warmest)} to {kelvin(f.tcLimits.coolest)}</dd>
      {/if}
      {#if f?.colour !== undefined && f.colour.channels > 0}
        <dt>Assigned colours</dt>
        <dd>{assignedText(f.assigned)}</dd>
      {/if}
      <dt>Groups</dt>
      <dd>
        {groupsText(f?.groups)}
      </dd>
    </dl>
    {#if device.profile !== undefined && device.profile.mismatches.length > 0}
      <ul class="small">
        {#each device.profile.mismatches as m (m.what)}
          <li>{m.what} should read {m.expected}, and reads {num(m.actual)}.</li>
        {/each}
      </ul>
    {/if}
    <button type="button" onclick={() => void reapply()}>Re-apply profile</button>
    {#if message !== ''}<p class="small" role="status">{message}</p>{/if}
    <p class="muted small">Values read back at the last scan or profile write.</p>
  {/if}
</aside>

<style>
  .inspector {
    grid-area: inspector;
    background: var(--surface);
    border-left: 1px solid var(--line);
    padding: var(--space-4);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .head {
    justify-content: space-between;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
</style>
