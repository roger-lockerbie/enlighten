<script lang="ts">
  import type { Snapshot } from '../engine/engine.ts';
  import type { Unlock } from '../safety/types.ts';
  import type { BusClient } from './bus.ts';
  import { assignedText, ceilingText, driveText, kelvin, num } from './format.ts';

  let { snap, client }: { snap: Snapshot; client: BusClient } = $props();

  let message = $state('');
  let ceilingInput = $state(220);
  let raiseTyped = $state('');
  let unlockName = $state<Unlock>('reset');
  let unlockTyped = $state('');
  let commissionTyped = $state('');

  const onHardware = $derived(snap.target !== 'simulator');

  async function run(p: Promise<{ ok: boolean; reason?: string }>, done = 'Done.'): Promise<void> {
    message = '';
    const r = await p;
    message = r.ok ? done : (r.reason ?? 'Refused.');
  }

  function lower(): Promise<void> {
    return run(
      client.call({ op: 'setCeiling', arc: ceilingInput, confirmed: false }),
      'Ceiling lowered.',
    );
  }

  function raise(): Promise<void> {
    const confirmed = raiseTyped.trim() === String(ceilingInput);
    raiseTyped = '';
    return run(client.call({ op: 'setCeiling', arc: ceilingInput, confirmed }), 'Ceiling raised.');
  }

  function unlock(): Promise<void> {
    const confirmed = unlockTyped.trim() === unlockName;
    unlockTyped = '';
    return run(
      client.call({ op: 'unlock', unlock: unlockName, confirmed }),
      `Unlocked ${unlockName}.`,
    );
  }

  function commission(): Promise<void> {
    const typed = commissionTyped.trim();
    commissionTyped = '';
    return run(client.call({ op: 'commission', typed }), 'Commissioning finished.');
  }
</script>

