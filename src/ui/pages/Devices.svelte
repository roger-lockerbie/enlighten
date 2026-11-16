<!--
  Devices (docs/UI.md section 1): the inventory and what each driver reports, the safety profile for
  each address, names, unlocks, commissioning, the simulator's settings, and the hardware check.
-->
<script lang="ts">
  import type { Unlock } from '../../safety/types.ts';
  import StatusChip from '../components/StatusChip.svelte';
  import { MAX_NAME } from '../../store/schema.ts';
  import { assignedText, driveText, kelvin, num } from '../format.ts';
  import type { AppState } from '../state.svelte.ts';
  import HardwareCheck from './HardwareCheck.svelte';
  import SimSettings from './SimSettings.svelte';

  let { app }: { app: AppState } = $props();

  const snap = $derived(app.snap);
  let message = $state('');
  let unlockName = $state<Unlock>('reset');
  let unlockTyped = $state('');
  let commissionTyped = $state('');

  const onHardware = $derived(snap !== undefined && snap.target !== 'simulator');

  async function run(p: ReturnType<AppState['call']>, done = 'Done.'): Promise<void> {
    message = '';
    const r = await p;
    message = r.ok ? done : 'reason' in r ? r.reason : 'Refused.';
  }

  function unlock(): Promise<void> {
    const confirmed = unlockTyped.trim() === unlockName;
    unlockTyped = '';
    return run(
      app.call({ op: 'unlock', unlock: unlockName, confirmed }),
      `Unlocked ${unlockName}.`,
    );
  }

  function commission(): Promise<void> {
    const typed = commissionTyped.trim();
    commissionTyped = '';
    return run(app.call({ op: 'commission', typed }), 'Commissioning finished.');
  }

  function rename(address: number, alias: string): void {
    const rest = app.prefs.aliases.filter((a) => a.address !== address);
    const name = alias.trim().slice(0, MAX_NAME);
    app.update({ aliases: name === '' ? rest : [...rest, { address, alias: name }] });
  }
</script>

<div class="page stack">
  <h1>Devices</h1>
  {#if snap === undefined}
    <p class="muted">Starting.</p>
  {:else}
    <section class="stack" aria-labelledby="inv-h">
      <h2 id="inv-h">Inventory</h2>
      <p class="muted">
        What each driver reports, and whether its safety profile is in place.
        {#if snap.jobs.length > 0}
          <span role="status">Working: {snap.jobs.map((j) => j.label).join(', ')}.</span>
        {/if}
      </p>
      <div class="row">
        <button type="button" onclick={() => void run(app.call({ op: 'rescan' }), 'Scan finished.')}
          >Scan again</button
        >
        <button
          type="button"
          onclick={() => void run(app.call({ op: 'reapplyProfile' }), 'Profile written.')}
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
                <th scope="col">Name</th>
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
                  <td>
                    <input
                      type="text"
                      class="alias"
                      maxlength={MAX_NAME}
                      aria-label={`Name for A${String(d.address)}`}
                      value={app.prefs.aliases.find((a) => a.address === d.address)?.alias ?? ''}
                      onchange={(e) => {
                        rename(d.address, e.currentTarget.value);
                      }}
                    />
                  </td>
                  <td
                    ><span class="sr-only" data-testid="profile-status">{d.ceiling}</span
                    ><StatusChip kind={d.ceiling} /></td
                  >
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

    <section class="stack" aria-labelledby="unlocks-h">
      <h2 id="unlocks-h">Unlocks</h2>
      <p class="muted">An unlock lasts until the page reloads. Type its name to confirm.</p>
      <div class="row">
        <label class="row"
          >Unlock
          <select bind:value={unlockName} data-testid="unlock-name">
            <option value="reset">reset</option>
            <option value="expert">expert</option>
            <option value="rate">rate</option>
          </select>
        </label>
        <label class="row"
          >Type its name <input
            bind:value={unlockTyped}
            autocomplete="off"
            data-testid="unlock-typed"
          /></label
        >
        <button type="button" onclick={() => void unlock()}>Unlock</button>
        <button type="button" onclick={() => void run(app.call({ op: 'lock' }), 'Locked.')}
          >Lock all</button
        >
      </div>
    </section>

    <section class="stack" aria-labelledby="commission-h">
      <h2 id="commission-h">Commissioning</h2>
      <p class="muted">
        Gives each driver without a short address the lowest free address, then scans and writes the
        safety profile to every driver. It changes the drivers' stored addresses. It needs the reset
        unlock.
      </p>
      <div class="row">
        <label class="row"
          >Type "commission" to confirm <input
            bind:value={commissionTyped}
            autocomplete="off"
            data-testid="commission-typed"
          /></label
        >
        <button type="button" onclick={() => void commission()}>Commission</button>
      </div>
      {#if snap.commission}
        <p data-testid="commission-result">
          {snap.commission.assigned.length === 0
            ? 'No driver without an address was found.'
            : `Assigned ${snap.commission.assigned.map((a) => `A${String(a.address)}`).join(', ')}.`}
          {snap.commission.problems.join(' ')}
        </p>
      {/if}
    </section>

    <p role="status" aria-live="polite" data-testid="devices-message">{message}</p>
    {#if snap.notices.length > 0}
      <section aria-labelledby="notices-h">
        <h2 id="notices-h">Notices</h2>
        <ul class="muted small">
          {#each snap.notices as n, i (i)}<li>{n}</li>{/each}
        </ul>
      </section>
    {/if}

    <SimSettings {app} />
    <HardwareCheck {snap} client={app.client} />
  {/if}
</div>

<style>
  .scroll {
    overflow-x: auto;
  }
  .problem {
    border-left: 4px solid var(--warn);
    padding-left: var(--space-3);
  }
  .alias {
    width: 12ch;
  }
</style>
