<!--
  The console drawer (docs/UI.md section 2), a placeholder until Stage 6. It opens to 220 px, drags
  taller, and remembers its height. Ctrl-` shows or hides it and moves focus to it.
-->
<script lang="ts">
  import { DRAWER_MAX, DRAWER_MIN } from '../../store/schema.ts';
  import type { AppState } from '../state.svelte.ts';

  let { app }: { app: AppState } = $props();

  const height = $derived(app.prefs.drawerHeight);
  let dragFrom: { y: number; h: number } | undefined;

  const clamp = (h: number) => Math.round(Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, h)));

  function key(e: KeyboardEvent): void {
    const by = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowUp') app.update({ drawerHeight: clamp(height + by) });
    else if (e.key === 'ArrowDown') app.update({ drawerHeight: clamp(height - by) });
    else return;
    e.preventDefault();
  }
</script>

<section
  class="drawer"
  aria-labelledby="console-h"
  data-region="console"
  tabindex="-1"
  style:height={`${String(height)}px`}
  data-testid="console"
>
  <button
    type="button"
    class="grip"
    aria-label={`Console height ${String(height)} pixels. Up and Down to change it.`}
    onkeydown={key}
    onpointerdown={(e) => {
      dragFrom = { y: e.clientY, h: height };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onpointermove={(e) => {
      if (dragFrom !== undefined)
        app.update({ drawerHeight: clamp(dragFrom.h + dragFrom.y - e.clientY) });
    }}
    onpointerup={() => {
      dragFrom = undefined;
    }}
  ></button>
  <header class="row head">
    <h2 id="console-h">Console</h2>
    <span class="muted small"><kbd>Ctrl</kbd> <kbd>`</kbd> to hide</span>
  </header>
  <p class="muted mono">The console arrives in Stage 6.</p>
</section>

<style>
  .drawer {
    grid-area: console;
    position: relative;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: var(--space-2) var(--space-4);
    overflow: auto;
    font-family: var(--font-mono);
  }
  .grip {
    padding: 0;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
  }
  .grip:focus-visible {
    outline-offset: -2px;
  }
  .head {
    justify-content: space-between;
    font-family: var(--font-ui);
  }
</style>
