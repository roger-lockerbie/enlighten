<!--
  The simulator's profile settings (SPEC R1.6): each unknown from the research, with its default,
  where the default comes from, and how hardware day settles it. A change rebuilds the simulated unit
  with every setting applied and the driver off. These settings never reach the hardware.
-->
<script lang="ts">
  import { DEFAULT_SETTINGS, SETTINGS_INFO, type Da5lSettings } from '../../sim/profile.ts';
  import {
    DEFAULT_SETUP,
    SETTING_EDIT,
    type BenchUnit,
    type UnitSetup,
  } from '../../sim/settings.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  let unit = $state<BenchUnit>('A');
  let message = $state('');
  const setup = $derived(
    app.snap?.bench.find((b) => b.unit === unit)?.setup ?? DEFAULT_SETUP[unit],
  );

  function value(key: keyof Da5lSettings): unknown {
    return Object.prototype.hasOwnProperty.call(setup.settings, key)
      ? setup.settings[key]
      : DEFAULT_SETTINGS[key];
  }

  function label(info: (typeof SETTINGS_INFO)[number], v: string | number | boolean): string {
    const e = SETTING_EDIT[info.key];
    if (e.kind !== 'choice') return String(v);
    if (v === e.values[0]) return `${info.default} (default)`;
    if (v === e.values[1]) return info.alternative;
    return String(v);
  }

  async function apply(next: UnitSetup): Promise<void> {
    message = '';
    const r = await app.call({ op: 'bench', setup: { [unit]: next } });
    if (!r.ok) {
      message = 'reason' in r ? r.reason : 'Refused.';
      return;
    }
    app.update({ bench: { ...app.prefs.bench, [unit]: next } });
    message = `Unit ${unit} rebuilt, off, and scanned again.`;
  }

  function set(key: keyof Da5lSettings, v: unknown): void {
    const settings = Object.fromEntries(
      Object.entries({ ...setup.settings, [key]: v }).filter(
        ([k, x]) => x !== DEFAULT_SETTINGS[k as keyof Da5lSettings],
      ),
    );
    void apply({ presentation: setup.presentation, settings });
  }

  function decode(key: keyof Da5lSettings, raw: string): unknown {
    const e = SETTING_EDIT[key];
    if (e.kind !== 'choice') return Number(raw);
    return e.values.find((x) => String(x) === raw);
  }
</script>

<section class="stack" aria-labelledby="sim-h" data-testid="sim-settings">
  <h2 id="sim-h">Simulator settings</h2>
  <p class="muted">
    These shape the simulated bench only and never reach the hardware. Changing one rebuilds that
    unit with the driver off, then scans it and writes its safety profile again.
  </p>
  <div class="row">
    <label class="row">
      <span class="muted">Unit</span>
      <select bind:value={unit} data-testid="sim-unit">
        <option value="A">A: DA5-L in C2 (tape A)</option>
        <option value="B">B: DA5-L in C5 (tape B)</option>
      </select>
    </label>
    <label class="row">
      <span class="muted">Presents colour as</span>
      <select
        value={setup.presentation}
        data-testid="sim-presentation"
        onchange={(e) =>
          void apply({
            presentation: e.currentTarget.value === 'tc' ? 'tc' : 'rgbwaf',
            settings: setup.settings,
          })}
      >
        <option value="tc">Tc (colour temperature)</option>
        <option value="rgbwaf">RGBWAF channels</option>
      </select>
    </label>
    <button
      type="button"
      onclick={() => void apply(DEFAULT_SETUP[unit])}
      disabled={Object.keys(setup.settings).length === 0 &&
        setup.presentation === DEFAULT_SETUP[unit].presentation}
    >
      Back to the defaults
    </button>
  </div>
  {#if message !== ''}<p role="status" data-testid="sim-message">{message}</p>{/if}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th scope="col">Unknown</th>
          <th scope="col">Value</th>
          <th scope="col">Source of the default</th>
          <th scope="col">Hardware day</th>
        </tr>
      </thead>
      <tbody>
        {#each SETTINGS_INFO as info (info.key)}
          {@const e = SETTING_EDIT[info.key]}
          {@const v = value(info.key)}
          <tr data-testid={`setting-${info.key}`}>
            <th scope="row">{info.unknown}</th>
            <td>
              {#if e.kind === 'choice'}
                <select
                  aria-label={info.unknown}
                  value={String(v)}
                  onchange={(ev) => {
                    set(info.key, decode(info.key, ev.currentTarget.value));
                  }}
                >
                  {#each e.values as c (String(c))}
                    <option value={String(c)}>{label(info, c)}</option>
                  {/each}
                </select>
              {:else if e.kind === 'range'}
                <input
                  type="number"
                  aria-label={info.unknown}
                  min={e.min}
                  max={e.max}
                  value={Number(v)}
                  onchange={(ev) => {
                    const n = Number(ev.currentTarget.value);
                    if (Number.isInteger(n) && n >= e.min && n <= e.max) set(info.key, n);
                    else ev.currentTarget.value = String(v);
                  }}
                />
              {:else}
                <span>{info.default}</span>
                <span class="muted small">(fixed in this version)</span>
              {/if}
              {#if v !== DEFAULT_SETTINGS[info.key] && e.kind !== 'fixed'}
                <span class="muted small">changed</span>
              {/if}
            </td>
            <td class="small">{info.source}</td>
            <td class="small">{info.hardwareDay}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
  }
  input[type='number'] {
    width: 8ch;
  }
</style>
