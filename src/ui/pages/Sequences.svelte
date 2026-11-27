<!--
  Sequences (SPEC R5.4 to R5.6, docs/UI.md section 1): timed plans. A sequence is a list of steps,
  each a target, a level, a colour and a duration. The planner uses the drivers' own fades where one
  fits and chains them where none does, and every change and frame is shown before anything runs.
-->
<script lang="ts">
  import { broadcast, group, short, type Address } from '../../dali/address.ts';
  import type { LookColour } from '../../design/look.ts';
  import { planSequence, type Driver } from '../../design/plan.ts';
  import { PRESETS } from '../../design/presets.ts';
  import { MAX_NAME } from '../../design/schema.ts';
  import { MAX_SEQUENCES, MAX_STEPS, type Sequence, type Step } from '../../design/sequence.ts';
  import { colourText, levelText, timeText } from '../../design/text.ts';
  import { driversFrom } from '../../engine/drivers.ts';
  import type { RunDef } from '../../engine/engine.ts';
  import NumberField from '../components/NumberField.svelte';
  import Toggle from '../components/Toggle.svelte';
  import { designOf } from '../design.svelte.ts';
  import LookFields from '../design/LookFields.svelte';
  import PlanPreview from '../design/PlanPreview.svelte';
  import RunBar from '../design/RunBar.svelte';
  import BenchPreview from '../playground/BenchPreview.svelte';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const design = $derived(designOf(app));
  const saved = $derived(design.value.sequences);
  const snap = $derived(app.snap);
  const ceiling = $derived(snap?.ceilingArc ?? 220);
  // The drivers as text first, so the plan is made again only when something about them changes,
  // not on every snapshot.
  const driversText = $derived(JSON.stringify(driversFrom(snap?.devices ?? [], snap?.light ?? [])));
  const drivers = $derived(JSON.parse(driversText) as Driver[]);

  let message = $state('');
  // The sequence being edited. It is kept only on Save, and it is what Check and Run use.
  let name = $state('');
  let steps = $state<Step[]>([]);
  let editing = $state<string | undefined>(undefined);
  let open = $state(false);
  let expanded = $state<number | undefined>(undefined);

  function load(q: Sequence, as: string | undefined): void {
    name = q.name;
    steps = q.steps.map((s) => ({ ...s }));
    editing = as;
    open = true;
    expanded = undefined;
    message = '';
  }

  const targetValue = (a: Address): string =>
    a.kind === 'short' ? `a${String(a.n)}` : a.kind === 'group' ? `g${String(a.n)}` : 'all';
  const targetFrom = (v: string): Address =>
    v === 'all'
      ? broadcast
      : v.startsWith('g')
        ? group(Number(v.slice(1)))
        : short(Number(v.slice(1)));

  function change(i: number, part: Partial<Step>): void {
    steps = steps.map((s, k) => (k === i ? { ...s, ...part } : s));
  }

  function together(i: number, on: boolean): void {
    steps = steps.map((s, k) => {
      if (k !== i) return s;
      const rest: Step = {
        target: s.target,
        arc: s.arc,
        colour: s.colour,
        durationMs: s.durationMs,
      };
      return on ? { ...rest, together: true } : rest;
    });
  }

  function add(): void {
    if (steps.length >= MAX_STEPS) return;
    const last = steps.at(-1);
    steps = [
      ...steps,
      {
        target: last?.target ?? (drivers[0] === undefined ? broadcast : short(drivers[0].address)),
        arc: last?.arc ?? Math.min(150, ceiling),
        colour: { kind: 'none' },
        durationMs: 4000,
      },
    ];
    expanded = steps.length - 1;
  }

  function removeStep(i: number): void {
    steps = steps.filter((_s, k) => k !== i);
    expanded = undefined;
  }

  const current = $derived<Sequence>({ name: name.trim(), steps });
  const made = $derived(
    open && steps.length > 0 ? planSequence(current, drivers, ceiling) : undefined,
  );
  const plan = $derived(made?.ok === true ? made.value : undefined);
  const def = $derived<RunDef | undefined>(
    plan !== undefined && plan.rows.length > 0
      ? {
          kind: 'sequence',
          sequence: { name: current.name === '' ? 'Untitled' : current.name, steps },
        }
      : undefined,
  );
  const auto = (address: number) => drivers.find((d) => d.address === address)?.auto ?? false;

  function save(): void {
    const n = name.trim();
    if (n === '') {
      message = 'A sequence needs a name.';
      return;
    }
    if (steps.length === 0) {
      message = 'A sequence needs at least one step.';
      return;
    }
    const others = saved.filter((q) => q.name !== editing);
    if (others.some((q) => q.name === n)) {
      message = 'Another sequence has that name.';
      return;
    }
    if (others.length >= MAX_SEQUENCES) {
      message = `At most ${String(MAX_SEQUENCES)} sequences can be kept.`;
      return;
    }
    design.set({ ...design.value, sequences: [...others, { name: n, steps }] });
    editing = n;
    message = `Saved "${n}".`;
  }

  function remove(q: Sequence): void {
    design.set({ ...design.value, sequences: saved.filter((x) => x.name !== q.name) });
    if (editing === q.name) open = false;
    message = `Removed "${q.name}".`;
  }

  const total = (q: Sequence): number => {
    let start = 0;
    let end = 0;
    for (const [i, s] of q.steps.entries()) {
      if (s.together !== true || i === 0) start = end;
      end = Math.max(s.together === true ? end : 0, start + s.durationMs);
    }
    return end;
  };