<section aria-labelledby="devices-h">
  <h2 id="devices-h">Devices</h2>
  <p class="muted">
    What each driver reports, and whether its safety profile is in place.
    {#if snap.jobs.length > 0}
      <span role="status">Working: {snap.jobs.map((j) => j.label).join(', ')}.</span>
    {/if}
  </p>
  <div class="actions">
    <button type="button" onclick={() => run(client.call({ op: 'rescan' }), 'Scan finished.')}
      >Scan again</button
    >
    <button
      type="button"
      onclick={() => run(client.call({ op: 'reapplyProfile' }), 'Profile written.')}
      >Write the safety profile again</button
    >
  </div>

  {#if snap.devices.length === 0}
    <p class="muted">{snap.scanned ? 'No driver answered the scan.' : 'Not scanned yet.'}</p>
  {:else}
    <div class="scroll">
      <table data-testid="inventory">
        <thead>
          <tr>
            <th scope="col">Address</th>
            <th scope="col">Safety profile</th>
            <th scope="col">Driven by</th>
            <th scope="col">Device types</th>
            <th scope="col">Physical minimum</th>
            <th scope="col">MIN</th>
            <th scope="col">MAX</th>
            <th scope="col">Power on</th>
            <th scope="col">System failure</th>
            <th scope="col">Fade time, rate, extended</th>
            <th scope="col">Colour</th>
            <th scope="col">Tc limits</th>
            <th scope="col">Assigned colours</th>
          </tr>
        </thead>
        <tbody>
          {#each snap.devices as d (d.address)}
            <tr data-testid={`device-${String(d.address)}`}>
              <th scope="row">A{d.address}</th>
              <td data-testid="profile-status">{d.ceiling}</td>
              <td>{driveText(d.facts?.drive)}</td>
              <td>{d.facts?.deviceTypes.join(', ') ?? 'not read'}</td>
              <td>{num(d.facts?.physicalMinimum)}</td>
              <td>{num(d.facts?.minLevel)}</td>
              <td>{num(d.facts?.maxLevel)}</td>
              <td>{num(d.facts?.powerOnLevel)}</td>
              <td>{num(d.facts?.systemFailureLevel)}</td>
              <td>
                {num(d.facts?.fadeTime)}, {num(d.facts?.fadeRate)}, {num(d.facts?.extendedFade)}
              </td>
              <td>
                {#if d.facts?.colour}
                  {d.facts.colour.tc ? 'Tc' : ''}{d.facts.colour.channels > 0
                    ? ` ${String(d.facts.colour.channels)} channels`
                    : ''}{d.facts.colour.xy ? ' xy' : ''}
                {:else}
                  none
                {/if}
              </td>
              <td>
                {#if d.facts?.tcLimits}
                  {kelvin(d.facts.tcLimits.warmest)} to {kelvin(d.facts.tcLimits.coolest)}
                {:else}
                  none
                {/if}
              </td>
              <td>{assignedText(d.facts?.assigned)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#each snap.devices as d (d.address)}
      {#if d.profile !== undefined && !d.profile.verified}
        <p class="problem">
          A{d.address}: the safety profile is not verified.
          {d.profile.reason ?? ''}
          {#each d.profile.mismatches as m (m.what)}
            {m.what} should read {m.expected}, and reads {num(m.actual)}.
          {/each}
        </p>
      {/if}
    {/each}
    {#if onHardware}
      <p class="muted">
        Not yet confirmed on hardware: {snap.devices[0]?.profile?.unconfirmed.join('; ') ?? ''}.
      </p>
    {/if}
  {/if}
</section>

<section aria-labelledby="ceiling-h">
  <h2 id="ceiling-h">Ceiling</h2>
  <p class="muted">
    Now {ceilingText(snap.ceilingArc)}. Lowering takes effect at once. Raising needs the new value
    typed again.
  </p>
  <label>Arc level <input type="number" min="1" max="254" bind:value={ceilingInput} /></label>
  <button type="button" onclick={lower}>Lower</button>
  <label>Type the new value to raise <input bind:value={raiseTyped} autocomplete="off" /></label>
  <button type="button" onclick={raise}>Raise</button>
</section>

<section aria-labelledby="unlocks-h">
  <h2 id="unlocks-h">Unlocks</h2>
  <p class="muted">An unlock lasts until the page reloads. Type its name to confirm.</p>
  <label
    >Unlock
    <select bind:value={unlockName} data-testid="unlock-name">
      <option value="reset">reset</option>
      <option value="expert">expert</option>
      <option value="rate">rate</option>
    </select>
  </label>
  <label
    >Type its name <input
      bind:value={unlockTyped}
      autocomplete="off"
      data-testid="unlock-typed"
    /></label
  >
  <button type="button" onclick={unlock}>Unlock</button>
  <button type="button" onclick={() => run(client.call({ op: 'lock' }), 'Locked.')}>Lock all</button
  >
</section>

<section aria-labelledby="commission-h">
  <h2 id="commission-h">Commissioning</h2>
  <p class="muted">
    Gives each driver without a short address the lowest free address, then scans and writes the
    safety profile to every driver. It changes the drivers' stored addresses. It needs the reset
    unlock.
  </p>
  <label
    >Type "commission" to confirm <input
      bind:value={commissionTyped}
      autocomplete="off"
      data-testid="commission-typed"
    /></label
  >
  <button type="button" onclick={commission}>Commission</button>
  {#if snap.commission}
    <p data-testid="commission-result">
      {snap.commission.assigned.length === 0
        ? 'No driver without an address was found.'
        : `Assigned ${snap.commission.assigned.map((a) => `A${String(a.address)}`).join(', ')}.`}
      {snap.commission.problems.join(' ')}
    </p>
  {/if}
</section>

<section aria-labelledby="divergence-h">
  <h2 id="divergence-h">Divergence log</h2>
  <p class="muted">
    In Both, each query answer the simulator predicted differently from the hardware.
  </p>
  {#if snap.divergences.length === 0}
    <p class="muted" data-testid="divergence-empty">No divergence.</p>
  {:else}
    <table data-testid="divergences">
      <thead>
        <tr
          ><th scope="col">Time</th><th scope="col">Address</th><th scope="col">Query</th><th
            scope="col">Frame</th
          ><th scope="col">Simulator</th><th scope="col">Hardware</th></tr
        >
      </thead>
      <tbody>
        {#each snap.divergences as d, i (i)}
          <tr>
            <td>{(d.at / 1000).toFixed(1)} s</td>
            <td>A{d.address}</td>
            <td>{d.command}</td>
            <td>{d.frame}</td>
            <td>{d.shadow}</td>
            <td>{d.hardware}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button type="button" onclick={() => client.call({ op: 'clearDivergences' })}>Clear</button>
  {/if}
</section>

<section aria-labelledby="frames-h">
  <h2 id="frames-h">Recent frames</h2>
  <ol class="frames">
    {#each snap.monitor.slice(-12) as m, i (i)}
      <li>{m.target === 'hardware' ? 'HW' : 'SIM'} {m.frame} {m.text}, {m.source}: {m.result}</li>
    {/each}
  </ol>
</section>

<p class="status" role="status" aria-live="polite">{message}</p>
<ul class="notices" aria-label="Notices">
  {#each snap.notices as n, i (i)}<li>{n}</li>{/each}
</ul>

<style>
  section {
    margin: 1.5rem 0;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 0.4rem;
  }
  .muted {
    color: var(--text-muted);
    margin: 0.25rem 0 0.6rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .problem {
    border-left: 4px solid var(--warn);
    padding-left: 0.6rem;
  }
  label {
    margin-right: 0.5rem;
  }
  input,
  select {
    margin-left: 0.25rem;
  }
  .frames {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--text-muted);
    padding-left: 1.5rem;
  }
  .notices {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>
