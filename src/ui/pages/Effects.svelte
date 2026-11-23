<!--
  Effects (SPEC R4, docs/UI.md section 1): the built-in effects with their settings as sliders, what
  each costs the bus, and the check against the governor. An effect moves around the level a light
  is at, so set levels on the Playground first. It can be aimed at any drivers there are, simulated
  ones included.
-->
<script lang="ts">
  import { withFloors } from '../../bus/timing.ts';
  import {
    defaultParams,
    EFFECTS,
    effectSpec,
    MAX_EFFECTS,
    planEffect,
    type EffectDef,
    type EffectId,
  } from '../../design/effects.ts';
  import { planCost, type Driver } from '../../design/plan.ts';
  import { MAX_NAME } from '../../design/schema.ts';
  import { driversFrom } from '../../engine/drivers.ts';
  import type { RunDef } from '../../engine/engine.ts';
  import NumberField from '../components/NumberField.svelte';
  import { designOf } from '../design.svelte.ts';
  import PlanPreview from '../design/PlanPreview.svelte';
  import RunBar from '../design/RunBar.svelte';
  import BenchPreview from '../playground/BenchPreview.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const design = $derived(designOf(app));
  const saved = $derived(design.value.effects);
  const snap = $derived(app.snap);
  const ceiling = $derived(snap?.ceilingArc ?? 220);
  // As text first, so the plan is made again only when something about the drivers changes.
  const driversText = $derived(JSON.stringify(driversFrom(snap?.devices ?? [], snap?.light ?? [])));
  const drivers = $derived(JSON.parse(driversText) as Driver[]);
  const timing = withFloors({});

  let type = $state<EffectId>('breathe');
  let params = $state<Record<string, number>>(defaultParams('breathe'));
  let targets = $state<number[]>([]);
  let name = $state('');
  let editing = $state<string | undefined>(undefined);
  let message = $state('');
  const spec = $derived(effectSpec(type));

  // Until a person chooses, an effect is aimed at every driver there is.
  let chosen = $state(false);
  const aimed = $derived(chosen ? targets : drivers.map((d) => d.address));

  function choose(id: EffectId): void {
    type = id;
    params = defaultParams(id);
    editing = undefined;
    name = '';
    message = '';
  }

  function load(e: EffectDef): void {
    type = e.type;
    params = { ...e.params };
    targets = [...e.targets];
    chosen = true;
    name = e.name;
    editing = e.name;
    message = '';
  }

  function toggle(address: number, on: boolean): void {
    const now = aimed.filter((n) => n !== address);
    targets = on ? [...now, address] : now;
    chosen = true;
  }

  const def = $derived<EffectDef>({
    name: name.trim() === '' ? spec.name : name.trim(),
    type,
    params,
    targets: aimed,
  });
  const made = $derived(planEffect(def, drivers, ceiling));
  const plan = $derived(made.ok ? made.value : undefined);
  const run = $derived<RunDef | undefined>(
    plan !== undefined && plan.rows.length > 0 ? { kind: 'effect', effect: def } : undefined,
  );
  const auto = (address: number) => drivers.find((d) => d.address === address)?.auto ?? false;
  const cost = $derived(plan === undefined ? undefined : planCost(plan, auto, timing));

  function save(): void {
    const n = name.trim();
    if (n === '') {
      message = 'An effect needs a name to be saved.';
      return;
    }
    const others = saved.filter((e) => e.name !== editing);
    if (others.some((e) => e.name === n)) {
      message = 'Another effect has that name.';
      return;
    }
    if (others.length >= MAX_EFFECTS) {
      message = `At most ${String(MAX_EFFECTS)} effects can be kept.`;
      return;
    }
    design.set({ ...design.value, effects: [...others, { ...def, name: n }] });
    editing = n;
    message = `Saved "${n}".`;
  }

  function remove(e: EffectDef): void {
    design.set({ ...design.value, effects: saved.filter((x) => x.name !== e.name) });
    if (editing === e.name) editing = undefined;
    message = `Removed "${e.name}".`;
  }
</script>

