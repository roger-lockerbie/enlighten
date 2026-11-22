<!--
  Check, run, stop and export for a sequence or an effect (SPEC R4.2, R5.4, R5.6). The worker plans
  the definition again and checks it on a copy of the bench before anything runs. The export is a
  download from a data: URL, since the app makes no blob URLs.
-->
<script lang="ts">
  import { fileName, toCsv, toJson } from '../../design/export.ts';
  import type { Plan } from '../../design/plan.ts';
  import { timeText } from '../../design/text.ts';
  import type { RunDef } from '../../engine/engine.ts';
  import StatusChip from '../components/StatusChip.svelte';
  import type { AppState } from '../state.svelte.ts';

  let {
    app,
    def,
    plan,
    name,
  }: {
    app: AppState;
    /** What would run, or undefined while it cannot be planned. */
    def: RunDef | undefined;
    plan: Plan | undefined;
    name: string;
  } = $props();

  const snap = $derived(app.snap);
  const run = $derived(snap?.run);
  const onHardware = $derived(snap !== undefined && snap.target !== 'simulator');
  // An answer is shown only while what it was about is unchanged.
  const key = $derived(JSON.stringify(def));
  let answer = $state<{ key: string; ok: boolean; text: string } | undefined>(undefined);
  const message = $derived(answer?.key === key ? answer : undefined);
  let busy = $state(false);

  async function call(op: 'planCheck' | 'runPlan'): Promise<void> {
    if (def === undefined) return;
    const asked = key;
    busy = true;
    answer = undefined;
    const r = await app.call({ op, run: def });
    busy = false;
    answer = r.ok
      ? { key: asked, ok: true, text: 'text' in r ? r.text : 'Started.' }
      : { key: asked, ok: false, text: 'reason' in r ? r.reason : 'Refused.' };
  }

  // The file is made when the link is used, not each time the plan changes: a long plan is about a
  // megabyte, and the plan is made again on every change of a run.
  function fill(link: HTMLAnchorElement, type: string, text: string): void {
    link.href = `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
  }
</script>

<div class="stack" data-testid="run-bar">
  <div class="row">
    <button
      type="button"
      data-testid="run-check"
      disabled={def === undefined || busy}
      onclick={() => void call('planCheck')}>Check</button
    >
    <button
      type="button"
      class="primary"
      data-testid="run-start"
      disabled={def === undefined || busy || run !== undefined}
      onclick={() => void call('runPlan')}>Run</button
    >
    <button
      type="button"
      data-testid="run-stop"
      disabled={run === undefined}
      onclick={() => void app.call({ op: 'stopRun' })}>Stop</button
    >
    {#if plan !== undefined && def !== undefined && plan.rows.length > 0}
      <a
        class="button"
        data-testid="export-csv"
        download={fileName(name, 'csv')}
        href="#export-csv"
        onclick={(e) => {
          fill(e.currentTarget, 'text/csv', toCsv(plan));
        }}>Export CSV</a
      >
      <a
        class="button"
        data-testid="export-json"
        download={fileName(name, 'json')}
        href="#export-json"
        onclick={(e) => {
          fill(e.currentTarget, 'application/json', toJson(name, def.kind, plan));
        }}>Export JSON</a
      >
    {/if}
  </div>
  {#if onHardware}
    <p class="muted small">
      On hardware a plan is not checked ahead. The governor judges each change as it is sent, and
      under the holding rules it refuses colour fades and changes to more than one driver at a time.
    </p>
  {/if}
  {#if busy}
    <p class="muted" role="status">Checking against the governor.</p>
  {/if}
  {#if message !== undefined}
    <p class="row" role="status" data-testid="run-message">
      <StatusChip kind={message.ok ? 'verified' : 'refused'} />{message.text}
    </p>
  {/if}
  {#if run !== undefined}
    <p class="row" role="status" data-testid="run-status">
      <StatusChip kind="waiting" />
      Running: "{run.name}", change {run.row} of {run.rows}{run.cycle > 0
        ? `, pass ${String(run.cycle + 1)}`
        : ''}, {timeText(run.elapsedMs)}{run.endMs === undefined
        ? ''
        : ` of ${timeText(run.endMs)}`}.
      {run.lateMs > 100 ? `Latest change ${timeText(run.lateMs)} after its time.` : ''}
    </p>
  {:else if snap?.lastRun !== undefined}
    <p class="row" role="status" data-testid="run-ended">
      <StatusChip kind={snap.lastRun.outcome === 'finished' ? 'verified' : 'refused'} />
      "{snap.lastRun.name}": {snap.lastRun.text}
    </p>
  {/if}
</div>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    min-height: 28px;
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }
</style>
