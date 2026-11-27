<!--
  Simulated drivers beyond the bench's two (SPEC R14.2, ADR 0020): up to four more DA5-Ls, each at
  its own short address, for set-ups in the visualiser and for effects across addresses. They exist
  in the Simulator target only and never reach the hardware.
-->
<script lang="ts">
  import { EXTRA_MIN_ADDRESS, MAX_EXTRAS, type ExtraUnit } from '../../sim/settings.ts';
  import NumberField from '../components/NumberField.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const extras = $derived(app.snap?.extras ?? []);
  let address = $state(EXTRA_MIN_ADDRESS);
  let lightType = $state<ExtraUnit['lightType']>('C5');
  let message = $state('');

  async function set(next: ExtraUnit[], done: string): Promise<void> {
    message = '';
    const r = await app.call({ op: 'extras', extras: next });
    if (!r.ok) {
      message = 'reason' in r ? r.reason : 'Refused.';
      return;
    }
    app.update({ extras: next });
    message = done;
  }

  function add(): void {
    if (extras.some((e) => e.address === address)) {
      message = `A simulated driver is at address ${String(address)} already.`;
      return;
    }
    void set([...extras, { address, lightType }], `Added a driver at address ${String(address)}.`);
  }
</script>

<section class="stack" aria-labelledby="extras-h">
  <h2 id="extras-h">Simulated drivers</h2>
  <p class="muted">
    The bench has two drivers. Up to {MAX_EXTRAS} more can be simulated, each a DA5-L with the default
    settings. They exist in the simulator only. A change turns the drivers that go off and scans again.
  </p>
  {#if extras.length > 0}
    <ul data-testid="extras">
      {#each extras as e (e.address)}
        <li class="row">
          A{e.address}: {e.lightType === 'C2' ? 'C2, tunable white' : 'C5, RGB and two whites'}
          <button
            type="button"
            data-testid={`extra-remove-${String(e.address)}`}
            onclick={() =>
              void set(
                extras.filter((x) => x.address !== e.address),
                `Removed the driver at address ${String(e.address)}.`,
              )}
          >
            Remove
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="row">
    <NumberField
      label="Address"
      value={address}
      min={EXTRA_MIN_ADDRESS}
      max={63}
      onchange={(v: number) => {
        address = v;
      }}
      testid="extra-address"
    />
    <label class="row">
      Light type
      <select bind:value={lightType} data-testid="extra-type">
        <option value="C5">C5, RGB and two whites</option>
        <option value="C2">C2, tunable white</option>
      </select>
    </label>
    <button
      type="button"
      data-testid="extra-add"
      disabled={extras.length >= MAX_EXTRAS}
      onclick={add}
    >
      Add a simulated driver
    </button>
  </div>
  <p role="status" aria-live="polite" data-testid="extras-message">{message}</p>
</section>
