<!--
  The preview of a plan (SPEC R5.4): what the planner left out or changed, every change with its
  time, and every frame with its time as the planner expects the bus to carry it.
-->
<script lang="ts">
  import { withFloors } from '../../bus/timing.ts';
  import { planFramesOf, rowText, type Plan } from '../../design/plan.ts';
  import { timeText } from '../../design/text.ts';

  let {
    plan,
    auto,
  }: {
    plan: Plan;
    /** Whether an address brings a loaded colour in with a level. */
    auto: (address: number) => boolean;
  } = $props();

  const timing = withFloors({});
  /** The page draws at most this many frames. The count is always given. */
  const SHOWN = 2000;
  const frames = $derived(planFramesOf(plan, auto, timing));
  const precise = (ms: number) => `${(ms / 1000).toFixed(3)} s`;
</script>

<div class="stack" data-testid="plan-preview">
  {#if plan.notes.length > 0}
    <ul class="warn-text small" data-testid="plan-notes">
      {#each plan.notes as n (n)}<li>{n}</li>{/each}
    </ul>
  {/if}
  <p class="muted small" data-testid="plan-summary">
    {plan.rows.length} changes and {frames.length} frames{plan.periodMs === undefined
      ? `, ending at ${timeText(plan.endMs)}`
      : `, starting again every ${timeText(plan.periodMs)}`}.
  </p>
  <div class="scroll">
    <table data-testid="plan-rows">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Address</th>
          <th scope="col">Command</th>
          <th scope="col">Values</th>
          <th scope="col">Fade</th>
        </tr>
      </thead>
      <tbody>
        {#each plan.rows as r, i (i)}
          {@const t = rowText(r)}
          <tr>
            <td>{timeText(r.atMs)}</td>
            <td>A{r.address}</td>
            <td>{t.command}</td>
            <td>{t.values}</td>
            <td>{t.fade}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <details>
    <summary data-testid="plan-frames-toggle">Every frame and its time</summary>
    <div class="scroll frames">
      <table data-testid="plan-frames">
        <thead>
          <tr><th scope="col">Time</th><th scope="col">Address</th><th scope="col">Frame</th></tr>
        </thead>
        <tbody>
          {#each frames.slice(0, SHOWN) as f, i (i)}
            <tr><td>{precise(f.atMs)}</td><td>A{f.address}</td><td>{f.text}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if frames.length > SHOWN}
      <p class="muted small">
        The first {SHOWN} of {frames.length} frames are shown. The export has every change.
      </p>
    {/if}
  </details>
</div>

<style>
  .scroll {
    overflow: auto;
    max-height: 22rem;
  }
  .warn-text {
    color: var(--warn);
  }
</style>
