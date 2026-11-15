<!--
  A segmented control for two to four exclusive choices (docs/UI.md section 3). Buttons in a group,
  each with aria-pressed, so a screen reader reads which one is chosen.
-->
<script lang="ts" generics="T extends string">
  let {
    label,
    options,
    value,
    onchange,
    disabled = false,
    testid,
  }: {
    label: string;
    options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
    value: T | undefined;
    onchange: (v: T) => void;
    disabled?: boolean;
    testid?: string | undefined;
  } = $props();
</script>

<div class="seg" role="group" aria-label={label} data-testid={testid}>
  {#each options as o (o.value)}
    <button
      type="button"
      aria-pressed={value === o.value}
      disabled={disabled || o.disabled === true}
      onclick={() => {
        onchange(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
  }
  button {
    border-radius: 0;
    margin-left: -1px;
  }
  button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
    margin-left: 0;
  }
  button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--text);
    background: var(--surface);
    position: relative;
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-underline-offset: 4px;
  }
</style>
