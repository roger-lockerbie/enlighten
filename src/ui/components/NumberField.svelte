<!--
  A number with its unit and range (docs/UI.md section 3). Up and Down step by one, Shift with them by
  ten. A typed value is applied on Enter or when focus leaves, clamped to the range.
-->
<script lang="ts">
  let {
    label,
    value,
    min,
    max,
    step = 1,
    decimals = 0,
    unit = '',
    onchange,
    disabled = false,
    hideLabel = false,
    testid,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    decimals?: number;
    unit?: string;
    onchange: (v: number) => void;
    disabled?: boolean;
    hideLabel?: boolean;
    testid?: string | undefined;
  } = $props();

  const shown = $derived(value.toFixed(decimals));
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  function commit(input: HTMLInputElement): void {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) {
      input.value = shown;
      return;
    }
    const next = clamp(Number(v.toFixed(decimals)));
    input.value = next.toFixed(decimals);
    if (next !== value) onchange(next);
  }

  function key(e: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (e.key === 'Enter') {
      commit(e.currentTarget);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const by = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
    const next = clamp(Number((value + by).toFixed(decimals)));
    if (next !== value) onchange(next);
  }
</script>

<label class="nf" data-testid={testid}>
  <span class={hideLabel ? 'sr-only' : 'lab'}>{label}</span>
  <input
    type="text"
    inputmode="decimal"
    autocomplete="off"
    spellcheck="false"
    value={shown}
    {disabled}
    role="spinbutton"
    aria-valuenow={value}
    aria-valuemin={min}
    aria-valuemax={max}
    onchange={(e) => {
      commit(e.currentTarget);
    }}
    onkeydown={key}
  />
  {#if unit !== ''}<span class="unit muted" aria-hidden="true">{unit}</span>{/if}
</label>

<style>
  .nf {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .lab {
    color: var(--text-muted);
  }
  input {
    width: 7ch;
    text-align: right;
  }
</style>