<div class="page stack">
  <h1>Effects</h1>
  {#if snap === undefined || !design.loaded}
    <p class="muted">Starting.</p>
  {:else}
    <section class="stack" aria-labelledby="choose-h">
      <h2 id="choose-h">Effect</h2>
      <div class="row wrap" role="group" aria-label="Effect" data-testid="effects">
        {#each EFFECTS as e (e.id)}
          <button
            type="button"
            aria-pressed={type === e.id}
            data-testid={`effect-${e.id}`}
            onclick={() => {
              choose(e.id);
            }}>{e.name}</button
          >
        {/each}
      </div>
      <p data-testid="effect-about">
        {spec.about}
        {spec.repeating ? 'It runs until it is stopped.' : 'It runs once.'}
      </p>
    </section>

    <section class="card stack" aria-labelledby="settings-h">
      <h2 id="settings-h">Settings</h2>
      {#each spec.params as x (x.key)}
        <div class="row setting">
          <label class="row grow"
            ><span class="label">{x.label}</span>
            <input
              type="range"
              min={x.min}
              max={x.max}
              step={x.step}
              value={params[x.key] ?? x.default}
              data-testid={`param-${x.key}-slider`}
              oninput={(e) => {
                params = { ...params, [x.key]: Number(e.currentTarget.value) };
              }}
            /></label
          >
          <NumberField
            label={x.label}
            hideLabel
            value={params[x.key] ?? x.default}
            min={x.min}
            max={x.max}
            step={x.step}
            decimals={x.step < 1 ? 1 : 0}
            unit={x.unit}
            onchange={(v: number) => {
              params = { ...params, [x.key]: v };
            }}
            testid={`param-${x.key}`}
          />
        </div>
      {/each}

      <fieldset class="row wrap">
        <legend>Drivers, in the order chosen</legend>
        {#if snap.devices.length === 0}
          <span class="muted">No driver answered the scan. See Devices.</span>
        {/if}
        {#each snap.devices as d (d.address)}
          <label class="row"
            ><input
              type="checkbox"
              checked={aimed.includes(d.address)}
              data-testid={`target-${String(d.address)}`}
              onchange={(e) => {
                toggle(d.address, e.currentTarget.checked);
              }}
            />{app.name(d.address)}{aimed.includes(d.address) && aimed.length > 1
              ? ` (${String(aimed.indexOf(d.address) + 1)})`
              : ''}</label
          >
        {/each}
      </fieldset>

      {#if !made.ok}
        <p class="warn-text" role="status" data-testid="effect-problem">{made.reason}</p>
      {:else if cost !== undefined}
        <div class="stack" data-testid="effect-cost">
          <h3>Bus cost</h3>
          <p>
            {(cost.busShare * 100).toFixed(1)}% of the bus{made.value.periodMs === undefined
              ? ' while it runs'
              : ''}.
          </p>
          <meter
            min="0"
            max="1"
            value={cost.busShare}
            aria-label="Share of the bus this effect uses"
          ></meter>
          <ul class="small">
            {#each [...cost.perAddress] as [address, perSecond] (address)}
              <li data-testid={`cost-${String(address)}`}>
                {app.name(address)}: {perSecond.toFixed(2)} frames a second
              </li>
            {/each}
          </ul>
        </div>
        <h3>Preview</h3>
        <PlanPreview plan={made.value} {auto} />
      {/if}
      <RunBar {app} def={run} {plan} name={def.name} />
    </section>

    <section class="stack" aria-labelledby="saved-h">
      <h2 id="saved-h">Saved</h2>
      <div class="row">
        <label class="row"
          >Name <input
            type="text"
            maxlength={MAX_NAME}
            bind:value={name}
            autocomplete="off"
            data-testid="effect-name"
          /></label
        >
        <button type="button" data-testid="effect-save" onclick={save}>Save these settings</button>
      </div>
      {#if saved.length === 0}
        <p class="muted">No effects saved yet.</p>
      {:else}
        <table data-testid="saved-effects">
          <thead>
            <tr
              ><th scope="col">Name</th><th scope="col">Effect</th><th scope="col">Drivers</th><th
                scope="col">Actions</th
              ></tr
            >
          </thead>
          <tbody>
            {#each saved as e (e.name)}
              <tr>
                <th scope="row">{e.name}</th>
                <td>{effectSpec(e.type).name}</td>
                <td>{e.targets.map((n) => `A${String(n)}`).join(', ')}</td>
                <td class="row">
                  <button
                    type="button"
                    aria-label={`Open ${e.name}`}
                    onclick={() => {
                      load(e);
                    }}>Open</button
                  >
                  <button
                    type="button"
                    aria-label={`Remove ${e.name}`}
                    onclick={() => {
                      remove(e);
                    }}>Remove</button
                  >
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <p role="status" aria-live="polite" data-testid="effects-message">{message}</p>
    <BenchPreview {app} light={snap.light} />
  {/if}
</div>

<style>
  .wrap {
    flex-wrap: wrap;
  }
  .grow {
    flex: 1 1 16rem;
  }
  .grow input {
    flex: 1 1 auto;
  }
  .label {
    min-width: 14rem;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent);
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-underline-offset: 4px;
  }
  meter {
    width: 16rem;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
