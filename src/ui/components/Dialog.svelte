<!--
  A dialog for confirmations only (docs/UI.md section 3). The native <dialog>, opened with show(), not
  showModal(), so the top bar and Panic stay live (SPEC S4.1). It keeps focus inside with its own trap
  and closes on Escape with its own handler. A scrim below the top bar keeps the page behind it still.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open,
    title,
    onclose,
    children,
    testid,
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    testid?: string | undefined;
  } = $props();

  let dlg = $state<HTMLDialogElement | undefined>(undefined);
  let returnTo: HTMLElement | undefined;
  const uid = $props.id();
  const titleId = `dialog-${uid}`;

  const FOCUSABLE =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    return dlg === undefined ? [] : [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }

  $effect(() => {
    const d = dlg;
    if (d === undefined) return;
    if (open && !d.open) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      d.show();
      (focusables()[0] ?? d).focus();
    } else if (!open && d.open) {
      d.close();
      returnTo?.focus();
      returnTo = undefined;
    }
  });

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // The page's own double-Escape panic listens first, on the window, in the capture phase.
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    const first = f[0];
    const last = f.at(-1);
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}<div class="scrim" aria-hidden="true"></div>{/if}
<dialog bind:this={dlg} aria-labelledby={titleId} onkeydown={key} data-testid={testid}>
  <h2 id={titleId}>{title}</h2>
  {@render children()}
</dialog>

<style>
  .scrim {
    position: fixed;
    inset: var(--topbar) 0 0 0;
    background: rgb(5 5 6 / 70%);
    z-index: 20;
  }
  dialog {
    position: fixed;
    top: calc(var(--topbar) + var(--space-6));
    left: 50%;
    translate: -50% 0;
    margin: 0;
    z-index: 21;
    width: min(32rem, calc(100vw - 2 * var(--space-6)));
    max-height: calc(100vh - var(--topbar) - 2 * var(--space-6));
    overflow: auto;
    background: var(--raised);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: var(--space-5);
  }
  h2 {
    margin-bottom: var(--space-3);
  }
</style>
