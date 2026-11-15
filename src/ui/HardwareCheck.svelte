<script lang="ts">
  import type { Snapshot } from '../engine/engine.ts';
  import { CHECK_STEPS } from '../engine/hwcheck.ts';
  import type { BusClient } from './bus.ts';

  let { snap, client }: { snap: Snapshot; client: BusClient } = $props();

  let notes = $state<Record<string, string>>({});
  let confirmed = $state<Record<string, boolean>>({});
  let busy = $state('');
  let message = $state('');
  let report = $state('');

  const parts = [2, 3, 4] as const;
  const partTitle: Record<number, string> = {
    2: 'Part 2: read both drivers, before sending any level',
    3: 'Part 3: the transport',
    4: 'Part 4: the safety profile',
  };

  function latest(id: string) {
    return snap.check.filter((r) => r.id === id).at(-1);
  }

  async function step(id: string, skip = false): Promise<void> {
    busy = id;
    message = '';
    const note = notes[id];
    const r = await client.call({
      op: 'check',
      step: id,
      ...(note === undefined || note === '' ? {} : { note }),
      ...(confirmed[id] === true ? { confirmed: true } : {}),
      ...(skip ? { skip: true } : {}),
    });
    busy = '';
    confirmed[id] = false;
    if (!r.ok && 'reason' in r) message = r.reason;
  }

  async function showReport(): Promise<void> {
    const r = await client.call({ op: 'checkReport' });
    if (r.ok && 'text' in r) report = r.text;
  }

  const fileHref = $derived(
    report === '' ? '' : `data:application/json;charset=utf-8,${encodeURIComponent(report)}`,
  );
</script>

<section aria-labelledby="check-h">
  <h2 id="check-h">Hardware check</h2>
  <p class="muted">
    Parts 2 to 4 of the hardware-day checklist. Automatic steps send through the governor like
    anything else. Steps marked "confirm" change a stored value or panic, and some need an unlock.
    Manual steps are for you to do and record. The results are for Stage 12.
  </p>
  {#each parts as part (part)}
    <h3>{partTitle[part]}</h3>
    <ol class="steps">
      {#each CHECK_STEPS.filter((s) => s.part === part) as s (s.id)}
        {@const r = latest(s.id)}
        <li data-testid={`check-${s.id}`}>
          <p>
            <strong>{s.title}</strong>
            <span class="kind"
              >{s.kind}{s.unlock === undefined ? '' : `, needs the ${s.unlock} unlock`}</span
            >
            <span class="status" data-testid="check-status">{r?.status ?? 'not run'}</span>
          </p>
          <p class="muted">{s.how}</p>
          {#if r?.error}<p class="problem">{r.error}</p>{/if}
          <label class="note"
            >Note <textarea rows="1" bind:value={notes[s.id]} aria-label={`Note for ${s.title}`}
            ></textarea></label
          >
          {#if s.kind === 'confirm'}
            <label
              ><input type="checkbox" bind:checked={confirmed[s.id]} /> I know what this step sends</label
            >
          {/if}
          {#if s.kind === 'manual'}
            <button type="button" disabled={busy !== ''} onclick={() => step(s.id)}>Record</button>
          {:else}
            <button type="button" disabled={busy !== ''} onclick={() => step(s.id)}>Run</button>
          {/if}
          <button type="button" disabled={busy !== ''} onclick={() => step(s.id, true)}>Skip</button
          >
        </li>
      {/each}
    </ol>
  {/each}
  <p class="status" role="status" aria-live="polite">{message}</p>
  <div class="actions">
    <button type="button" onclick={showReport}>Show results</button>
    <button type="button" onclick={() => client.call({ op: 'clearCheck' })}>Clear results</button>
    {#if fileHref !== ''}<a href={fileHref} download="hardware-check.json">Save as a file</a>{/if}
  </div>
  {#if report !== ''}
    <textarea
      class="report"
      readonly
      rows="12"
      aria-label="Hardware check results"
      data-testid="check-report">{report}</textarea
    >
  {/if}
</section>

<style>
  h2 {
    font-size: 1.05rem;
    margin: 0 0 0.4rem;
  }
  h3 {
    font-size: 0.95rem;
    margin: 1rem 0 0.4rem;
  }
  .muted {
    color: var(--text-muted);
    margin: 0.2rem 0;
  }
  .steps {
    padding-left: 1.5rem;
  }
  .steps li {
    margin-bottom: 0.8rem;
  }
  .steps p {
    margin: 0.15rem 0;
  }
  .kind,
  .status {
    margin-left: 0.6rem;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .note textarea {
    vertical-align: middle;
    width: 24rem;
  }
  .problem {
    border-left: 4px solid var(--warn);
    padding-left: 0.6rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .report {
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
  }
</style>