</script>

<div class="page stack">
  <h1>Sequences</h1>
  {#if snap === undefined || !design.loaded}
    <p class="muted">Starting.</p>
  {:else}
    <section class="stack" aria-labelledby="presets-h">
      <h2 id="presets-h">Built in</h2>
      <p class="muted">
        Each is made for the drivers there are now. Open one to see every change before it runs.
      </p>
      <ul class="stack" data-testid="presets">
        {#each PRESETS as p (p.id)}
          <li class="row">
            <button
              type="button"
              data-testid={`preset-${p.id}`}
              onclick={() => {
                load(p.build(drivers), undefined);
              }}
            >
              {p.name}
            </button>
            <span>{p.about}</span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="stack" aria-labelledby="saved-h">
      <h2 id="saved-h">Saved</h2>
      {#if saved.length === 0}
        <p class="muted">No sequences saved yet.</p>
      {:else}
        <table data-testid="sequences">
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Steps</th><th scope="col">Length</th><th
                scope="col"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {#each saved as q (q.name)}
              <tr>
                <th scope="row">{q.name}</th>
                <td>{q.steps.length}</td>
                <td>{timeText(total(q))}</td>
                <td class="row">
                  <button
                    type="button"
                    aria-label={`Open ${q.name}`}
                    onclick={() => {
                      load(q, q.name);
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${q.name}`}
                    onclick={() => {
                      remove(q);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <div class="row">
        <button
          type="button"
          data-testid="sequence-new"
          onclick={() => {
            load({ name: '', steps: [] }, undefined);
          }}
        >
          New sequence
        </button>
      </div>
    </section>

    {#if open}
      <section class="card stack" aria-labelledby="editor-h" data-testid="sequence-editor">
        <h2 id="editor-h">{editing === undefined ? 'Sequence' : `"${editing}"`}</h2>
        <label class="row">
          Name <input
            type="text"
            maxlength={MAX_NAME}
            bind:value={name}
            autocomplete="off"
            data-testid="sequence-name"
          />
        </label>
        {#if steps.length === 0}
          <p class="muted">No steps yet.</p>
        {/if}
        <ol class="stack steps">
          {#each steps as s, i (i)}
            <li class="stack step" data-testid={`step-${String(i)}`}>
              <div class="row">
                <label class="row">
                  Target
                  <select
                    value={targetValue(s.target)}
                    data-testid={`step-${String(i)}-target`}
                    onchange={(e) => {
                      change(i, { target: targetFrom(e.currentTarget.value) });
                    }}
                  >
                    <option value="all">every driver</option>
                    {#each snap.devices as d (d.address)}
                      <option value={`a${String(d.address)}`}>{app.name(d.address)}</option>
                    {/each}
                    {#if s.target.kind === 'short' && !snap.devices.some((d) => s.target.kind === 'short' && d.address === s.target.n)}
                      <option value={targetValue(s.target)}>A{s.target.n} (no driver)</option>
                    {/if}
                    {#each Array.from({ length: 16 }, (_, g) => g) as g (g)}
                      <option value={`g${String(g)}`}>group {g}</option>
                    {/each}
                  </select>
                </label>
                <span data-testid={`step-${String(i)}-text`}>
                  to {levelText(s.arc)}, {colourText(s.colour)}
                </span>
                <button
                  type="button"
                  aria-expanded={expanded === i}
                  data-testid={`step-${String(i)}-edit`}
                  onclick={() => {
                    expanded = expanded === i ? undefined : i;
                  }}
                >
                  Level and colour
                </button>
              </div>
              <div class="row">
                <NumberField
                  label="Minutes"
                  value={Math.floor(s.durationMs / 60_000)}
                  min={0}
                  max={1440}
                  unit="min"
                  onchange={(m: number) => {
                    change(i, {
                      durationMs: Math.min(86_400_000, m * 60_000 + (s.durationMs % 60_000)),
                    });
                  }}
                  testid={`step-${String(i)}-min`}
                />
                <NumberField
                  label="Seconds"
                  value={(s.durationMs % 60_000) / 1000}
                  min={0}
                  max={59.9}
                  step={1}
                  decimals={1}
                  unit="s"
                  onchange={(sec: number) => {
                    change(i, {
                      durationMs:
                        Math.floor(s.durationMs / 60_000) * 60_000 + Math.round(sec * 1000),
                    });
                  }}
                  testid={`step-${String(i)}-s`}
                />
                {#if i > 0}
                  <Toggle
                    label="With the step above"
                    checked={s.together === true}
                    onchange={(on: boolean) => {
                      together(i, on);
                    }}
                    testid={`step-${String(i)}-together`}
                  />
                {/if}
                <button
                  type="button"
                  aria-label={`Remove step ${String(i + 1)}`}
                  onclick={() => {
                    removeStep(i);
                  }}
                >
                  Remove
                </button>
              </div>
              {#if expanded === i}
                <LookFields
                  arc={s.arc}
                  colour={s.colour}
                  {ceiling}
                  onchange={(a: number, c: LookColour) => {
                    change(i, { arc: a, colour: c });
                  }}
                  testid={`step-${String(i)}-look`}
                />
              {/if}
            </li>
          {/each}
        </ol>
        <div class="row">
          <button
            type="button"
            data-testid="step-add"
            disabled={steps.length >= MAX_STEPS}
            onclick={add}
          >
            Add a step
          </button>
          <button type="button" data-testid="sequence-save" onclick={save}>Save</button>
          <button
            type="button"
            onclick={() => {
              open = false;
            }}
          >
            Close
          </button>
        </div>

        <h3>Preview</h3>
        {#if made === undefined}
          <p class="muted">Add a step to see the plan.</p>
        {:else if !made.ok}
          <p class="warn-text" data-testid="plan-problem">{made.reason}</p>
        {:else}
          <PlanPreview plan={made.value} {auto} />
        {/if}
        <RunBar {app} {def} {plan} name={current.name === '' ? 'Untitled' : current.name} />
      </section>
    {/if}

    <p role="status" aria-live="polite" data-testid="sequences-message">{message}</p>
    <BenchPreview {app} light={snap.light} />
  {/if}
</div>

<style>
  .steps {
    padding-left: var(--space-5);
  }
  .step {
    border-bottom: 1px solid var(--line);
    padding-bottom: var(--space-2);
  }
  .warn-text {
    color: var(--warn);
  }
</style>
