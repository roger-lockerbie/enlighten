<!--
  A confirmation for raising the ceiling and for unlocks (docs/UI.md section 3): it says what changes
  and asks for the new value or the unlock's name to be typed.
-->
<script lang="ts">
  import Dialog from './Dialog.svelte';

  let {
    open,
    title,
    lines,
    expect,
    confirmLabel,
    onconfirm,
    oncancel,
    testid,
  }: {
    open: boolean;
    title: string;
    lines: readonly string[];
    expect: string;
    confirmLabel: string;
    onconfirm: () => void;
    oncancel: () => void;
    testid?: string | undefined;
  } = $props();

  let typed = $state('');
  const matches = $derived(typed.trim() === expect);

  $effect(() => {
    if (!open) typed = '';
  });

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    if (matches) onconfirm();
  }
</script>

<Dialog {open} {title} onclose={oncancel} {testid}>
  <form class="stack" onsubmit={submit}>
    {#each lines as l, i (i)}<p>{l}</p>{/each}
    <label class="stack typed">
      <span>Type {expect} to confirm</span>
      <input type="text" autocomplete="off" spellcheck="false" bind:value={typed} />
    </label>
    <div class="row end">
      <button type="button" onclick={oncancel}>Cancel</button>
      <button type="submit" class="primary" disabled={!matches}>{confirmLabel}</button>
    </div>
  </form>
</Dialog>

<style>
  .typed {
    gap: var(--space-1);
  }
  .end {
    justify-content: flex-end;
  }
</style>
