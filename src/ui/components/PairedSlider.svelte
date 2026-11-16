<!--
  A slider with two linked fields: % and arc level, or K and mirek (docs/UI.md section 3, SPEC R13.2).
  The slider and the right-hand field work in the right-hand unit, so the arrow keys step by one of it,
  and by ten with Shift. Home goes to the minimum and End to the ceiling, or the maximum. Markers show
  the driver's minimum and the ceiling. What was sent, or why not, shows below.
-->
<script lang="ts">
  import NumberField from './NumberField.svelte';
  import StatusChip, { type ChipKind } from './StatusChip.svelte';

  interface Side {
    readonly label: string;
    readonly unit: string;
    readonly decimals: number;
    readonly step: number;
    readonly min: number;
    readonly max: number;
    /** From the slider's unit to this field's. */
    readonly to: (v: number) => number;
    /** From this field's unit to the slider's, rounded to a whole step. */
    readonly from: (n: number) => number;
  }

  let {
    label,
    value,
    min,
    max,
    right,
    left,
    reverse = false,
    end,
    home,
    markers = [],
    feedback,
    disabled = false,
    onchange,
    onenter,
    testid,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    right: { readonly label: string; readonly unit: string };
    left: Side;
    /** Draw the high end on the left, as for mirek, so warm is on the left. */
    reverse?: boolean;
    /** Where End goes: the ceiling. */
    end?: number;
    /** Where Home goes: the driver's minimum. */
    home?: number;
    markers?: readonly { readonly at: number; readonly label: string }[];
    feedback?: { readonly state: ChipKind; readonly text: string } | undefined;
    disabled?: boolean;
    onchange: (v: number, live: boolean) => void;
    /** Enter on the slider: Apply, in Commit mode. */
    onenter?: (() => void) | undefined;
    testid?: string | undefined;
  } = $props();

  const span = $derived(Math.max(1, max - min));
  const pos = (v: number) => {
    const p = ((Math.min(max, Math.max(min, v)) - min) / span) * 100;
    return reverse ? 100 - p : p;
  };
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));

  function key(e: KeyboardEvent): void {
    let next: number | undefined;
    const by = e.shiftKey ? 10 : 1;
    // Right and Up move the thumb right or up on screen, whichever way the values run.
    const dir = reverse ? -1 : 1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + by * dir;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - by * dir;
        break;
      case 'PageUp':
        next = value + 10 * dir;
        break;
      case 'PageDown':
        next = value - 10 * dir;
        break;
      case 'Home':
        next = home ?? min;
        break;
      case 'End':
        next = end ?? max;
        break;
      case 'Enter':
        if (onenter !== undefined) {
          e.preventDefault();
          onenter();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    const v = clamp(next);
    if (v !== value) onchange(v, true);
  }
</script>

<div class="ps" data-testid={testid}>
  <div class="head">
    <span class="label">{label}</span>
    <span class="fields">
      <NumberField
        label={`${label}, ${left.label}`}
        hideLabel
        value={left.to(value)}
        min={left.min}
        max={left.max}
        step={left.step}
        decimals={left.decimals}
        unit={left.unit}
        {disabled}
        testid={testid === undefined ? undefined : `${testid}-left`}
        onchange={(n: number) => {
          onchange(clamp(left.from(n)), false);
        }}
      />
      <NumberField
        label={`${label}, ${right.label}`}
        hideLabel
        {value}
        {min}
        {max}
        unit={right.unit}
        {disabled}
        testid={testid === undefined ? undefined : `${testid}-right`}
        onchange={(n: number) => {
          onchange(clamp(n), false);
        }}
      />
    </span>
  </div>
  <div class="track">
    <div
      class="fill"
      class:reverse
      style:--fill={`${String(reverse ? 100 - pos(value) : pos(value))}%`}
    ></div>
    <input
      type="range"
      {min}
      {max}
      step="1"
      {value}
      dir={reverse ? 'rtl' : 'ltr'}
      {disabled}
      aria-label={label}
      aria-valuetext={`${left.to(value).toFixed(left.decimals)} ${left.unit}, ${String(value)} ${right.unit}`}
      oninput={(e) => {
        onchange(Number(e.currentTarget.value), true);
      }}
      onkeydown={key}
    />
    {#each markers as m (m.label)}
      <span class="marker" style:left={`${String(pos(m.at))}%`} aria-hidden="true"></span>
    {/each}
  </div>
  {#if markers.length > 0}
    <div class="legend muted small">
      {#each markers as m (m.label)}<span>{m.label}</span>{/each}
    </div>
  {/if}
  {#if feedback !== undefined}
    <p
      class="feedback small"
      role="status"
      data-testid={testid === undefined ? undefined : `${testid}-feedback`}
    >
      <StatusChip kind={feedback.state} />
      {feedback.text}
    </p>
  {/if}
</div>

<style>
  .ps {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }
  .fields {
    display: inline-flex;
    gap: var(--space-2);
  }
  .track {
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }
  .fill {
    position: absolute;
    left: 0;
    height: 4px;
    width: var(--fill);
    background: var(--accent);
    border-radius: var(--radius);
    pointer-events: none;
  }
  .fill.reverse {
    left: auto;
    right: 0;
  }
  input[type='range'] {
    position: relative;
    width: 100%;
    margin: 0;
    background: transparent;
    accent-color: var(--accent);
  }
  .marker {
    position: absolute;
    top: 0;
    width: 2px;
    height: 20px;
    margin-left: -1px;
    background: var(--text-muted);
    pointer-events: none;
  }
  .legend {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .feedback {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
